import { DEFAULT_WATCHLIST } from "@atc/market-data";

import { toHomeData } from "@/lib/home";
import { scanWatchlist } from "@/lib/scan";
import { HomeView } from "./HomeView";

// Market state changes constantly, so never cache the scan.
export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

export default async function HomePage() {
  const scan = await scanWatchlist(DEFAULT_WATCHLIST);

  const counts: Record<string, number> = {};
  for (const [state, setups] of Object.entries(scan.buckets)) {
    counts[state] = setups.length;
  }

  const data = toHomeData(scan.scans, scan.opportunities, counts, scan.scannedAt, scan.failed);

  return <HomeView data={data} />;
}
