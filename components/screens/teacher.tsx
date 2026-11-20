"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { splitTeams } from "@/components/screens/new-trip";
import { Button, Field, Notice, Sheet, inputClass, messageFor, useToast } from "@/components/ui";
import { getTripCodes, resetPin, setDeveloped, setMemberFilm, updateTrip } from "@/lib/api";
import { keys, useMealChoices, usePlaceCounts, usePlaces, useRollStats } from "@/lib/queries";
import { membershipsKey, useTrip } from "@/lib/session";
import type { RollStat } from "@/lib/types";

type Tab = "board" | "people" | "codes" | "settings";

function ago(iso: string | null) {
  if (!iso) return "아직 없음";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

function DevelopCard() {
  const { trip } = useTrip();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const developed = Boolean(trip.developed_at);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      await setDeveloped(trip.id, on);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.trip(trip.id) }),
        queryClient.invalidateQueries({ queryKey: keys.frames(trip.id) }),
        queryClient.invalidateQueries({ queryKey: membershipsKey }),
      ]);
      toast(on ? "현상했습니다. 모두의 사진이 공개됩니다." : "현상을 되돌렸습니다.");
      setConfirm(false);
    } catch (error) {
      toast(messageFor(error instanceof Error ? error.message : "UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-xl border p-4 ${developed ? "border-line bg-panel" : "border-safelight/50 bg-safelight/10"}`}
    >
      <p className={`label ${developed ? "text-kodak" : "text-safelight"}`}>{developed ? "현상 완료" : "암실"}</p>
      <p className="pt-1 text-[15px] leading-relaxed">
        {developed
          ? "학생들이 서로의 사진을 보고 도장을 찍을 수 있습니다."
          : "현상하면 학생들이 서로의 사진을 한꺼번에 보게 됩니다. 귀교 버스처럼 모두 함께 볼 수 있는 때가 좋습니다."}
      </p>
      <div className="pt-3">
        {developed ? (
          <Button tone="quiet" busy={busy} onClick={() => void toggle(false)} className="px-0">
            현상 되돌리기
          </Button>
        ) : (
          <Button tone="danger" wide onClick={() => setConfirm(true)}>
            현상하기
          </Button>
        )}
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="지금 현상할까요?">
        <div className="flex flex-col gap-3 pb-3">
          <p className="text-[15px] leading-relaxed text-dim">
            이 기행의 모든 학생에게 서로의 사진이 공개됩니다. 숨긴 컷과 버린 컷은 보이지 않습니다. 필요하면 되돌릴 수
            있습니다.
          </p>
          <Button tone="danger" wide busy={busy} onClick={() => void toggle(true)}>
            현상합니다
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

function Board() {
  const { trip } = useTrip();
  const rolls = useRollStats(trip.id, true).data ?? [];
  const places = usePlaces(trip.id).data ?? [];
  const counts = usePlaceCounts(trip.id, true).data ?? [];
  const meals = useMealChoices(trip.id).data ?? [];

  const students = rolls.filter((r) => r.role === "student");
  const teams = [...new Set(students.map((r) => r.team))].sort((a, b) => a.localeCompare(b, "ko"));
  const visited = counts
    .map((c) => ({ ...c, place: places.find((p) => p.id === c.place_id) }))
    .filter((c) => c.place)
    .sort((a, b) => b.shots - a.shots);
  const restaurants = places.filter((p) => p.kind === "restaurant");
  const totalShots = students.reduce((sum, r) => sum + r.used, 0);

  return (
    <div className="flex flex-col gap-5">
      <DevelopCard />

      <section className="grid grid-cols-3 gap-2">
        {[
          ["학생", students.length + "명"],
          ["찍은 컷", totalShots + "컷"],
          ["다녀간 곳", visited.length + "곳"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-panel px-3 py-3">
            <p className="label">{label}</p>
            <p className="tabular pt-1 text-[20px] font-bold">{value}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label">모둠별 현황</h2>
        {teams.length === 0 ? <p className="text-[14px] text-dim">아직 들어온 학생이 없습니다.</p> : null}
        {teams.map((team) => {
          const members = students.filter((r) => r.team === team);
          const latest = members
            .map((m) => m.last_shot_at)
            .filter((t): t is string => Boolean(t))
            .sort()
            .at(-1);
          const teamPlaces = visited.filter((v) => v.teams.includes(team)).map((v) => v.place!.name);
          return (
            <div key={team || "none"} className="rounded-xl bg-panel p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[16px] font-bold">{team || "모둠 없음"}</h3>
                <span className="text-[12px] text-dim">마지막 컷 {ago(latest ?? null)}</span>
              </div>
              <p className="pt-1 text-[13px] leading-relaxed text-kodak">
                {teamPlaces.length > 0 ? teamPlaces.join(" → ") : "아직 체크인한 곳이 없습니다"}
              </p>
              <ul className="flex flex-col gap-1.5 pt-3">
                {members.map((m) => (
                  <li key={m.member_id} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 truncate text-[14px]">{m.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-well">
                      <span
                        className="block h-full rounded-full bg-kodak"
                        style={{ width: `${Math.min(100, (m.used / Math.max(1, m.film)) * 100)}%` }}
                      />
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-[12px] text-dim">
                      {m.used}/{m.film}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {restaurants.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="label">점심 선택</h2>
          <ul className="flex flex-col gap-1.5">
            {restaurants.map((place) => {
              const chosen = meals.filter((m) => m.place_id === place.id);
              const names = chosen
                .map((c) => rolls.find((r) => r.member_id === c.member_id)?.name)
                .filter(Boolean)
                .join(", ");
              return (
                <li key={place.id} className="rounded-xl bg-panel px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[15px] font-bold">{place.name}</span>
                    <span className="tabular text-[15px] font-bold text-kodak">{chosen.length}명</span>
                  </div>
                  {names ? <p className="pt-1 text-[12px] leading-relaxed text-dim">{names}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-faint">
            아직 고르지 않은 학생 {students.length - meals.filter((m) => students.some((s) => s.member_id === m.member_id)).length}명
          </p>
        </section>
      ) : null}
    </div>
  );
}

function People() {
  const { trip, member } = useTrip();
  const toast = useToast();
  const queryClient = useQueryClient();
  const rolls = useRollStats(trip.id).data ?? [];
  const [target, setTarget] = useState<RollStat | null>(null);
  const [film, setFilm] = useState(24);
  const [busy, setBusy] = useState(false);

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: keys.rolls(trip.id) });
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
      toast(done);
      setTarget(null);
    } catch (error) {
      toast(messageFor(error instanceof Error ? error.message : "UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] leading-relaxed text-dim">이름을 누르면 필름을 더 주거나 PIN을 초기화할 수 있습니다.</p>
      <ul className="flex flex-col gap-1.5">
        {rolls.map((r) => (
          <li key={r.member_id}>
            <button
              type="button"
              onClick={() => {
                setTarget(r);
                setFilm(r.film);
              }}
              className="flex min-h-14 w-full items-center justify-between rounded-lg bg-panel px-3.5 text-left active:bg-well"
            >
              <span>
                <span className="text-[15px] font-semibold">{r.name}</span>
                <span className="pl-2 text-[12px] text-dim">{r.role === "teacher" ? "교사" : r.team}</span>
              </span>
              <span className="tabular text-[13px] text-dim">
                {r.used}/{r.film}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={target !== null} onClose={() => setTarget(null)} title={target?.name ?? ""}>
        {target ? (
          <div className="flex flex-col gap-4 pb-3">
            <div className="flex flex-col gap-2">
              <p className="label">필름 컷 수</p>
              <div className="flex items-center gap-2">
                <Button onClick={() => setFilm((n) => Math.max(target.used, n - 12))} aria-label="12컷 줄이기">
                  −12
                </Button>
                <p className="tabular flex-1 text-center text-[24px] font-bold">{film}</p>
                <Button onClick={() => setFilm((n) => Math.min(144, n + 12))} aria-label="12컷 늘리기">
                  +12
                </Button>
              </div>
              <Button
                tone="primary"
                busy={busy}
                disabled={film === target.film}
                onClick={() => void act(() => setMemberFilm(target.member_id, film), "필름 수를 바꿨습니다.")}
              >
                필름 수 저장
              </Button>
            </div>
            {target.member_id !== member.id ? (
              <div className="flex flex-col gap-2 border-t border-line pt-4">
                <p className="text-[13px] leading-relaxed text-dim">
                  PIN을 잊었을 때 씁니다. 초기화하면 이 사람의 모든 기기 연결이 끊기고, 다음에 들어올 때 넣는 숫자가 새 PIN이
                  됩니다.
                </p>
                <Button busy={busy} onClick={() => void act(() => resetPin(target.member_id), "PIN을 초기화했습니다.")}>
                  PIN 초기화
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function Codes() {
  const { trip } = useTrip();
  const codes = useQuery({ queryKey: ["codes", trip.id], queryFn: () => getTripCodes(trip.id), staleTime: Infinity });
  const [qr, setQr] = useState<string | null>(null);
  const joinCode = codes.data?.join_code;
  const joinUrl = joinCode && typeof window !== "undefined" ? `${window.location.origin}/?code=${joinCode}` : null;

  useEffect(() => {
    if (!joinUrl) return;
    let alive = true;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480, color: { dark: "#0e0d0b", light: "#f7f3ea" } })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [joinUrl]);

  if (!codes.data) return <p className="text-[14px] text-dim">코드를 불러오는 중입니다.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-paper p-5 text-center text-paper-ink">
        <p className="text-[12px] font-bold tracking-[0.14em]">학생 참가 코드</p>
        <p className="tabular py-1 font-mono text-[40px] font-black tracking-[0.18em]">{codes.data.join_code}</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="입장용 QR 코드" className="mx-auto size-56" />
        ) : null}
        <p className="pt-2 text-[12px] text-paper-ink/60">QR을 찍으면 코드가 입력된 입장 화면이 열립니다.</p>
      </div>
      <div className="leather rounded-xl border border-line p-4">
        <p className="label">교사 코드</p>
        <p className="tabular pt-1 font-mono text-[24px] font-bold tracking-[0.16em]">{codes.data.teacher_code}</p>
        <p className="pt-2 text-[13px] leading-relaxed text-dim">함께 가는 선생님께만 알려 주세요.</p>
      </div>
    </div>
  );
}

function Settings() {
  const { trip } = useTrip();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(trip.title);
  const [tripDate, setTripDate] = useState(trip.trip_date);
  const [teams, setTeams] = useState(trip.teams.join(", "));
  const [notice, setNotice] = useState(trip.notice);
  const [purgeAfter, setPurgeAfter] = useState(trip.purge_after ?? "");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateTrip(trip.id, { title, tripDate, teams: splitTeams(teams), notice, purgeAfter: purgeAfter || null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.trip(trip.id) }),
        queryClient.invalidateQueries({ queryKey: membershipsKey }),
      ]);
      toast("저장했습니다.");
    } catch (error) {
      toast(messageFor(error instanceof Error ? error.message : "UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <Field label="기행 이름">
        {(props) => <input {...props} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} maxLength={60} />}
      </Field>
      <Field label="날짜">
        {(props) => (
          <input {...props} type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} className={inputClass} />
        )}
      </Field>
      <Field label="모둠" hint="쉼표로 나눠 적습니다. 이미 들어온 학생의 모둠은 바뀌지 않습니다.">
        {(props) => <input {...props} value={teams} onChange={(e) => setTeams(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="일정과 안내" hint="집결 장소와 시간, 준비물, 귀교 안내를 적어 주세요. 안내 탭에 그대로 보입니다.">
        {(props) => (
          <textarea
            {...props}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            rows={9}
            maxLength={4000}
            className="rounded-lg border border-line bg-well px-3.5 py-3 text-[16px] leading-relaxed focus:border-kodak focus:outline-none"
          />
        )}
      </Field>
      <Field label="삭제 예정일" hint="이 날짜가 지나면 사진과 기록을 지울 예정임을 알리는 날짜입니다. 자동으로 지워지지는 않습니다.">
        {(props) => (
          <input {...props} type="date" value={purgeAfter} onChange={(e) => setPurgeAfter(e.target.value)} className={inputClass} />
        )}
      </Field>
      <Button type="submit" tone="primary" wide busy={busy} disabled={!title.trim() || !tripDate}>
        저장
      </Button>
      <Notice>추천 장소와 식당은 지도 탭에서 장소를 눌러 지정합니다. 컷 숨기기는 인화 탭에서 사진을 눌러 합니다.</Notice>
    </form>
  );
}

export function TeacherScreen() {
  const router = useRouter();
  const { member } = useTrip();
  const [tab, setTab] = useState<Tab>("board");
  const isTeacher = member.role === "teacher";

  useEffect(() => {
    if (!isTeacher) router.replace("/camera");
  }, [isTeacher, router]);

  const tabs = useMemo<[Tab, string][]>(
    () => [
      ["board", "현황"],
      ["people", "구성원"],
      ["codes", "코드"],
      ["settings", "설정"],
    ],
    [],
  );

  if (!isTeacher) return null;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div role="tablist" aria-label="교사 메뉴" className="flex rounded-lg bg-well p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-10 flex-1 rounded-md text-[14px] ${tab === id ? "bg-kodak font-bold text-body" : "text-dim"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "board" ? <Board /> : null}
      {tab === "people" ? <People /> : null}
      {tab === "codes" ? <Codes /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  );
}
