import { randomUUID } from "node:crypto";
import os from "node:os";
import pg from "pg";

export type Json = Record<string, unknown>;

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({
    host: process.env.PGHOST ?? "/var/run/postgresql",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER ?? os.userInfo().username,
    password: process.env.PGPASSWORD,
    database: process.env.BOOKMAP_TEST_DB ?? "bookmap_test",
  });
  await client.connect();
  return client;
}

/** 로그인한 사용자(또는 로그인 전 anon) 한 명의 시점에서 쿼리를 실행한다. */
export class Actor {
  readonly uid: string;

  constructor(
    private readonly db: pg.Client,
    private readonly role: "authenticated" | "anon" = "authenticated",
  ) {
    this.uid = randomUUID();
  }

  async query<T extends Json = Json>(sql: string, params: unknown[] = []): Promise<T[]> {
    const claims = this.role === "anon" ? "{}" : JSON.stringify({ sub: this.uid, role: this.role });
    await this.db.query("reset role");
    await this.db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await this.db.query("set role " + this.role);
    try {
      const res = await this.db.query(sql, params);
      return res.rows as T[];
    } finally {
      await this.db.query("reset role");
    }
  }

  /** jsonb나 스칼라를 돌려주는 함수를 부른다. casts로 인자 타입을 지정할 수 있다. */
  async rpc<T = Json>(fn: string, args: unknown[] = [], casts: string[] = []): Promise<T> {
    const placeholders = args
      .map((_, i) => "$" + (i + 1) + (casts[i] ? "::" + casts[i] : ""))
      .join(", ");
    const rows = await this.query<{ out: T }>("select public." + fn + "(" + placeholders + ") as out", args);
    return rows[0].out;
  }
}

export async function admin<T extends Json = Json>(db: pg.Client, sql: string, params: unknown[] = []) {
  await db.query("reset role");
  const res = await db.query(sql, params);
  return res.rows as T[];
}
