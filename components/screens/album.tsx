"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FilmStrip, FrameCell, Print, StampMark, type CellState } from "@/components/film";
import { PlacePicker } from "@/components/place-picker";
import { Button, Sheet, messageFor, useToast } from "@/components/ui";
import { discardShot, editShot, putStamp, removeStamp, setFrameHidden } from "@/lib/api";
import { keys, useFrames, useObjectUrls, usePhotoUrls, usePlaces, useQueuedShots, useRollStats, useStamps } from "@/lib/queries";
import type { QueuedShot } from "@/lib/queue/store";
import { useTrip } from "@/lib/session";
import { STAMP_KINDS, type Frame, type Place, type RollStat, type Stamp, type StampKind } from "@/lib/types";

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const SEEN_KEY = (tripId: string) => "bookmap.seenDeveloped." + tripId;

function readSeen(tripId: string): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY(tripId));
  } catch {
    return null; // 저장소를 못 쓰면 매번 연출을 보여 준다.
  }
}

/** 현상된 것을 이 기기에서 처음 보는 순간에만 연출을 보여 준다. */
function useReveal(tripId: string, developedAt: string | null) {
  const [seen, setSeen] = useState<string | null>(() => readSeen(tripId));
  const reveal = developedAt !== null && seen !== developedAt;
  useEffect(() => {
    if (!reveal || !developedAt) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SEEN_KEY(tripId), developedAt);
      } catch {
        // 위와 같다.
      }
      setSeen(developedAt);
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [reveal, tripId, developedAt]);
  return reveal;
}

interface Viewing {
  frame: Frame;
  owner: RollStat | undefined;
}

function Viewer({
  viewing,
  places,
  stamps,
  photoUrl,
  onClose,
}: {
  viewing: Viewing;
  places: Place[];
  stamps: Stamp[];
  photoUrl: string | undefined;
  onClose: () => void;
}) {
  const { trip, member } = useTrip();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { frame, owner } = viewing;
  const isMine = frame.member_id === member.id;
  const isTeacher = member.role === "teacher";
  const place = places.find((p) => p.id === frame.place_id) ?? null;

  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState(frame.memo);
  const [placeId, setPlaceId] = useState(frame.place_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = stamps.find((s) => s.frame_id === frame.id && s.member_id === member.id);
  const counts = useMemo(() => {
    const out = Object.fromEntries(STAMP_KINDS.map((k) => [k, 0])) as Record<StampKind, number>;
    for (const s of stamps) if (s.frame_id === frame.id) out[s.kind]++;
    return out;
  }, [stamps, frame.id]);

  const refreshFrames = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.frames(trip.id) }),
      queryClient.invalidateQueries({ queryKey: keys.placeCounts(trip.id) }),
    ]);

  async function act(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      await work();
      after?.();
    } catch (error) {
      toast(messageFor(error instanceof Error ? error.message : "UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function stamp(kind: StampKind) {
    await act(async () => {
      if (mine?.kind === kind) await removeStamp(frame.id, member.id);
      else await putStamp(frame.id, member.id, kind);
      await queryClient.invalidateQueries({ queryKey: keys.stamps(trip.id) });
    });
  }

  const canStamp = Boolean(trip.developed_at) && !isMine && !frame.is_hidden;
  const showStamps = Boolean(trip.developed_at) && !frame.is_hidden;
  const editPlace = places.find((p) => p.id === placeId) ?? null;

  return (
    <Sheet open onClose={onClose} title={`${frame.frame_no}번 컷`}>
      <div className="flex flex-col gap-4 pb-3">
        <Print
          src={photoUrl}
          caption={editing ? undefined : frame.memo}
          meta={[owner ? `${owner.name}${owner.team ? " · " + owner.team : ""}` : "", place?.name, timeLabel(frame.taken_at)]
            .filter(Boolean)
            .join(" · ")}
        >
          {showStamps ? (
            <div className="flex flex-wrap gap-2 pt-3">
              {STAMP_KINDS.map((kind) =>
                canStamp || counts[kind] > 0 ? (
                  <StampMark
                    key={kind}
                    kind={kind}
                    count={counts[kind]}
                    active={mine?.kind === kind}
                    onPress={canStamp && !busy ? () => void stamp(kind) : undefined}
                  />
                ) : null,
              )}
            </div>
          ) : null}
        </Print>

        {isMine && editing ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-h-14 items-center justify-between rounded-lg border border-line bg-well px-3.5 text-left"
            >
              <span>
                <span className="label block">장소</span>
                <span className="block text-[16px] font-semibold">{editPlace ? editPlace.name : "장소 없음"}</span>
              </span>
              <span className="text-[13px] text-kodak">바꾸기</span>
            </button>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={300}
              rows={3}
              aria-label="메모"
              className="rounded-lg border border-line bg-well px-3.5 py-3 text-[16px] leading-relaxed focus:border-kodak focus:outline-none"
            />
            <div className="flex gap-2">
              <Button onClick={() => setEditing(false)} className="flex-1">
                취소
              </Button>
              <Button
                tone="primary"
                busy={busy}
                className="flex-1"
                onClick={() =>
                  void act(async () => {
                    await editShot(frame.id, placeId, memo.trim());
                    await refreshFrames();
                  }, onClose)
                }
              >
                저장
              </Button>
            </div>
          </div>
        ) : null}

        {isMine && !editing ? (
          <div className="flex flex-col gap-2">
            <Button onClick={() => setEditing(true)}>메모와 장소 고치기</Button>
            {confirmDiscard ? (
              <Button
                tone="danger"
                busy={busy}
                onClick={() =>
                  void act(async () => {
                    await discardShot(frame);
                    await refreshFrames();
                  }, onClose)
                }
              >
                버립니다. 이 컷은 돌아오지 않습니다.
              </Button>
            ) : (
              <Button tone="quiet" onClick={() => setConfirmDiscard(true)}>
                이 컷 버리기
              </Button>
            )}
          </div>
        ) : null}

        {isTeacher && !isMine ? (
          <Button
            busy={busy}
            onClick={() =>
              void act(async () => {
                await setFrameHidden(frame.id, !frame.is_hidden);
                await refreshFrames();
              }, onClose)
            }
          >
            {frame.is_hidden ? "숨김 해제" : "다른 학생에게 숨기기"}
          </Button>
        ) : null}

        <PlacePicker
          tripId={trip.id}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(id) => {
            setPlaceId(id);
            setPickerOpen(false);
          }}
          allowNone
        />
      </div>
    </Sheet>
  );
}

export function AlbumScreen() {
  const { trip, member } = useTrip();
  const isTeacher = member.role === "teacher";
  const developed = Boolean(trip.developed_at);

  const frames = useFrames(trip.id, true).data;
  const rolls = useRollStats(trip.id, true).data;
  const places = usePlaces(trip.id).data ?? [];
  const queued = useQueuedShots(trip.id, member.id);
  const queuedUrls = useObjectUrls(queued);
  const reveal = useReveal(trip.id, trip.developed_at);

  const visible = useMemo(() => frames ?? [], [frames]);
  const thumbPaths = useMemo(() => visible.map((f) => f.thumb_path).filter((p): p is string => Boolean(p)), [visible]);
  const thumbUrls = usePhotoUrls(thumbPaths);
  const frameIds = useMemo(() => visible.map((f) => f.id), [visible]);
  const stampsQuery = useStamps(trip.id, frameIds, developed);
  const stamps = useMemo(() => stampsQuery.data ?? [], [stampsQuery.data]);
  const stampCount = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of stamps) out.set(s.frame_id, (out.get(s.frame_id) ?? 0) + 1);
    return out;
  }, [stamps]);

  const [viewing, setViewing] = useState<Viewing | null>(null);
  const fullPath = viewing?.frame.photo_path ?? null;
  const fullUrls = usePhotoUrls(useMemo(() => (fullPath ? [fullPath] : []), [fullPath]));

  const byMember = useMemo(() => {
    const out = new Map<string, Frame[]>();
    for (const frame of visible) {
      const list = out.get(frame.member_id) ?? [];
      list.push(frame);
      out.set(frame.member_id, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.frame_no - b.frame_no);
    return out;
  }, [visible]);

  const myFrames = byMember.get(member.id) ?? [];
  const myServerIds = new Set(myFrames.map((f) => f.id));
  const pendingLocal: QueuedShot[] = queued.filter((s) => !myServerIds.has(s.id));
  const myRoll = rolls?.find((r) => r.member_id === member.id);
  const others = (rolls ?? []).filter((r) => r.member_id !== member.id && (r.used > 0 || r.role === "student"));
  const teams = [...new Set(others.map((r) => r.team))].sort((a, b) => a.localeCompare(b, "ko"));

  function cellsForMine() {
    const cells: React.ReactNode[] = [];
    for (const frame of myFrames) {
      const local = queued.find((s) => s.id === frame.id);
      const src = frame.thumb_path ? thumbUrls[frame.thumb_path] : local ? queuedUrls[local.id] : undefined;
      const state: CellState = frame.is_deleted ? "discarded" : frame.thumb_path ? "photo" : "sending";
      cells.push(
        <FrameCell
          key={frame.id}
          no={frame.frame_no}
          state={state}
          src={frame.is_deleted ? undefined : src}
          hidden={frame.is_hidden}
          stamped={stampCount.get(frame.id)}
          onOpen={frame.is_deleted || !frame.photo_path ? undefined : () => setViewing({ frame, owner: myRoll })}
        />,
      );
    }
    pendingLocal.forEach((shot, index) => {
      cells.push(
        <FrameCell
          key={shot.id}
          no={myFrames.length + index + 1}
          state={shot.state === "rejected" ? "rejected" : "sending"}
          src={shot.state === "rejected" ? undefined : queuedUrls[shot.id]}
        />,
      );
    });
    for (let no = cells.length + 1; no <= member.film; no++) {
      cells.push(<FrameCell key={"unused-" + no} no={no} state="unused" />);
    }
    return cells;
  }

  function cellsFor(roll: RollStat) {
    const shown = byMember.get(roll.member_id) ?? [];
    // 교사이거나 현상 뒤라면 사진이 보인다. 그렇지 않으면 찍은 수만큼 봉인된 칸만 보인다.
    if (isTeacher || developed) {
      return shown
        .filter((f) => !f.is_deleted)
        .map((frame) => (
          <FrameCell
            key={frame.id}
            no={frame.frame_no}
            state={frame.thumb_path ? "photo" : "sending"}
            src={frame.thumb_path ? thumbUrls[frame.thumb_path] : undefined}
            reveal={reveal}
            hidden={frame.is_hidden}
            stamped={stampCount.get(frame.id)}
            onOpen={frame.photo_path ? () => setViewing({ frame, owner: roll }) : undefined}
          />
        ));
    }
    return Array.from({ length: roll.used }, (_, i) => <FrameCell key={i} no={i + 1} state="sealed" />);
  }

  return (
    <div className="flex flex-col gap-5 px-3 py-4">
      <div
        className={`rounded-lg border px-4 py-3 ${
          developed ? "border-line bg-panel" : "border-safelight/50 bg-safelight/10"
        }`}
        role="status"
      >
        <p className={`label ${developed ? "text-kodak" : "text-safelight"}`}>{developed ? "현상 완료" : "미현상 · 암실 대기"}</p>
        <p className="pt-1 text-[14px] leading-relaxed text-dim">
          {developed
            ? "모두의 필름이 공개됐습니다. 마음에 드는 컷에 도장을 찍어 보세요."
            : isTeacher
              ? "학생들은 아직 서로의 사진을 볼 수 없습니다. 교사 탭에서 현상할 수 있어요."
              : "지금은 내 컷만 보입니다. 선생님이 현상하면 모두의 사진이 한꺼번에 공개됩니다."}
        </p>
      </div>

      {reveal ? (
        <div className="animate-flash pointer-events-none fixed inset-0 z-40 bg-safelight" style={{ animationDuration: "1.6s" }} aria-hidden />
      ) : null}

      <FilmStrip title={`내 필름 · ${member.name}`} meta={`${myFrames.length + pendingLocal.length}/${member.film}`}>
        {cellsForMine()}
      </FilmStrip>

      {teams.map((team) => (
        <div key={team || "none"} className="flex flex-col gap-2">
          <h2 className="px-1 pt-2 text-[13px] font-bold text-dim">{team || "모둠 없음"}</h2>
          {others
            .filter((r) => r.team === team)
            .map((roll) => {
              const cells = cellsFor(roll);
              return (
                <FilmStrip key={roll.member_id} title={roll.name} meta={`${roll.used}/${roll.film}`}>
                  {cells.length > 0 ? (
                    cells
                  ) : (
                    <p className="col-span-6 py-3 text-center text-[12px] text-faint">아직 찍은 컷이 없어요</p>
                  )}
                </FilmStrip>
              );
            })}
        </div>
      ))}

      {viewing ? (
        <Viewer
          key={viewing.frame.id}
          viewing={viewing}
          places={places}
          stamps={stamps}
          photoUrl={fullPath ? fullUrls[fullPath] : undefined}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
