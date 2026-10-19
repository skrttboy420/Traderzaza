"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useT } from "@/i18n/provider";
import { AccountChip } from "./AccountChip";
import { cx } from "./ui";

/**
 * §60: mobile-first navigation. Every destination is a full-height tap target
 * with an icon AND a label — never an icon alone.
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

/**
 * The five that answer "is there a trade right now, and what am I already in".
 * The other six are reference and admin: wanted often, but not mid-decision.
 *
 * All eleven used to sit in one sideways-scrolling row. At 375px that put six
 * of them — Settings among them — past the right edge, with nothing on screen
 * to say they were there. A scroll nobody can see is not navigation, so the
 * overflow moved into a button that is visible: two taps to anywhere, instead
 * of one tap to five things and a dead end to the rest.
 */
const PRIMARY: readonly string[] = ["/", "/signal", "/setups", "/positions", "/news"];

function useActiveMatcher() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  const t = useT("common");
  const isActive = useActiveMatcher();
  const [moreOpen, setMoreOpen] = useState(false);

  // Navigating from inside the sheet does not unmount this component, so the
  // sheet has to be told the journey is over.
  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const primary = ITEMS.filter((item) => PRIMARY.includes(item.href));
  const overflow = ITEMS.filter((item) => !PRIMARY.includes(item.href));
  const overflowActive = overflow.some((item) => isActive(item.href));

  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label={t("actions.close")}
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}
      <div
        className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {moreOpen && (
          <div
            id="nav-more"
            className="max-h-[60vh] overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-2 pt-3"
          >
            <ul className="grid grid-cols-2 gap-1">
              {overflow.map((item) => {
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
                          : "text-[var(--color-muted)]",
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
            <div className="mt-2 border-t border-[var(--color-border)] pt-2">
              <AccountChip variant="row" />
            </div>
          </div>
        )}

        <nav
          aria-label={t("nav.home")}
          className="border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur"
        >
          <ul className="flex">
            {primary.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href} className="flex-1">
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
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen((open) => !open)}
                aria-expanded={moreOpen}
                aria-controls="nav-more"
                className={cx(
                  "tap flex w-full flex-col items-center justify-center gap-0.5 px-1 py-2",
                  moreOpen || overflowActive
                    ? "text-[var(--color-text)]"
                    : "text-[var(--color-faint)]",
                )}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {moreOpen ? "✕" : "☰"}
                </span>
                <span className="text-[9.5px] leading-tight">{t("nav.more")}</span>
                <span
                  aria-hidden
                  className={cx(
                    "mt-0.5 h-0.5 w-5 rounded-full",
                    overflowActive ? "bg-[var(--color-limit)]" : "bg-transparent",
                  )}
                />
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}

/** Desktop sidebar: same destinations, more room for labels. */
export function SideNav() {
  const t = useT("common");
  const isActive = useActiveMatcher();

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
