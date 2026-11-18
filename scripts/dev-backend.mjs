#!/usr/bin/env node
// 개발·테스트용 대역 서버.
//
// 실제 Supabase 대신, 로컬 Postgres(마이그레이션과 RLS가 그대로 적용된 DB) 위에서
// 앱이 쓰는 API의 일부만 흉내 낸다: 익명 로그인, 테이블 읽기/쓰기, 함수 호출, 사진 저장소.
// 규칙은 전부 실제 DB가 판단하므로 화면 흐름을 끝까지 돌려 볼 수 있다.
// 실시간(WebSocket)은 흉내 내지 않는다. 운영에는 쓰지 않는다.
//
//   node scripts/dev-backend.mjs            # 127.0.0.1:54321, DB bookmap_dev를 새로 만든다

import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.DEV_BACKEND_PORT ?? 54321);
const DB = process.env.BOOKMAP_DEV_DB ?? "bookmap_dev";
const ADMIN_CODE = process.env.DEV_ADMIN_CODE ?? "dev-admin";
const SECRET = "dev-only-secret";
const FILES = path.join(os.tmpdir(), "bookmap-dev-files");
const root = path.resolve(import.meta.dirname, "..");

execFileSync(path.join(root, "scripts/db-test-setup.sh"), { stdio: "inherit", env: { ...process.env, BOOKMAP_TEST_DB: DB } });
rmSync(FILES, { recursive: true, force: true });
mkdirSync(FILES, { recursive: true });

// PostgREST처럼 날짜는 글자 그대로 돌려준다.
pg.types.setTypeParser(1082, (value) => value);

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "/var/run/postgresql",
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER ?? os.userInfo().username,
  password: process.env.PGPASSWORD,
  database: DB,
});
await pool.query(
  "insert into private.app_settings (admin_code_hash) values (extensions.crypt($1, extensions.gen_salt('bf', 4)))",
  [ADMIN_CODE],
);

// --- 토큰 ---------------------------------------------------------------------

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const sign = (text) => createHmac("sha256", SECRET).update(text).digest("base64url");

function issueToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aud: "authenticated", is_anonymous: true, iat: now, exp: now + 3600 })}`;
  return `${body}.${sign(body)}`;
}

function readToken(request) {
  const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const [head, payload, signature] = token.split(".");
  if (!head || !payload || sign(`${head}.${payload}`) !== signature) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

function sessionFor(uid) {
  const now = Math.floor(Date.now() / 1000);
  const stamp = new Date().toISOString();
  return {
    access_token: issueToken(uid),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `${uid}.${sign("refresh:" + uid)}`,
    user: {
      id: uid,
      aud: "authenticated",
      role: "authenticated",
      email: "",
      phone: "",
      is_anonymous: true,
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: stamp,
      updated_at: stamp,
    },
  };
}

// --- DB: 요청한 사람의 권한으로 실행 -------------------------------------------

async function asCaller(claims, work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
    await client.query(`set local role ${claims ? "authenticated" : "anon"}`);
    const out = await work(client);
    await client.query("commit");
    return out;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error("bad identifier: " + name), { status: 400 });
  return `"${name}"`;
};

/** PostgREST의 필터 일부(eq, in)를 where 절로 바꾼다. */
function whereFrom(query, skip = []) {
  const clauses = [];
  const params = [];
  for (const [key, raw] of query) {
    if (["select", "order", "limit", "on_conflict", "columns", ...skip].includes(key)) continue;
    if (raw.startsWith("eq.")) {
      params.push(raw.slice(3));
      clauses.push(`${ident(key)}::text = $${params.length}`);
    } else if (raw.startsWith("in.(") && raw.endsWith(")")) {
      const items = raw.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).filter((v) => v !== "");
      params.push(items);
      clauses.push(`${ident(key)}::text = any($${params.length})`);
    } else {
      throw Object.assign(new Error("unsupported filter: " + key + "=" + raw), { status: 400 });
    }
  }
  return { sql: clauses.length ? " where " + clauses.join(" and ") : "", params };
}

async function restTable(method, table, query, body, prefer, claims) {
  const t = "public." + ident(table);
  if (method === "GET") {
    const where = whereFrom(query);
    let sql = `select * from ${t}${where.sql}`;
    const order = query.get("order");
    if (order) {
      sql +=
        " order by " +
        order
          .split(",")
          .map((part) => {
            const [col, dir] = part.split(".");
            return `${ident(col)} ${dir === "desc" ? "desc" : "asc"}`;
          })
          .join(", ");
    }
    const limit = Number(query.get("limit"));
    if (Number.isInteger(limit) && limit > 0) sql += " limit " + limit;
    return asCaller(claims, async (c) => ({ status: 200, body: (await c.query(sql, where.params)).rows }));
  }
  if (method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    const cols = Object.keys(rows[0]);
    const params = [];
    const values = rows
      .map((row) => "(" + cols.map((col) => (params.push(row[col]), "$" + params.length)).join(", ") + ")")
      .join(", ");
    let sql = `insert into ${t} (${cols.map(ident).join(", ")}) values ${values}`;
    if (prefer.includes("resolution=merge-duplicates")) {
      const conflict = (query.get("on_conflict") ?? "").split(",").filter(Boolean);
      const updates = cols.filter((col) => !conflict.includes(col));
      sql += ` on conflict (${conflict.map(ident).join(", ")}) do update set ${updates
        .map((col) => `${ident(col)} = excluded.${ident(col)}`)
        .join(", ")}`;
    }
    return asCaller(claims, async (c) => {
      await c.query(sql, params);
      return { status: 201, body: null };
    });
  }
  if (method === "PATCH") {
    const cols = Object.keys(body);
    const params = cols.map((col) => body[col]);
    const where = whereFrom(query);
    const shifted = where.sql.replace(/\$(\d+)/g, (_, n) => "$" + (Number(n) + cols.length));
    const sql = `update ${t} set ${cols.map((col, i) => `${ident(col)} = $${i + 1}`).join(", ")}${shifted}`;
    return asCaller(claims, async (c) => {
      await c.query(sql, [...params, ...where.params]);
      return { status: 204, body: null };
    });
  }
  if (method === "DELETE") {
    const where = whereFrom(query);
    if (!where.sql) throw Object.assign(new Error("delete without filter"), { status: 400 });
    return asCaller(claims, async (c) => {
      await c.query(`delete from ${t}${where.sql}`, where.params);
      return { status: 204, body: null };
    });
  }
  throw Object.assign(new Error("method not allowed"), { status: 405 });
}

async function restRpc(fn, args, claims) {
  const name = ident(fn);
  const keys = Object.keys(args ?? {});
  const call = `public.${name}(${keys.map((key, i) => `${ident(key)} => $${i + 1}`).join(", ")})`;
  const values = keys.map((key) => args[key]);
  return asCaller(claims, async (c) => {
    const meta = await c.query(
      "select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1",
      [fn],
    );
    if (meta.rowCount === 0) throw Object.assign(new Error("function not found: " + fn), { status: 404 });
    if (meta.rows[0].proretset) return { status: 200, body: (await c.query(`select * from ${call}`, values)).rows };
    const out = (await c.query(`select ${call} as out`, values)).rows[0].out;
    return out === null || out === "" ? { status: 204, body: null } : { status: 200, body: out };
  });
}

// --- 저장소 -------------------------------------------------------------------

const fileFor = (name) => path.join(FILES, Buffer.from(name).toString("base64url"));

async function storage(method, parts, url, request, raw, claims) {
  // POST /object/photos/<path> : 올리기
  if (method === "POST" && parts[0] === "object" && parts[1] === "photos") {
    const name = decodeURIComponent(parts.slice(2).join("/"));
    const form = await new Request("http://local/", { method: "POST", headers: request.headers, body: raw }).formData();
    const file = [...form.values()].find((value) => typeof value !== "string");
    if (!file) throw Object.assign(new Error("no file"), { status: 400 });
    if (file.type !== "image/jpeg") throw Object.assign(new Error("mime type not supported"), { status: 415 });
    if (file.size > 3145728) throw Object.assign(new Error("The object exceeded the maximum allowed size"), { status: 413 });
    await asCaller(claims, (c) => c.query("insert into storage.objects (bucket_id, name) values ('photos', $1)", [name]));
    writeFileSync(fileFor(name), Buffer.from(await file.arrayBuffer()));
    return { status: 200, body: { Key: "photos/" + name, Id: randomUUID() } };
  }
  // POST /object/sign/photos : 서명 주소 여러 개
  if (method === "POST" && parts[0] === "object" && parts[1] === "sign" && parts[2] === "photos") {
    const { paths = [] } = JSON.parse(raw.toString() || "{}");
    const visible = await asCaller(claims, async (c) => {
      const res = await c.query("select name from storage.objects where bucket_id = 'photos' and name = any($1)", [paths]);
      return new Set(res.rows.map((row) => row.name));
    });
    return {
      status: 200,
      body: paths.map((name) =>
        visible.has(name)
          ? { error: null, path: name, signedURL: `/object/sign/photos/${name}?token=${sign("file:" + name)}` }
          : { error: "Either the object does not exist or you do not have access to it", path: name, signedURL: null },
      ),
    };
  }
  // GET /object/sign/photos/<path>?token= : 서명 주소로 내려받기
  if (method === "GET" && parts[0] === "object" && parts[1] === "sign" && parts[2] === "photos") {
    const name = decodeURIComponent(parts.slice(3).join("/"));
    if (url.searchParams.get("token") !== sign("file:" + name) || !existsSync(fileFor(name))) {
      return { status: 400, body: { error: "InvalidJWT", message: "invalid token" } };
    }
    return { status: 200, file: readFileSync(fileFor(name)) };
  }
  // DELETE /object/photos : 여러 개 지우기
  if (method === "DELETE" && parts[0] === "object" && parts[1] === "photos") {
    const { prefixes = [] } = JSON.parse(raw.toString() || "{}");
    const removed = await asCaller(claims, async (c) => {
      const res = await c.query("delete from storage.objects where bucket_id = 'photos' and name = any($1) returning name", [
        prefixes,
      ]);
      return res.rows.map((row) => row.name);
    });
    for (const name of removed) rmSync(fileFor(name), { force: true });
    return { status: 200, body: removed.map((name) => ({ name, bucket_id: "photos" })) };
  }
  throw Object.assign(new Error("storage route not found"), { status: 404 });
}

// --- 서버 ---------------------------------------------------------------------

function errorResponse(error, area) {
  const code = error.code;
  if (area === "storage") {
    const status = code === "23505" ? 409 : code === "42501" ? 403 : (error.status ?? 500);
    const label = status === 409 ? "Duplicate" : status === 403 ? "Unauthorized" : "Error";
    const message = status === 409 ? "The resource already exists" : error.message;
    return { status, body: { statusCode: String(status), error: label, message } };
  }
  const status = error.status ?? (code === "42501" ? 403 : code === "23505" ? 409 : code ? 400 : 500);
  return { status, body: { message: error.message, code: code ?? null, details: error.detail ?? null, hint: error.hint ?? null } };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://local");
  const cors = {
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": request.headers["access-control-request-headers"] ?? "*",
    "Access-Control-Max-Age": "600",
  };
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors).end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const claims = readToken(request);
  const area = url.pathname.split("/")[1];
  let out;

  try {
    const parts = url.pathname.split("/").slice(3);
    if (area === "auth") {
      if (request.method === "POST" && parts[0] === "signup") out = { status: 200, body: sessionFor(randomUUID()) };
      else if (request.method === "POST" && parts[0] === "token") {
        const [uid, signature] = (JSON.parse(raw.toString() || "{}").refresh_token ?? "").split(".");
        out =
          uid && signature === sign("refresh:" + uid)
            ? { status: 200, body: sessionFor(uid) }
            : { status: 400, body: { error: "invalid_grant", error_description: "Invalid Refresh Token" } };
      } else if (request.method === "GET" && parts[0] === "user") {
        out = claims ? { status: 200, body: sessionFor(claims.sub).user } : { status: 401, body: { message: "invalid JWT" } };
      } else out = { status: 204, body: null };
    } else if (area === "rest") {
      const json = raw.length ? JSON.parse(raw.toString()) : {};
      out =
        parts[0] === "rpc"
          ? await restRpc(parts[1], json, claims)
          : await restTable(request.method, parts[0], url.searchParams, json, request.headers.prefer ?? "", claims);
    } else if (area === "storage") {
      out = await storage(request.method, parts, url, request, raw, claims);
    } else {
      out = { status: 404, body: { message: "not found" } };
    }
  } catch (error) {
    out = errorResponse(error, area);
    if (out.status >= 500) console.error(error);
  }

  if (out.file) {
    response.writeHead(200, { ...cors, "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" }).end(out.file);
  } else if (out.body === null || out.body === undefined) {
    response.writeHead(out.status, cors).end();
  } else {
    response.writeHead(out.status, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(out.body));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev backend ready: http://127.0.0.1:${PORT} (db ${DB}, 관리 코드 ${ADMIN_CODE})`);
});
