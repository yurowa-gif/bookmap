"use client";

import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 1024px)";

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** 노트북·전자칠판처럼 넓은 화면인가. 서버에서는 폰 기준으로 그린다. */
export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}
