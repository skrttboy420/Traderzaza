import type { Asset, Locale, Timeframe } from "@atc/types";

/** Decimal places implied by a tick size: 0.01 -> 2, 0.00001 -> 5. */
export function digitsFor(minTick: number): number {
  if (!Number.isFinite(minTick) || minTick <= 0) return 2;
  const text = minTick.toExponential();
  const exponent = Number(text.slice(text.indexOf("e") + 1));
  return Math.max(0, -exponent);
}

export function formatPrice(value: number, asset?: Pick<Asset, "minTick"> | null): string {
  if (!Number.isFinite(value)) return "—";
  const digits = asset ? digitsFor(asset.minTick) : value < 10 ? 4 : 2;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatMoney(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}R`;
}

export function formatRange(low: number, high: number, asset?: Pick<Asset, "minTick"> | null): string {
  return `${formatPrice(low, asset)} – ${formatPrice(high, asset)}`;
}

/** Unix seconds -> local clock, locale aware. */
export function formatTime(unixSeconds: number, locale: Locale): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(locale === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAgo(unixSeconds: number, locale: Locale, now = Date.now()): string {
  if (!unixSeconds) return "—";
  const seconds = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  const th = locale === "th";
  if (seconds < 60) return th ? "เมื่อครู่นี้" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return th ? `${minutes} นาทีที่แล้ว` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return th ? `${hours} ชั่วโมงที่แล้ว` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return th ? `${days} วันที่แล้ว` : `${days}d ago`;
}

/**
 * A length of time, for "the release is in 25 minutes". Deliberately coarse:
 * the calendar's own timing is only accurate to the minute, so showing seconds
 * would imply a precision the data does not have.
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const total = Math.max(0, Math.round(Math.abs(seconds)));
  const th = locale === "th";
  if (total < 60) return th ? "ไม่ถึงนาที" : "under a minute";
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return th ? `${minutes} นาที` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    const hourPart = th ? `${hours} ชม.` : `${hours}h`;
    if (restMinutes === 0) return hourPart;
    return th ? `${hourPart} ${restMinutes} นาที` : `${hourPart} ${restMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayPart = th ? `${days} วัน` : `${days}d`;
  if (restHours === 0) return dayPart;
  return th ? `${dayPart} ${restHours} ชม.` : `${dayPart} ${restHours}h`;
}

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "1m": "1M",
  "5m": "5M",
  "15m": "15M",
  "30m": "30M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

export function timeframeLabel(tf: Timeframe): string {
  return TIMEFRAME_LABEL[tf];
}

export function formatRr(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `1 : ${value.toFixed(2)}`;
}

export function formatAtr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} ATR`;
}

/** Size fraction 0.5 -> "50%" so probe entries read clearly. */
export function formatSizeFraction(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
