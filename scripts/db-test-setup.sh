#!/usr/bin/env bash
# 테스트용 DB를 새로 만들고 Supabase 대역과 마이그레이션을 적용한다.
# 접속 정보는 PGHOST, PGUSER, PGPASSWORD 환경 변수를 따른다.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${BOOKMAP_TEST_DB:-bookmap_test}"

psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -q -v ON_ERROR_STOP=1 -d "${DB}" -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "${DB}" -f "$f"
done
echo "test database ready: ${DB}"
