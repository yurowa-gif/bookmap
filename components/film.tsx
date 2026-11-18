"use client";

import { STAMP_LABEL, type StampKind } from "@/lib/types";

/** 카메라 윗면의 컷 카운터. 숫자가 바뀌면 드럼이 돌아가듯 굴러간다. */
export function Counter({ value, label }: { value: number; label: string }) {
  const digits = String(Math.max(0, Math.min(99, value))).padStart(2, "0");
  return (
    <div className="flex flex-col items-center gap-1" role="status" aria-label={`${label} ${value}`}>
      <div className="flex gap-px rounded-md bg-black p-1 shadow-[inset_0_2px_6px_rgb(0_0_0/0.9),0_1px_0_rgb(255_255_255/0.08)]">
        {[...digits].map((digit, index) => (
          <div key={index} className="relative h-11 w-8 overflow-hidden rounded-[3px] bg-[#f4efe2]">
            <div
              className="absolute inset-x-0 top-0 transition-transform duration-500 ease-[cubic-bezier(0.3,1.3,0.5,1)]"
              style={{ transform: `translateY(-${Number(digit) * 2.75}rem)` }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <div
                  key={n}
                  className="tabular flex h-11 items-center justify-center text-[26px] leading-none font-extrabold text-[#1c1a17]"
                >
                  {n}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30" />
          </div>
        ))}
      </div>
      <span className="label" aria-hidden>
        {label}
      </span>
    </div>
  );
}

/** 셔터 버튼 */
export function Shutter({
  onPress,
  disabled,
  label = "찍기",
}: {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      className="group relative size-[92px] rounded-full bg-[#2a2620] p-[7px] shadow-[0_6px_14px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.12)] transition active:scale-95 disabled:opacity-40"
    >
      <span className="block size-full rounded-full bg-kodak shadow-[inset_0_-5px_0_var(--color-kodak-deep),inset_0_2px_0_rgb(255_255_255/0.5)] group-active:shadow-[inset_0_2px_6px_rgb(0_0_0/0.4)]" />
    </button>
  );
}

export function Sprockets() {
  return <div className="sprockets" aria-hidden />;
}

/** 필름 띠 한 줄. 위아래에 구멍이 있다. */
export function FilmStrip({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="film-base rounded-[4px] px-2 py-1.5">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-[11px] font-bold tracking-[0.16em] text-kodak uppercase">{title}</h3>
        {meta ? <span className="tabular text-[11px] text-stamp">{meta}</span> : null}
      </div>
      <Sprockets />
      <div className="grid grid-cols-4 gap-1 py-1">{children}</div>
      <Sprockets />
    </section>
  );
}

export type CellState = "photo" | "sending" | "rejected" | "discarded" | "sealed" | "unused";

/** 필름 프레임 한 칸 */
export function FrameCell({
  no,
  state,
  src,
  onOpen,
  reveal,
  hidden,
  stamped,
}: {
  no: number;
  state: CellState;
  src?: string;
  onOpen?: () => void;
  /** 현상 연출을 보여 줄지 */
  reveal?: boolean;
  hidden?: boolean;
  stamped?: number;
}) {
  const number = (
    <span className="tabular absolute top-0.5 left-1 z-10 text-[9px] font-bold text-stamp/90 drop-shadow-[0_1px_1px_rgb(0_0_0/0.8)]">
      {no}
    </span>
  );
  const base = "relative aspect-square overflow-hidden rounded-frame";

  if ((state === "photo" || state === "sending") && src) {
    return (
      <button type="button" onClick={onOpen} className={`${base} bg-black`} aria-label={`${no}번 컷 보기`}>
        {number}
        {/* 사진 주소는 서명된 임시 주소라 next/image 최적화를 거치지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          className={`size-full object-cover ${reveal ? "animate-develop" : ""} ${hidden ? "opacity-35" : ""}`}
          style={reveal ? { animationDelay: `${(no % 8) * 90}ms` } : undefined}
        />
        {state === "sending" ? (
          <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[9px] text-kodak">전송 대기</span>
        ) : null}
        {hidden ? (
          <span className="absolute inset-x-0 bottom-0 bg-safelight/90 py-0.5 text-center text-[9px] text-white">숨김</span>
        ) : null}
        {stamped ? (
          <span className="tabular absolute right-1 bottom-1 rounded-full bg-safelight px-1.5 text-[9px] font-bold text-white">
            {stamped}
          </span>
        ) : null}
      </button>
    );
  }

  const content: Record<Exclude<CellState, "photo">, { text: string; className: string }> = {
    sending: { text: "전송 대기", className: "bg-[#2b2620] text-kodak" },
    rejected: { text: "전송 실패", className: "bg-safelight/25 text-safelight" },
    discarded: { text: "버림", className: "bg-[#15130f] text-faint line-through" },
    sealed: { text: "미현상", className: "bg-[#3a1512] text-safelight/80" },
    unused: { text: "", className: "bg-[#15130f]" },
  };
  const { text, className } = content[state === "photo" ? "sending" : state];

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={`${base} ${className} flex items-center justify-center text-[9px]`}>
        {number}
        {text}
      </button>
    );
  }
  return (
    <div className={`${base} ${className} flex items-center justify-center text-[9px]`}>
      {number}
      {text}
    </div>
  );
}

/** 인화지에 뽑은 사진 한 장 */
export function Print({
  src,
  caption,
  meta,
  children,
}: {
  src?: string;
  caption?: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <figure className="rounded-[2px] bg-paper p-3 pb-4 text-paper-ink shadow-[0_10px_30px_rgb(0_0_0/0.6)]">
      <div className="overflow-hidden bg-black">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={caption || "기행 사진"} className="max-h-[58dvh] w-full object-contain" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-[13px] text-faint">사진을 불러오는 중</div>
        )}
      </div>
      <figcaption className="pt-3">
        {caption ? <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{caption}</p> : null}
        {meta ? <p className="pt-1 text-[12px] text-paper-ink/55">{meta}</p> : null}
        {children}
      </figcaption>
    </figure>
  );
}

const STAMP_SHAPE: Record<StampKind, string> = {
  good: "rounded-full",
  funny: "rounded-[40%_60%_55%_45%]",
  moving: "rounded-lg",
  wow: "rounded-full",
  literary: "rounded-[6px]",
};

/** 도장 하나. 종이에 찍힌 것처럼 살짝 기울어 있다. */
export function StampMark({
  kind,
  count,
  active,
  onPress,
}: {
  kind: StampKind;
  count: number;
  active: boolean;
  onPress?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={!onPress}
      aria-pressed={active}
      className={`flex min-h-11 -rotate-2 items-center gap-1.5 border-2 px-2.5 text-[12px] font-bold transition ${STAMP_SHAPE[kind]} ${
        active
          ? "border-safelight bg-safelight/10 text-safelight"
          : "border-paper-ink/25 text-paper-ink/45 enabled:active:border-safelight/60"
      }`}
    >
      {STAMP_LABEL[kind]}
      {count > 0 ? <span className="tabular">{count}</span> : null}
    </button>
  );
}
