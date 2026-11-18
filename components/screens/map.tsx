"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlaceBadge, PlacePicker, centerOf, sortPlaces } from "@/components/place-picker";
import { presetPlace } from "@/components/screens/camera";
import { Button, EmptyState, Notice, Sheet, inputClass, messageFor, useToast } from "@/components/ui";
import { deletePlace, listMembers, updatePlace, writePlaceIntro } from "@/lib/api";
import { hasKakaoKey, loadKakao, type KakaoMap, type KakaoNamespace, type KakaoOverlay } from "@/lib/kakao";
import { keys, usePlaceCounts, usePlaces } from "@/lib/queries";
import { useTrip } from "@/lib/session";
import type { Place, PlaceShotCount } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

type MapState = "loading" | "ready" | "failed" | "nokey";

function pinElement(place: Place, shots: number, onPress: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", place.name);
  const color = place.kind === "restaurant" ? "#ff7a1a" : place.is_recommended ? "#f5b301" : "#f3efe6";
  el.style.cssText =
    "display:flex;flex-direction:column;align-items:center;background:none;border:0;padding:0;cursor:pointer;font-family:inherit";
  const dot = document.createElement("span");
  dot.style.cssText = `display:flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;border-radius:13px;background:${color};color:#0e0d0b;font-size:12px;font-weight:800;border:2px solid #0e0d0b;box-shadow:0 2px 6px rgba(0,0,0,.5)`;
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
  onSelect,
  onState,
}: {
  places: Place[];
  counts: Map<string, PlaceShotCount>;
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

  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    for (const overlay of overlays.current) overlay.setMap(null);
    overlays.current = places.map((place) => {
      const overlay = new current.kakao.maps.CustomOverlay({
        position: new current.kakao.maps.LatLng(place.lat, place.lng),
        content: pinElement(place, counts.get(place.id)?.shots ?? 0, () => onSelect(place.id)),
        yAnchor: 0.35,
        clickable: true,
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
  }, [ready, places, counts, onSelect]);

  return <div ref={container} className="h-[46dvh] w-full bg-well" aria-label="지도" />;
}

function PlaceSheet({
  place,
  count,
  onClose,
}: {
  place: Place;
  count: PlaceShotCount | undefined;
  onClose: () => void;
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
    <Sheet open onClose={onClose} title={place.name}>
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

        <section className="flex items-center justify-between rounded-lg bg-well px-3.5 py-3">
          <div>
            <p className="label">여기서 찍힌 컷</p>
            <p className="tabular text-[20px] font-bold text-kodak">{count?.shots ?? 0}</p>
          </div>
          <p className="max-w-[55%] text-right text-[12px] leading-relaxed text-dim">
            {count && count.teams.length > 0 ? count.teams.join(", ") : "아직 아무도 찍지 않았어요"}
            {trip.developed_at ? "" : " · 사진은 현상 뒤 공개"}
          </p>
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
                  onClose();
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
    </Sheet>
  );
}

export function MapScreen() {
  const { trip } = useTrip();
  const places = usePlaces(trip.id);
  const countsQuery = usePlaceCounts(trip.id, true);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => sortPlaces(places.data ?? []), [places.data]);
  const counts = useMemo(() => new Map((countsQuery.data ?? []).map((c) => [c.place_id, c])), [countsQuery.data]);
  const selected = list.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col">
      {mapState === "nokey" || mapState === "failed" ? (
        <div className="px-4 pt-4">
          <Notice tone="warn">
            {mapState === "nokey"
              ? "지도 키가 설정되지 않아 지도를 띄울 수 없습니다. 아래 목록으로 장소를 볼 수 있어요."
              : "지도를 불러오지 못했습니다. 아래 목록으로 장소를 볼 수 있어요."}
          </Notice>
        </div>
      ) : null}
      {mapState !== "nokey" && mapState !== "failed" ? (
        <MapCanvas places={list} counts={counts} onSelect={setSelectedId} onState={setMapState} />
      ) : null}

      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="label">장소 {list.length}곳</p>
        <Button onClick={() => setAdding(true)} className="min-h-10">
          장소 추가
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState title="아직 장소가 없어요">가 보고 싶은 곳을 이름으로 찾아 추가해 보세요.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-1.5 px-4 pb-6">
          {list.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => setSelectedId(place.id)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg bg-panel px-3.5 py-2.5 text-left active:bg-well"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[16px] font-semibold">{place.name}</span>
                    <PlaceBadge place={place} />
                  </span>
                  <span className="block truncate pt-0.5 text-[13px] text-dim">
                    {place.kind === "restaurant" && place.menu_note
                      ? place.menu_note
                      : place.intro || "소개글이 아직 없어요"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[13px] text-kodak">{counts.get(place.id)?.shots ?? 0}컷</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <PlaceSheet key={selected.id + selected.updated_at} place={selected} count={counts.get(selected.id)} onClose={() => setSelectedId(null)} />
      ) : null}
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
