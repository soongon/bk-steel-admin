// 업로드 전 사진 축소·재인코딩(클라이언트 전용).
// 휴대폰 원본(3~12MB)은 서버 액션 본문 상한(4MB, next.config)·첨부 버킷 상한(5MB)을 넘기 쉽다 —
// 긴 변 maxEdge 의 JPEG 로 줄여 보낸다. 재인코딩이라 EXIF(촬영 위치 등)도 함께 빠진다.
// HEIC: 브라우저가 직접 읽으면(Safari·iOS) 그대로, 못 읽으면(Chrome·Edge·Firefox·Android) 그때만 변환 도구(heic-to, 약 800KB)를
// 받아 읽는다. 어느 쪽이든 저장은 JPEG — 버킷·서버는 HEIC 를 모른다.

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** 변환 도구를 못 받았거나 멈춤 — 다음 사진도 같은 결과이므로 호출측이 남은 장을 멈춘다(토스트 한 번). */
export class ImageConvertStoppedError extends Error {}

const READ_ERROR = "이미지를 읽지 못했습니다 — 사진 파일(JPEG·PNG·WebP·HEIC)을 골라 주세요.";
const HEIC_READ_ERROR = "HEIC 사진을 읽지 못했습니다 — 파일이 손상됐을 수 있습니다. JPEG 로 바꾸거나 다시 찍어 주세요.";
/** 도구 받기·1장 변환 각각의 제한 시간(48MP 도 PC 에서 5초 안팎). */
const HEIC_TIMEOUT_MS = 60_000;

/** ISO BMFF ftyp 상자에서 브랜드를 읽어 HEIC/HEIF 인지 — 파일 이름·형식(윈도우는 빈 값)을 믿지 않고 내용으로 본다. AVIF 는 제외. */
export function isHeicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number) => String.fromCharCode(bytes[from], bytes[from + 1], bytes[from + 2], bytes[from + 3]);
  if (ascii(4) !== "ftyp") return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(boxSize, bytes.length);
  const brands = [ascii(8)]; // major
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(at)); // compatible (12~15 는 minor version)
  if (brands.some((b) => b === "avif" || b === "avis")) return false;
  return brands.some((b) => ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"].includes(b));
}

/** 응답이 없으면 ImageConvertStoppedError — 창이 잠긴 채 끝나지 않는 일을 막는다. 늦은 결과·실패는 race 가 받아 흘려보낸다. */
async function stopAfter<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ImageConvertStoppedError(message)), HEIC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function decodeHeic(file: File): Promise<Decoded> {
  const loadError = "HEIC 변환 도구를 받지 못했습니다 — 연결을 확인하고 새로고침한 뒤 다시 해 주세요.";
  let heicTo: typeof import("heic-to").heicTo;
  try {
    ({ heicTo } = await stopAfter(import("heic-to"), loadError));
  } catch {
    throw new ImageConvertStoppedError(loadError); // 약한 신호, 또는 재배포 직후 옛 조각이 사라진 경우
  }
  let abandoned = false;
  const converting = heicTo({ blob: file, type: "bitmap" }).then((bitmap) => {
    if (abandoned) bitmap.close(); // 시간 초과 뒤 늦게 끝난 결과는 버린다
    return bitmap;
  });
  try {
    const bitmap = await stopAfter(converting, "HEIC 변환이 멈췄습니다 — 새로고침한 뒤 몇 장씩 나눠 올려 주세요.");
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch (e) {
    if (e instanceof ImageConvertStoppedError) {
      abandoned = true;
      throw e;
    }
    throw new Error(HEIC_READ_ERROR); // 도구는 문자열로 거부하기도 한다 — 호출측이 보여 줄 수 있게 Error 로
  }
}

// <img> 로 디코딩 — 주요 브라우저는 <img>·drawImage 모두 EXIF 회전을 반영한다(세로로 찍은 명함이 눕지 않게).
async function decode(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    const head = new Uint8Array(await file.slice(0, 256).arrayBuffer().catch(() => new ArrayBuffer(0))); // 못 읽는 파일(옮겨짐 등)은 READ_ERROR 로
    if (isHeicHeader(head)) return decodeHeic(file);
    throw new Error(READ_ERROR);
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => {
      img.src = "";
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * 파일 고르기 accept — PC 브라우저(Safari 제외)는 HEIC 를 명시한다. image/* 에 HEIC 가 들어가는지는 OS 설정에 달렸다(코덱 없는 Windows 등).
 * 휴대폰·Safari 는 image/* 그대로 — 목록을 바꾸면 사진 선택창·자동 변환 동작이 달라질 수 있다. 다이얼로그 안 입력칸용(닫힌 창은 서버에서 그리지 않음).
 */
export function imageAccept(): string {
  if (typeof navigator === "undefined") return "image/*";
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  return mobile || safari ? "image/*" : "image/*,.heic,.heif";
}

/** file 을 긴 변 maxEdge 이하 JPEG File 로 변환(작은 사진도 재인코딩 — 메타데이터 제거). */
export async function compressImage(
  file: File,
  { maxEdge = 2000, quality = 0.85 }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  const img = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    if (!img.width || !img.height) throw new Error("이미지 크기를 읽지 못했습니다.");
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
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
    canvas.width = canvas.height = 0; // 여러 장 연속 처리 때 캔버스 메모리를 바로 돌려준다(휴대폰)
    img.release();
  }
}
