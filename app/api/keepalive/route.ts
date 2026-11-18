// 무료 플랜의 DB는 일주일 동안 요청이 없으면 멈춘다.
// Vercel Cron이 하루 한 번 이 주소를 불러 DB에 가벼운 요청을 보낸다(vercel.json).

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return Response.json({ ok: false, error: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/ping`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    return Response.json({ ok: response.ok, status: response.status }, { status: response.ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false, error: "UNREACHABLE" }, { status: 502 });
  }
}
