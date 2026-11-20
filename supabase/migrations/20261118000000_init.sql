-- bookmap: 필름 카메라 컨셉의 기행 기록 앱
--
-- 원칙
--   * 브라우저는 공개 키만 쓴다. 모든 규칙은 이 파일(RLS, DB 함수)에 있다.
--   * 학생은 테이블에 직접 쓰지 않는다. 규칙이 필요한 쓰기는 모두 함수로만 한다.
--   * 비밀(참가 코드, PIN 해시)은 API에 노출되지 않는 private 스키마에 둔다.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 60),
  trip_date     date not null,
  teams         text[] not null default '{}',
  notice        text not null default '' check (char_length(notice) <= 4000),
  default_film  int  not null default 24 check (default_film between 1 and 72),
  developed_at  timestamptz,
  purge_after   date,
  created_at    timestamptz not null default now()
);

create table public.members (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  team        text not null default '' check (char_length(team) <= 20),
  role        text not null default 'student' check (role in ('student', 'teacher')),
  film        int  not null default 24 check (film between 0 and 144),
  created_at  timestamptz not null default now(),
  unique (trip_id, team, name)
);

-- 익명 로그인 계정과 구성원의 연결. 한 구성원이 여러 기기에서 들어올 수 있다.
create table public.member_sessions (
  user_id     uuid not null,
  member_id   uuid not null references public.members (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, member_id)
);
create index member_sessions_member_idx on public.member_sessions (member_id);

create table public.places (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  address         text not null default '' check (char_length(address) <= 120),
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  kakao_place_id  text check (char_length(kakao_place_id) <= 40),
  kind            text not null default 'spot' check (kind in ('spot', 'restaurant')),
  is_recommended  boolean not null default false,
  intro           text not null default '' check (char_length(intro) <= 1000),
  menu_note       text not null default '' check (char_length(menu_note) <= 200),
  created_by      uuid references public.members (id) on delete set null,
  intro_by        uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (trip_id, kakao_place_id)
);
create index places_trip_idx on public.places (trip_id);
create index places_created_by_idx on public.places (created_by);
create index places_intro_by_idx on public.places (intro_by);

-- 컷 한 장 = 사진 한 장 + 장소 + 메모. 지워도 행은 남아 컷 번호를 차지한다.
create table public.frames (
  id           uuid primary key,
  trip_id      uuid not null references public.trips (id) on delete cascade,
  member_id    uuid not null references public.members (id) on delete cascade,
  frame_no     int  not null check (frame_no >= 1),
  place_id     uuid references public.places (id) on delete set null,
  memo         text not null default '' check (char_length(memo) <= 300),
  photo_path   text,
  thumb_path   text,
  width        int check (width between 1 and 10000),
  height       int check (height between 1 and 10000),
  taken_at     timestamptz not null default now(),
  uploaded_at  timestamptz,
  is_hidden    boolean not null default false,
  is_deleted   boolean not null default false,
  unique (member_id, frame_no)
);
create index frames_trip_taken_idx on public.frames (trip_id, taken_at desc);
create index frames_place_idx on public.frames (place_id);

create table public.stamps (
  frame_id    uuid not null references public.frames (id) on delete cascade,
  member_id   uuid not null references public.members (id) on delete cascade,
  kind        text not null check (kind in ('good', 'funny', 'moving', 'wow', 'literary')),
  created_at  timestamptz not null default now(),
  primary key (frame_id, member_id)
);
create index stamps_member_idx on public.stamps (member_id);

create table public.essays (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  member_id     uuid not null references public.members (id) on delete cascade,
  title         text not null default '' check (char_length(title) <= 80),
  body          text not null default '' check (char_length(body) <= 20000),
  frame_ids     uuid[] not null default '{}' check (cardinality(frame_ids) <= 24),
  status        text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (trip_id, member_id)
);
create index essays_member_idx on public.essays (member_id);

create table public.meal_choices (
  trip_id     uuid not null references public.trips (id) on delete cascade,
  member_id   uuid not null references public.members (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (trip_id, member_id)
);
create index meal_choices_member_idx on public.meal_choices (member_id);
create index meal_choices_place_idx on public.meal_choices (place_id);

-- 비밀. API로는 절대 읽히지 않는다.
create table private.app_settings (
  id               boolean primary key default true check (id),
  admin_code_hash  text not null
);

create table private.trip_codes (
  trip_id       uuid primary key references public.trips (id) on delete cascade,
  join_code     text not null unique,
  teacher_code  text not null unique
);

create table private.member_secrets (
  member_id        uuid primary key references public.members (id) on delete cascade,
  pin_hash         text,
  failed_attempts  int not null default 0,
  locked_until     timestamptz
);

-- 잘못된 코드를 반복해서 넣는 계정을 잠근다.
create table private.attempts (
  user_id       uuid primary key,
  failed        int not null default 0,
  locked_until  timestamptz
);

-- ---------------------------------------------------------------------------
-- 도우미 함수 (private): 정책 안에서 재귀 없이 구성원 여부를 확인한다
-- ---------------------------------------------------------------------------

create function private.member_id_for(p_trip_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from public.member_sessions s
  join public.members m on m.id = s.member_id
  where s.user_id = (select auth.uid()) and m.trip_id = p_trip_id
  limit 1
$$;

create function private.is_member(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.member_id_for(p_trip_id) is not null
$$;

create function private.is_teacher(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.member_sessions s
    join public.members m on m.id = s.member_id
    where s.user_id = (select auth.uid()) and m.trip_id = p_trip_id and m.role = 'teacher'
  )
$$;

create function private.is_developed(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips t where t.id = p_trip_id and t.developed_at is not null)
$$;

-- 컷을 볼 수 있는가: 본인 것, 교사, 또는 현상된 기행의 공개 컷.
create function private.can_see_frame(p_trip_id uuid, p_member_id uuid, p_hidden boolean, p_deleted boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when private.member_id_for(p_trip_id) is null then false
    when private.member_id_for(p_trip_id) = p_member_id then true
    when private.is_teacher(p_trip_id) then true
    else private.is_developed(p_trip_id) and not p_hidden and not p_deleted
  end
$$;

-- 사진 경로: {trip_id}/{member_id}/{frame_id}.jpg 또는 {frame_id}.thumb.jpg
create function private.photo_frame_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}(\.thumb)?\.jpg$'
    then split_part(split_part(p_name, '/', 3), '.', 1)::uuid
  end
$$;

create function private.photo_matches_frame(p_name text, p_trip_id uuid, p_member_id uuid) returns boolean
language sql immutable set search_path = '' as $$
  select split_part(p_name, '/', 1) = p_trip_id::text and split_part(p_name, '/', 2) = p_member_id::text
$$;

create function private.can_upload_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.frames f
    where f.id = private.photo_frame_id(p_name)
      and private.photo_matches_frame(p_name, f.trip_id, f.member_id)
      and f.member_id = private.member_id_for(f.trip_id)
      and f.photo_path is null
      and not f.is_deleted
  )
$$;

create function private.can_read_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.frames f
    where f.id = private.photo_frame_id(p_name)
      and private.photo_matches_frame(p_name, f.trip_id, f.member_id)
      and private.can_see_frame(f.trip_id, f.member_id, f.is_hidden, f.is_deleted)
  )
$$;

-- 올리는 중(아직 완료 전)이거나 버린 컷의 파일만 본인이 지울 수 있다.
create function private.can_delete_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.frames f
    where f.id = private.photo_frame_id(p_name)
      and private.photo_matches_frame(p_name, f.trip_id, f.member_id)
      and f.member_id = private.member_id_for(f.trip_id)
      and (f.photo_path is null or f.is_deleted)
  )
$$;

create function private.gen_code(p_len int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  -- 헷갈리는 글자(0/O, 1/I)는 뺀다.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_len);
  v_out text := '';
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  return v_out;
end
$$;

create function private.note_failure(p_user_id uuid) returns void
language plpgsql volatile set search_path = '' as $$
begin
  insert into private.attempts as a (user_id, failed)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set failed = case when a.failed + 1 >= 10 then 0 else a.failed + 1 end,
        locked_until = case when a.failed + 1 >= 10 then now() + interval '10 minutes' else a.locked_until end;
end
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger places_touch before update on public.places
  for each row execute function private.touch_updated_at();
create trigger essays_touch before update on public.essays
  for each row execute function private.touch_updated_at();
create trigger meal_choices_touch before update on public.meal_choices
  for each row execute function private.touch_updated_at();

create function private.essay_submit_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    new.submitted_at := now();
  elsif new.status = 'draft' then
    new.submitted_at := null;
  end if;
  return new;
end
$$;

create trigger essays_submit_stamp before insert or update on public.essays
  for each row execute function private.essay_submit_stamp();

-- ---------------------------------------------------------------------------
-- 공개 함수 (RPC)
-- 실패 횟수처럼 남아야 하는 상태가 있는 경우에는 예외 대신 {ok:false}를 돌려준다.
-- (예외를 던지면 트랜잭션이 되돌아가 횟수 기록이 사라진다.)
-- ---------------------------------------------------------------------------

create function public.ping() returns text
language sql stable set search_path = '' as $$ select 'pong' $$;

create function public.create_trip(
  p_admin_code text, p_title text, p_trip_date date, p_teams text[], p_teacher_name text, p_pin text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_att private.attempts;
  v_hash text;
  v_trip_id uuid;
  v_member_id uuid;
  v_join text;
  v_teacher text;
  v_name text := btrim(coalesce(p_teacher_name, ''));
  v_teams text[];
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_att from private.attempts where user_id = v_uid;
  if v_att.locked_until is not null and v_att.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED', 'retry_at', v_att.locked_until);
  end if;

  select admin_code_hash into v_hash from private.app_settings;
  if v_hash is null or v_hash <> extensions.crypt(coalesce(p_admin_code, ''), v_hash) then
    perform private.note_failure(v_uid);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60
     or p_trip_date is null
     or char_length(v_name) not between 1 and 20
     or coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;

  select coalesce(array_agg(distinct t), '{}') into v_teams
  from unnest(coalesce(p_teams, '{}')) as u(raw), lateral (select btrim(u.raw) as t) s
  where s.t <> '' and s.t <> '교사' and char_length(s.t) <= 20;

  insert into public.trips (title, trip_date, teams)
  values (btrim(p_title), p_trip_date, v_teams)
  returning id into v_trip_id;

  loop
    v_join := private.gen_code(6);
    v_teacher := private.gen_code(8);
    begin
      insert into private.trip_codes (trip_id, join_code, teacher_code) values (v_trip_id, v_join, v_teacher);
      exit;
    exception when unique_violation then
      -- 드물게 겹치면 다시 뽑는다.
    end;
  end loop;

  insert into public.members (trip_id, name, team, role) values (v_trip_id, v_name, '교사', 'teacher')
  returning id into v_member_id;
  insert into private.member_secrets (member_id, pin_hash)
  values (v_member_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)));
  insert into public.member_sessions (user_id, member_id) values (v_uid, v_member_id);

  delete from private.attempts where user_id = v_uid;

  return jsonb_build_object(
    'ok', true, 'trip_id', v_trip_id, 'member_id', v_member_id,
    'join_code', v_join, 'teacher_code', v_teacher
  );
end
$$;

create function public.join_trip(p_code text, p_name text, p_team text, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_name text := btrim(coalesce(p_name, ''));
  v_team text := btrim(coalesce(p_team, ''));
  v_att private.attempts;
  v_trip_id uuid;
  v_trip public.trips;
  v_role text;
  v_member public.members;
  v_secret private.member_secrets;
  v_left int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_att from private.attempts where user_id = v_uid;
  if v_att.locked_until is not null and v_att.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED', 'retry_at', v_att.locked_until);
  end if;

  select c.trip_id, case when c.teacher_code = v_code then 'teacher' else 'student' end
  into v_trip_id, v_role
  from private.trip_codes c
  where c.join_code = v_code or c.teacher_code = v_code;

  if v_trip_id is not null then
    select * into v_trip from public.trips where id = v_trip_id;
  end if;

  if v_trip.id is null then
    perform private.note_failure(v_uid);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if char_length(v_name) not between 1 and 20 or coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_INPUT');
  end if;

  if v_role = 'teacher' then
    v_team := '교사';
  elsif v_team = '교사' or char_length(v_team) > 20
        or (cardinality(v_trip.teams) > 0 and not (v_team = any (v_trip.teams))) then
    return jsonb_build_object('ok', false, 'error', 'BAD_TEAM', 'teams', to_jsonb(v_trip.teams));
  end if;

  select * into v_member from public.members
  where trip_id = v_trip.id and team = v_team and name = v_name
  for update;

  if found then
    if v_member.role <> v_role then
      return jsonb_build_object('ok', false, 'error', 'NAME_TAKEN');
    end if;

    select * into v_secret from private.member_secrets where member_id = v_member.id for update;
    if v_secret.locked_until is not null and v_secret.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'LOCKED', 'retry_at', v_secret.locked_until);
    end if;

    if v_secret.pin_hash is null then
      -- 교사가 PIN을 초기화한 뒤 첫 입장: 새 PIN으로 정한다.
      insert into private.member_secrets as s (member_id, pin_hash)
      values (v_member.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
      on conflict (member_id) do update
        set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
    elsif v_secret.pin_hash <> extensions.crypt(p_pin, v_secret.pin_hash) then
      v_left := 4 - v_secret.failed_attempts;
      update private.member_secrets
      set failed_attempts = case when v_left <= 0 then 0 else failed_attempts + 1 end,
          locked_until = case when v_left <= 0 then now() + interval '10 minutes' else null end
      where member_id = v_member.id;
      return jsonb_build_object('ok', false, 'error', 'WRONG_PIN', 'attempts_left', greatest(v_left, 0));
    else
      update private.member_secrets set failed_attempts = 0, locked_until = null
      where member_id = v_member.id;
    end if;
  else
    if (select count(*) from public.members where trip_id = v_trip.id) >= 200 then
      return jsonb_build_object('ok', false, 'error', 'TRIP_FULL');
    end if;
    insert into public.members (trip_id, name, team, role, film)
    values (v_trip.id, v_name, v_team, v_role, v_trip.default_film)
    returning * into v_member;
    insert into private.member_secrets (member_id, pin_hash)
    values (v_member.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)));
  end if;

  insert into public.member_sessions (user_id, member_id) values (v_uid, v_member.id)
  on conflict do nothing;
  delete from private.attempts where user_id = v_uid;

  return jsonb_build_object('ok', true, 'trip_id', v_trip.id, 'member_id', v_member.id, 'role', v_member.role);
end
$$;

-- 참가 코드를 넣기 전에 기행 이름과 모둠 목록을 보여 주기 위한 조회.
create function public.peek_trip(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_att private.attempts;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_att from private.attempts where user_id = v_uid;
  if v_att.locked_until is not null and v_att.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'LOCKED', 'retry_at', v_att.locked_until);
  end if;

  select jsonb_build_object(
    'ok', true, 'title', t.title, 'trip_date', t.trip_date, 'teams', to_jsonb(t.teams),
    'role', case when c.teacher_code = v_code then 'teacher' else 'student' end
  ) into v_out
  from private.trip_codes c join public.trips t on t.id = c.trip_id
  where c.join_code = v_code or c.teacher_code = v_code;

  if v_out is null then
    perform private.note_failure(v_uid);
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;
  return v_out;
end
$$;

create function public.leave_session(p_trip_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.member_sessions s
  using public.members m
  where m.id = s.member_id and m.trip_id = p_trip_id and s.user_id = (select auth.uid())
$$;

create function public.get_trip_codes(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_teacher(p_trip_id) then raise exception 'NOT_TEACHER'; end if;
  return (
    select jsonb_build_object('join_code', c.join_code, 'teacher_code', c.teacher_code)
    from private.trip_codes c where c.trip_id = p_trip_id
  );
end
$$;

create function public.update_trip(
  p_trip_id uuid, p_title text, p_trip_date date, p_teams text[], p_notice text, p_purge_after date
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_teacher(p_trip_id) then raise exception 'NOT_TEACHER'; end if;
  update public.trips set
    title = btrim(p_title),
    trip_date = p_trip_date,
    teams = (
      select coalesce(array_agg(distinct btrim(u.raw)), '{}')
      from unnest(coalesce(p_teams, '{}')) as u(raw)
      where btrim(u.raw) <> '' and btrim(u.raw) <> '교사' and char_length(btrim(u.raw)) <= 20
    ),
    notice = coalesce(p_notice, ''),
    purge_after = p_purge_after
  where id = p_trip_id;
end
$$;

create function public.set_developed(p_trip_id uuid, p_on boolean) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if not private.is_teacher(p_trip_id) then raise exception 'NOT_TEACHER'; end if;
  update public.trips
  set developed_at = case when p_on then coalesce(developed_at, now()) else null end
  where id = p_trip_id
  returning developed_at into v_at;
  return v_at;
end
$$;

create function public.add_place(
  p_trip_id uuid, p_name text, p_address text, p_lat double precision, p_lng double precision,
  p_kakao_place_id text
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_member_id uuid := private.member_id_for(p_trip_id);
  v_id uuid;
begin
  if v_member_id is null then raise exception 'NOT_MEMBER'; end if;

  if p_kakao_place_id is not null then
    select id into v_id from public.places
    where trip_id = p_trip_id and kakao_place_id = p_kakao_place_id;
    if found then return v_id; end if;
  end if;

  if (select count(*) from public.places where trip_id = p_trip_id) >= 500 then
    raise exception 'TOO_MANY_PLACES';
  end if;

  insert into public.places (trip_id, name, address, lat, lng, kakao_place_id, created_by)
  values (p_trip_id, btrim(p_name), coalesce(btrim(p_address), ''), p_lat, p_lng, p_kakao_place_id, v_member_id)
  on conflict (trip_id, kakao_place_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.places
    where trip_id = p_trip_id and kakao_place_id = p_kakao_place_id;
  end if;
  return v_id;
end
$$;

-- 소개글은 비어 있거나 본인이 쓴 것일 때만 학생이 고칠 수 있다. 교사는 언제나 고친다.
create function public.write_place_intro(p_place_id uuid, p_intro text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_place public.places;
  v_member_id uuid;
begin
  select * into v_place from public.places where id = p_place_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_member_id := private.member_id_for(v_place.trip_id);
  if v_member_id is null then raise exception 'NOT_MEMBER'; end if;

  if not private.is_teacher(v_place.trip_id)
     and v_place.intro <> '' and v_place.intro_by is distinct from v_member_id then
    return jsonb_build_object('ok', false, 'error', 'INTRO_TAKEN');
  end if;

  update public.places
  set intro = coalesce(btrim(p_intro), ''),
      intro_by = case when coalesce(btrim(p_intro), '') = '' then null else v_member_id end
  where id = p_place_id;
  return jsonb_build_object('ok', true);
end
$$;

-- 컷 예약. 같은 frame_id로 다시 불러도 한 컷만 쓴다(통신이 끊겨 재시도할 때를 위해).
create function public.take_shot(
  p_frame_id uuid, p_trip_id uuid, p_place_id uuid, p_memo text, p_taken_at timestamptz
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_member public.members;
  v_existing public.frames;
  v_used int;
  v_place_id uuid;
begin
  select * into v_member from public.members
  where id = private.member_id_for(p_trip_id)
  for update;
  if not found then raise exception 'NOT_MEMBER'; end if;

  select * into v_existing from public.frames where id = p_frame_id;
  if found then
    if v_existing.member_id <> v_member.id then raise exception 'FRAME_CONFLICT'; end if;
    select count(*) into v_used from public.frames where member_id = v_member.id;
    return jsonb_build_object(
      'ok', true, 'frame_no', v_existing.frame_no, 'remaining', greatest(v_member.film - v_used, 0),
      'uploaded', v_existing.photo_path is not null
    );
  end if;

  select count(*) into v_used from public.frames where member_id = v_member.id;
  if v_used >= v_member.film then
    return jsonb_build_object('ok', false, 'error', 'NO_FILM');
  end if;

  select id into v_place_id from public.places where id = p_place_id and trip_id = p_trip_id;

  insert into public.frames (id, trip_id, member_id, frame_no, place_id, memo, taken_at)
  values (
    p_frame_id, p_trip_id, v_member.id, v_used + 1, v_place_id,
    left(coalesce(p_memo, ''), 300), least(coalesce(p_taken_at, now()), now())
  );

  return jsonb_build_object(
    'ok', true, 'frame_no', v_used + 1, 'remaining', v_member.film - v_used - 1, 'uploaded', false
  );
end
$$;

create function public.finish_shot(p_frame_id uuid, p_width int, p_height int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_frame public.frames;
  v_photo text;
  v_thumb text;
begin
  select * into v_frame from public.frames where id = p_frame_id for update;
  if not found or v_frame.member_id is distinct from private.member_id_for(v_frame.trip_id) then
    raise exception 'NOT_OWNER';
  end if;
  if v_frame.photo_path is not null then
    return jsonb_build_object('ok', true);
  end if;

  v_photo := v_frame.trip_id || '/' || v_frame.member_id || '/' || v_frame.id || '.jpg';
  v_thumb := v_frame.trip_id || '/' || v_frame.member_id || '/' || v_frame.id || '.thumb.jpg';

  if (select count(*) from storage.objects o
      where o.bucket_id = 'photos' and o.name in (v_photo, v_thumb)) < 2 then
    return jsonb_build_object('ok', false, 'error', 'NOT_UPLOADED');
  end if;

  update public.frames
  set photo_path = v_photo, thumb_path = v_thumb, width = p_width, height = p_height, uploaded_at = now()
  where id = p_frame_id;
  return jsonb_build_object('ok', true);
end
$$;

create function public.edit_shot(p_frame_id uuid, p_place_id uuid, p_memo text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_frame public.frames;
begin
  select * into v_frame from public.frames where id = p_frame_id for update;
  if not found or v_frame.member_id is distinct from private.member_id_for(v_frame.trip_id) then
    raise exception 'NOT_OWNER';
  end if;
  update public.frames
  set memo = left(coalesce(p_memo, ''), 300),
      place_id = (select id from public.places where id = p_place_id and trip_id = v_frame.trip_id)
  where id = p_frame_id;
end
$$;

-- 버린 컷은 돌아오지 않는다. 행은 남고 사진만 사라진다.
create function public.discard_shot(p_frame_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_frame public.frames;
begin
  select * into v_frame from public.frames where id = p_frame_id for update;
  if not found or v_frame.member_id is distinct from private.member_id_for(v_frame.trip_id) then
    raise exception 'NOT_OWNER';
  end if;
  update public.frames set is_deleted = true, memo = '' where id = p_frame_id;
  delete from public.stamps where frame_id = p_frame_id;
end
$$;

create function public.set_frame_hidden(p_frame_id uuid, p_hidden boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.frames where id = p_frame_id;
  if not found or not private.is_teacher(v_trip_id) then raise exception 'NOT_TEACHER'; end if;
  update public.frames set is_hidden = p_hidden where id = p_frame_id;
end
$$;

create function public.set_member_film(p_member_id uuid, p_film int) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.members where id = p_member_id;
  if not found or not private.is_teacher(v_trip_id) then raise exception 'NOT_TEACHER'; end if;
  update public.members set film = p_film where id = p_member_id;
end
$$;

-- PIN을 비우고 그 구성원의 모든 기기 연결을 끊는다. 다음 입장 때 새 PIN을 정한다.
create function public.reset_pin(p_member_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.members where id = p_member_id;
  if not found or not private.is_teacher(v_trip_id) then raise exception 'NOT_TEACHER'; end if;
  update private.member_secrets set pin_hash = null, failed_attempts = 0, locked_until = null
  where member_id = p_member_id;
  delete from public.member_sessions where member_id = p_member_id and user_id <> (select auth.uid());
end
$$;

-- 현상 전에도 "누가 몇 컷 찍었는지"는 모두 본다. 사진은 안 보인다.
create function public.roll_stats(p_trip_id uuid)
returns table (member_id uuid, name text, team text, role text, film int, used int, last_shot_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_trip_id) then raise exception 'NOT_MEMBER'; end if;
  return query
    select m.id, m.name, m.team, m.role, m.film,
           count(f.id)::int, max(f.taken_at)
    from public.members m
    left join public.frames f on f.member_id = m.id
    where m.trip_id = p_trip_id
    group by m.id
    order by m.team, m.name;
end
$$;

create function public.place_shot_counts(p_trip_id uuid)
returns table (place_id uuid, shots int, teams text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_trip_id) then raise exception 'NOT_MEMBER'; end if;
  return query
    select f.place_id, count(*)::int, array_agg(distinct m.team)
    from public.frames f
    join public.members m on m.id = f.member_id
    where f.trip_id = p_trip_id and f.place_id is not null and not f.is_deleted and not f.is_hidden
    group by f.place_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 접근 규칙 (RLS)
-- ---------------------------------------------------------------------------

alter table public.trips enable row level security;
alter table public.members enable row level security;
alter table public.member_sessions enable row level security;
alter table public.places enable row level security;
alter table public.frames enable row level security;
alter table public.stamps enable row level security;
alter table public.essays enable row level security;
alter table public.meal_choices enable row level security;
alter table private.app_settings enable row level security;
alter table private.trip_codes enable row level security;
alter table private.member_secrets enable row level security;
alter table private.attempts enable row level security;

create policy trips_select on public.trips for select to authenticated
  using ((select private.is_member(id)));

create policy members_select on public.members for select to authenticated
  using ((select private.is_member(trip_id)));

create policy member_sessions_select on public.member_sessions for select to authenticated
  using (user_id = (select auth.uid()));

create policy places_select on public.places for select to authenticated
  using ((select private.is_member(trip_id)));
create policy places_teacher_insert on public.places for insert to authenticated
  with check ((select private.is_teacher(trip_id)));
create policy places_teacher_update on public.places for update to authenticated
  using ((select private.is_teacher(trip_id)))
  with check ((select private.is_teacher(trip_id)));
create policy places_teacher_delete on public.places for delete to authenticated
  using ((select private.is_teacher(trip_id)));

create policy frames_select on public.frames for select to authenticated
  using (private.can_see_frame(trip_id, member_id, is_hidden, is_deleted));

-- 도장: 보이는 컷에만, 현상 뒤에만, 자기 이름으로만.
create policy stamps_select on public.stamps for select to authenticated
  using (exists (select 1 from public.frames f where f.id = stamps.frame_id));
create policy stamps_insert on public.stamps for insert to authenticated
  with check (exists (
    select 1 from public.frames f
    where f.id = stamps.frame_id
      and stamps.member_id = private.member_id_for(f.trip_id)
      and private.is_developed(f.trip_id)
      and not f.is_hidden and not f.is_deleted
  ));
create policy stamps_update on public.stamps for update to authenticated
  using (exists (
    select 1 from public.frames f
    where f.id = stamps.frame_id and stamps.member_id = private.member_id_for(f.trip_id)
  ))
  with check (exists (
    select 1 from public.frames f
    where f.id = stamps.frame_id
      and stamps.member_id = private.member_id_for(f.trip_id)
      and private.is_developed(f.trip_id)
      and not f.is_hidden and not f.is_deleted
  ));
create policy stamps_delete on public.stamps for delete to authenticated
  using (exists (
    select 1 from public.frames f
    where f.id = stamps.frame_id and stamps.member_id = private.member_id_for(f.trip_id)
  ));

create policy essays_select on public.essays for select to authenticated
  using (member_id = (select private.member_id_for(trip_id)) or (select private.is_teacher(trip_id)));
create policy essays_insert on public.essays for insert to authenticated
  with check (member_id = (select private.member_id_for(trip_id)));
create policy essays_update on public.essays for update to authenticated
  using (member_id = (select private.member_id_for(trip_id)))
  with check (member_id = (select private.member_id_for(trip_id)));

create policy meal_choices_select on public.meal_choices for select to authenticated
  using ((select private.is_member(trip_id)));
create policy meal_choices_insert on public.meal_choices for insert to authenticated
  with check (
    member_id = (select private.member_id_for(trip_id))
    and exists (select 1 from public.places p
                where p.id = meal_choices.place_id and p.trip_id = meal_choices.trip_id and p.kind = 'restaurant')
  );
create policy meal_choices_update on public.meal_choices for update to authenticated
  using (member_id = (select private.member_id_for(trip_id)))
  with check (
    member_id = (select private.member_id_for(trip_id))
    and exists (select 1 from public.places p
                where p.id = meal_choices.place_id and p.trip_id = meal_choices.trip_id and p.kind = 'restaurant')
  );
create policy meal_choices_delete on public.meal_choices for delete to authenticated
  using (member_id = (select private.member_id_for(trip_id)));

-- ---------------------------------------------------------------------------
-- 권한: 기본 권한을 모두 걷어 내고 필요한 것만 준다
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all tables in schema private from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all functions in schema private from anon, authenticated, public;

grant usage on schema private to authenticated;

grant select on public.trips, public.members, public.member_sessions, public.places,
                public.frames, public.stamps, public.essays, public.meal_choices to authenticated;
grant insert, update, delete on public.places to authenticated;
grant insert, update, delete on public.stamps to authenticated;
grant insert, update on public.essays to authenticated;
grant insert, update, delete on public.meal_choices to authenticated;

-- 정책이 부르는 도우미만 실행을 허용한다.
grant execute on function
  private.member_id_for(uuid), private.is_member(uuid), private.is_teacher(uuid),
  private.is_developed(uuid), private.can_see_frame(uuid, uuid, boolean, boolean),
  private.can_upload_photo(text), private.can_read_photo(text), private.can_delete_photo(text)
to authenticated;

grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.create_trip(text, text, date, text[], text, text),
  public.join_trip(text, text, text, text),
  public.peek_trip(text),
  public.leave_session(uuid),
  public.get_trip_codes(uuid),
  public.update_trip(uuid, text, date, text[], text, date),
  public.set_developed(uuid, boolean),
  public.add_place(uuid, text, text, double precision, double precision, text),
  public.write_place_intro(uuid, text),
  public.take_shot(uuid, uuid, uuid, text, timestamptz),
  public.finish_shot(uuid, int, int),
  public.edit_shot(uuid, uuid, text),
  public.discard_shot(uuid),
  public.set_frame_hidden(uuid, boolean),
  public.set_member_film(uuid, int),
  public.reset_pin(uuid),
  public.roll_stats(uuid),
  public.place_shot_counts(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 사진 저장소: 비공개 버킷, JPEG만, 3MB 이하
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.can_read_photo(name));
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.can_upload_photo(name));
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and private.can_delete_photo(name));

-- ---------------------------------------------------------------------------
-- 실시간: 교사 현황판(컷), 현상 알림(기행), 장소 추가
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.frames, public.trips, public.places;
