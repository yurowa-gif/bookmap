"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "plain" | "danger" | "quiet";
  busy?: boolean;
  wide?: boolean;
};

const tones: Record<NonNullable<ButtonProps["tone"]>, string> = {
  primary: "bg-kodak text-body font-bold shadow-[0_2px_0_var(--color-kodak-deep)] active:translate-y-px active:shadow-none",
  plain: "bg-well text-ink border border-line active:bg-line",
  danger: "bg-safelight text-white font-bold active:brightness-90",
  quiet: "text-dim active:text-ink",
};

export function Button({ tone = "plain", busy, wide, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-[15px] transition disabled:opacity-40 ${
        wide ? "w-full" : ""
      } ${tones[tone]} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="처리 중"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const noteId = id + "-note";
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, "aria-describedby": note ? noteId : undefined, "aria-invalid": error ? true : undefined })}
      {note ? (
        <p id={noteId} className={`text-[13px] ${error ? "text-safelight" : "text-faint"}`}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-lg border border-line bg-well px-3.5 text-[16px] text-ink placeholder:text-faint focus:border-kodak focus:outline-none";

/** 화면 아래에서 올라오는 시트. 바깥을 누르거나 Esc로 닫는다. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-rise relative flex max-h-[88dvh] w-full max-w-[480px] flex-col rounded-t-2xl border-t border-line bg-panel pb-[max(env(safe-area-inset-bottom),16px)] outline-none"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-2 min-h-11 px-3 text-dim" aria-label="닫기">
            닫기
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-2">{children}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; tone: "info" | "error" };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = nextId.current++;
    setToasts([{ id, text, tone }]); // 한 번에 하나만 보여 준다
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2400);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(74px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-rise max-w-[440px] rounded-lg px-4 py-2.5 text-[14px] shadow-lg ${
              toast.tone === "error" ? "bg-safelight text-white" : "bg-ink text-body"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-lg border px-3.5 py-3 text-[14px] leading-relaxed ${
        tone === "warn" ? "border-stamp/40 bg-stamp/10 text-ink" : "border-line bg-well text-dim"
      }`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-[16px] font-semibold">{title}</p>
      {children ? <p className="max-w-[30ch] text-[14px] leading-relaxed text-dim">{children}</p> : null}
    </div>
  );
}

/** 서버가 돌려준 코드를 사람이 읽을 문장으로 바꾼다. */
export function messageFor(code: string): string {
  const table: Record<string, string> = {
    INVALID_CODE: "코드가 맞지 않아요. 다시 확인해 주세요.",
    LOCKED: "여러 번 틀려서 잠시 잠겼어요. 10분 뒤에 다시 해 주세요.",
    BAD_INPUT: "입력한 내용을 다시 확인해 주세요.",
    BAD_TEAM: "모둠을 골라 주세요.",
    NAME_TAKEN: "이미 쓰이는 이름이에요. 이름 뒤에 숫자를 붙여 주세요.",
    WRONG_PIN: "PIN이 맞지 않아요.",
    TRIP_FULL: "이 기행은 인원이 가득 찼어요. 선생님께 알려 주세요.",
    NO_FILM: "필름을 다 썼어요.",
    NOT_UPLOADED: "사진이 아직 다 올라가지 않았어요.",
    INTRO_TAKEN: "다른 친구가 먼저 쓴 소개글이에요.",
    NOT_MEMBER: "이 기행에 들어와 있지 않아요. 다시 입장해 주세요.",
    NOT_TEACHER: "선생님만 할 수 있어요.",
    NOT_OWNER: "내 컷이 아니에요.",
    UNSUPPORTED_IMAGE: "이 사진은 열 수 없어요. 다시 찍어 주세요.",
    NETWORK: "통신이 원활하지 않아요. 연결되면 자동으로 다시 보냅니다.",
  };
  return table[code] ?? "문제가 생겼어요. 잠시 뒤 다시 해 주세요.";
}
