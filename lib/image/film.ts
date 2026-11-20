// 필름 색감과 날짜 스탬프의 계산 부분. 화면(canvas)에 의존하지 않아 테스트하기 쉽다.

export const PHOTO_MAX = 1600;
export const THUMB_MAX = 400;

/** 긴 변이 max를 넘지 않도록 비율을 지켜 줄인 크기. 작은 사진은 키우지 않는다. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 필름 카메라의 날짜 각인처럼 "'26 12 05" 꼴로 만든다. */
export function stampText(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `'${two(date.getFullYear() % 100)} ${two(date.getMonth() + 1)} ${two(date.getDate())}`;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * 한 픽셀에 필름 색감을 입힌다.
 * 암부를 살짝 띄우고(빛바램), 대비를 조금 올리고, 따뜻한 쪽으로 기울인다.
 * vignette는 0(가운데)~1(모서리), grain은 -1~1.
 */
export function filmTone(
  r: number,
  g: number,
  b: number,
  vignette = 0,
  grain = 0,
): [number, number, number] {
  const curve = (v: number) => {
    const x = v / 255;
    const contrasted = (x - 0.5) * 1.08 + 0.5;
    return (0.045 + contrasted * 0.935) * 255;
  };
  let rr = curve(r) * 1.045;
  let gg = curve(g) * 1.0;
  let bb = curve(b) * 0.93;

  // 채도를 조금 올린다.
  const luma = 0.299 * rr + 0.587 * gg + 0.114 * bb;
  rr = luma + (rr - luma) * 1.08;
  gg = luma + (gg - luma) * 1.08;
  bb = luma + (bb - luma) * 1.08;

  const shade = 1 - 0.32 * vignette * vignette;
  const noise = grain * 9;
  return [clamp(rr * shade + noise), clamp(gg * shade + noise), clamp(bb * shade + noise)];
}

/** 7세그먼트 숫자. 순서는 a(위) b(오른쪽 위) c(오른쪽 아래) d(아래) e(왼쪽 아래) f(왼쪽 위) g(가운데). */
export const SEGMENTS: Record<string, readonly boolean[]> = {
  "0": [true, true, true, true, true, true, false],
  "1": [false, true, true, false, false, false, false],
  "2": [true, true, false, true, true, false, true],
  "3": [true, true, true, true, false, false, true],
  "4": [false, true, true, false, false, true, true],
  "5": [true, false, true, true, false, true, true],
  "6": [true, false, true, true, true, true, true],
  "7": [true, true, true, false, false, false, false],
  "8": [true, true, true, true, true, true, true],
  "9": [true, true, true, true, false, true, true],
};

type Rect = { x: number; y: number; w: number; h: number };

/** 글자 하나의 켜진 세그먼트를 사각형 목록으로 돌려준다. (0,0)에서 시작하는 w×h 칸 기준. */
export function segmentRects(char: string, w: number, h: number): Rect[] {
  const t = Math.max(1, Math.round(w * 0.2)); // 세그먼트 굵기
  if (char === "'") return [{ x: w * 0.35, y: 0, w: t, h: h * 0.22 }];
  const on = SEGMENTS[char];
  if (!on) return [];
  const half = h / 2;
  const all: Rect[] = [
    { x: t, y: 0, w: w - 2 * t, h: t },
    { x: w - t, y: t * 0.5, w: t, h: half - t },
    { x: w - t, y: half + t * 0.5, w: t, h: half - t },
    { x: t, y: h - t, w: w - 2 * t, h: t },
    { x: 0, y: half + t * 0.5, w: t, h: half - t },
    { x: 0, y: t * 0.5, w: t, h: half - t },
    { x: t, y: half - t / 2, w: w - 2 * t, h: t },
  ];
  return all.filter((_, i) => on[i]);
}
