"use client";

import type { Locale } from "@atc/types";

import { LOCALES } from "@/i18n/dictionaries";
import { useLocale, useT } from "@/i18n/provider";
import { cx } from "./ui";

/**
 * §61-63: TH | EN toggle, switches instantly with no page reload, and the
 * choice is persisted by LocaleProvider.
 */
export function LocaleSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const t = useT("common");

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]"
    >
      {LOCALES.map((code: Locale) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            className={cx(
              "px-2.5 text-[12px] font-medium transition-colors",
              compact ? "h-8" : "tap",
              active
                ? "bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
            )}
          >
            {code === "th" ? "ไทย" : "EN"}
          </button>
        );
      })}
    </div>
  );
}
