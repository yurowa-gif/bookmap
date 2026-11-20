"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, Notice, Sheet, inputClass, useToast } from "@/components/ui";
import { addPlace } from "@/lib/api";
import { DEFAULT_CENTER, hasKakaoKey, searchPlaces, type KakaoPlaceResult } from "@/lib/kakao";
import { keys, usePlaces } from "@/lib/queries";
import type { Place } from "@/lib/types";

/** 장소들의 가운데. 검색 결과를 가까운 순으로 받는 데 쓴다. */
export function centerOf(places: Place[]) {
  if (places.length === 0) return DEFAULT_CENTER;
  const lat = places.reduce((sum, p) => sum + p.lat, 0) / places.length;
  const lng = places.reduce((sum, p) => sum + p.lng, 0) / places.length;
  return { lat, lng };
}

/** 추천, 그다음 이름 순 */
export function sortPlaces(places: Place[]) {
  return [...places].sort(
    (a, b) => Number(b.is_recommended) - Number(a.is_recommended) || a.name.localeCompare(b.name, "ko"),
  );
}

export function PlaceBadge({ place }: { place: Place }) {
  if (place.kind === "restaurant") return <span className="rounded bg-stamp/20 px-1.5 py-0.5 text-[10px] text-stamp">식당</span>;
  if (place.is_recommended) return <span className="rounded bg-kodak/20 px-1.5 py-0.5 text-[10px] text-kodak">추천</span>;
  return null;
}

/**
 * 장소를 고르는 시트. 이미 등록된 장소에서 고르거나, 카카오에서 이름으로 찾아 새로 등록한다.
 * allowNone이면 "장소 없이"도 고를 수 있다.
 */
export function PlacePicker({
  tripId,
  open,
  onClose,
  onPick,
  allowNone,
}: {
  tripId: string;
  open: boolean;
  onClose: () => void;
  onPick: (placeId: string | null) => void;
  allowNone?: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const places = usePlaces(tripId).data;
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<KakaoPlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = keyword.trim();
    const list = sortPlaces(places ?? []);
    return term ? list.filter((p) => p.name.includes(term)) : list;
  }, [places, keyword]);

  async function search() {
    const term = keyword.trim();
    if (!term) return;
    setSearching(true);
    try {
      setResults(await searchPlaces(term, centerOf(places ?? [])));
    } catch {
      toast("지도 검색을 불러오지 못했어요.", "error");
    } finally {
      setSearching(false);
    }
  }

  async function register(result: KakaoPlaceResult) {
    setAdding(result.id);
    try {
      const id = await addPlace(tripId, {
        name: result.place_name,
        address: result.road_address_name || result.address_name,
        lat: Number(result.y),
        lng: Number(result.x),
        kakaoPlaceId: result.id,
      });
      await queryClient.invalidateQueries({ queryKey: keys.places(tripId) });
      onPick(id);
    } catch {
      toast("장소를 등록하지 못했어요.", "error");
    } finally {
      setAdding(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="어디인가요?">
      <div className="flex flex-col gap-3 pb-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setResults(null);
            }}
            className={inputClass}
            placeholder="장소 이름"
            enterKeyHint="search"
            aria-label="장소 이름"
          />
          <Button type="submit" busy={searching} disabled={!hasKakaoKey || !keyword.trim()} className="shrink-0">
            찾기
          </Button>
        </form>
        {!hasKakaoKey ? <Notice>지도 키가 없어 새 장소 검색은 쓸 수 없어요. 등록된 장소에서 골라 주세요.</Notice> : null}

        {allowNone ? (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="min-h-12 rounded-lg border border-dashed border-line px-3.5 text-left text-[15px] text-dim"
          >
            장소 없이 남기기
          </button>
        ) : null}

        {filtered.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {filtered.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => onPick(place.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg bg-well px-3.5 py-2 text-left active:bg-line"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{place.name}</span>
                    {place.address ? <span className="block truncate text-[12px] text-dim">{place.address}</span> : null}
                  </span>
                  <PlaceBadge place={place} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {results ? (
          <div className="flex flex-col gap-1.5">
            <p className="label pt-2">지도에서 찾은 곳</p>
            {results.length === 0 ? <p className="text-[14px] text-dim">찾은 곳이 없어요.</p> : null}
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                disabled={adding !== null}
                onClick={() => void register(result)}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2 text-left active:bg-well disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{result.place_name}</span>
                  <span className="block truncate text-[12px] text-dim">
                    {result.road_address_name || result.address_name}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-kodak">{adding === result.id ? "등록 중" : "등록"}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
