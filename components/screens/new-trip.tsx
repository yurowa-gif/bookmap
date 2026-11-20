"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Notice, inputClass, messageFor } from "@/components/ui";
import { SetupNotice } from "@/components/screens/join";
import { createTrip, ensureAuth } from "@/lib/api";
import { useSession } from "@/lib/session";
import { isConfigured } from "@/lib/supabase/client";

interface Created {
  tripId: string;
  joinCode: string;
  teacherCode: string;
}

export function splitTeams(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

export function NewTripScreen() {
  const router = useRouter();
  const session = useSession();
  const [adminCode, setAdminCode] = useState("");
  const [title, setTitle] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [teams, setTeams] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureAuth();
      const out = await createTrip({ adminCode, title, tripDate, teams: splitTeams(teams), teacherName, pin });
      if (!out.ok) {
        setError(out.error === "INVALID_CODE" ? "관리 코드가 맞지 않아요." : messageFor(out.error));
        return;
      }
      session.select(out.trip_id);
      await session.refresh();
      setCreated({ tripId: out.trip_id, joinCode: out.join_code, teacherCode: out.teacher_code });
    } catch {
      setError(messageFor("NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <main className="app-shell pt-10">
        <SetupNotice />
      </main>
    );
  }

  if (created) {
    return (
      <main className="app-shell flex flex-col gap-5 px-6 pt-[max(env(safe-area-inset-top),28px)] pb-12">
        <div>
          <p className="label text-kodak">기행이 만들어졌습니다</p>
          <h1 className="pt-1 text-[28px] font-black">{title}</h1>
        </div>
        <div className="leather rounded-xl border border-line p-4">
          <p className="label">학생 참가 코드</p>
          <p className="tabular pt-1 font-mono text-[34px] font-bold tracking-[0.2em] text-kodak">{created.joinCode}</p>
        </div>
        <div className="leather rounded-xl border border-line p-4">
          <p className="label">교사 코드</p>
          <p className="tabular pt-1 font-mono text-[26px] font-bold tracking-[0.16em]">{created.teacherCode}</p>
          <p className="pt-2 text-[13px] leading-relaxed text-dim">
            함께 가는 선생님께만 알려 주세요. 이 코드로 들어오면 모든 사진을 보고 현상할 수 있습니다.
          </p>
        </div>
        <Notice>두 코드는 교사 화면에서 언제든 다시 볼 수 있습니다.</Notice>
        <Button tone="primary" wide onClick={() => router.replace("/teacher")}>
          교사 화면으로
        </Button>
      </main>
    );
  }

  return (
    <main className="app-shell px-6 pt-[max(env(safe-area-inset-top),28px)] pb-12">
      <Link href="/" className="text-[14px] text-dim">
        ← 입장 화면
      </Link>
      <h1 className="pt-4 pb-6 text-[28px] font-black">새 기행 만들기</h1>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="관리 코드" hint="기행을 만들 수 있는 선생님만 아는 코드입니다.">
          {(props) => (
            <input
              {...props}
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              className={inputClass}
              type="password"
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="기행 이름">
          {(props) => (
            <input
              {...props}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              maxLength={60}
              placeholder="서촌 인문학기행"
            />
          )}
        </Field>
        <Field label="날짜">
          {(props) => (
            <input
              {...props}
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              className={inputClass}
              type="date"
            />
          )}
        </Field>
        <Field label="모둠" hint="쉼표로 나눠 적어 주세요. 비워 두면 학생이 직접 적습니다.">
          {(props) => (
            <input
              {...props}
              value={teams}
              onChange={(e) => setTeams(e.target.value)}
              className={inputClass}
              placeholder="1모둠, 2모둠, 3모둠"
            />
          )}
        </Field>
        <Field label="선생님 이름">
          {(props) => (
            <input
              {...props}
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              className={inputClass}
              maxLength={20}
              autoComplete="name"
            />
          )}
        </Field>
        <Field label="PIN 네 자리" hint="다른 기기에서 다시 들어올 때 씁니다." error={error}>
          {(props) => (
            <input
              {...props}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className={`${inputClass} text-center font-mono text-[24px] tracking-[0.5em]`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="····"
            />
          )}
        </Field>
        <Button
          type="submit"
          tone="primary"
          wide
          busy={busy}
          disabled={!adminCode || !title.trim() || !tripDate || !teacherName.trim() || pin.length !== 4}
        >
          기행 만들기
        </Button>
      </form>
    </main>
  );
}
