/**
 * Server-only environment reader.
 *
 * Nothing in here may be imported from a `"use client"` module: the keys must
 * never reach the browser bundle (§77). Client code learns about capability
 * through the API responses (for example `dataStatus.quality`), not by reading
 * env vars.
 */

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ServerEnv {
  anthropicApiKey: string | undefined;
  anthropicModel: string | undefined;
  twelveDataApiKey: string | undefined;
  enableBinance: boolean;
  forceDemo: boolean;
  candleLimit: number;
  newsEnabled: boolean;
  newsInvesting: boolean;
  newsTtlSeconds: number;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  supabaseServiceKey: string | undefined;
}

export function serverEnv(): ServerEnv {
  const env = process.env;
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || undefined,
    twelveDataApiKey: env.TWELVE_DATA_API_KEY || undefined,
    enableBinance: flag(env.ENABLE_BINANCE, true),
    forceDemo: flag(env.FORCE_DEMO_DATA, false),
    candleLimit: num(env.CANDLE_LIMIT, 400),
    newsEnabled: flag(env.ENABLE_NEWS, true),
    // Default off on purpose: investing.com's edge rejects Node's TLS
    // fingerprint, so on Vercel this only wastes a request. Set it to 1 when
    // running somewhere that can reach the site.
    newsInvesting: flag(env.ENABLE_INVESTING_CALENDAR, false),
    newsTtlSeconds: num(env.NEWS_TTL_SECONDS, 900),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  };
}

/** What the browser is allowed to know about the server configuration. */
export interface Capabilities {
  llm: boolean;
  database: boolean;
  liveCrypto: boolean;
  liveForex: boolean;
  forcedDemo: boolean;
  news: boolean;
}

export function capabilities(env: ServerEnv = serverEnv()): Capabilities {
  return {
    llm: Boolean(env.anthropicApiKey),
    database: Boolean(env.supabaseUrl && env.supabaseAnonKey),
    liveCrypto: env.enableBinance && !env.forceDemo,
    liveForex: Boolean(env.twelveDataApiKey) && !env.forceDemo,
    forcedDemo: env.forceDemo,
    news: env.newsEnabled,
  };
}
