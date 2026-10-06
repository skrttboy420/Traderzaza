"use client";

import type { DataStatus } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import { formatAgo } from "@/lib/format";
import { DATA_VISUAL } from "./visual";
import { Badge, cx } from "./ui";

/**
 * §54 / §70: every analysis says where its numbers came from. The badge shows
 * the quality word itself ("Demo"), not just a coloured dot, and DEMO data gets
 * an explicit do-not-trade warning (not hidden in a tooltip).
 */
export function DataStatusBadge({ status, compact = false }: { status: DataStatus; compact?: boolean }) {
  const t = useT("common");
  const visual = DATA_VISUAL[status.quality];

  return (
    <Badge
      glyph={visual.glyph}
      className={cx(visual.text, visual.bg, visual.border)}
      title={status.note ?? `${t("dataQuality.provider")}: ${status.provider}`}
    >
      {compact ? t(`dataQuality.${status.quality}`) : `${t("dataQuality.label")}: ${t(`dataQuality.${status.quality}`)}`}
    </Badge>
  );
}

export function DataStatusPanel({ status }: { status: DataStatus }) {
  const t = useT("common");
  const { locale } = useLocale();
  const visual = DATA_VISUAL[status.quality];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <DataStatusBadge status={status} />
        <span className="num text-[11.5px] text-[var(--color-faint)]">
          {t("dataQuality.provider")}: {status.provider}
        </span>
        <span className="num text-[11.5px] text-[var(--color-faint)]">
          {t("dataQuality.candles")}: {status.candleCount}
        </span>
        <span className="text-[11.5px] text-[var(--color-faint)]">
          {t("dataQuality.lastUpdate")}: {formatAgo(status.lastCandleTime, locale)}
        </span>
      </div>

      {status.quality === "DEMO" ? (
        <p
          className={cx(
            "rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
            visual.bg,
            visual.border,
            visual.text,
          )}
        >
          {t("dataQuality.demoWarning")}
        </p>
      ) : null}

      {status.note && status.quality !== "DEMO" ? (
        <p className="text-[11.5px] leading-relaxed text-[var(--color-faint)]">{status.note}</p>
      ) : null}
    </div>
  );
}
