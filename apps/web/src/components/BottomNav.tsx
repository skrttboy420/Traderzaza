"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/i18n/provider";
import { AccountChip } from "./AccountChip";
import { cx } from "./ui";

/**
 * §60: mobile-first navigation. Every destination is a full-height tap target
 * with an icon AND a label — never an icon alone. The bar scrolls sideways on
 * a narrow phone rather than shrinking the labels into illegibility.
 */
const ITEMS = [
  { href: "/", key: "home", glyph: "◎" },
  { href: "/signal", key: "signal", glyph: "◉" },
  { href: "/markets", key: "markets", glyph: "▤" },
  { href: "/setups", key: "setups", glyph: "◈" },
  { href: "/news", key: "news", glyph: "◷" },
  { href: "/positions", key: "positions", glyph: "⊞" },
  { href: "/journal", key: "journal", glyph: "✎" },
  { href: "/coach", key: "coach", glyph: "✦" },
  { href: "/training", key: "training", glyph: "⟳" },
  { href: "/guide", key: "guide", glyph: "?" },
  { href: "/settings", key: "settings", glyph: "⚙" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useT("common");

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label={t("nav.home")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="scroll-x flex">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="min-w-[20%] flex-1 sm:min-w-[10%]">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "tap flex flex-col items-center justify-center gap-0.5 px-1 py-2",
                  active ? "text-[var(--color-text)]" : "text-[var(--color-faint)]",
                )}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {item.glyph}
                </span>
                <span className="text-[9.5px] leading-tight">{t(`nav.${item.key}`)}</span>
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 h-0.5 w-5 rounded-full",
                    active ? "bg-[var(--color-limit)]" : "bg-transparent",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop sidebar: same destinations, more room for labels. */
export function SideNav() {
  const pathname = usePathname();
  const t = useT("common");

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="hidden w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] lg:block">
      <div className="sticky top-0 p-3">
        <div className="mb-4 px-2 pt-2">
          <div className="text-[13px] font-semibold tracking-tight">{t("appName")}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-faint)]">{t("tagline")}</div>
        </div>
        <ul className="space-y-0.5">
          {ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "tap flex items-center gap-2.5 rounded-lg px-2.5 text-[13px]",
                    active
                      ? "bg-[var(--color-surface-3)] font-medium text-[var(--color-text)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]",
                  )}
                >
                  <span aria-hidden className="w-4 text-center text-[14px]">
                    {item.glyph}
                  </span>
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Account sits below the destinations, separated by a rule: it is a
            state indicator that happens to be clickable, not another screen in
            the same list. Renders nothing when accounts are unconfigured. */}
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <AccountChip variant="row" />
        </div>
      </div>
    </nav>
  );
}
