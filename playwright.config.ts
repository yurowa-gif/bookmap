import { defineConfig } from "@playwright/test";

// 화면 흐름 테스트. 개발용 대역 서버(scripts/dev-backend.mjs)와 빌드한 앱을 띄워서 돌린다.
// 대역 서버는 로컬 Postgres에 실제 마이그레이션을 올려 쓰므로 DB 규칙은 진짜다.
const BACKEND = "http://127.0.0.1:54321";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: process.env.E2E_SHOTS ? 2 : 1, // 화면을 저장할 때는 선명하게
    locale: "ko-KR",
    trace: "off",
  },
  webServer: [
    {
      command: "node scripts/dev-backend.mjs",
      port: 54321,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run build && npx next start -p 3100",
      port: 3100,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: BACKEND,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "dev-key",
        NEXT_PUBLIC_KAKAO_JS_KEY: "",
      },
    },
  ],
});
