import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Candle, Timeframe } from "@atc/types";

import { serverEnv } from "./env";

/**
 * Stored candle history — the thing that makes a months-long backtest both
 * possible and affordable.
 *
 * Possible, because no provider returns four months of 15-minute bars in one
 * call and the live path asks for exactly one page. Affordable, because
 * *paging* alone would only move the cost, not remove it: a four-month walk is
 * a handful of metered credits, and a walk re-run on every press is a handful
 * of credits every press. Writing the bars down turns a recurring bill into a
 * one-off one, after which a visit a day later costs a single page of catch-up.
 * That is the whole reason this file exists; without it, deep history would be
 * a worse version of the 400-bar cap it replaces.
 *
 * Server-only. It holds the service-role key, which bypasses RLS, and must
 * never be imported from a `"use client"` module (§77).
 *
 * ## Why the service-role key, when the app already has an anon client
 *
 * `candles` is reference data, not user data: every account reads the same
 * gold history and nobody owns a row. The anon client is bound to a signed-in
 * user, but a backfill is triggered by a server route that may be answering a
 * request from any account, and the archive it writes serves all of them. A
 * per-user path would also mean each friend paying their own credits to
 * re-fetch bars the deployment already has, which defeats the point.
 *
 * ## Everything here degrades to null rather than throwing
 *
 * The app is designed to run with an empty env file (see lib/store.ts), and a
 * backtest that *works* on 400 live bars must not start crashing because the
 * database is unreachable. Every function returns null / false / an empty
 * reading instead, and the caller treats that as "no archive" and uses the
 * live path. A degraded backtest is a smaller sample; a thrown one is a blank
 * screen.
 */

/** The table is reference data shared by every account; see the note above. */
let cached: SupabaseClient | null = null;
let resolved = false;

function archiveClient(): SupabaseClient | null {
  if (resolved) return cached;
  resolved = true;

  const env = serverEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    cached = null;
    return null;
  }

  cached = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    // No user session is involved and the key must never be persisted or
    // refreshed: this client exists for the length of one server request.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Whether a deployment can store history at all. */
export function archiveConfigured(): boolean {
  return archiveClient() !== null;
}

/**
 * Supabase caps a single response at 1,000 rows by default, and the cap is
 * silent — asking for 8,000 bars returns 1,000 of them and no error. A
 * backtest handed the newest 1,000 bars of a four-month archive would report
 * on four days and say nothing was wrong, which is the exact failure this
 * whole feature exists to remove. So reads are paged explicitly.
 */
const READ_PAGE = 1000;

/**
 * Postgres has a parameter ceiling per statement, and a candle is nine
 * columns. Writing 8,000 bars in one upsert exceeds it; the error arrives
 * after the credits were already spent on fetching them.
 */
const WRITE_CHUNK = 500;

/**
 * The slice of the client this file uses, so the paging can be exercised
 * without a database.
 *
 * The two things worth testing here are both silent when wrong and both
 * catastrophic: a read that stops at Supabase's unannounced 1,000-row cap
 * would hand a four-month archive back as four days and report success, and a
 * write that abandons already-committed chunks would invite paying for the
 * same bars twice. Neither is visible in a type and neither shows up on a
 * screen — a shallow result looks exactly like a quiet market. So the query
 * builders are typed structurally and the functions below take the client as
 * an argument, with the exported wrappers supplying the real one.
 *
 * Typed as the narrow shape rather than `SupabaseClient` because a fake of the
 * full client is a fake of a hundred methods, and would drift.
 */
export interface ArchiveClient {
  from(table: string): {
    select: (columns: string, options?: { count?: "exact" }) => ArchiveQuery;
    upsert: (rows: unknown[], options: { onConflict: string }) => PromiseLike<{ error: unknown }>;
  };
}

interface ArchiveQuery extends PromiseLike<{ data: unknown[] | null; error: unknown; count?: number | null }> {
  eq: (column: string, value: string) => ArchiveQuery;
  order: (column: string, options: { ascending: boolean }) => ArchiveQuery;
  limit: (n: number) => ArchiveQuery;
  range: (from: number, to: number) => ArchiveQuery;
}

interface CandleRow {
  symbol: string;
  timeframe: string;
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quality: string;
  provider: string | null;
}

function toCandle(row: CandleRow): Candle {
  // Numeric columns come back as strings from PostgREST on some drivers.
  return {
    time: Number(row.open_time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

export interface ArchiveCoverage {
  /** Bars stored for this series. */
  bars: number;
  /** Open time of the newest stored bar, or null when nothing is stored. */
  newest: number | null;
  /** Open time of the oldest stored bar, or null when nothing is stored. */
  oldest: number | null;
}

const EMPTY: ArchiveCoverage = { bars: 0, newest: null, oldest: null };

/**
 * What is already stored, without reading the bars themselves.
 *
 * Separate from `readCandles` because the decision "do we need to spend
 * credits" is made before any bars are wanted, and pulling eight thousand rows
 * to count them would make checking the archive as expensive as not having
 * one.
 */
export async function archiveCoverage(params: {
  symbol: string;
  timeframe: Timeframe;
}): Promise<ArchiveCoverage> {
  const client = archiveClient();
  if (!client) return EMPTY;
  return coverageFrom(client as unknown as ArchiveClient, params);
}

export async function coverageFrom(
  client: ArchiveClient,
  params: { symbol: string; timeframe: Timeframe },
): Promise<ArchiveCoverage> {
  try {
    const base = client
      .from("candles")
      .select("open_time", { count: "exact" })
      .eq("symbol", params.symbol)
      .eq("timeframe", params.timeframe);

    const [newest, oldest] = await Promise.all([
      base.order("open_time", { ascending: false }).limit(1),
      client
        .from("candles")
        .select("open_time")
        .eq("symbol", params.symbol)
        .eq("timeframe", params.timeframe)
        .order("open_time", { ascending: true })
        .limit(1),
    ]);

    if (newest.error) return EMPTY;

    const bars = newest.count ?? 0;
    if (bars === 0) return EMPTY;

    const newestRow = newest.data?.[0] as { open_time: number } | undefined;
    const oldestRow = oldest.data?.[0] as { open_time: number } | undefined;

    return {
      bars,
      newest: newestRow ? Number(newestRow.open_time) : null,
      oldest: oldestRow ? Number(oldestRow.open_time) : null,
    };
  } catch {
    // Unreachable database is "no archive", not a broken page.
    return EMPTY;
  }
}

/**
 * The newest `limit` stored bars, oldest-first — the order the engine reads.
 *
 * Newest-first at the database and reversed here, rather than
 * `ascending: true` with an offset: the engine wants the most recent window,
 * and taking it off the *front* of a descending index scan is one seek
 * regardless of how deep the archive grows.
 */
export async function readCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  limit: number;
}): Promise<Candle[]> {
  const client = archiveClient();
  if (!client) return [];
  return readCandlesFrom(client as unknown as ArchiveClient, params);
}

export async function readCandlesFrom(
  client: ArchiveClient,
  params: { symbol: string; timeframe: Timeframe; limit: number },
): Promise<Candle[]> {
  if (params.limit <= 0) return [];

  const collected: Candle[] = [];
  try {
    for (let from = 0; from < params.limit; from += READ_PAGE) {
      const to = Math.min(from + READ_PAGE, params.limit) - 1;
      const { data, error } = await client
        .from("candles")
        .select("symbol,timeframe,open_time,open,high,low,close,volume,quality,provider")
        .eq("symbol", params.symbol)
        .eq("timeframe", params.timeframe)
        .order("open_time", { ascending: false })
        .range(from, to);

      if (error) break;
      const rows = (data ?? []) as CandleRow[];
      for (const row of rows) collected.push(toCandle(row));
      // A short page is the end of the archive; asking again returns nothing
      // and costs a round trip.
      if (rows.length < to - from + 1) break;
    }
  } catch {
    return collected.reverse();
  }

  return collected.reverse();
}

export interface WriteResult {
  /** Rows sent upstream. Not the same as rows newly created — see below. */
  written: number;
  /** False when the archive is unconfigured or the write failed. */
  ok: boolean;
}

/**
 * Store bars, overwriting any that are already there.
 *
 * Upsert on the composite primary key `(symbol, timeframe, open_time)` rather
 * than insert, and that is a correctness choice rather than a convenience. The
 * newest bar of any fetch is usually still *open* — its high, low and close
 * are not final. A plain insert would make the first version of that bar
 * permanent and every later run would silently be backtesting against a
 * partial candle. Upserting lets the finished bar replace the unfinished one.
 *
 * Measured idempotent against the live table: re-running a 1,000-row write
 * updates in place and does not duplicate.
 */
export async function writeCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  quality: string;
  provider: string | null;
}): Promise<WriteResult> {
  const client = archiveClient();
  if (!client) return { written: 0, ok: false };
  return writeCandlesTo(client as unknown as ArchiveClient, params);
}

export async function writeCandlesTo(
  client: ArchiveClient,
  params: {
    symbol: string;
    timeframe: Timeframe;
    candles: Candle[];
    quality: string;
    provider: string | null;
  },
): Promise<WriteResult> {
  if (params.candles.length === 0) return { written: 0, ok: true };

  // DEMO bars are synthetic. Writing them would put invented prices in a
  // permanent archive that later runs cannot tell from real ones, and no
  // later backfill would replace them because the open times are already
  // occupied. The service's backfill path avoids the demo fallback for this
  // reason; this is the second lock on the same door.
  if (params.quality === "DEMO") return { written: 0, ok: false };

  const rows: CandleRow[] = params.candles.map((candle) => ({
    symbol: params.symbol,
    timeframe: params.timeframe,
    open_time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quality: params.quality,
    provider: params.provider,
  }));

  let written = 0;
  try {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const { error } = await client
        .from("candles")
        .upsert(chunk, { onConflict: "symbol,timeframe,open_time" });
      // Keep what landed. Chunks already committed are real bars the credits
      // were spent on, and reporting zero would invite paying for them again.
      if (error) return { written, ok: false };
      written += chunk.length;
    }
  } catch {
    return { written, ok: false };
  }

  return { written, ok: true };
}
