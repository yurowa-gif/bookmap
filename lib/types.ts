// DB 행과 함수 결과의 타입. supabase/migrations 의 스키마와 맞춘다.

export type Role = "student" | "teacher";

export interface Trip {
  id: string;
  title: string;
  trip_date: string;
  teams: string[];
  notice: string;
  default_film: number;
  developed_at: string | null;
  purge_after: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  trip_id: string;
  name: string;
  team: string;
  role: Role;
  film: number;
  created_at: string;
}

export type PlaceKind = "spot" | "restaurant";

export interface Place {
  id: string;
  trip_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kakao_place_id: string | null;
  kind: PlaceKind;
  is_recommended: boolean;
  intro: string;
  menu_note: string;
  created_by: string | null;
  intro_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Frame {
  id: string;
  trip_id: string;
  member_id: string;
  frame_no: number;
  place_id: string | null;
  memo: string;
  photo_path: string | null;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  taken_at: string;
  uploaded_at: string | null;
  is_hidden: boolean;
  is_deleted: boolean;
}

export const STAMP_KINDS = ["good", "funny", "moving", "wow", "literary"] as const;
export type StampKind = (typeof STAMP_KINDS)[number];

export const STAMP_LABEL: Record<StampKind, string> = {
  good: "참 잘했어요",
  funny: "웃겨요",
  moving: "뭉클해요",
  wow: "우와",
  literary: "문학적",
};

export interface Stamp {
  frame_id: string;
  member_id: string;
  kind: StampKind;
  created_at: string;
}

export interface MealChoice {
  trip_id: string;
  member_id: string;
  place_id: string;
}

export interface RollStat {
  member_id: string;
  name: string;
  team: string;
  role: Role;
  film: number;
  used: number;
  last_shot_at: string | null;
}

export interface PlaceShotCount {
  place_id: string;
  shots: number;
  teams: string[];
}

export interface Membership {
  trip: Trip;
  member: Member;
}

export interface TripCodes {
  join_code: string;
  teacher_code: string;
}

/** 함수가 예외 대신 돌려주는 실패 코드 */
export type FailCode =
  | "INVALID_CODE"
  | "LOCKED"
  | "BAD_INPUT"
  | "BAD_TEAM"
  | "NAME_TAKEN"
  | "WRONG_PIN"
  | "TRIP_FULL"
  | "NO_FILM"
  | "NOT_UPLOADED"
  | "INTRO_TAKEN";

export type Result<T> = ({ ok: true } & T) | { ok: false; error: FailCode; [extra: string]: unknown };
