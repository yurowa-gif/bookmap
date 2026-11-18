-- 로컬·CI 테스트용: Supabase가 미리 만들어 두는 것들의 최소 대역.
-- 실제 프로젝트에는 적용하지 않는다.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create schema auth;
create schema storage;
create schema extensions;
create extension pgcrypto schema extensions;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- Supabase는 public 스키마의 새 객체에 기본 권한을 넓게 준다. 그 상태를 흉내 내야
-- 마이그레이션의 revoke가 실제로 효과가 있는지 확인할 수 있다.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

create publication supabase_realtime;
