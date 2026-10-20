"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ASSETS } from "@atc/market-data";

import { useT } from "@/i18n/provider";
import type { ScanCostReport } from "@/lib/scan-cost";
import { hasMeteredFeed, selectionPrice } from "@/lib/scan-cost";
import { useSettings } from "@/lib/store";
import { toggleWatchlist, writeWatchlistCookie } from "@/lib/watchlist";
import { cx } from "./ui";

/**
 * Screens whose contents come from a market scan, and so the only ones where
 * re-running the server render means anything. Auto-refreshing the guide or
 * the settings page would spend nothing useful and, on the metered feed, could
 * spend something real.
 */
const SCANNING_ROUTES = ["/", "/signal", "/setups", "/markets"];

/** Floor on the auto interval, matching the shortest candle cache window. */
const MIN_AUTO_SECONDS = 15;

/**
 * Re-runs the server render of the current screen, which is what makes the
 * scan and the analysis happen again — and says what that will cost first.
 *
 * Three things it deliberately does not do:
 *
 *  - Bypass the candle cache. Within the cache window the analysis is recomputed
 *    against the same candles and costs no credits; past it, new candles are
 *    fetched. The cache is the only reason the metered feed survives this app's
 *    own access pattern, so a button that skipped it would be a button that
 *    empties the day's allowance in a few impatient taps.
 *  - Tick while the tab is hidden. A phone in a pocket with auto-refresh running
 *    would spend the allowance on a chart nobody is reading, and then show DEMO
 *    prices at the moment the trader finally looks.
 *  - Refresh the moment a market is ticked or unticked. Changing the selection
 *    is how you find out what something costs; it must not be how you pay for it.
 *
 * The confirmation tick matters because of the first point: inside the cache
 * window a refresh legitimately changes nothing on screen, and without an
 * acknowledgement that reads as a broken button.
 *
 * The price next to the button exists because the allowance is small enough to
 * matter — eight credits a minute, and gold's four-bar chain is half of that.
 * Without it the only feedback is the failure: a chart that silently drops to
 * DEMO several presses later, with no way to connect the two. With it, the
 * trader can see that unticking the markets they do not trade makes the
 * refreshes they do care about affordable.
 */
export function RefreshButton() {
  const t = useT("common");
  const router = useRouter();
  const pathname = usePathname();
  const { settings, setSettings, loaded } = useSettings();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState<ScanCostReport | null>(null);
  const [costTick, setCostTick] = useState(0);

  const scanning = SCANNING_ROUTES.includes(pathname) || pathname.startsWith("/setups/");

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  const wasPending = useRef(false);
  useEffect(() => {
    const was = wasPending.current;
    wasPending.current = pending;
    if (!was || pending) return;
    setConfirmed(true);
    // The scan just warmed the cache, so the price on the chip is now stale and
    // too high. Re-reading it here is what makes "that press was free" visible.
    setCostTick((n) => n + 1);
    const id = window.setTimeout(() => setConfirmed(false), 1600);
    return () => window.clearTimeout(id);
  }, [pending]);

  /**
   * The watchlist bridge. localStorage is invisible to the server, so without
   * this the editor on the settings screen changes what the client *shows* and
   * not what the server *fetches* — the saving it appears to offer is not real.
   */
  useEffect(() => {
    if (!loaded) return;
    writeWatchlistCookie(settings.watchlist);
  }, [loaded, settings.watchlist]);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/scan-cost");
        if (!response.ok) return;
        const payload = (await response.json()) as ScanCostReport;
        if (!cancelled) setCost(payload);
      } catch {
        // No price is better than a wrong one: the chip simply stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanning, costTick, pathname]);

  const autoSeconds = settings.refreshSeconds;

  useEffect(() => {
    if (!scanning || autoSeconds <= 0) return;
    const id = window.setInterval(
      () => {
        if (document.visibilityState !== "visible") return;
        startTransition(() => router.refresh());
      },
      Math.max(autoSeconds, MIN_AUTO_SECONDS) * 1000,
    );
    return () => window.clearInterval(id);
  }, [scanning, autoSeconds, router, startTransition]);

  const selected = settings.watchlist;

  /**
   * Per-symbol costs are marginal over a baseline that is already paid, so the
   * selection's total is a plain sum. See `scanCost` for why that holds.
   */
  const price = useMemo(() => (cost ? selectionPrice(cost, selected) : null), [cost, selected]);

  const label = pending ? t("actions.refreshing") : t("actions.refresh");
  // Deliberately keyed to the catalogue, not to `price`. The chip is the only
  // way into the market picker, so hiding it when the selection costs nothing
  // would make unticking gold — the whole point of the feature — remove the
  // control needed to tick it back on. See `hasMeteredFeed`.
  const showPrice = scanning && cost !== null && price !== null && hasMeteredFeed(cost);

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        aria-label={label}
        title={t("actions.refreshHint")}
        className={cx(
          "inline-flex h-8 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-[12px] transition-colors",
          confirmed ? "text-[var(--color-long)]" : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
        )}
      >
        <span aria-hidden className={cx("leading-none", pending && "inline-block animate-spin")}>
          {confirmed ? "✓" : "⟳"}
        </span>
        <span className="sr-only">{label}</span>
      </button>

      {showPrice && price ? (
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setCostTick((n) => n + 1);
          }}
          aria-expanded={open}
          aria-label={t("refreshCost.pickerLabel")}
          title={t("refreshCost.pickerLabel")}
          className={cx(
            "num inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11.5px] font-semibold tabular-nums transition-colors",
            price.now === 0
              ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-faint)]"
              : "border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]",
          )}
        >
          <span aria-hidden>◉</span>
          <span>{price.now}</span>
          <span aria-hidden className="text-[9px] leading-none opacity-70">
            {open ? "▲" : "▼"}
          </span>
        </button>
      ) : null}

      {open && cost && price ? (
        <>
          {/* Click-away. A popover over a sticky header is easy to strand open
              on a phone, where there is no Escape key within reach. */}
          <button
            type="button"
            aria-label={t("actions.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="dialog"
            aria-label={t("refreshCost.title")}
            className="absolute top-9 right-0 z-50 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-1)] p-3 shadow-xl"
          >
            <p className="text-[12.5px] font-semibold">{t("refreshCost.title")}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
              {t("refreshCost.subtitle")}
            </p>

            <ul className="mt-2 divide-y divide-[var(--color-border)]">
              {ASSETS.map((asset) => {
                const row = cost.perSymbol.find((r) => r.symbol === asset.symbol);
                const on = selected.includes(asset.symbol);
                const last = on && selected.length <= 1;
                return (
                  <li key={asset.symbol} className="flex items-center gap-2 py-1.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={asset.display}
                      disabled={last}
                      // Updater form, not `patch` with a computed list: a burst
                      // of clicks is batched into one render, and reading
                      // `selected` from this closure would make every click in
                      // the burst start from the same list and overwrite the
                      // one before it. See `toggleWatchlist`.
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          watchlist: toggleWatchlist(prev.watchlist, asset.symbol),
                        }))
                      }
                      className={cx(
                        "flex size-[18px] shrink-0 items-center justify-center rounded border text-[11px] leading-none",
                        on
                          ? "border-[var(--color-long)]/50 bg-[var(--color-long-soft)] text-[var(--color-long)]"
                          : "border-[var(--color-border-strong)] text-transparent",
                        last && "opacity-50",
                      )}
                    >
                      <span aria-hidden>✓</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{asset.symbol}</p>
                      <p className="truncate text-[10.5px] text-[var(--color-faint)]">
                        {row?.provider ?? asset.display}
                      </p>
                    </div>
                    <span
                      className={cx(
                        "num shrink-0 text-[11px] tabular-nums",
                        row && row.fullCredits > 0
                          ? "text-[var(--color-wait)]"
                          : "text-[var(--color-faint)]",
                      )}
                    >
                      {row && row.fullCredits > 0
                        ? `${row.credits} / ${row.fullCredits}`
                        : t("refreshCost.free")}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 border-t border-[var(--color-border)] pt-2">
              <p className="text-[12px] font-medium">
                {t("refreshCost.total", { now: price.now, full: price.full })}
              </p>
              {/* The two numbers differ for a reason worth spelling out: a press
                  right now is free because the candles are still fresh, and the
                  same press after the bars age costs the full price. Showing
                  only the first teaches that refreshing never costs anything. */}
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {price.now < price.full
                  ? t("refreshCost.cachedNote")
                  : t("refreshCost.coldNote")}
              </p>
              {cost.quota ? (
                <p className="num mt-1.5 text-[11px] tabular-nums text-[var(--color-faint)]">
                  {t("refreshCost.quota", {
                    minuteUsed: cost.quota.minuteUsed,
                    minuteLimit: cost.quota.minuteLimit,
                    dayUsed: cost.quota.dayUsed,
                    dayLimit: cost.quota.dayLimit,
                  })}
                </p>
              ) : null}
              {cost.quota && price.now > cost.quota.minuteLimit - cost.quota.minuteUsed ? (
                <p className="mt-1.5 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-[var(--color-wait)]">
                  {t("refreshCost.overBudget")}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                refresh();
              }}
              className="tap mt-2.5 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] text-[12.5px] font-semibold disabled:opacity-40"
            >
              {t("refreshCost.apply")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
