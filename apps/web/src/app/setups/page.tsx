import { scanWatchlist, serverWatchlist } from "@/lib/scan";
import { weakestStatus } from "@/lib/home";
import { SetupsView } from "./SetupsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

export default async function SetupsPage() {
  const scan = await scanWatchlist(await serverWatchlist());

  return (
    <SetupsView
      data={{
        buckets: scan.buckets,
        scannedAt: scan.scannedAt,
        measured: scan.results.length,
        weakestStatus: weakestStatus(scan.results.map((r) => r.dataStatus)),
        failed: scan.failed,
      }}
    />
  );
}
