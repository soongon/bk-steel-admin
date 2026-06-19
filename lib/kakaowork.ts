// 카카오워크 Incoming Webhook 알림 — 시스템 주요 이벤트를 운영 채팅방으로 전송.
// 본 작업(매출 등록 등)을 막지 않도록 best-effort(실패해도 무시). lib/solapi.ts 패턴 미러.
//
// 셋업: 카카오워크 → 확장 서비스 → Incoming Webhook → Bot 만들기 → 채팅방 선택 → Webhook URL.
// env: KAKAOWORK_WEBHOOK_URL(필수), APP_BASE_URL(딥링크 베이스, 선택).

const webhookUrl = () => process.env.KAKAOWORK_WEBHOOK_URL;
const appBase = () => (process.env.APP_BASE_URL ?? "https://bk-steel-admin.vercel.app").replace(/\/$/, "");

/** 관리자 딥링크(알림에서 클릭 → 해당 화면). */
export function adminUrl(path: string): string {
  return `${appBase()}${path.startsWith("/") ? path : "/" + path}`;
}

/** 금액 표기(₩1,100,000). */
export function fmtWon(n: number | string): string {
  return "₩" + Math.round(Number(n) || 0).toLocaleString("ko-KR");
}

/** 카카오워크 웹훅 전송. 미설정/실패 시 {ok:false, error}. */
export async function sendKakaoWork(text: string): Promise<{ ok: boolean; error?: string }> {
  const url = webhookUrl();
  if (!url) return { ok: false, error: "KAKAOWORK_WEBHOOK_URL 미설정" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { ok: false, error: `webhook ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "전송 실패" };
  }
}

/** 본 작업을 막지 않는 알림(에러는 삼킨다). 서버액션·크론 공용. */
export async function notifyKakaoWork(text: string): Promise<void> {
  try {
    await sendKakaoWork(text);
  } catch {
    /* best-effort */
  }
}
