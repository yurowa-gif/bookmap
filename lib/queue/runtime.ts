import { ApiError, finishShot, photoPath, takeShot, uploadPhoto } from "@/lib/api";
import { shotStore, type QueuedShot } from "@/lib/queue/store";
import { syncQueue, type SyncApi, type SyncReport } from "@/lib/queue/sync";

const realApi: SyncApi = {
  takeShot,
  uploadPhoto,
  finishShot,
  photoPath,
  isRetryable: (error) => !(error instanceof ApiError) || error.isNetwork,
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** 대기열이 바뀔 때마다 불린다. 돌려주는 함수로 구독을 끊는다. */
export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listQueuedShots(): Promise<QueuedShot[]> {
  return shotStore.all();
}

/** 찍은 컷을 폰에 먼저 저장하고 곧바로 전송을 시도한다. */
export async function enqueueShot(shot: QueuedShot): Promise<void> {
  await shotStore.put(shot);
  notify();
  void flushQueue();
}

export async function flushQueue(): Promise<SyncReport> {
  try {
    return await syncQueue(realApi, shotStore);
  } finally {
    notify();
  }
}

/** 거부된 컷을 다시 대기 상태로 돌린다. */
export async function retryShot(id: string): Promise<void> {
  const shot = (await shotStore.all()).find((s) => s.id === id);
  if (!shot) return;
  await shotStore.put({ ...shot, state: "queued", error: null });
  notify();
  void flushQueue();
}

export async function dropShot(id: string): Promise<void> {
  await shotStore.remove(id);
  notify();
}
