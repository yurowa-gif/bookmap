# 북맵

한 사람에 필름 한 통, 스물네 컷. 학생들이 폰으로 기행을 기록하고, 선생님이 "현상"하면 모두의 사진이 한꺼번에 공개되는 학교 기행 앱입니다. 종이 리플렛과 일회용 카메라를 대신합니다.

## 어떻게 쓰나

1. 선생님이 `/new`에서 관리 코드로 기행을 만들면 **학생 참가 코드**와 **교사 코드**가 나옵니다.
2. 학생은 참가 코드(또는 QR), 이름, 모둠, PIN 네 자리로 들어옵니다. 회원가입은 없습니다.
3. 카메라 탭에서 찍고, 장소와 메모를 붙여 "필름 감기"를 누르면 한 컷을 씁니다. 감은 컷은 되돌릴 수 없습니다.
4. 현상 전에는 자기 컷만 보입니다. 교사는 처음부터 전부 봅니다.
5. 교사 탭에서 "현상하기"를 누르면 서로의 사진이 공개되고 도장을 찍을 수 있습니다.

## 화면

| 탭 | 내용 |
|---|---|
| 카메라 | 남은 컷 카운터, 셔터, 장소·메모 입력. 통신이 끊기면 폰에 저장했다가 자동으로 다시 보냅니다. |
| 지도 | 추천 장소·식당·방문 장소 핀, 장소 소개글 쓰기, 장소별 컷 수 |
| 인화 | 필름 띠 모양의 밀착 인화. 현상 전에는 다른 사람의 컷이 봉인된 칸으로만 보입니다. |
| 안내 | 일정 안내, 점심 식당 고르기 |
| 교사 | 모둠별 체크인 현황, 현상, 구성원 필름·PIN 관리, 코드와 QR, 기행 설정 |

## 구조

- **프론트엔드**: Next.js(App Router) + TypeScript + Tailwind CSS. 화면은 모두 브라우저에서 그립니다.
- **백엔드**: Supabase(Postgres, 익명 로그인, 비공개 사진 저장소, Realtime).
- **지도**: 카카오맵 JavaScript SDK.

보안은 DB에 있습니다. 브라우저에는 공개 키만 나가고, 규칙은 `supabase/migrations/`의 접근 규칙(RLS)과 DB 함수가 지킵니다. 학생은 테이블에 직접 쓰지 못하고, 입장·컷 예약·현상은 함수로만 합니다. 참가 코드와 PIN 해시는 API에 노출되지 않는 `private` 스키마에 둡니다.

```
app/                 화면과 API 경로
components/          화면 부품 (film.tsx: 카운터·셔터·필름 띠, screens/: 탭별 화면)
lib/api.ts           서버 호출을 모은 곳
lib/image/           사진 줄이기, 필름 색감, 날짜 각인
lib/queue/           전송 대기열 (IndexedDB)
supabase/migrations/ 스키마, 함수, 접근 규칙
supabase/tests/      테스트용 Supabase 대역
scripts/             테스트 DB 준비, 개발용 대역 서버
tests/               단위 · 접근 규칙 · 화면 흐름 테스트
```

## 처음 설정하기

1. **Supabase 프로젝트**를 만들고 `supabase/migrations/`의 SQL을 적용합니다.
2. 대시보드 Authentication 설정에서 **익명 로그인(Anonymous sign-ins)**을 켭니다.
3. SQL 편집기에서 **관리 코드**를 정합니다. 기행을 만들 때 쓰는 비밀입니다.

   ```sql
   insert into private.app_settings (admin_code_hash)
   values (extensions.crypt('여기에-관리-코드', extensions.gen_salt('bf', 10)));
   ```

4. **카카오 키**: developers.kakao.com에서 앱을 만들고 JavaScript 키를 받습니다. 카카오맵 사용을 켜고, 배포 주소를 JavaScript SDK 도메인에 등록합니다.
5. `.env.example`을 `.env.local`로 복사해 세 값을 채웁니다. Vercel에는 같은 이름의 환경 변수로 넣습니다.

## 개발

```bash
npm install
npm run dev            # http://localhost:3000
```

실제 Supabase 없이 화면을 돌려 보려면 로컬 Postgres 16과 개발용 대역 서버를 씁니다.

```bash
npm run dev:backend    # 127.0.0.1:54321, 관리 코드는 dev-admin
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dev-key npm run dev
```

대역 서버는 실제 마이그레이션을 올린 DB 위에서 로그인·테이블·함수·저장소 API의 일부만 흉내 냅니다. 규칙 판단은 진짜 DB가 하지만, 실시간 알림은 없고 운영에는 쓰지 않습니다.

## 테스트

```bash
npm run lint
npm run typecheck
npm test               # 단위: 사진 처리 계산, 전송 대기열
npm run test:db        # 접근 규칙: 로컬 Postgres에 마이그레이션을 올려 역할별로 확인
npm run test:e2e       # 화면 흐름: 기행 생성 → 입장 → 촬영 → 통신 끊김 → 현상 → 도장
```

`test:db`와 `test:e2e`는 로컬 Postgres 16이 필요합니다. 접속 정보는 `PGHOST`, `PGUSER`, `PGPASSWORD`를 따릅니다. GitHub Actions가 PR마다 세 가지를 모두 돌립니다.

## 아직 없는 것

- 기행문 엮기와 교사용 내려받기 (기행 뒤 단계)
- 보관본 내려받기와 삭제
- 앱을 닫은 상태에서 통신 없이 다시 여는 기능(서비스 워커). 열려 있는 동안의 통신 끊김은 처리합니다.
