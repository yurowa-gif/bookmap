import type { Result } from "@/lib/types";
import type { QueuedShot, ShotStore } from "@/lib/queue/store";

/** 대기열이 서버와 이야기하는 데 필요한 것만 모은 창구. 테스트에서는 가짜로 바꾼다. */
export interface SyncApi {
  takeShot(input: {
    frameId: string;
    tripId: string;
    placeId: string | null;
    memo: string;
    takenAt: string;
  }): Promise<Result<{ frame_no: number; remaining: number; uploaded: boolean }>>;
  uploadPhoto(path: string, body: Blob): Promise<void>;
  finishShot(frameId: string, width: number, height: number): Promise<Result<object>>;
  photoPath(tripId: string, memberId: string, frameId: string, thumb?: boolean): string;
  /** 통신 문제라서 나중에 다시 해 볼 오류인가 */
  isRetryable(error: unknown): boolean;
}

export interface SyncReport {
  sent: number;
  rejected: number;
  /** 통신 문제로 남겨 둔 컷 수 */
  waiting: number;
}

const jpeg = (buffer: ArrayBuffer) => new Blob([buffer], { type: "image/jpeg" });

async function sendOne(api: SyncApi, shot: QueuedShot): Promise<"sent" | { rejected: string }> {
  // 1) 컷 예약. 같은 id로 다시 보내도 한 컷만 쓴다.
  const reserved = await api.takeShot({
    frameId: shot.id,
    tripId: shot.tripId,
    placeId: shot.placeId,
    memo: shot.memo,
    takenAt: shot.takenAt,
  });
  if (!reserved.ok) return { rejected: reserved.error };
  if (reserved.uploaded) return "sent"; // 지난번에 끝났는데 응답만 못 받은 경우

  // 2) 사진 두 장. 이미 올라가 있으면 uploadPhoto가 성공으로 처리한다.
  await api.uploadPhoto(api.photoPath(shot.tripId, shot.memberId, shot.id), jpeg(shot.photo));
  await api.uploadPhoto(api.photoPath(shot.tripId, shot.memberId, shot.id, true), jpeg(shot.thumb));

  // 3) 완료 표시
  const finished = await api.finishShot(shot.id, shot.width, shot.height);
  if (!finished.ok) return { rejected: finished.error };
  return "sent";
}

let running: Promise<SyncReport> | null = null;

/**
 * 대기 중인 컷을 찍은 순서대로 올린다.
 * 통신이 끊기면 거기서 멈추고 나머지는 다음 기회에 보낸다.
 * 동시에 두 번 불러도 한 번만 돈다.
 */
export function syncQueue(api: SyncApi, store: ShotStore): Promise<SyncReport> {
  running ??= run(api, store).finally(() => {
    running = null;
  });
  return running;
}

async function run(api: SyncApi, store: ShotStore): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, rejected: 0, waiting: 0 };
  const shots = (await store.all()).filter((s) => s.state === "queued");

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    try {
      const outcome = await sendOne(api, shot);
      if (outcome === "sent") {
        await store.remove(shot.id);
        report.sent++;
      } else {
        await store.put({ ...shot, state: "rejected", error: outcome.rejected, attempts: shot.attempts + 1 });
        report.rejected++;
      }
    } catch (error) {
      if (api.isRetryable(error)) {
        await store.put({ ...shot, attempts: shot.attempts + 1, error: "NETWORK" });
        report.waiting = shots.length - i;
        return report; // 지금은 통신이 안 된다. 순서를 지키기 위해 여기서 멈춘다.
      }
      const message = error instanceof Error ? error.message : "UNKNOWN";
      await store.put({ ...shot, state: "rejected", error: message, attempts: shot.attempts + 1 });
      report.rejected++;
    }
  }
  return report;
}
