import "server-only";
import nodemailer from "nodemailer";
import { isEmailAddress } from "./address";

// 문서 메일 발송(SMTP) — 회사 메일 계정(Gmail·네이버·도메인 메일)으로 보낸다.
// 환경변수(서버 전용, Vercel 에 직접 입력): MAIL_SMTP_HOST·MAIL_SMTP_USER·MAIL_SMTP_PASS(앱 비밀번호)
//   + 선택 MAIL_SMTP_PORT(기본 465=SSL, 587=STARTTLS)·MAIL_FROM(보내는 주소, 기본 = USER).
// 미설정이면 isMailConfigured()=false → 화면 버튼이 '메일 설정 필요'로 비활성.

type MailConfig = { host: string; port: number; user: string; pass: string; from: string };

function mailConfig(): MailConfig | null {
  const host = process.env.MAIL_SMTP_HOST?.trim();
  const user = process.env.MAIL_SMTP_USER?.trim();
  const pass = process.env.MAIL_SMTP_PASS?.replace(/\s+/g, ""); // 앱 비밀번호는 'abcd efgh …' 처럼 띄어 보여 준다
  const from = process.env.MAIL_FROM?.trim() || user;
  const port = Number(process.env.MAIL_SMTP_PORT) || 465;
  // MAIL_FROM 은 주소만('이름 <주소>' 형식 X — 보내는 이름은 회사명으로 따로 붙는다). 형식이 틀리면 미설정으로 본다.
  if (!host || !user || !pass || !from || !isEmailAddress(from)) return null;
  return { host, port, user, pass, from };
}

export const isMailConfigured = () => mailConfig() !== null;

export type MailAttachment = { filename: string; content: Buffer; contentType: string; cid?: string };
/** rejected: 메일 서버가 받지 않은 주소(일부만 거부되면 나머지에는 발송된다). */
export type MailResult = { ok: true; rejected: string[] } | { ok: false; error: string };

// nodemailer 오류 → 직원용 안내. 봉투 단계 거부는 command 로 갈라 본다(MAIL FROM=보내는 쪽, RCPT TO=받는 쪽).
function friendlyMailError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; command?: string; response?: string; message?: string };
  const server = err?.response ? ` (${String(err.response).slice(0, 120)})` : "";
  if (err?.code === "EAUTH" || err?.responseCode === 535) return "메일 계정 인증에 실패했습니다 — 앱 비밀번호 설정을 확인하세요.";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS"].includes(err?.code ?? "")) {
    return "메일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.";
  }
  if (err?.code === "EMESSAGE" || err?.responseCode === 552) return `메일이 너무 크거나 메일 서버가 거부했습니다${server}.`;
  if (err?.code === "EENVELOPE" && err?.command === "RCPT TO") return `받는 메일 주소를 메일 서버가 거부했습니다. 주소를 확인하세요${server}.`;
  if (err?.code === "EENVELOPE") {
    return `보내는 메일 계정·주소를 메일 서버가 거부했습니다 — 관리자에게 메일 설정(MAIL_FROM·발송 한도) 확인을 요청하세요${server}.`;
  }
  return `메일을 보내지 못했습니다${err?.message ? ` (${String(err.message).slice(0, 120)})` : ""}.`;
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "::1";

/** 보내는 이름은 문서의 회사명(책별 company_profile.name), 주소는 MAIL_FROM. 답장도 그 주소로. */
export async function sendMail(msg: {
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments: MailAttachment[];
}): Promise<MailResult> {
  const cfg = mailConfig();
  if (!cfg) return { ok: false, error: "메일 발송 설정이 없습니다 — 관리자에게 회사 메일 계정 설정을 요청하세요." };
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    // 465 외(587 등)는 STARTTLS 를 강제 — 서버가 TLS 를 안 내밀면 앱 비밀번호를 평문으로 보내지 않고 실패. 로컬 시험용 SMTP 만 예외.
    requireTLS: cfg.port !== 465 && !isLocalHost(cfg.host),
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transporter.sendMail({
      from: { name: msg.fromName, address: cfg.from },
      replyTo: cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid })),
    });
    const rejected = ((info.rejected ?? []) as unknown[]).map((a) =>
      typeof a === "string" ? a : ((a as { address?: string })?.address ?? String(a)),
    );
    return { ok: true, rejected };
  } catch (e) {
    console.error("[mail] 발송 실패:", (e as { code?: string })?.code ?? "", (e as Error)?.message ?? e);
    return { ok: false, error: friendlyMailError(e) };
  } finally {
    transporter.close();
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();

/**
 * 문서 메일 구성 — 제목 '[회사] 거래명세서 …', 본문 인사 + 메모 + 회사 연락처, 첨부 PDF + 본문 미리보기 이미지.
 * docLabel: 거래명세서·견적서·매입견적서. title: 문서번호나 날짜(제목·파일명에 붙음).
 */
export function composeDocumentMail(p: {
  docLabel: string;
  title?: string | null;
  companyName: string;
  companyPhone?: string | null;
  note?: string | null;
  pdf: Buffer;
  previewJpeg: Buffer;
}): { subject: string; text: string; html: string; attachments: MailAttachment[] } {
  const titled = p.title ? `${p.docLabel} ${p.title}` : p.docLabel;
  const subject = `[${p.companyName}] ${titled}`;
  const note = p.note?.trim() ? p.note.trim().slice(0, 1000) : null;
  const sign = [p.companyName, p.companyPhone ? `전화 ${p.companyPhone}` : null].filter(Boolean).join("\n");
  // 조사는 문서명(…서 → '를')에만 붙인다 — 문서번호(…-001)에 붙이면 어색하다.
  const text = [
    `안녕하세요, ${p.companyName}입니다.`,
    `요청하신 ${p.docLabel}를 PDF로 첨부해 드립니다.`,
    p.title ? `문서: ${p.title}` : null,
    note,
    "",
    sign,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const html = `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.6;color:#111">
<p>안녕하세요, ${escapeHtml(p.companyName)}입니다.<br>요청하신 ${escapeHtml(p.docLabel)}를 PDF로 첨부해 드립니다.${p.title ? `<br>문서: ${escapeHtml(p.title)}` : ""}</p>
${note ? `<p style="white-space:pre-line">${escapeHtml(note)}</p>` : ""}
<p><img src="cid:doc-preview" alt="${escapeHtml(titled)}" style="max-width:100%;width:640px;border:1px solid #ddd"></p>
<p style="color:#555">${escapeHtml(sign).replace(/\n/g, "<br>")}</p>
</div>`;
  const base = fileSafe(titled) || p.docLabel;
  return {
    subject,
    text,
    html,
    attachments: [
      { filename: `${base}.pdf`, content: p.pdf, contentType: "application/pdf" },
      { filename: `${base}.jpg`, content: p.previewJpeg, contentType: "image/jpeg", cid: "doc-preview" },
    ],
  };
}
