import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Actor, admin, connect, type Json } from "./helpers";

// 한 기행의 흐름을 처음부터 끝까지 따라가며 규칙을 확인한다.
// 테스트는 위에서 아래로 순서대로 이어진다.

const ADMIN_CODE = "test-admin-code";

let db: pg.Client;
let teacher: Actor; // 기행을 만든 교사
let anna: Actor; // 1모둠 학생
let ben: Actor; // 2모둠 학생
let outsider: Actor; // 어느 기행에도 없는 로그인 사용자
let otherTeacher: Actor; // 다른 기행의 교사
let anon: Actor; // 로그인하지 않은 방문자

let tripId: string;
let joinCode: string;
let teacherCode: string;
let annaId: string;
let benId: string;
let otherTripId: string;

const frameA1 = randomUUID();
const frameA2 = randomUUID();
const frameB1 = randomUUID();

function photoPath(trip: string, member: string, frame: string, thumb = false) {
  return trip + "/" + member + "/" + frame + (thumb ? ".thumb.jpg" : ".jpg");
}

async function upload(actor: Actor, name: string) {
  return actor.query("insert into storage.objects (bucket_id, name) values ('photos', $1)", [name]);
}

async function visibleFrameIds(actor: Actor) {
  const rows = await actor.query<{ id: string }>("select id from public.frames where trip_id = $1", [tripId]);
  return rows.map((r) => r.id).sort();
}

beforeAll(async () => {
  db = await connect();
  await admin(
    db,
    "insert into private.app_settings (admin_code_hash) values (extensions.crypt($1, extensions.gen_salt('bf', 4)))",
    [ADMIN_CODE],
  );
  teacher = new Actor(db);
  anna = new Actor(db);
  ben = new Actor(db);
  outsider = new Actor(db);
  otherTeacher = new Actor(db);
  anon = new Actor(db, "anon");
});

afterAll(async () => {
  await db.end();
});

describe("기행 만들기", () => {
  it("관리 코드가 틀리면 만들 수 없다", async () => {
    const out = await outsider.rpc<Json>("create_trip", ["wrong", "서촌", "2026-12-05", ["1모둠"], "김교사", "1234"]);
    expect(out).toMatchObject({ ok: false, error: "INVALID_CODE" });
    expect(await admin(db, "select 1 from public.trips")).toHaveLength(0);
  });

  it("관리 코드가 맞으면 기행과 코드 두 개가 생기고 만든 사람이 교사가 된다", async () => {
    const out = await teacher.rpc<Json>("create_trip", [
      ADMIN_CODE,
      "서촌 인문학기행",
      "2026-12-05",
      ["1모둠", "2모둠", " 1모둠 ", "교사", ""],
      "김교사",
      "1234",
    ]);
    expect(out.ok).toBe(true);
    tripId = out.trip_id as string;
    joinCode = out.join_code as string;
    teacherCode = out.teacher_code as string;
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(teacherCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const [trip] = await teacher.query<{ teams: string[] }>("select teams from public.trips where id = $1", [tripId]);
    expect(trip.teams.sort()).toEqual(["1모둠", "2모둠"]);
  });

  it("다른 기행도 만들어 둔다", async () => {
    const out = await otherTeacher.rpc<Json>("create_trip", [ADMIN_CODE, "다른 기행", "2026-12-10", [], "박교사", "9999"]);
    expect(out.ok).toBe(true);
    otherTripId = out.trip_id as string;
  });
});

describe("로그인하지 않은 방문자", () => {
  it("테이블을 읽지 못한다", async () => {
    await expect(anon.query("select * from public.trips")).rejects.toThrow(/permission denied/);
    await expect(anon.query("select * from public.frames")).rejects.toThrow(/permission denied/);
  });

  it("입장 함수를 부르지 못한다", async () => {
    await expect(anon.rpc("join_trip", [joinCode, "누구", "1모둠", "0000"])).rejects.toThrow(/permission denied/);
  });

  it("ping만 된다", async () => {
    expect(await anon.rpc<string>("ping")).toBe("pong");
  });
});

describe("입장", () => {
  it("없는 코드는 거부된다", async () => {
    const out = await anna.rpc<Json>("join_trip", ["ZZZZZZ", "안나", "1모둠", "1111"]);
    expect(out).toMatchObject({ ok: false, error: "INVALID_CODE" });
  });

  it("코드를 미리 조회하면 기행 이름과 모둠 목록이 나온다", async () => {
    const out = await anna.rpc<Json>("peek_trip", [" " + joinCode.toLowerCase() + " "]);
    expect(out).toMatchObject({ ok: true, title: "서촌 인문학기행", role: "student" });
  });

  it("모둠 목록에 없는 모둠이나 '교사' 모둠으로는 들어올 수 없다", async () => {
    expect(await anna.rpc<Json>("join_trip", [joinCode, "안나", "9모둠", "1111"])).toMatchObject({ error: "BAD_TEAM" });
    expect(await anna.rpc<Json>("join_trip", [joinCode, "김교사", "교사", "1234"])).toMatchObject({ error: "BAD_TEAM" });
  });

  it("PIN은 숫자 네 자리여야 한다", async () => {
    expect(await anna.rpc<Json>("join_trip", [joinCode, "안나", "1모둠", "12ab"])).toMatchObject({ error: "BAD_INPUT" });
  });

  it("학생 두 명이 들어온다", async () => {
    const a = await anna.rpc<Json>("join_trip", [joinCode, "안나", "1모둠", "1111"]);
    const b = await ben.rpc<Json>("join_trip", [joinCode, "벤", "2모둠", "2222"]);
    expect(a).toMatchObject({ ok: true, role: "student" });
    expect(b).toMatchObject({ ok: true, role: "student" });
    annaId = a.member_id as string;
    benId = b.member_id as string;
  });

  it("다른 기기에서 같은 이름과 맞는 PIN으로 들어오면 같은 구성원으로 이어진다", async () => {
    const phone2 = new Actor(db);
    const out = await phone2.rpc<Json>("join_trip", [joinCode, "안나", "1모둠", "1111"]);
    expect(out).toMatchObject({ ok: true, member_id: annaId });
  });

  it("PIN이 틀리면 남의 이름으로 들어올 수 없고, 다섯 번 틀리면 잠긴다", async () => {
    const thief = new Actor(db);
    for (let left = 4; left >= 0; left--) {
      const out = await thief.rpc<Json>("join_trip", [joinCode, "벤", "2모둠", "0000"]);
      expect(out).toMatchObject({ ok: false, error: "WRONG_PIN", attempts_left: left });
    }
    // 잠긴 동안에는 맞는 PIN도 통하지 않는다.
    const locked = await thief.rpc<Json>("join_trip", [joinCode, "벤", "2모둠", "2222"]);
    expect(locked).toMatchObject({ ok: false, error: "LOCKED" });
    expect(await thief.query("select 1 from public.members")).toHaveLength(0);

    await admin(db, "update private.member_secrets set locked_until = null where member_id = $1", [benId]);
  });

  it("없는 코드를 열 번 넣으면 그 계정이 잠긴다", async () => {
    const guesser = new Actor(db);
    for (let i = 0; i < 10; i++) {
      expect(await guesser.rpc<Json>("join_trip", ["AAAAA" + (i % 8 + 2), "x", "", "0000"])).toMatchObject({
        error: "INVALID_CODE",
      });
    }
    expect(await guesser.rpc<Json>("join_trip", [joinCode, "새학생", "1모둠", "0000"])).toMatchObject({ error: "LOCKED" });
    expect(await guesser.rpc<Json>("peek_trip", [joinCode])).toMatchObject({ error: "LOCKED" });
  });

  it("교사 코드로 들어오면 교사가 된다", async () => {
    const t2 = new Actor(db);
    const out = await t2.rpc<Json>("join_trip", [teacherCode, "이교사", "아무거나", "5555"]);
    expect(out).toMatchObject({ ok: true, role: "teacher" });
  });

  it("학생 코드로는 교사 이름을 차지할 수 없다", async () => {
    await admin(db, "update public.trips set teams = '{}' where id = $1", [otherTripId]);
    const codes = await otherTeacher.rpc<Json>("get_trip_codes", [otherTripId]);
    const sneaky = new Actor(db);
    const out = await sneaky.rpc<Json>("join_trip", [codes.join_code, "박교사", "교사", "9999"]);
    expect(out).toMatchObject({ ok: false, error: "BAD_TEAM" });
  });
});

describe("기행 밖의 사람", () => {
  it("아무것도 보지 못한다", async () => {
    for (const table of ["trips", "members", "places", "frames", "stamps", "essays", "meal_choices"]) {
      expect(await outsider.query("select * from public." + table)).toHaveLength(0);
    }
    await expect(outsider.rpc("roll_stats", [tripId])).rejects.toThrow(/NOT_MEMBER/);
  });

  it("다른 기행의 교사도 이 기행을 보지 못한다", async () => {
    const rows = await otherTeacher.query("select id from public.trips");
    expect(rows).toEqual([{ id: otherTripId }]);
    expect(await otherTeacher.query("select 1 from public.members where trip_id = $1", [tripId])).toHaveLength(0);
  });
});

describe("비밀과 직접 쓰기", () => {
  it("참가 코드와 PIN 해시는 누구도 직접 읽지 못한다", async () => {
    for (const actor of [anna, teacher]) {
      await expect(actor.query("select * from private.trip_codes")).rejects.toThrow(/permission denied/);
      await expect(actor.query("select * from private.member_secrets")).rejects.toThrow(/permission denied/);
      await expect(actor.query("select * from private.app_settings")).rejects.toThrow(/permission denied/);
    }
  });

  it("코드는 교사만 함수로 본다", async () => {
    await expect(anna.rpc("get_trip_codes", [tripId])).rejects.toThrow(/NOT_TEACHER/);
    expect(await teacher.rpc<Json>("get_trip_codes", [tripId])).toEqual({ join_code: joinCode, teacher_code: teacherCode });
  });

  it("학생은 구성원·기행·컷 테이블을 직접 고치지 못한다", async () => {
    await expect(anna.query("update public.members set role = 'teacher' where id = $1", [annaId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(anna.query("update public.members set film = 99 where id = $1", [annaId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(anna.query("update public.trips set developed_at = now()")).rejects.toThrow(/permission denied/);
    await expect(
      anna.query("insert into public.frames (id, trip_id, member_id, frame_no) values ($1, $2, $3, 1)", [
        randomUUID(),
        tripId,
        annaId,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      anna.query("insert into public.member_sessions (user_id, member_id) values ($1, $2)", [anna.uid, benId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("학생은 교사 전용 함수를 쓰지 못한다", async () => {
    await expect(anna.rpc("set_developed", [tripId, true])).rejects.toThrow(/NOT_TEACHER/);
    await expect(anna.rpc("set_member_film", [annaId, 99])).rejects.toThrow(/NOT_TEACHER/);
    await expect(anna.rpc("reset_pin", [benId])).rejects.toThrow(/NOT_TEACHER/);
    await expect(
      anna.rpc("update_trip", [tripId, "해킹", "2026-01-01", [], "", null], ["uuid", "text", "date", "text[]", "text", "date"]),
    ).rejects.toThrow(/NOT_TEACHER/);
  });

  it("다른 기행의 교사는 이 기행에서 교사가 아니다", async () => {
    await expect(otherTeacher.rpc("set_developed", [tripId, true])).rejects.toThrow(/NOT_TEACHER/);
    await expect(otherTeacher.rpc("get_trip_codes", [tripId])).rejects.toThrow(/NOT_TEACHER/);
    await expect(otherTeacher.rpc("set_member_film", [annaId, 0])).rejects.toThrow(/NOT_TEACHER/);
  });
});

describe("장소", () => {
  let placeId: string;

  it("학생이 장소를 추가하고, 같은 카카오 장소는 한 번만 생긴다", async () => {
    const args = [tripId, "대오서점", "서울 종로구", 37.5796, 126.9692, "kakao-1"];
    const casts = ["uuid", "text", "text", "float8", "float8", "text"];
    placeId = await anna.rpc<string>("add_place", args, casts);
    expect(await ben.rpc<string>("add_place", args, casts)).toBe(placeId);
    expect(await anna.query("select 1 from public.places where trip_id = $1", [tripId])).toHaveLength(1);
  });

  it("학생은 장소를 직접 넣거나 추천으로 바꾸지 못한다", async () => {
    await expect(
      anna.query(
        "insert into public.places (trip_id, name, lat, lng, is_recommended) values ($1, '몰래', 37, 127, true)",
        [tripId],
      ),
    ).rejects.toThrow(/row-level security/);
    await anna.query("update public.places set is_recommended = true where id = $1", [placeId]);
    const [row] = await anna.query<{ is_recommended: boolean }>("select is_recommended from public.places where id = $1", [
      placeId,
    ]);
    expect(row.is_recommended).toBe(false);
  });

  it("교사는 추천으로 지정하고 식당을 등록한다", async () => {
    await teacher.query("update public.places set is_recommended = true where id = $1", [placeId]);
    await teacher.query(
      "insert into public.places (trip_id, name, lat, lng, kind, menu_note) values ($1, '서촌식당', 37.58, 126.97, 'restaurant', '칼국수 9,000원')",
      [tripId],
    );
    const rows = await ben.query<{ name: string }>("select name from public.places where trip_id = $1 order by name", [
      tripId,
    ]);
    expect(rows.map((r) => r.name)).toEqual(["대오서점", "서촌식당"]);
  });

  it("교사는 다른 기행에 장소를 넣지 못한다", async () => {
    await expect(
      teacher.query("insert into public.places (trip_id, name, lat, lng) values ($1, '침범', 37, 127)", [otherTripId]),
    ).rejects.toThrow(/row-level security/);
  });

  it("소개글은 먼저 쓴 학생의 것이고, 교사는 고칠 수 있다", async () => {
    expect(await anna.rpc<Json>("write_place_intro", [placeId, "이상이 드나들던 헌책방"])).toEqual({ ok: true });
    expect(await ben.rpc<Json>("write_place_intro", [placeId, "내가 덮어쓴다"])).toMatchObject({ error: "INTRO_TAKEN" });
    expect(await anna.rpc<Json>("write_place_intro", [placeId, "서울에서 가장 오래된 헌책방"])).toEqual({ ok: true });
    const [row] = await ben.query<{ intro: string; intro_by: string }>(
      "select intro, intro_by from public.places where id = $1",
      [placeId],
    );
    expect(row).toEqual({ intro: "서울에서 가장 오래된 헌책방", intro_by: annaId });
    expect(await teacher.rpc<Json>("write_place_intro", [placeId, "교사가 다듬은 소개"])).toEqual({ ok: true });
  });

  it("식당 고르기는 식당에만, 자기 이름으로만 된다", async () => {
    const [restaurant] = await anna.query<{ id: string }>(
      "select id from public.places where trip_id = $1 and kind = 'restaurant'",
      [tripId],
    );
    await expect(
      anna.query("insert into public.meal_choices (trip_id, member_id, place_id) values ($1, $2, $3)", [
        tripId,
        annaId,
        placeId,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      anna.query("insert into public.meal_choices (trip_id, member_id, place_id) values ($1, $2, $3)", [
        tripId,
        benId,
        restaurant.id,
      ]),
    ).rejects.toThrow(/row-level security/);
    await anna.query("insert into public.meal_choices (trip_id, member_id, place_id) values ($1, $2, $3)", [
      tripId,
      annaId,
      restaurant.id,
    ]);
    expect(await ben.query("select 1 from public.meal_choices where trip_id = $1", [tripId])).toHaveLength(1);
  });
});

describe("컷", () => {
  const shotCasts = ["uuid", "uuid", "uuid", "text", "timestamptz"];

  it("필름을 다 쓰면 더 찍을 수 없다", async () => {
    await teacher.rpc("set_member_film", [annaId, 2]);
    expect(await anna.rpc<Json>("take_shot", [frameA1, tripId, null, "첫 컷", null], shotCasts)).toMatchObject({
      ok: true,
      frame_no: 1,
      remaining: 1,
    });
    expect(await anna.rpc<Json>("take_shot", [frameA2, tripId, null, "둘째 컷", null], shotCasts)).toMatchObject({
      ok: true,
      frame_no: 2,
      remaining: 0,
    });
    expect(await anna.rpc<Json>("take_shot", [randomUUID(), tripId, null, "셋째", null], shotCasts)).toMatchObject({
      ok: false,
      error: "NO_FILM",
    });
  });

  it("같은 요청이 다시 와도 컷은 한 번만 쓴다", async () => {
    expect(await anna.rpc<Json>("take_shot", [frameA1, tripId, null, "재전송", null], shotCasts)).toMatchObject({
      ok: true,
      frame_no: 1,
      remaining: 0,
    });
    expect(await admin(db, "select 1 from public.frames where member_id = $1", [annaId])).toHaveLength(2);
  });

  it("남의 컷 번호를 가로챌 수 없다", async () => {
    await expect(ben.rpc("take_shot", [frameA1, tripId, null, "", null], shotCasts)).rejects.toThrow(/FRAME_CONFLICT/);
  });

  it("기행 밖의 사람은 찍을 수 없다", async () => {
    await expect(outsider.rpc("take_shot", [randomUUID(), tripId, null, "", null], shotCasts)).rejects.toThrow(
      /NOT_MEMBER/,
    );
  });

  it("미래 시각은 지금으로 맞춘다", async () => {
    await ben.rpc("take_shot", [frameB1, tripId, null, "벤의 컷", "2099-01-01T00:00:00Z"], shotCasts);
    const [row] = await ben.query<{ future: boolean }>("select taken_at > now() as future from public.frames where id = $1", [
      frameB1,
    ]);
    expect(row.future).toBe(false);
  });

  it("버린 컷은 돌아오지 않는다", async () => {
    await anna.rpc("discard_shot", [frameA2]);
    expect(await anna.rpc<Json>("take_shot", [randomUUID(), tripId, null, "", null], shotCasts)).toMatchObject({
      error: "NO_FILM",
    });
    await expect(ben.rpc("discard_shot", [frameA1])).rejects.toThrow(/NOT_OWNER/);
  });
});

describe("사진 파일", () => {
  it("자기 컷의 경로에만 올릴 수 있다", async () => {
    await upload(anna, photoPath(tripId, annaId, frameA1));
    await upload(anna, photoPath(tripId, annaId, frameA1, true));

    await expect(upload(ben, photoPath(tripId, annaId, frameA1) + "x")).rejects.toThrow(/row-level security/);
    await expect(upload(ben, photoPath(tripId, benId, frameA1))).rejects.toThrow(/row-level security/);
    await expect(upload(anna, photoPath(tripId, annaId, randomUUID()))).rejects.toThrow(/row-level security/);
    await expect(upload(anna, "아무/경로.jpg")).rejects.toThrow(/row-level security/);
    await expect(upload(outsider, photoPath(tripId, annaId, frameA1))).rejects.toThrow(/row-level security/);
  });

  it("버린 컷에는 올릴 수 없다", async () => {
    await expect(upload(anna, photoPath(tripId, annaId, frameA2))).rejects.toThrow(/row-level security/);
  });

  it("파일이 둘 다 올라와야 완료된다", async () => {
    expect(await ben.rpc<Json>("finish_shot", [frameB1, 1600, 1200])).toMatchObject({ ok: false, error: "NOT_UPLOADED" });
    await upload(ben, photoPath(tripId, benId, frameB1));
    await upload(ben, photoPath(tripId, benId, frameB1, true));
    expect(await ben.rpc<Json>("finish_shot", [frameB1, 1600, 1200])).toEqual({ ok: true });
    expect(await anna.rpc<Json>("finish_shot", [frameA1, 1200, 1600])).toEqual({ ok: true });
    await expect(ben.rpc("finish_shot", [frameA1, 1, 1])).rejects.toThrow(/NOT_OWNER/);
  });

  it("완료된 뒤에는 파일을 바꾸거나 지울 수 없다", async () => {
    const name = photoPath(tripId, benId, frameB1);
    await ben.query("delete from storage.objects where name = $1", [name]);
    expect(await admin(db, "select 1 from storage.objects where name = $1", [name])).toHaveLength(1);
    await expect(
      ben.query("update storage.objects set name = name || 'x' where name = $1", [name]),
    ).resolves.toHaveLength(0);
    expect(await admin(db, "select 1 from storage.objects where name = $1", [name])).toHaveLength(1);
  });
});

describe("현상 전", () => {
  it("학생은 자기 컷만 본다", async () => {
    expect(await visibleFrameIds(anna)).toEqual([frameA1, frameA2].sort());
    expect(await visibleFrameIds(ben)).toEqual([frameB1]);
  });

  it("교사는 모두 본다", async () => {
    expect(await visibleFrameIds(teacher)).toEqual([frameA1, frameA2, frameB1].sort());
  });

  it("남의 사진 파일을 읽을 수 없다", async () => {
    const rows = await ben.query("select name from storage.objects where bucket_id = 'photos'");
    expect(rows.map((r) => r.name).sort()).toEqual(
      [photoPath(tripId, benId, frameB1), photoPath(tripId, benId, frameB1, true)].sort(),
    );
    expect(await teacher.query("select 1 from storage.objects where bucket_id = 'photos'")).toHaveLength(4);
    expect(await outsider.query("select 1 from storage.objects where bucket_id = 'photos'")).toHaveLength(0);
  });

  it("누가 몇 컷 찍었는지와 장소별 컷 수는 모두 본다", async () => {
    await anna.rpc("edit_shot", [frameA1, (await anna.query<{ id: string }>("select id from public.places where name = '대오서점'"))[0].id, "고친 메모"]);
    const stats = await ben.query<{ name: string; used: number }>("select name, used from public.roll_stats($1)", [tripId]);
    expect(stats.find((s) => s.name === "안나")?.used).toBe(2);
    const counts = await ben.query<{ shots: number; teams: string[] }>("select shots, teams from public.place_shot_counts($1)", [
      tripId,
    ]);
    expect(counts).toEqual([{ shots: 1, teams: ["1모둠"] }]);
  });

  it("도장은 찍을 수 없다", async () => {
    await expect(
      ben.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'good')", [frameA1, benId]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      anna.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'good')", [frameA1, annaId]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("현상 뒤", () => {
  it("교사가 현상한다", async () => {
    const at = await teacher.rpc<string>("set_developed", [tripId, true]);
    expect(at).toBeTruthy();
  });

  it("학생은 서로의 컷을 보지만 버린 컷은 못 본다", async () => {
    expect(await visibleFrameIds(ben)).toEqual([frameA1, frameB1].sort());
    expect(await visibleFrameIds(anna)).toEqual([frameA1, frameA2, frameB1].sort());
  });

  it("사진 파일도 읽힌다", async () => {
    expect(await ben.query("select 1 from storage.objects where bucket_id = 'photos'")).toHaveLength(4);
    expect(await outsider.query("select 1 from storage.objects where bucket_id = 'photos'")).toHaveLength(0);
    expect(await otherTeacher.query("select 1 from storage.objects where bucket_id = 'photos'")).toHaveLength(0);
  });

  it("도장은 자기 이름으로 한 컷에 하나만 찍는다", async () => {
    await ben.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'good')", [frameA1, benId]);
    await expect(
      ben.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'wow')", [frameA1, benId]),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      ben.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'wow')", [frameB1, annaId]),
    ).rejects.toThrow(/row-level security/);
    await ben.query("update public.stamps set kind = 'literary' where frame_id = $1 and member_id = $2", [frameA1, benId]);
    await anna.query("delete from public.stamps where frame_id = $1", [frameA1]);
    const rows = await anna.query<{ kind: string }>("select kind from public.stamps where frame_id = $1", [frameA1]);
    expect(rows).toEqual([{ kind: "literary" }]);
  });

  it("교사가 숨긴 컷은 다른 학생에게 안 보이고 도장도 못 찍는다", async () => {
    await expect(anna.rpc("set_frame_hidden", [frameB1, true])).rejects.toThrow(/NOT_TEACHER/);
    await teacher.rpc("set_frame_hidden", [frameB1, true]);
    expect(await visibleFrameIds(anna)).toEqual([frameA1, frameA2].sort());
    expect(await visibleFrameIds(ben)).toEqual([frameA1, frameB1].sort());
    expect(await anna.query("select 1 from storage.objects where name like $1", ["%" + frameB1 + "%"])).toHaveLength(0);
    await expect(
      anna.query("insert into public.stamps (frame_id, member_id, kind) values ($1, $2, 'good')", [frameB1, annaId]),
    ).rejects.toThrow(/row-level security/);
    await teacher.rpc("set_frame_hidden", [frameB1, false]);
  });

  it("현상을 되돌리면 다시 가려진다", async () => {
    await teacher.rpc("set_developed", [tripId, false]);
    expect(await visibleFrameIds(ben)).toEqual([frameB1]);
    await teacher.rpc("set_developed", [tripId, true]);
  });
});

describe("기행문", () => {
  it("자기 글만 쓰고, 교사만 남의 글을 읽는다", async () => {
    await anna.query(
      "insert into public.essays (trip_id, member_id, title, body, frame_ids) values ($1, $2, '서촌에서', '본문', $3)",
      [tripId, annaId, [frameA1]],
    );
    await expect(
      ben.query("insert into public.essays (trip_id, member_id, title) values ($1, $2, '사칭')", [tripId, annaId]),
    ).rejects.toThrow(/row-level security/);
    expect(await ben.query("select 1 from public.essays")).toHaveLength(0);
    expect(await teacher.query("select 1 from public.essays")).toHaveLength(1);
    expect(await otherTeacher.query("select 1 from public.essays")).toHaveLength(0);
  });

  it("제출하면 제출 시각이 찍히고, 남의 글은 고칠 수 없다", async () => {
    await ben.query("update public.essays set body = '훼손'");
    await anna.query("update public.essays set status = 'submitted' where member_id = $1", [annaId]);
    const [row] = await teacher.query<{ body: string; submitted: boolean }>(
      "select body, submitted_at is not null as submitted from public.essays",
    );
    expect(row).toEqual({ body: "본문", submitted: true });
  });
});

describe("PIN 초기화", () => {
  it("교사가 초기화하면 기존 기기 연결이 끊기고 새 PIN으로 다시 들어온다", async () => {
    await teacher.rpc("reset_pin", [annaId]);
    expect(await anna.query("select 1 from public.trips")).toHaveLength(0);

    const out = await anna.rpc<Json>("join_trip", [joinCode, "안나", "1모둠", "7777"]);
    expect(out).toMatchObject({ ok: true, member_id: annaId });
    expect(await visibleFrameIds(anna)).toContain(frameA1);

    const old = new Actor(db);
    expect(await old.rpc<Json>("join_trip", [joinCode, "안나", "1모둠", "1111"])).toMatchObject({ error: "WRONG_PIN" });
  });
});

describe("나가기", () => {
  it("연결을 끊으면 그 기기에서는 더 보이지 않는다", async () => {
    await ben.rpc("leave_session", [tripId]);
    expect(await ben.query("select 1 from public.trips")).toHaveLength(0);
    expect(await admin(db, "select 1 from public.members where id = $1", [benId])).toHaveLength(1);
  });
});
