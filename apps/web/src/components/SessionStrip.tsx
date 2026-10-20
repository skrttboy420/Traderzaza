"use client";

import { useEffect, useState } from "react";
import { readSessions, type Liquidity, type SessionReading } from "@atc/engine";

import { useT, usePhrase } from "@/i18n/provider";
import { Badge, cx } from "./ui";

/**
 * Which market is awake, and what that does to everything else on the screen.
 *
 * The scan grades a setup on structure alone, which is correct — structure is
 * what it can measure. But the same grade means two different things at 14:00
 * UTC and at 03:00 UTC, and the trader is the only one who can apply that
 * discount. This strip is the input to that judgement.
 *
 * Rendered client-side and after mount on purpose. The server renders at its
 * own clock and caches; a session banner baked into cached HTML would keep
 * insisting London is open an hour after it shut.
 */
const LIQUIDITY_TONE: Record<Liquidity, { text: string; border: string; bg: string; glyph: string }> =
  {
    high: {
      text: "text-[var(--color-long)]",
      border: "border-[var(--color-long)]/40",
      bg: "bg-[var(--color-long-soft)]",
      glyph: "◉",
    },
    normal: {
      text: "text-[var(--color-limit)]",
      border: "border-[var(--color-limit)]/40",
      bg: "bg-[var(--color-limit-soft)]",
      glyph: "◎",
    },
    thin: {
      text: "text-[var(--color-wait)]",
      border: "border-[var(--color-wait)]/40",
      bg: "bg-[var(--color-wait-soft)]",
      glyph: "◌",
    },
    closed: {
      text: "text-[var(--color-faint)]",
      border: "border-[var(--color-border)]",
      bg: "bg-[var(--color-surface-2)]",
      glyph: "○",
    },
  };

/** "2h 15m" — minutes alone stop being readable somewhere around ninety. */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function SessionStrip({ className }: { className?: string }) {
  const t = useT("trading");
  const say = usePhrase();
  const [reading, setReading] = useState<SessionReading | null>(null);

  useEffect(() => {
    const tick = () => setReading(readSessions(new Date()));
    tick();
    // A session boundary that arrives while the page is open should be seen.
    // A minute is finer than any decision made from this, and the work is
    // three timezone lookups against cached formatters.
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!reading) return null;

  const tone = LIQUIDITY_TONE[reading.liquidity];

  return (
    <section className={cx("rounded-xl border p-3.5", tone.border, tone.bg, className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden className={cx("text-[12px] leading-none", tone.text)}>
          {tone.glyph}
        </span>
        <h2 className={cx("mr-1 text-[12.5px] font-semibold", tone.text)}>
          {t(`session.liquidity.${reading.liquidity}`)}
        </h2>

        {reading.sessions.map((session) => (
          <Badge
            key={session.id}
            className={cx(
              session.open
                ? "border-[var(--color-border-strong)] text-[var(--color-text)]"
                : "border-[var(--color-border)] text-[var(--color-faint)] opacity-70",
            )}
            title={
              session.minutesToChange === null
                ? undefined
                : session.open
                  ? t("session.closesIn", { time: duration(session.minutesToChange) })
                  : t("session.opensIn", { time: duration(session.minutesToChange) })
            }
          >
            {t(`session.name.${session.id}`)}
            {session.minutesToChange === null ? null : (
              <span className="num ml-1 text-[10px] opacity-75">
                {session.open ? "−" : "+"}
                {duration(session.minutesToChange)}
              </span>
            )}
          </Badge>
        ))}
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-text)]/90">
        {say(reading.note)}
      </p>
    </section>
  );
}
