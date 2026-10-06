import { DEFAULT_WATCHLIST } from "@atc/market-data";

import { scanWatchlist } from "@/lib/scan";
import { toSignalData } from "@/lib/signal";
import { SignalView } from "./SignalView";

// A signal that is one scan old is not a signal, so never cache this.
export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

export default async function SignalPage() {
  const scan = await scanWatchlist(DEFAULT_WATCHLIST);
  const data = toSignalData(scan.results, scan.scannedAt, scan.failed);

  return <SignalView data={data} />;
}
