"use client";

import Link from "next/link";

import { useT } from "@/i18n/provider";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";

export function TopBar({ title, subtitle }: { title?: string; subtitle?: string }) {
  const t = useT("common");

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/92 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <Link href="/" className="block min-w-0">
            <div className="truncate text-[14px] font-semibold tracking-tight">
              {title ?? t("appName")}
            </div>
            <div className="truncate text-[11px] leading-snug text-[var(--color-faint)]">
              {subtitle ?? t("tagline")}
            </div>
          </Link>
        </div>
        {/* shrink-0 so a long symbol name in the title truncates instead of
            squeezing the controls out of reach on a phone. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeSwitch compact />
          <LocaleSwitch compact />
        </div>
      </div>
    </header>
  );
}
