import { PHOTO_MAX, THUMB_MAX, filmTone, fitWithin, segmentRects, stampText } from "@/lib/image/film";

export interface ProcessedPhoto {
  photo: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decode(file: Blob): Promise<{ source: Drawable; width: number; height: number; release: () => void }> {
  // createImageBitmap은 사진의 회전 정보(EXIF)를 반영해 준다.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 일부 브라우저는 특정 형식에서 실패한다. 아래 방식으로 다시 시도한다.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("UNSUPPORTED_IMAGE");
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("ENCODE_FAILED"))), "image/jpeg", quality);
  });
}

function applyFilmLook(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const vignette = Math.hypot(x - cx, y - cy) / maxDist;
      const grain = Math.random() * 2 - 1;
      const [r, g, b] = filmTone(px[i], px[i + 1], px[i + 2], vignette, grain);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** 오른쪽 아래에 주황색 날짜를 새긴다. */
function drawDateStamp(ctx: CanvasRenderingContext2D, width: number, height: number, date: Date) {
  const text = stampText(date);
  const digitH = Math.round(Math.min(width, height) * 0.042);
  const digitW = Math.round(digitH * 0.56);
  const gap = Math.round(digitW * 0.38);
  const advance = (ch: string) => (ch === " " ? digitW * 0.7 : ch === "'" ? digitW * 0.55 : digitW + gap);
  const total = [...text].reduce((sum, ch) => sum + advance(ch), 0);
  const margin = Math.round(Math.min(width, height) * 0.045);
  let x = width - margin - total;
  const y = height - margin - digitH;

  ctx.save();
  ctx.fillStyle = "#ff8a1f";
  ctx.shadowColor = "rgba(255, 110, 20, 0.85)";
  ctx.shadowBlur = digitH * 0.35;
  for (const ch of text) {
    for (const r of segmentRects(ch, digitW, digitH)) {
      ctx.fillRect(Math.round(x + r.x), Math.round(y + r.y), Math.ceil(r.w), Math.ceil(r.h));
    }
    x += advance(ch);
  }
  ctx.restore();
}

/**
 * 찍은 사진을 올리기 좋게 만든다: 1600px로 줄이고, 필름 색감과 날짜를 입히고,
 * 400px 미리보기를 함께 만든다. 원본은 남기지 않는다.
 */
export async function processPhoto(file: Blob, takenAt: Date): Promise<ProcessedPhoto> {
  const decoded = await decode(file);
  try {
    const size = fitWithin(decoded.width, decoded.height, PHOTO_MAX);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
    applyFilmLook(ctx, size.width, size.height);
    drawDateStamp(ctx, size.width, size.height, takenAt);

    const thumbSize = fitWithin(size.width, size.height, THUMB_MAX);
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = thumbSize.width;
    thumbCanvas.height = thumbSize.height;
    const thumbCtx = thumbCanvas.getContext("2d");
    if (!thumbCtx) throw new Error("CANVAS_UNAVAILABLE");
    thumbCtx.imageSmoothingQuality = "high";
    thumbCtx.drawImage(canvas, 0, 0, thumbSize.width, thumbSize.height);

    const [photo, thumb] = await Promise.all([toJpeg(canvas, 0.82), toJpeg(thumbCanvas, 0.72)]);
    return { photo, thumb, width: size.width, height: size.height };
  } finally {
    decoded.release();
  }
}
