import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** 서버 주소와 공개 키가 설정돼 있는가. 없으면 화면에 설정 안내를 띄운다. */
export const isConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

/**
 * 브라우저용 Supabase 클라이언트. 공개 키만 쓴다.
 * 접근 제한은 전부 DB의 RLS와 함수가 맡으므로 이 키가 노출돼도 된다.
 */
export function supabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 설정되지 않았습니다.");
  }
  client ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export const PHOTO_BUCKET = "photos";
