"use client";

import { useT } from "@/i18n/provider";
import { THEME_CHOICES, useTheme, type ThemeChoice } from "@/lib/theme";
import { cx } from "./ui";

const GLYPH: Record<ThemeChoice, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

/**
 * Dark / light / follow-the-OS.
 *
 * Deliberately the same segmented control as LocaleSwitch: both are "pick one
 * of a few, applies instantly, remembered" and there is no reason for a user
 * to learn two shapes for the same idea.
 *
 * `compact` drops it to 32px for the TopBar, where it sits next to the locale
 * switch; the full size honours the 44px touch minimum (§60) and is what the
 * settings page uses.
 */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { choice, setChoice, hydrated } = useTheme();
  const t = useT("settings");

  return (
    <div
      role="group"
      aria-label={t("appearance.label")}
      className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]"
    >
      {THEME_CHOICES.map((option) => {
        // Before hydration the stored choice is unknown, so nothing is marked
        // active. Guessing "system" here would light up the wrong segment for
        // a split second on every load for anyone who has actually chosen.
        const active = hydrated && option === choice;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setChoice(option)}
            aria-pressed={active}
            title={t(`appearance.${option}`)}
            className={cx(
              "px-2.5 text-[12px] font-medium transition-colors",
              compact ? "h-8" : "tap",
              active
                ? "bg-[var(--color-surface-3)] text-[var(--color-text)]"
                : "text-[var(--color-faint)] hover:text-[var(--color-muted)]",
            )}
          >
            <span aria-hidden>{GLYPH[option]}</span>
            {/* The label is the accessible name; on the compact control it is
                visually hidden so the glyph can carry it, but a screen reader
                and a tooltip still get real words. */}
            <span className={compact ? "sr-only" : "ml-1.5"}>{t(`appearance.${option}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
