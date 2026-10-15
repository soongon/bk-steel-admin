// 업로드 전 사진 축소·재인코딩(클라이언트 전용).
// 휴대폰 원본(3~12MB)은 서버 액션 본문 상한(4MB, next.config)·첨부 버킷 상한(5MB)을 넘기 쉽다 —
// 긴 변 maxEdge 의 JPEG 로 줄여 보낸다. 재인코딩이라 EXIF(촬영 위치 등)도 함께 빠진다.
// 브라우저가 디코딩할 수 있는 사진이면 형식과 무관하게 JPEG 로 바뀐다(Safari 의 HEIC 포함).

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

// <img> 로 디코딩 — 주요 브라우저는 <img>·drawImage 모두 EXIF 회전을 반영한다(세로로 찍은 명함이 눕지 않게).
async function decode(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("이미지를 읽지 못했습니다 — 사진 파일(JPEG·PNG·WebP)을 골라 주세요.");
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/** file 을 긴 변 maxEdge 이하 JPEG File 로 변환(작은 사진도 재인코딩 — 메타데이터 제거). */
export async function compressImage(
  file: File,
  { maxEdge = 2000, quality = 0.85 }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new Error("이미지 크기를 읽지 못했습니다.");
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 변환하지 못했습니다.");
    ctx.fillStyle = "#ffffff"; // 투명 PNG → 흰 배경(JPEG 는 투명 없음)
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("이미지를 변환하지 못했습니다.");
    const base = file.name.replace(/\.[^.]*$/, "") || "image";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    img.release();
  }
}
