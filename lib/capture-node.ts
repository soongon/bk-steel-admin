// 명세표·견적서·세금계산서 DOM → JPEG data URL 캡처(클라이언트 전용).
// MMS 이미지 상한(솔라피 200KB)을 넘지 않도록 폭·품질을 단계적으로 낮춰 재인코딩한다.
// html2canvas-pro: Tailwind4 oklch 색상 파싱(원조 html2canvas 는 실패). 동적 import(브라우저 전용).

/** data URL(base64) 의 실제 바이트 크기 추정. */
function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((b64.length * 3) / 4);
}

/** canvas 를 지정 폭으로 축소해 JPEG data URL 인코딩. */
function encode(canvas: HTMLCanvasElement, width: number, quality: number): string {
  if (canvas.width <= width) return canvas.toDataURL("image/jpeg", quality);
  const scaled = document.createElement("canvas");
  scaled.width = width;
  scaled.height = Math.round((canvas.height * width) / canvas.width);
  scaled.getContext("2d")?.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL("image/jpeg", quality);
}

/**
 * node 를 캡처해 maxBytes 이하 JPEG data URL 로 반환.
 * 폭(1400→900)·품질(0.85→0.5)을 단계적으로 낮춰가며 첫 번째로 상한 이하가 되는 이미지를 채택.
 * 라인이 많아 끝까지 못 줄이면 가장 작은 조합 결과를 그대로 반환(서버가 최종 가드).
 */
export async function captureNodeToJpeg(
  node: HTMLElement,
  maxBytes = 195_000,
): Promise<string> {
  const html2canvas = (await import("html2canvas-pro")).default;
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    imageTimeout: 15000,
  });

  const widths = [1400, 1200, 1000, 900];
  const qualities = [0.85, 0.75, 0.65, 0.55, 0.5];
  let smallest = encode(canvas, Math.min(canvas.width, widths[0]), qualities[0]);
  let smallestBytes = dataUrlBytes(smallest);

  for (const w of widths) {
    for (const q of qualities) {
      const url = encode(canvas, Math.min(canvas.width, w), q);
      const bytes = dataUrlBytes(url);
      if (bytes <= maxBytes) return url;
      if (bytes < smallestBytes) {
        smallest = url;
        smallestBytes = bytes;
      }
    }
  }
  return smallest; // 상한 이하로 못 줄인 경우(초장문) — 최소 크기 결과
}
