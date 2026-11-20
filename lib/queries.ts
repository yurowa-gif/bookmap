"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  getTrip,
  listFrames,
  listMealChoices,
  listPlaces,
  listStamps,
  placeShotCounts,
  rollStats,
  signPhotoUrls,
} from "@/lib/api";
import { listQueuedShots, subscribeQueue } from "@/lib/queue/runtime";
import type { QueuedShot } from "@/lib/queue/store";
import { supabase } from "@/lib/supabase/client";

export const keys = {
  trip: (tripId: string) => ["trip", tripId] as const,
  places: (tripId: string) => ["places", tripId] as const,
  frames: (tripId: string) => ["frames", tripId] as const,
  rolls: (tripId: string) => ["rolls", tripId] as const,
  placeCounts: (tripId: string) => ["placeCounts", tripId] as const,
  stamps: (tripId: string) => ["stamps", tripId] as const,
  meals: (tripId: string) => ["meals", tripId] as const,
};

/** 기행 정보. 현상 여부가 바뀌는 것을 놓치지 않도록 주기적으로 다시 읽는다. */
export function useTripInfo(tripId: string) {
  return useQuery({ queryKey: keys.trip(tripId), queryFn: () => getTrip(tripId), refetchInterval: 20_000 });
}

export function usePlaces(tripId: string) {
  return useQuery({ queryKey: keys.places(tripId), queryFn: () => listPlaces(tripId), staleTime: 15_000 });
}

export function useFrames(tripId: string, live = false) {
  return useQuery({
    queryKey: keys.frames(tripId),
    queryFn: () => listFrames(tripId),
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export function useRollStats(tripId: string, live = false) {
  return useQuery({
    queryKey: keys.rolls(tripId),
    queryFn: () => rollStats(tripId),
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export function usePlaceCounts(tripId: string, live = false) {
  return useQuery({
    queryKey: keys.placeCounts(tripId),
    queryFn: () => placeShotCounts(tripId),
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export function useStamps(tripId: string, frameIds: string[], enabled: boolean) {
  const signature = frameIds.join(",");
  return useQuery({
    queryKey: [...keys.stamps(tripId), signature],
    queryFn: () => listStamps(frameIds),
    enabled: enabled && frameIds.length > 0,
    staleTime: 10_000,
  });
}

export function useMealChoices(tripId: string) {
  return useQuery({ queryKey: keys.meals(tripId), queryFn: () => listMealChoices(tripId), staleTime: 10_000 });
}

/** 비공개 사진 경로를 볼 수 있는 주소로 바꾼다. 주소는 한 시간짜리라 50분마다 새로 받는다. */
export function usePhotoUrls(paths: string[]) {
  const sorted = useMemo(() => [...new Set(paths)].sort(), [paths]);
  const query = useQuery({
    queryKey: ["photoUrls", sorted.join("|")],
    queryFn: () => signPhotoUrls(sorted),
    enabled: sorted.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  });
  return query.data ?? {};
}

/** 이 폰에만 있고 아직 서버에 다 올라가지 않은 컷 */
export function useQueuedShots(tripId: string, memberId: string): QueuedShot[] {
  const [shots, setShots] = useState<QueuedShot[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      listQueuedShots()
        .then((all) => {
          if (alive) setShots(all.filter((s) => s.tripId === tripId && s.memberId === memberId));
        })
        .catch(() => {
          if (alive) setShots([]);
        });
    };
    load();
    const unsubscribe = subscribeQueue(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tripId, memberId]);
  return shots;
}

/** ArrayBuffer로 저장된 사진을 화면에 띄울 임시 주소로 바꾼다. */
export function useObjectUrls(shots: QueuedShot[], which: "photo" | "thumb" = "thumb"): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const made: Record<string, string> = {};
    for (const shot of shots) {
      made[shot.id] = URL.createObjectURL(new Blob([shot[which]], { type: "image/jpeg" }));
    }
    // 임시 주소는 React 바깥의 자원이다. 만들고 해제하는 일을 이 effect가 맡는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(made);
    return () => {
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
    };
  }, [shots, which]);
  return urls;
}

/**
 * 실시간 알림을 받으면 관련 목록을 다시 읽는다.
 * 연결이 안 되는 환경에서도 주기적 새로 고침이 있으므로 화면은 계속 맞는다.
 */
export function useTripLive(tripId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sb = supabase();
    const refresh = (...queryKeys: (readonly unknown[])[]) => {
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
    };
    const channel = sb
      .channel("trip:" + tripId)
      .on("postgres_changes", { event: "*", schema: "public", table: "trips", filter: "id=eq." + tripId }, () =>
        refresh(keys.trip(tripId), keys.frames(tripId)),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "frames", filter: "trip_id=eq." + tripId }, () =>
        refresh(keys.frames(tripId), keys.rolls(tripId), keys.placeCounts(tripId)),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: "trip_id=eq." + tripId }, () =>
        refresh(keys.places(tripId)),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [tripId, queryClient]);
}
