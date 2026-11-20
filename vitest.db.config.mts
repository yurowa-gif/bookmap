import { defineConfig } from "vitest/config";

// 접근 규칙 테스트. 로컬 Postgres에 Supabase 대역과 마이그레이션을 올려 놓고 돌린다.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
