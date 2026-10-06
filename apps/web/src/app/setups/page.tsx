import { DEFAULT_WATCHLIST } from "@atc/market-data";

import { scanWatchlist } from "@/lib/scan";
import { SetupsView } from "./SetupsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

export default async function SetupsPage() {
  const scan = await scanWatchlist(DEFAULT_WATCHLIST);

  return <SetupsView data={{ buckets: scan.buckets, scannedAt: scan.scannedAt }} />;
}
