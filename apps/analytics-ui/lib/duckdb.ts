import type { AsyncDuckDBConnection, DuckDBBundles } from "@duckdb/duckdb-wasm";

export async function initDB() {
  const duckdb = await import("@duckdb/duckdb-wasm/dist/duckdb-browser.mjs");
  const bundles: DuckDBBundles = {
    mvp: {
      mainModule: new URL("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm", import.meta.url).toString(),
      mainWorker: new URL("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js", import.meta.url).toString()
    },
    eh: {
      mainModule: new URL("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm", import.meta.url).toString(),
      mainWorker: new URL("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js", import.meta.url).toString()
    }
  };
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const conn = await db.connect();
  return { db, conn };
}

export async function loadEventData(conn: AsyncDuckDBConnection, parquetUrl?: string) {
  await conn.query(`
    create table if not exists events(
      timestamp TIMESTAMP,
      request_id VARCHAR,
      user_id VARCHAR,
      action VARCHAR,
      output_leak BOOLEAN,
      leak_types VARCHAR[],
      upstream VARCHAR,
      input_score DOUBLE,
      pii_tag VARCHAR,
      latency_ms BIGINT
    );
  `);
  if (!parquetUrl) {
    const cntResult = await conn.query(`select count(*) as c from events`);
    const countValue = Number((cntResult.toArray()[0] as { c: number }).c);
    if (countValue === 0) {
      await conn.query(`
        insert into events(timestamp, request_id, user_id, action, output_leak, leak_types, upstream, input_score, pii_tag, latency_ms) values
        (now(), 'demo-1', 'user-a', 'allow', false, [], 'mock-llm', 0.12, 'SAFE', 34),
        (now(), 'demo-2', 'user-b', 'block_input', false, [], 'mock-llm', 0.93, 'RED_FLAG', 12),
        (now(), 'demo-3', 'user-c', 'redact_stream', true, ['email'], 'mock-llm', 0.44, 'CRITICAL', 57);
      `);
    }
    return;
  }
  try {
    const safeParquetURL = parquetUrl.replaceAll("'", "''");
    await conn.query(`
      insert into events
      select * from read_parquet('${safeParquetURL}');
    `);
  } catch {
    // Fall back to local demo data when remote parquet is unreachable/missing.
    const cntResult = await conn.query(`select count(*) as c from events`);
    const countValue = Number((cntResult.toArray()[0] as { c: number }).c);
    if (countValue === 0) {
      await conn.query(`
        insert into events(timestamp, request_id, user_id, action, output_leak, leak_types, upstream, input_score, pii_tag, latency_ms) values
        (now(), 'demo-1', 'user-a', 'allow', false, [], 'mock-llm', 0.12, 'SAFE', 34),
        (now(), 'demo-2', 'user-b', 'block_input', false, [], 'mock-llm', 0.93, 'RED_FLAG', 12),
        (now(), 'demo-3', 'user-c', 'redact_stream', true, ['email'], 'mock-llm', 0.44, 'CRITICAL', 57);
      `);
    }
  }
}

type LiveEvent = {
  timestamp?: string;
  request_id?: string;
  user_id?: string;
  action?: string;
  output_leak?: boolean;
  leak_types?: string[];
  upstream?: string;
  input_score?: number;
  pii_tag?: string;
  latency_ms?: number;
};

function esc(v: string): string {
  return v.replaceAll("'", "''");
}

export async function syncLiveEvents(conn: AsyncDuckDBConnection, endpoint: string): Promise<"live" | "stale"> {
  let res: Response;
  try {
    res = await fetch(endpoint, { cache: "no-store" });
  } catch {
    // Proxy live endpoint unavailable; keep dashboard usable with local/parquet data.
    return "stale";
  }
  if (!res.ok) {
    return "stale";
  }
  let data: LiveEvent[];
  try {
    data = (await res.json()) as LiveEvent[];
  } catch {
    return "stale";
  }
  if (!Array.isArray(data) || data.length === 0) {
    return "stale";
  }

  for (const row of data) {
    const requestID = esc(String(row.request_id ?? ""));
    const userID = esc(String(row.user_id ?? "unknown"));
    const action = esc(String(row.action ?? "allow"));
    const upstream = esc(String(row.upstream ?? "unknown"));
    const piiTag = esc(String(row.pii_tag ?? "SAFE"));
    const timestamp = esc(String(row.timestamp ?? new Date().toISOString()));
    const score = Number(row.input_score ?? 0);
    const latency = Number(row.latency_ms ?? 0);
    const outputLeak = row.output_leak ? "true" : "false";
    const leakTypes = Array.isArray(row.leak_types) ? row.leak_types.map((x) => `'${esc(String(x))}'`).join(",") : "";

    await conn.query(`delete from events where request_id='${requestID}'`);
    await conn.query(`
      insert into events(timestamp, request_id, user_id, action, output_leak, leak_types, upstream, input_score, pii_tag, latency_ms)
      values (
        '${timestamp}',
        '${requestID}',
        '${userID}',
        '${action}',
        ${outputLeak},
        [${leakTypes}],
        '${upstream}',
        ${Number.isFinite(score) ? score : 0},
        '${piiTag}',
        ${Number.isFinite(latency) ? latency : 0}
      )
    `);
  }
  return "live";
}
