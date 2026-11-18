"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { ensureAuth, leaveSession, listMemberships } from "@/lib/api";
import { isConfigured } from "@/lib/supabase/client";
import type { Membership } from "@/lib/types";

const CURRENT_KEY = "bookmap.currentTrip";
const storeListeners = new Set<() => void>();

function readCurrent(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function writeCurrent(tripId: string | null) {
  try {
    if (tripId) window.localStorage.setItem(CURRENT_KEY, tripId);
    else window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 이번 방문 동안만 기억한다.
  }
  for (const listener of storeListeners) listener();
}

function subscribeCurrent(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

interface SessionValue {
  status: "loading" | "ready" | "error";
  memberships: Membership[];
  /** 지금 보고 있는 기행. 없으면 입장 화면으로 보낸다. */
  current: Membership | null;
  select(tripId: string): void;
  refresh(): Promise<void>;
  /** 이 기기에서 지금 기행의 연결을 끊는다. 기록은 남는다. */
  leave(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export const membershipsKey = ["memberships"] as const;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const currentId = useSyncExternalStore(subscribeCurrent, readCurrent, () => null);

  const query = useQuery({
    queryKey: membershipsKey,
    enabled: isConfigured,
    staleTime: 30_000,
    // 교사가 필름을 더 주거나 PIN을 초기화한 것을 늦지 않게 반영한다.
    refetchInterval: 60_000,
    queryFn: async () => {
      await ensureAuth();
      return listMemberships();
    },
  });

  const memberships = useMemo(() => query.data ?? [], [query.data]);
  const current = useMemo(
    () => memberships.find((m) => m.trip.id === currentId) ?? memberships[0] ?? null,
    [memberships, currentId],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: membershipsKey });
  }, [queryClient]);

  const leave = useCallback(async () => {
    if (!current) return;
    await leaveSession(current.trip.id);
    writeCurrent(null);
    await queryClient.invalidateQueries({ queryKey: membershipsKey });
  }, [current, queryClient]);

  const value = useMemo<SessionValue>(
    () => ({
      status: !isConfigured ? "error" : query.isPending ? "loading" : query.isError ? "error" : "ready",
      memberships,
      current,
      select: writeCurrent,
      refresh,
      leave,
    }),
    [query.isPending, query.isError, memberships, current, refresh, leave],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider 밖에서 useSession을 불렀습니다.");
  return value;
}

const TripContext = createContext<Membership | null>(null);

export const TripProvider = TripContext.Provider;

/** 기행 화면 안에서 쓴다. 기행 레이아웃이 입장 여부를 이미 확인했다. */
export function useTrip(): Membership {
  const value = useContext(TripContext);
  if (!value) throw new Error("기행 화면 밖에서 useTrip을 불렀습니다.");
  return value;
}
