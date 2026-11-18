import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { resetShotStoreForTests, shotStore, type QueuedShot } from "@/lib/queue/store";
import { syncQueue, type SyncApi } from "@/lib/queue/sync";

class NetworkDown extends Error {}

function shot(id: string, createdAt: number): QueuedShot {
  return {
    id,
    tripId: "trip",
    memberId: "member",
    placeId: null,
    memo: "",
    takenAt: new Date(createdAt).toISOString(),
    photo: new Uint8Array([1, 2, 3]).buffer,
    thumb: new Uint8Array([4]).buffer,
    width: 1600,
    height: 1200,
    state: "queued",
    error: null,
    attempts: 0,
    createdAt,
  };
}

/** 서버 대역: 필름 수를 세고, 올라온 파일과 완료된 컷을 기억한다. */
function fakeServer(film: number) {
  const reserved = new Set<string>();
  const files = new Set<string>();
  const finished = new Set<string>();
  const calls: string[] = [];
  let offline = false;
  let failUploadsOnce = false;

  const api: SyncApi = {
    async takeShot({ frameId }) {
      calls.push("take:" + frameId);
      if (offline) throw new NetworkDown();
      if (reserved.has(frameId)) {
        return { ok: true, frame_no: 1, remaining: film - reserved.size, uploaded: finished.has(frameId) };
      }
      if (reserved.size >= film) return { ok: false, error: "NO_FILM" };
      reserved.add(frameId);
      return { ok: true, frame_no: reserved.size, remaining: film - reserved.size, uploaded: false };
    },
    async uploadPhoto(path) {
      calls.push("upload:" + path);
      if (offline) throw new NetworkDown();
      if (failUploadsOnce) {
        failUploadsOnce = false;
        throw new NetworkDown();
      }
      files.add(path);
    },
    async finishShot(frameId) {
      calls.push("finish:" + frameId);
      if (offline) throw new NetworkDown();
      finished.add(frameId);
      return { ok: true };
    },
    photoPath: (trip, member, frame, thumb) => trip + "/" + member + "/" + frame + (thumb ? ".thumb" : "") + ".jpg",
    isRetryable: (error) => error instanceof NetworkDown,
  };

  return {
    api,
    reserved,
    files,
    finished,
    calls,
    setOffline(value: boolean) {
      offline = value;
    },
    failNextUpload() {
      failUploadsOnce = true;
    },
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetShotStoreForTests();
});

describe("전송 대기열", () => {
  it("찍은 순서대로 올리고 대기열을 비운다", async () => {
    const server = fakeServer(24);
    await shotStore.put(shot("b", 2));
    await shotStore.put(shot("a", 1));

    const report = await syncQueue(server.api, shotStore);

    expect(report).toEqual({ sent: 2, rejected: 0, waiting: 0 });
    expect(server.calls.filter((c) => c.startsWith("take:"))).toEqual(["take:a", "take:b"]);
    expect([...server.files].sort()).toEqual([
      "trip/member/a.jpg",
      "trip/member/a.thumb.jpg",
      "trip/member/b.jpg",
      "trip/member/b.thumb.jpg",
    ]);
    expect([...server.finished].sort()).toEqual(["a", "b"]);
    expect(await shotStore.all()).toEqual([]);
  });

  it("통신이 끊기면 컷을 잃지 않고 남겨 둔다", async () => {
    const server = fakeServer(24);
    server.setOffline(true);
    await shotStore.put(shot("a", 1));
    await shotStore.put(shot("b", 2));

    const report = await syncQueue(server.api, shotStore);

    expect(report).toEqual({ sent: 0, rejected: 0, waiting: 2 });
    const left = await shotStore.all();
    expect(left.map((s) => [s.id, s.state, s.attempts])).toEqual([
      ["a", "queued", 1],
      ["b", "queued", 0],
    ]);
  });

  it("통신이 돌아오면 이어서 올린다", async () => {
    const server = fakeServer(24);
    server.setOffline(true);
    await shotStore.put(shot("a", 1));
    await syncQueue(server.api, shotStore);

    server.setOffline(false);
    const report = await syncQueue(server.api, shotStore);

    expect(report.sent).toBe(1);
    expect(await shotStore.all()).toEqual([]);
  });

  it("올리다 끊겨 다시 보내도 컷은 한 번만 쓴다", async () => {
    const server = fakeServer(24);
    server.failNextUpload();
    await shotStore.put(shot("a", 1));

    expect(await syncQueue(server.api, shotStore)).toEqual({ sent: 0, rejected: 0, waiting: 1 });
    expect(server.reserved.size).toBe(1);

    expect(await syncQueue(server.api, shotStore)).toEqual({ sent: 1, rejected: 0, waiting: 0 });
    expect(server.reserved.size).toBe(1);
    expect(server.finished.has("a")).toBe(true);
  });

  it("서버에서는 이미 끝났는데 응답만 못 받았다면 다시 올리지 않는다", async () => {
    const server = fakeServer(24);
    await shotStore.put(shot("a", 1));
    await syncQueue(server.api, shotStore);
    await shotStore.put(shot("a", 1)); // 응답을 못 받아 대기열에 남아 있던 상황
    server.calls.length = 0;

    const report = await syncQueue(server.api, shotStore);

    expect(report.sent).toBe(1);
    expect(server.calls).toEqual(["take:a"]);
    expect(await shotStore.all()).toEqual([]);
  });

  it("필름이 없다고 거부된 컷은 표시만 하고 다시 보내지 않는다", async () => {
    const server = fakeServer(1);
    await shotStore.put(shot("a", 1));
    await shotStore.put(shot("b", 2));

    const report = await syncQueue(server.api, shotStore);

    expect(report).toEqual({ sent: 1, rejected: 1, waiting: 0 });
    const left = await shotStore.all();
    expect(left.map((s) => [s.id, s.state, s.error])).toEqual([["b", "rejected", "NO_FILM"]]);

    server.calls.length = 0;
    await syncQueue(server.api, shotStore);
    expect(server.calls).toEqual([]);
  });

  it("동시에 두 번 불러도 한 번만 돈다", async () => {
    const server = fakeServer(24);
    await shotStore.put(shot("a", 1));

    const [first, second] = await Promise.all([syncQueue(server.api, shotStore), syncQueue(server.api, shotStore)]);

    expect(first).toBe(second);
    expect(server.calls.filter((c) => c === "take:a")).toHaveLength(1);
  });
});
