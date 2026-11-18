import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * 찍었지만 아직 서버에 다 올라가지 않은 컷.
 * 사진은 Blob 대신 ArrayBuffer로 둔다(일부 브라우저의 IndexedDB는 Blob 저장이 불안정하다).
 */
export interface QueuedShot {
  id: string; // frame id. 서버에 같은 id로 여러 번 보내도 한 컷만 쓴다.
  tripId: string;
  memberId: string;
  placeId: string | null;
  memo: string;
  takenAt: string;
  photo: ArrayBuffer;
  thumb: ArrayBuffer;
  width: number;
  height: number;
  /** queued: 전송 대기, rejected: 서버가 거부(필름 없음 등)해서 더 시도하지 않음 */
  state: "queued" | "rejected";
  error: string | null;
  attempts: number;
  createdAt: number;
}

interface QueueSchema extends DBSchema {
  shots: { key: string; value: QueuedShot; indexes: { byCreated: number } };
}

let dbPromise: Promise<IDBPDatabase<QueueSchema>> | null = null;

function db() {
  dbPromise ??= openDB<QueueSchema>("bookmap-queue", 1, {
    upgrade(database) {
      const store = database.createObjectStore("shots", { keyPath: "id" });
      store.createIndex("byCreated", "createdAt");
    },
  });
  return dbPromise;
}

export interface ShotStore {
  put(shot: QueuedShot): Promise<void>;
  remove(id: string): Promise<void>;
  /** 찍은 순서대로 */
  all(): Promise<QueuedShot[]>;
}

export const shotStore: ShotStore = {
  async put(shot) {
    await (await db()).put("shots", shot);
  },
  async remove(id) {
    await (await db()).delete("shots", id);
  },
  async all() {
    return (await db()).getAllFromIndex("shots", "byCreated");
  },
};

/** 테스트에서 저장소를 새로 열기 위한 것 */
export function resetShotStoreForTests() {
  dbPromise = null;
}
