import { describe, expect, it } from "vitest";
import { filmTone, fitWithin, segmentRects, stampText } from "@/lib/image/film";

describe("fitWithin", () => {
  it("긴 변을 기준으로 비율을 지켜 줄인다", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("작은 사진은 키우지 않는다", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("아주 길쭉한 사진도 한 변이 0이 되지 않는다", () => {
    expect(fitWithin(10000, 2, 400)).toEqual({ width: 400, height: 1 });
  });
});

describe("stampText", () => {
  it("연·월·일을 두 자리씩 새긴다", () => {
    expect(stampText(new Date(2026, 11, 5))).toBe("'26 12 05");
    expect(stampText(new Date(2027, 0, 31))).toBe("'27 01 31");
  });
});

describe("filmTone", () => {
  it("검정은 살짝 뜨고 흰색은 범위를 넘지 않는다", () => {
    const [r, g, b] = filmTone(0, 0, 0);
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    for (const v of filmTone(255, 255, 255)) expect(v).toBeLessThanOrEqual(255);
  });

  it("회색을 따뜻한 쪽으로 기울인다", () => {
    const [r, , b] = filmTone(128, 128, 128);
    expect(r).toBeGreaterThan(b);
  });

  it("모서리는 가운데보다 어둡다", () => {
    const center = filmTone(180, 180, 180, 0);
    const corner = filmTone(180, 180, 180, 1);
    expect(corner[0]).toBeLessThan(center[0]);
  });

  it("값은 항상 0~255 안에 있다", () => {
    for (const grain of [-1, 1]) {
      for (const v of [...filmTone(0, 0, 0, 1, grain), ...filmTone(255, 255, 255, 0, grain)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("segmentRects", () => {
  it("숫자마다 켜지는 세그먼트 수가 맞다", () => {
    const count = (ch: string) => segmentRects(ch, 10, 18).length;
    expect(count("8")).toBe(7);
    expect(count("1")).toBe(2);
    expect(count("7")).toBe(3);
    expect(count("0")).toBe(6);
  });

  it("모든 세그먼트는 글자 칸 안에 있다", () => {
    for (const ch of "0123456789'") {
      for (const r of segmentRects(ch, 10, 18)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(10);
        expect(r.y + r.h).toBeLessThanOrEqual(18);
      }
    }
  });

  it("빈칸과 모르는 글자는 아무것도 그리지 않는다", () => {
    expect(segmentRects(" ", 10, 18)).toEqual([]);
    expect(segmentRects("x", 10, 18)).toEqual([]);
  });
});
