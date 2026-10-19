"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { useT } from "@/i18n/provider";
import { useSettings } from "@/lib/store";
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
 * scan and the analysis happen again.
 *
 * Two things it deliberately does not do:
 *
 *  - Bypass the candle cache. Within the cache window the analysis is recomputed
 *    against the same candles and costs no credits; past it, new candles are
 *    fetched. The cache is the only reason the metered feed survives this app's
 *    own access pattern, so a button that skipped it would be a button that
 *    empties the day's allowance in a few impatient taps.
 *  - Tick while the tab is hidden. A phone in a pocket with auto-refresh running
 *    would spend the allowance on a chart nobody is reading, and then show DEMO
 *    prices at the moment the trader finally looks.
 *
 * The confirmation tick matters because of the first point: inside the cache
 * window a refresh legitimately changes nothing on screen, and without an
 * acknowledgement that reads as a broken button.
 */
export function RefreshButton() {
  const t = useT("common");
  const router = useRouter();
  const pathname = usePathname();
  const { settings } = useSettings();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  const wasPending = useRef(false);
  useEffect(() => {
    const was = wasPending.current;
    wasPending.current = pending;
    if (!was || pending) return;
    setConfirmed(true);
    const id = window.setTimeout(() => setConfirmed(false), 1600);
    return () => window.clearTimeout(id);
  }, [pending]);

  const autoSeconds = settings.refreshSeconds;
  const scanning = SCANNING_ROUTES.includes(pathname) || pathname.startsWith("/setups/");

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

  const label = pending ? t("actions.refreshing") : t("actions.refresh");

  return (
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
  );
}
