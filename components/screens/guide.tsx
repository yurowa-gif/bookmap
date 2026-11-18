"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { EmptyState, messageFor, useToast } from "@/components/ui";
import { formatDate } from "@/components/screens/join";
import { chooseMeal } from "@/lib/api";
import { keys, useMealChoices, usePlaces } from "@/lib/queries";
import { useTrip } from "@/lib/session";

export function GuideScreen() {
  const { trip, member } = useTrip();
  const toast = useToast();
  const queryClient = useQueryClient();
  const places = usePlaces(trip.id).data;
  const choices = useMealChoices(trip.id).data;
  const [saving, setSaving] = useState<string | null>(null);

  const restaurants = useMemo(() => (places ?? []).filter((p) => p.kind === "restaurant"), [places]);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of choices ?? []) out.set(c.place_id, (out.get(c.place_id) ?? 0) + 1);
    return out;
  }, [choices]);
  const mine = choices?.find((c) => c.member_id === member.id)?.place_id ?? null;

  async function choose(placeId: string) {
    setSaving(placeId);
    try {
      await chooseMeal(trip.id, member.id, placeId);
      await queryClient.invalidateQueries({ queryKey: keys.meals(trip.id) });
    } catch {
      toast(messageFor("UNKNOWN"), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <section>
        <p className="label text-kodak">{formatDate(trip.trip_date)}</p>
        <h1 className="pt-1 text-[24px] font-black">{trip.title}</h1>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">일정과 안내</h2>
        {trip.notice ? (
          <p className="rounded-xl bg-panel px-4 py-4 text-[15px] leading-[1.75] whitespace-pre-wrap">{trip.notice}</p>
        ) : (
          <p className="rounded-xl bg-panel px-4 py-4 text-[14px] text-dim">선생님이 아직 안내를 올리지 않았어요.</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">점심 고르기</h2>
        {restaurants.length === 0 ? (
          <EmptyState title="식당 목록이 아직 없어요">선생님이 식당을 올리면 여기서 고를 수 있어요.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {restaurants.map((place) => {
              const chosen = mine === place.id;
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    disabled={saving !== null}
                    onClick={() => void choose(place.id)}
                    className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                      chosen ? "border-kodak bg-kodak/10" : "border-line bg-panel active:bg-well"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[16px] font-bold">{place.name}</span>
                      {place.menu_note ? <span className="block pt-0.5 text-[13px] text-dim">{place.menu_note}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-[15px] font-bold text-kodak">{counts.get(place.id) ?? 0}명</span>
                      <span className="block text-[11px] text-dim">{chosen ? "내 선택" : saving === place.id ? "저장 중" : "고르기"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {restaurants.length > 0 ? (
          <p className="text-[12px] text-faint">기행 전까지 언제든 바꿀 수 있습니다.</p>
        ) : null}
      </section>
    </div>
  );
}
