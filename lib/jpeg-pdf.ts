// JPEG 1장 → PDF 1쪽(서버 전용, 의존성 없음). 메일 첨부용 — 문서 화면을 캡처한 JPEG 를 DCTDecode 로 그대로 싣는다.
// 쪽 폭은 A4(595.28pt), 높이는 이미지 비율대로(A4 보다 짧으면 A4) — 줄이 많은 명세서도 한 쪽에 잘리지 않고 담긴다.

const A4_W = 595.28;
const A4_H = 841.89;

/** JPEG 의 SOF 마커에서 크기·색 성분 수를 읽는다(baseline·progressive 모두). */
export function jpegInfo(jpeg: Uint8Array): { width: number; height: number; components: number } {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("JPEG 이미지가 아닙니다.");
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpeg[i + 1];
    if (marker === 0xff) {
      i++; // 채움 바이트
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // 길이 없는 마커
      continue;
    }
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    // SOF0~SOF15 (DHT 0xC4·JPG 0xC8·DAC 0xCC 제외)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (jpeg[i + 5] << 8) | jpeg[i + 6];
      const width = (jpeg[i + 7] << 8) | jpeg[i + 8];
      const components = jpeg[i + 9];
      if (!width || !height) break;
      return { width, height, components };
    }
    if (marker === 0xda) break; // 스캔 시작 — SOF 없이 여기 오면 잘못된 파일
    i += 2 + len;
  }
  throw new Error("JPEG 크기를 읽지 못했습니다.");
}

const pdfHexString = (s: string) =>
  "<FEFF" +
  Array.from(s)
    .flatMap((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0xffff) return [cp];
      const v = cp - 0x10000;
      return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
    })
    .map((u) => u.toString(16).padStart(4, "0").toUpperCase())
    .join("") +
  ">";

/** JPEG 를 담은 PDF 바이트. margin(pt)은 쪽 가장자리 여백, title 은 문서 속성 제목(한글 가능). */
export function jpegToPdf(jpeg: Uint8Array, { margin = 18, title }: { margin?: number; title?: string } = {}): Buffer {
  const { width, height, components } = jpegInfo(jpeg);
  const colorSpace = components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
  const drawW = A4_W - margin * 2;
  const drawH = (height * drawW) / width;
  const pageH = Math.max(A4_H, drawH + margin * 2);
  const f = (n: number) => n.toFixed(2);

  const content = `q ${f(drawW)} 0 0 ${f(drawH)} ${f(margin)} ${f(pageH - margin - drawH)} cm /Im0 Do Q`;
  const decode = components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : ""; // Adobe CMYK JPEG 반전
  const objects: Array<string | Uint8Array[]> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(A4_W)} ${f(pageH)}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`,
    [
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${jpeg.length} >>\nstream\n`,
        "latin1",
      ),
      jpeg,
      Buffer.from("\nendstream", "latin1"),
    ],
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    `<< /Producer (bk-steel-admin)${title ? ` /Title ${pdfHexString(title)}` : ""} >>`,
  ];

  const parts: Uint8Array[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, idx) => {
    offsets.push(offset);
    const chunks = typeof obj === "string" ? [Buffer.from(`${idx + 1} 0 obj\n${obj}\nendobj\n`, "latin1")] : [
      Buffer.from(`${idx + 1} 0 obj\n`, "latin1"),
      ...obj,
      Buffer.from("\nendobj\n", "latin1"),
    ];
    for (const c of chunks) {
      parts.push(c);
      offset += c.length;
    }
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
