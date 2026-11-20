"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlaceBadge, PlacePicker, centerOf, sortPlaces } from "@/components/place-picker";
import { FrameViewer } from "@/components/screens/album";
import { presetPlace } from "@/components/screens/camera";
import { Button, EmptyState, Notice, Sheet, inputClass, messageFor, useToast } from "@/components/ui";
import { deletePlace, listMembers, updatePlace, writePlaceIntro } from "@/lib/api";
import { useIsWide } from "@/lib/hooks";
import { hasKakaoKey, loadKakao, type KakaoMap, type KakaoNamespace, type KakaoOverlay } from "@/lib/kakao";
import { keys, useFrames, usePhotoUrls, usePlaceCounts, usePlaces, useRollStats } from "@/lib/queries";
import { useTrip } from "@/lib/session";
import type { Frame, Place, PlaceShotCount, RollStat } from "@/lib/types";

type MapState = "loading" | "ready" | "failed" | "nokey";

/** 장소가 없는 컷을 묶는 열쇠 */
const NO_PLACE = "none";

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pinElement(place: Place, shots: number, selected: boolean, onPress: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", place.name);
  const color = place.kind === "restaurant" ? "#ff7a1a" : place.is_recommended ? "#f5b301" : "#f3efe6";
  el.style.cssText =
    "display:flex;flex-direction:column;align-items:center;background:none;border:0;padding:0;cursor:pointer;font-family:inherit";
  const dot = document.createElement("span");
  const size = selected ? 34 : 26;
  dot.style.cssText = `display:flex;align-items:center;justify-content:center;min-width:${size}px;height:${size}px;padding:0 6px;border-radius:${size / 2}px;background:${color};color:#0e0d0b;font-size:${selected ? 14 : 12}px;font-weight:800;border:2px solid #0e0d0b;box-shadow:${selected ? "0 0 0 3px #e5332a," : ""}0 2px 6px rgba(0,0,0,.5)`;
  dot.textContent = shots > 0 ? String(shots) : place.kind === "restaurant" ? "식" : place.is_recommended ? "★" : "";
  const name = document.createElement("span");
  name.style.cssText =
    "margin-top:2px;padding:1px 5px;border-radius:4px;background:rgba(14,13,11,.85);color:#f3efe6;font-size:11px;font-weight:600;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis";
  name.textContent = place.name;
  el.append(dot, name);
  el.addEventListener("click", onPress);
  return el;
}

function MapCanvas({
  places,
  counts,
  selectedId,
  onSelect,
  onState,
}: {
  places: Place[];
  counts: Map<string, PlaceShotCount>;
  selectedId: string | null;
  onSelect: (placeId: string) => void;
  onState: (state: MapState) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<{ kakao: KakaoNamespace; map: KakaoMap } | null>(null);
  const overlays = useRef<KakaoOverlay[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasKakaoKey) {
      onState("nokey");
      return;
    }
    let cancelled = false;
    loadKakao()
      .then((kakao) => {
        if (cancelled || !container.current) return;
        const center = centerOf([]);
        map.current = {
          kakao,
          map: new kakao.maps.Map(container.current, { center: new kakao.maps.LatLng(center.lat, center.lng), level: 4 }),
        };
        setReady(true);
        onState("ready");
      })
      .catch(() => {
        if (!cancelled) onState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [onState]);

  // 창 크기가 바뀌면(폰을 돌리거나 창을 넓히면) 지도가 새 크기를 알아야 한다.
  useEffect(() => {
    if (!ready) return;
    const relayout = () => map.current?.map.relayout();
    window.addEventListener("resize", relayout);
    return () => window.removeEventListener("resize", relayout);
  }, [ready]);

  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    for (const overlay of overlays.current) overlay.setMap(null);
    overlays.current = places.map((place) => {
      const selected = place.id === selectedId;
      const overlay = new current.kakao.maps.CustomOverlay({
        position: new current.kakao.maps.LatLng(place.lat, place.lng),
        content: pinElement(place, counts.get(place.id)?.shots ?? 0, selected, () => onSelect(place.id)),
        yAnchor: 0.35,
        clickable: true,
        zIndex: selected ? 10 : 1,
      });
      overlay.setMap(current.map);
      return overlay;
    });
    // 처음 한 번만 모든 장소가 보이게 맞춘다. 그 뒤로는 사용자가 움직인 화면을 건드리지 않는다.
    if (!fitted.current && places.length > 0) {
      const bounds = new current.kakao.maps.LatLngBounds();
      for (const place of places) bounds.extend(new current.kakao.maps.LatLng(place.lat, place.lng));
      current.map.setBounds(bounds, 60, 40, 60, 40);
      fitted.current = true;
    }
  }, [ready, places, counts, selectedId, onSelect]);

  // 장소를 고르면 그곳으로 지도를 옮긴다.
  useEffect(() => {
    const current = map.current;
    const place = places.find((p) => p.id === selectedId);
    if (!ready || !current || !place) return;
    current.map.panTo(new current.kakao.maps.LatLng(place.lat, place.lng));
  }, [ready, selectedId, places]);

  return <div ref={container} className="h-[46dvh] w-full bg-well lg:h-full" aria-label="지도" />;
}

/** 사진과 메모를 한 줄씩 보여 주는 기록 목록 */
function Records({
  frames,
  thumbUrls,
  rolls,
  onOpen,
}: {
  frames: Frame[];
  thumbUrls: Record<string, string>;
  rolls: RollStat[];
  onOpen: (frame: Frame) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {frames.map((frame) => {
        const owner = rolls.find((r) => r.member_id === frame.member_id);
        const src = frame.thumb_path ? thumbUrls[frame.thumb_path] : undefined;
        return (
          <li key={frame.id}>
            <button
              type="button"
              onClick={() => onOpen(frame)}
              className="flex w-full items-center gap-3 rounded-lg bg-well p-2 text-left active:bg-line"
            >
              <span className="relative size-16 shrink-0 overflow-hidden rounded-frame bg-black">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" loading="lazy" className="size-full object-cover" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className={`line-clamp-2 block text-[14px] leading-snug ${frame.memo ? "" : "text-faint"}`}>
                  {frame.memo || "메모 없이 남긴 컷"}
                </span>
                <span className="block pt-1 text-[12px] text-dim">
                  {owner ? `${owner.name}${owner.team && owner.role !== "teacher" ? " · " + owner.team : ""} · ` : ""}
                  {timeLabel(frame.taken_at)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PlaceDetail({
  place,
  count,
  frames,
  thumbUrls,
  rolls,
  onOpenFrame,
  onDeleted,
}: {
  place: Place;
  count: PlaceShotCount | undefined;
  frames: Frame[];
  thumbUrls: Record<string, string>;
  rolls: RollStat[];
  onOpenFrame: (frame: Frame) => void;
  onDeleted: () => void;
}) {
  const { trip, member } = useTrip();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isTeacher = member.role === "teacher";
  const members = useQuery({ queryKey: ["members", trip.id], queryFn: () => listMembers(trip.id), staleTime: 60_000 });
  const author = members.data?.find((m) => m.id === place.intro_by);

  const canEditIntro = isTeacher || place.intro === "" || place.intro_by === member.id;
  const [editing, setEditing] = useState(false);
  const [intro, setIntro] = useState(place.intro);
  const [menuNote, setMenuNote] = useState(place.menu_note);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.places(trip.id) });
  const total = count?.shots ?? 0;
  const hiddenUntilDeveloped = !trip.developed_at && !isTeacher && total > frames.length;

  async function saveIntro() {
    setBusy(true);
    try {
      const out = await writePlaceIntro(place.id, intro);
      if (!out.ok) toast(messageFor(out.error), "error");
      else {
        await refresh();
        setEditing(false);
      }
    } catch {
      toast(messageFor("UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function patch(change: Parameters<typeof updatePlace>[1]) {
    setBusy(true);
    try {
      await updatePlace(place.id, change);
      await refresh();
    } catch {
      toast(messageFor("UNKNOWN"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-3">
      <div className="flex items-center gap-2 text-[13px] text-dim">
        <PlaceBadge place={place} />
        <span className="truncate">{place.address}</span>
      </div>

      {place.kind === "restaurant" && place.menu_note ? (
        <p className="rounded-lg bg-well px-3.5 py-3 text-[15px]">{place.menu_note}</p>
      ) : null}

      <section className="flex flex-col gap-2">
        <p className="label">소개</p>
        {editing ? (
          <>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              maxLength={1000}
              rows={6}
              placeholder="이곳은 어떤 곳인가요? 관련된 작가나 작품, 추천하는 까닭을 적어 주세요."
              className="rounded-lg border border-line bg-well px-3.5 py-3 text-[16px] leading-relaxed placeholder:text-faint focus:border-kodak focus:outline-none"
            />
            <div className="flex gap-2">
              <Button onClick={() => setEditing(false)} className="flex-1">
                취소
              </Button>
              <Button tone="primary" busy={busy} onClick={() => void saveIntro()} className="flex-1">
                저장
              </Button>
            </div>
          </>
        ) : place.intro ? (
          <>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{place.intro}</p>
            <p className="text-[12px] text-faint">
              {author ? `글 ${author.name}${author.role === "teacher" ? " 선생님" : ` · ${author.team}`}` : ""}
            </p>
            {canEditIntro ? (
              <Button tone="quiet" onClick={() => setEditing(true)} className="self-start px-0">
                소개 고치기
              </Button>
            ) : null}
          </>
        ) : (
          <Button onClick={() => setEditing(true)}>첫 소개글 쓰기</Button>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <p className="label">여기서 찍은 사진과 기록</p>
          <p className="tabular text-[13px] font-bold text-kodak">{total}컷</p>
        </div>
        {frames.length > 0 ? (
          <Records frames={frames} thumbUrls={thumbUrls} rolls={rolls} onOpen={onOpenFrame} />
        ) : (
          <p className="rounded-lg bg-well px-3.5 py-3 text-[14px] text-dim">
            {total > 0 ? "현상하면 이곳에서 찍힌 사진이 여기에 나타납니다." : "아직 아무도 찍지 않았어요."}
          </p>
        )}
        {hiddenUntilDeveloped && frames.length > 0 ? (
          <p className="text-[12px] text-faint">지금은 내 컷만 보입니다. 나머지 {total - frames.length}컷은 현상 뒤에 공개됩니다.</p>
        ) : null}
        {count && count.teams.length > 0 ? (
          <p className="text-[12px] text-dim">다녀간 모둠: {count.teams.filter(Boolean).join(", ") || "교사"}</p>
        ) : null}
      </section>

      <Button
        tone="primary"
        wide
        onClick={() => {
          presetPlace(place.id);
          router.push("/camera");
        }}
      >
        여기서 찍기
      </Button>

      {isTeacher ? (
        <section className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="label">교사 설정</p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={busy}
              aria-pressed={place.is_recommended}
              onClick={() => void patch({ is_recommended: !place.is_recommended })}
            >
              {place.is_recommended ? "추천 해제" : "추천으로 지정"}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              aria-pressed={place.kind === "restaurant"}
              onClick={() => void patch({ kind: place.kind === "restaurant" ? "spot" : "restaurant" })}
            >
              {place.kind === "restaurant" ? "식당 해제" : "식당으로 지정"}
            </Button>
          </div>
          {place.kind === "restaurant" ? (
            <div className="flex gap-2">
              <input
                value={menuNote}
                onChange={(e) => setMenuNote(e.target.value)}
                maxLength={200}
                className={inputClass}
                placeholder="대표 메뉴와 가격"
                aria-label="대표 메뉴와 가격"
              />
              <Button disabled={busy} onClick={() => void patch({ menu_note: menuNote })} className="shrink-0">
                저장
              </Button>
            </div>
          ) : null}
          {confirmDelete ? (
            <Button
              tone="danger"
              busy={busy}
              onClick={async () => {
                await deletePlace(place.id).catch(() => toast(messageFor("UNKNOWN"), "error"));
                await refresh();
                onDeleted();
              }}
            >
              정말 삭제합니다. 컷은 남고 장소 표시만 사라집니다.
            </Button>
          ) : (
            <Button tone="quiet" onClick={() => setConfirmDelete(true)}>
              장소 삭제
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** 장소 카드에 붙는 작은 사진 띠 */
function ThumbStrip({ frames, thumbUrls }: { frames: Frame[]; thumbUrls: Record<string, string> }) {
  if (frames.length === 0) return null;
  const shown = frames.slice(0, 4);
  return (
    <span className="flex gap-1 pt-2">
      {shown.map((frame) => (
        <span key={frame.id} className="size-12 overflow-hidden rounded-frame bg-black">
          {frame.thumb_path && thumbUrls[frame.thumb_path] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrls[frame.thumb_path]} alt="" loading="lazy" className="size-full object-cover" />
          ) : null}
        </span>
      ))}
      {frames.length > shown.length ? (
        <span className="tabular flex size-12 items-center justify-center rounded-frame bg-well text-[12px] text-dim">
          +{frames.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

export function MapScreen() {
  const { trip } = useTrip();
  const wide = useIsWide();
  const places = usePlaces(trip.id);
  const countsQuery = usePlaceCounts(trip.id, true);
  const framesQuery = useFrames(trip.id, true);
  const rollsQuery = useRollStats(trip.id);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<Frame | null>(null);

  const list = useMemo(() => sortPlaces(places.data ?? []), [places.data]);
  const counts = useMemo(() => new Map((countsQuery.data ?? []).map((c) => [c.place_id, c])), [countsQuery.data]);
  const rolls = useMemo(() => rollsQuery.data ?? [], [rollsQuery.data]);
  const selected = list.find((p) => p.id === selectedId) ?? null;

  // 내가 볼 수 있는 컷을 장소별로 묶는다. 최근 것이 먼저.
  const { byPlace, thumbPaths } = useMemo(() => {
    const grouped = new Map<string, Frame[]>();
    const paths: string[] = [];
    const known = new Set(list.map((p) => p.id));
    const visible = (framesQuery.data ?? [])
      .filter((f) => !f.is_deleted && f.photo_path)
      .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
    for (const frame of visible) {
      const key = frame.place_id && known.has(frame.place_id) ? frame.place_id : NO_PLACE;
      const group = grouped.get(key) ?? [];
      group.push(frame);
      grouped.set(key, group);
      if (frame.thumb_path) paths.push(frame.thumb_path);
    }
    return { byPlace: grouped, thumbPaths: paths };
  }, [framesQuery.data, list]);
  const thumbUrls = usePhotoUrls(thumbPaths);
  const unplaced = byPlace.get(NO_PLACE) ?? [];

  const mapUnavailable = mapState === "nokey" || mapState === "failed";

  const detail = selected ? (
    <PlaceDetail
      key={selected.id + selected.updated_at}
      place={selected}
      count={counts.get(selected.id)}
      frames={byPlace.get(selected.id) ?? []}
      thumbUrls={thumbUrls}
      rolls={rolls}
      onOpenFrame={setViewing}
      onDeleted={() => setSelectedId(null)}
    />
  ) : null;

  return (
    <div className="flex flex-col lg:grid lg:h-full lg:grid-cols-[minmax(380px,460px)_1fr]">
      <div className="lg:order-2 lg:h-full lg:min-h-0">
        {mapUnavailable ? (
          <div className="px-4 pt-4 lg:flex lg:h-full lg:items-center lg:justify-center lg:bg-panel lg:pt-0">
            <div className="lg:max-w-sm">
              <Notice tone="warn">
                {mapState === "nokey"
                  ? "지도 키가 설정되지 않아 지도를 띄울 수 없습니다. 목록으로 장소와 기록을 볼 수 있어요."
                  : "지도를 불러오지 못했습니다. 목록으로 장소와 기록을 볼 수 있어요."}
              </Notice>
            </div>
          </div>
        ) : (
          <MapCanvas places={list} counts={counts} selectedId={selectedId} onSelect={setSelectedId} onState={setMapState} />
        )}
      </div>

      <section className="lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-line" aria-label="장소와 기록">
        {wide && selected ? (
          <div className="px-4 py-4">
            <button type="button" onClick={() => setSelectedId(null)} className="min-h-11 text-[14px] text-dim">
              ← 장소 목록
            </button>
            <h2 className="pb-3 text-[22px] font-black">{selected.name}</h2>
            {detail}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <p className="label">장소 {list.length}곳</p>
              <Button onClick={() => setAdding(true)} className="min-h-10">
                장소 추가
              </Button>
            </div>

            {list.length === 0 && unplaced.length === 0 ? (
              <EmptyState title="아직 장소가 없어요">가 보고 싶은 곳을 이름으로 찾아 추가해 보세요.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5 px-4 pb-6">
                {list.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(place.id)}
                      className="flex w-full flex-col rounded-lg bg-panel px-3.5 py-3 text-left active:bg-well"
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[16px] font-semibold">{place.name}</span>
                          <PlaceBadge place={place} />
                        </span>
                        <span className="tabular shrink-0 text-[13px] text-kodak">{counts.get(place.id)?.shots ?? 0}컷</span>
                      </span>
                      <span className="block truncate pt-0.5 text-[13px] text-dim">
                        {place.kind === "restaurant" && place.menu_note
                          ? place.menu_note
                          : place.intro || "소개글이 아직 없어요"}
                      </span>
                      <ThumbStrip frames={byPlace.get(place.id) ?? []} thumbUrls={thumbUrls} />
                    </button>
                  </li>
                ))}
                {unplaced.length > 0 ? (
                  <li className="pt-3">
                    <p className="label pb-2">장소 없이 남긴 컷 {unplaced.length}</p>
                    <Records frames={unplaced} thumbUrls={thumbUrls} rolls={rolls} onOpen={setViewing} />
                  </li>
                ) : null}
              </ul>
            )}
          </>
        )}
      </section>

      {/* 폰에서는 장소를 아래에서 올라오는 시트로 보여 준다. */}
      {!wide && selected ? (
        <Sheet open onClose={() => setSelectedId(null)} title={selected.name}>
          {detail}
        </Sheet>
      ) : null}

      {viewing ? <FrameViewer key={viewing.id} frame={viewing} onClose={() => setViewing(null)} /> : null}

      <PlacePicker
        tripId={trip.id}
        open={adding}
        onClose={() => setAdding(false)}
        onPick={(id) => {
          setAdding(false);
          setSelectedId(id);
        }}
      />
    </div>
  );
}
