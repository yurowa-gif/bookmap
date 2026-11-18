import { PHOTO_BUCKET, supabase } from "@/lib/supabase/client";
import type {
  Frame,
  MealChoice,
  Member,
  Membership,
  Place,
  PlaceKind,
  PlaceShotCount,
  Result,
  Role,
  RollStat,
  Stamp,
  StampKind,
  Trip,
  TripCodes,
} from "@/lib/types";

/** DB 함수가 던진 예외. message가 곧 코드(NOT_MEMBER 등)다. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 통신 문제라서 나중에 다시 시도하면 될 수 있는 오류인가 */
  get isNetwork() {
    return this.status === undefined || this.status === 0 || this.status >= 500;
  }
}

type PgError = { message: string; code?: string };

function fail(error: PgError, status?: number): never {
  // PostgREST가 돌려준 오류(code가 있음)는 서버가 판단한 것, 없으면 통신 실패로 본다.
  throw new ApiError(error.message, error.code ? (status ?? 400) : undefined);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error, status } = await supabase().rpc(fn, args);
  if (error) fail(error, status);
  return data as T;
}

// --- 로그인 -----------------------------------------------------------------

/** 익명 로그인 세션을 보장한다. 이미 있으면 그대로 쓴다. */
export async function ensureAuth(): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.user) throw new ApiError(error?.message ?? "AUTH_FAILED", error?.status);
  return signed.user.id;
}

// --- 입장 -------------------------------------------------------------------

export function peekTrip(code: string) {
  return rpc<Result<{ title: string; trip_date: string; teams: string[]; role: Role }>>("peek_trip", { p_code: code });
}

export function joinTrip(input: { code: string; name: string; team: string; pin: string }) {
  return rpc<Result<{ trip_id: string; member_id: string; role: Role }>>("join_trip", {
    p_code: input.code,
    p_name: input.name,
    p_team: input.team,
    p_pin: input.pin,
  });
}

export function createTrip(input: {
  adminCode: string;
  title: string;
  tripDate: string;
  teams: string[];
  teacherName: string;
  pin: string;
}) {
  return rpc<Result<{ trip_id: string; member_id: string; join_code: string; teacher_code: string }>>("create_trip", {
    p_admin_code: input.adminCode,
    p_title: input.title,
    p_trip_date: input.tripDate,
    p_teams: input.teams,
    p_teacher_name: input.teacherName,
    p_pin: input.pin,
  });
}

/** 이 기기의 로그인 계정에 연결된 기행과 구성원 목록 */
export async function listMemberships(): Promise<Membership[]> {
  const sb = supabase();
  const sessions = await sb.from("member_sessions").select("member_id");
  if (sessions.error) fail(sessions.error, sessions.status);
  const memberIds = (sessions.data ?? []).map((s) => s.member_id as string);
  if (memberIds.length === 0) return [];

  const members = await sb.from("members").select("*").in("id", memberIds);
  if (members.error) fail(members.error, members.status);
  const mine = (members.data ?? []) as Member[];

  const trips = await sb
    .from("trips")
    .select("*")
    .in(
      "id",
      mine.map((m) => m.trip_id),
    );
  if (trips.error) fail(trips.error, trips.status);
  const byId = new Map(((trips.data ?? []) as Trip[]).map((t) => [t.id, t]));

  return mine
    .filter((m) => byId.has(m.trip_id))
    .map((member) => ({ member, trip: byId.get(member.trip_id)! }))
    .sort((a, b) => b.trip.trip_date.localeCompare(a.trip.trip_date));
}

export function leaveSession(tripId: string) {
  return rpc<void>("leave_session", { p_trip_id: tripId });
}

// --- 기행 -------------------------------------------------------------------

export async function getTrip(tripId: string): Promise<Trip> {
  const { data, error, status } = await supabase().from("trips").select("*").eq("id", tripId).limit(1);
  if (error) fail(error, status);
  const trip = (data ?? [])[0] as Trip | undefined;
  if (!trip) throw new ApiError("NOT_MEMBER", 403);
  return trip;
}

export async function listMembers(tripId: string): Promise<Member[]> {
  const { data, error, status } = await supabase().from("members").select("*").eq("trip_id", tripId);
  if (error) fail(error, status);
  return (data ?? []) as Member[];
}

export function getTripCodes(tripId: string) {
  return rpc<TripCodes>("get_trip_codes", { p_trip_id: tripId });
}

export function updateTrip(
  tripId: string,
  input: { title: string; tripDate: string; teams: string[]; notice: string; purgeAfter: string | null },
) {
  return rpc<void>("update_trip", {
    p_trip_id: tripId,
    p_title: input.title,
    p_trip_date: input.tripDate,
    p_teams: input.teams,
    p_notice: input.notice,
    p_purge_after: input.purgeAfter,
  });
}

export function setDeveloped(tripId: string, on: boolean) {
  return rpc<string | null>("set_developed", { p_trip_id: tripId, p_on: on });
}

export function rollStats(tripId: string) {
  return rpc<RollStat[]>("roll_stats", { p_trip_id: tripId });
}

export function setMemberFilm(memberId: string, film: number) {
  return rpc<void>("set_member_film", { p_member_id: memberId, p_film: film });
}

export function resetPin(memberId: string) {
  return rpc<void>("reset_pin", { p_member_id: memberId });
}

// --- 장소 -------------------------------------------------------------------

export async function listPlaces(tripId: string): Promise<Place[]> {
  const { data, error, status } = await supabase().from("places").select("*").eq("trip_id", tripId).order("name");
  if (error) fail(error, status);
  return (data ?? []) as Place[];
}

export function addPlace(
  tripId: string,
  input: { name: string; address: string; lat: number; lng: number; kakaoPlaceId: string | null },
) {
  return rpc<string>("add_place", {
    p_trip_id: tripId,
    p_name: input.name,
    p_address: input.address,
    p_lat: input.lat,
    p_lng: input.lng,
    p_kakao_place_id: input.kakaoPlaceId,
  });
}

export function writePlaceIntro(placeId: string, intro: string) {
  return rpc<Result<object>>("write_place_intro", { p_place_id: placeId, p_intro: intro });
}

/** 교사 전용: 추천 지정, 식당 전환, 메뉴 메모 */
export async function updatePlace(
  placeId: string,
  patch: Partial<{ is_recommended: boolean; kind: PlaceKind; menu_note: string; name: string }>,
) {
  const { error, status } = await supabase().from("places").update(patch).eq("id", placeId);
  if (error) fail(error, status);
}

export async function deletePlace(placeId: string) {
  const { error, status } = await supabase().from("places").delete().eq("id", placeId);
  if (error) fail(error, status);
}

export function placeShotCounts(tripId: string) {
  return rpc<PlaceShotCount[]>("place_shot_counts", { p_trip_id: tripId });
}

// --- 컷 ---------------------------------------------------------------------

/** 내가 볼 수 있는 컷 전부. 현상 전에는 내 컷뿐이다(교사는 전부). */
export async function listFrames(tripId: string): Promise<Frame[]> {
  const { data, error, status } = await supabase()
    .from("frames")
    .select("*")
    .eq("trip_id", tripId)
    .order("taken_at", { ascending: true });
  if (error) fail(error, status);
  return (data ?? []) as Frame[];
}

export function takeShot(input: {
  frameId: string;
  tripId: string;
  placeId: string | null;
  memo: string;
  takenAt: string;
}) {
  return rpc<Result<{ frame_no: number; remaining: number; uploaded: boolean }>>("take_shot", {
    p_frame_id: input.frameId,
    p_trip_id: input.tripId,
    p_place_id: input.placeId,
    p_memo: input.memo,
    p_taken_at: input.takenAt,
  });
}

export function photoPath(tripId: string, memberId: string, frameId: string, thumb = false) {
  return `${tripId}/${memberId}/${frameId}${thumb ? ".thumb" : ""}.jpg`;
}

/** 사진 한 장을 올린다. 이미 올라가 있으면(재시도) 성공으로 본다. */
export async function uploadPhoto(path: string, body: Blob): Promise<void> {
  const { error } = await supabase().storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (!error) return;
  const status = Number((error as { statusCode?: string; status?: number }).statusCode ?? (error as { status?: number }).status);
  if (status === 409 || /exists|duplicate/i.test(error.message)) return;
  throw new ApiError(error.message, Number.isFinite(status) && status >= 400 && status < 500 ? status : undefined);
}

export function finishShot(frameId: string, width: number, height: number) {
  return rpc<Result<object>>("finish_shot", { p_frame_id: frameId, p_width: width, p_height: height });
}

export function editShot(frameId: string, placeId: string | null, memo: string) {
  return rpc<void>("edit_shot", { p_frame_id: frameId, p_place_id: placeId, p_memo: memo });
}

export async function discardShot(frame: Frame) {
  await rpc<void>("discard_shot", { p_frame_id: frame.id });
  const paths = [frame.photo_path, frame.thumb_path].filter((p): p is string => Boolean(p));
  if (paths.length > 0) await supabase().storage.from(PHOTO_BUCKET).remove(paths);
}

export function setFrameHidden(frameId: string, hidden: boolean) {
  return rpc<void>("set_frame_hidden", { p_frame_id: frameId, p_hidden: hidden });
}

/** 비공개 사진을 한 시간 동안 볼 수 있는 주소로 바꾼다. */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase().storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new ApiError(error.message);
  const out: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}

// --- 도장 -------------------------------------------------------------------

export async function listStamps(frameIds: string[]): Promise<Stamp[]> {
  if (frameIds.length === 0) return [];
  const { data, error, status } = await supabase().from("stamps").select("*").in("frame_id", frameIds);
  if (error) fail(error, status);
  return (data ?? []) as Stamp[];
}

export async function putStamp(frameId: string, memberId: string, kind: StampKind) {
  const { error, status } = await supabase()
    .from("stamps")
    .upsert({ frame_id: frameId, member_id: memberId, kind }, { onConflict: "frame_id,member_id" });
  if (error) fail(error, status);
}

export async function removeStamp(frameId: string, memberId: string) {
  const { error, status } = await supabase().from("stamps").delete().eq("frame_id", frameId).eq("member_id", memberId);
  if (error) fail(error, status);
}

// --- 식당 고르기 --------------------------------------------------------------

export async function listMealChoices(tripId: string): Promise<MealChoice[]> {
  const { data, error, status } = await supabase().from("meal_choices").select("*").eq("trip_id", tripId);
  if (error) fail(error, status);
  return (data ?? []) as MealChoice[];
}

export async function chooseMeal(tripId: string, memberId: string, placeId: string) {
  const { error, status } = await supabase()
    .from("meal_choices")
    .upsert({ trip_id: tripId, member_id: memberId, place_id: placeId }, { onConflict: "trip_id,member_id" });
  if (error) fail(error, status);
}
