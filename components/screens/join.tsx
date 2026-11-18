"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Sprockets } from "@/components/film";
import { Button, Field, Notice, Spinner, inputClass, messageFor } from "@/components/ui";
import { ensureAuth, joinTrip, peekTrip } from "@/lib/api";
import { useSession } from "@/lib/session";
import { isConfigured } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

interface Peeked {
  code: string;
  title: string;
  tripDate: string;
  teams: string[];
  role: Role;
}

const subscribeNever = () => () => {};
const readSearch = () => window.location.search;

export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function Masthead() {
  return (
    <header className="px-6 pt-[max(env(safe-area-inset-top),28px)] pb-6">
      <Sprockets />
      <div className="py-7">
        <p className="label text-kodak">ISO 400 · 24 EXP</p>
        <h1 className="pt-2 text-[44px] leading-[1.05] font-black tracking-tight">
          북맵<span className="text-kodak">.</span>
        </h1>
        <p className="pt-3 text-[16px] leading-relaxed text-dim">
          한 사람에 필름 한 통, 스물네 컷.
          <br />
          다 찍고 나면 함께 현상합니다.
        </p>
      </div>
      <Sprockets />
    </header>
  );
}

export function SetupNotice() {
  return (
    <div className="px-6">
      <Notice tone="warn">
        서버 연결 정보가 아직 없습니다. <code>.env.local</code>에 Supabase 주소와 공개 키를 넣어 주세요. 자세한 방법은
        README에 있습니다.
      </Notice>
    </div>
  );
}

export function JoinScreen() {
  const router = useRouter();
  const session = useSession();
  // QR로 들어오면 주소에 코드가 붙어 있다. 직접 입력하기 전까지는 그 값을 쓴다.
  const search = useSyncExternalStore(subscribeNever, readSearch, () => "");
  const params = new URLSearchParams(search);
  const urlCode = (params.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const [typedCode, setCode] = useState<string | null>(null);
  const code = typedCode ?? urlCode;
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [wantsAnother, setJoiningAnother] = useState<boolean | null>(null);
  const joiningAnother = wantsAnother ?? (urlCode !== "" || params.has("join"));
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookUp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureAuth();
      const out = await peekTrip(code);
      if (!out.ok) {
        setError(messageFor(out.error));
        return;
      }
      setPeeked({ code, title: out.title, tripDate: out.trip_date, teams: out.teams, role: out.role });
      setTeam(out.teams.length === 1 ? out.teams[0] : "");
    } catch {
      setError(messageFor("NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (!peeked) return;
    setBusy(true);
    setError(null);
    try {
      const out = await joinTrip({ code: peeked.code, name, team, pin });
      if (!out.ok) {
        const left = typeof out.attempts_left === "number" ? ` (남은 기회 ${out.attempts_left}번)` : "";
        setError(messageFor(out.error) + (out.error === "WRONG_PIN" ? left : ""));
        return;
      }
      session.select(out.trip_id);
      await session.refresh();
      router.replace(out.role === "teacher" ? "/teacher" : "/camera");
    } catch {
      setError(messageFor("NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <main className="app-shell">
        <Masthead />
        <SetupNotice />
      </main>
    );
  }

  const hasTrips = session.memberships.length > 0;
  const showResume = hasTrips && !joiningAnother && !peeked;

  return (
    <main className="app-shell pb-12">
      <Masthead />

      {session.status === "loading" ? (
        <div className="flex justify-center py-10 text-dim">
          <Spinner />
        </div>
      ) : showResume ? (
        <section className="flex flex-col gap-3 px-6">
          <p className="label">이어서 들어가기</p>
          {session.memberships.map(({ trip, member }) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => {
                session.select(trip.id);
                router.push(member.role === "teacher" ? "/teacher" : "/camera");
              }}
              className="leather flex items-center justify-between rounded-xl border border-line px-4 py-4 text-left active:border-kodak"
            >
              <span>
                <span className="block text-[17px] font-bold">{trip.title}</span>
                <span className="block pt-0.5 text-[13px] text-dim">
                  {formatDate(trip.trip_date)} · {member.name}
                  {member.role === "teacher" ? " 선생님" : member.team ? ` · ${member.team}` : ""}
                </span>
              </span>
              <span className="text-kodak" aria-hidden>
                →
              </span>
            </button>
          ))}
          <Button tone="quiet" onClick={() => setJoiningAnother(true)}>
            다른 기행에 입장하기
          </Button>
        </section>
      ) : !peeked ? (
        <form onSubmit={lookUp} className="flex flex-col gap-4 px-6">
          <Field label="참가 코드" hint="선생님이 알려 준 코드를 넣어 주세요." error={error}>
            {(props) => (
              <input
                {...props}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                className={`${inputClass} text-center font-mono text-[24px] tracking-[0.3em]`}
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="······"
              />
            )}
          </Field>
          <Button type="submit" tone="primary" wide busy={busy} disabled={code.length < 6}>
            다음
          </Button>
          {hasTrips ? (
            <Button type="button" tone="quiet" onClick={() => setJoiningAnother(false)}>
              돌아가기
            </Button>
          ) : (
            <Link href="/new" className="pt-2 text-center text-[14px] text-dim underline underline-offset-4">
              선생님이신가요? 새 기행 만들기
            </Link>
          )}
        </form>
      ) : (
        <form onSubmit={join} className="flex flex-col gap-5 px-6">
          <div className="leather rounded-xl border border-line px-4 py-4">
            <p className="label text-kodak">{peeked.role === "teacher" ? "교사로 입장" : "입장할 기행"}</p>
            <p className="pt-1 text-[19px] font-bold">{peeked.title}</p>
            <p className="text-[13px] text-dim">{formatDate(peeked.tripDate)}</p>
          </div>

          <Field label="이름">
            {(props) => (
              <input
                {...props}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                maxLength={20}
                autoComplete="name"
                enterKeyHint="next"
                placeholder="홍길동"
              />
            )}
          </Field>

          {peeked.role === "student" && peeked.teams.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="label pb-1.5">모둠</legend>
              <div className="flex flex-wrap gap-2">
                {peeked.teams.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={team === t}
                    onClick={() => setTeam(t)}
                    className={`min-h-11 rounded-full border px-4 text-[15px] ${
                      team === t ? "border-kodak bg-kodak font-bold text-body" : "border-line bg-well text-ink"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <Field
            label="PIN 네 자리"
            hint="처음이면 지금 넣는 숫자가 내 PIN이 됩니다. 다시 들어올 때 필요하니 기억해 주세요."
            error={error}
          >
            {(props) => (
              <input
                {...props}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className={`${inputClass} text-center font-mono text-[24px] tracking-[0.5em]`}
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="····"
              />
            )}
          </Field>

          <Button
            type="submit"
            tone="primary"
            wide
            busy={busy}
            disabled={
              name.trim().length === 0 ||
              pin.length !== 4 ||
              (peeked.role === "student" && peeked.teams.length > 0 && !team)
            }
          >
            필름 받기
          </Button>
          <Button
            type="button"
            tone="quiet"
            onClick={() => {
              setPeeked(null);
              setError(null);
              setPin("");
            }}
          >
            코드 다시 넣기
          </Button>
        </form>
      )}
    </main>
  );
}
