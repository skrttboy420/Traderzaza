"use client";

import type { ReactNode } from "react";
import type { Phrase } from "@atc/types";
import { usePhrase } from "@/i18n/provider";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cx("card p-4", className)}>{children}</Tag>;
}

export function SectionTitle({
  title,
  subtitle,
  right,
  hint,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
        {hint ? (
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-faint)]">{hint}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  glyph,
  className,
  title,
}: {
  children: ReactNode;
  glyph?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium leading-none",
        className,
      )}
    >
      {glyph ? <span aria-hidden className="text-[10px] leading-none">{glyph}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">{label}</div>
      <div className={cx("mt-0.5 truncate text-[15px] font-semibold", mono && "num", tone)}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-faint)]">{hint}</div> : null}
    </div>
  );
}

export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[12.5px] text-[var(--color-muted)]">{label}</span>
      <span className={cx("num min-w-0 truncate text-right text-[13px] font-medium", tone)}>{value}</span>
    </div>
  );
}

/**
 * Bullet list used for whyEnter / whyWait / invalidation / facts.
 *
 * Accepts engine `Phrase` objects as well as plain strings and renders them in
 * the active locale itself. This is the single place almost all engine
 * narrative reaches the screen, so doing the translation here is what stops
 * each caller from having to remember to — which is how the whole page ended up
 * in English while the locale was set to Thai.
 */
export function Bullets({
  items,
  glyph = "–",
  tone,
  empty,
}: {
  items: (string | Phrase)[];
  glyph?: string;
  tone?: string;
  empty?: string;
}) {
  const say = usePhrase();
  if (items.length === 0) {
    return empty ? <p className="text-[12.5px] text-[var(--color-faint)]">{empty}</p> : null;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
          <span aria-hidden className={cx("shrink-0 select-none", tone ?? "text-[var(--color-faint)]")}>
            {glyph}
          </span>
          <span className="min-w-0 text-[var(--color-text)]/90">
            {typeof item === "string" ? item : say(item)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A single engine phrase, for the places that are not a list. */
export function Said({ phrase }: { phrase: Phrase }) {
  return <>{usePhrase()(phrase)}</>;
}

export function Progress({ value, tone = "bg-[var(--color-limit)]" }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
      <div className={cx("h-full rounded-full transition-[width]", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-[13.5px] font-medium text-[var(--color-muted)]">{title}</p>
      {hint ? <p className="max-w-sm text-[12px] leading-relaxed text-[var(--color-faint)]">{hint}</p> : null}
    </div>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="px-1 py-4 text-center text-[11px] leading-relaxed text-[var(--color-faint)]">{text}</p>
  );
}
