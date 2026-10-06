"use client";

import Link from "next/link";

import { TopBar } from "@/components/TopBar";
import { Disclaimer, SectionTitle, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";

/**
 * The usage guide.
 *
 * Every section is `title` + optional `body` + numbered `item1..itemN` keys,
 * because the translator signature is `(key, vars?) => string` and cannot
 * return an array. The counts live here rather than in the JSON so a missing
 * translation shows up as a visible key instead of a silently dropped bullet.
 *
 * `href` is the screen the section is about. Reading about a screen and then
 * having to go find it in the nav is a small friction, and this page exists
 * precisely to remove small frictions.
 */
const SECTIONS: {
  id: string;
  glyph: string;
  items: number;
  body?: boolean;
  href?: string;
  linkKey?: string;
}[] = [
  { id: "start", glyph: "◎", items: 4, body: true },
  { id: "flow", glyph: "⇢", items: 6, body: true, href: "/setups", linkKey: "nav.setups" },
  { id: "score", glyph: "◈", items: 4, body: true, href: "/setups", linkKey: "nav.setups" },
  { id: "data", glyph: "▤", items: 4, body: true, href: "/markets", linkKey: "nav.markets" },
  { id: "risk", glyph: "⚖", items: 4, href: "/settings", linkKey: "nav.settings" },
  { id: "news", glyph: "◷", items: 4, body: true, href: "/news", linkKey: "nav.news" },
  { id: "positions", glyph: "⊞", items: 3, href: "/positions", linkKey: "nav.positions" },
  { id: "journal", glyph: "✎", items: 3, href: "/journal", linkKey: "nav.journal" },
  { id: "training", glyph: "⟳", items: 3, href: "/training", linkKey: "nav.training" },
  { id: "limits", glyph: "⚠", items: 5, body: true },
];

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function GuideView() {
  const t = useT("guide");
  const tc = useT("common");

  return (
    <>
      <TopBar title={t("title")} subtitle={t("subtitle")} />

      <main className="space-y-4 p-4">
        {/* The one thing worth reading even if nothing else gets read. */}
        <section className="card border-l-2 border-l-[var(--color-limit)] p-4">
          <p className="text-[13px] leading-relaxed text-[var(--color-text)]/90">{t("intro")}</p>
        </section>

        {/* Jump list. On a phone this page is long, and the section someone
            actually wants is usually not the first one. */}
        <nav aria-label={t("title")} className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--color-muted)]"
            >
              <span aria-hidden className="mr-1.5 text-[10px]">
                {section.glyph}
              </span>
              {t(`${section.id}.title`)}
            </a>
          ))}
        </nav>

        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="card scroll-mt-20 p-4">
            <SectionTitle
              title={t(`${section.id}.title`)}
              subtitle={section.body ? t(`${section.id}.body`) : undefined}
              right={
                <span
                  aria-hidden
                  className="text-[13px] leading-none text-[var(--color-faint)]"
                >
                  {section.glyph}
                </span>
              }
            />

            <ol className="space-y-2.5">
              {range(section.items).map((n) => (
                <li key={n} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                  <span
                    aria-hidden
                    className={cx(
                      "num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                      "bg-[var(--color-surface-3)] text-[9.5px] font-semibold text-[var(--color-muted)]",
                    )}
                  >
                    {n}
                  </span>
                  <span className="min-w-0 text-[var(--color-text)]/90">
                    {t(`${section.id}.item${n}`)}
                  </span>
                </li>
              ))}
            </ol>

            {section.href && section.linkKey ? (
              <Link
                href={section.href}
                className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-limit)]"
              >
                {tc(section.linkKey)}
                <span aria-hidden>→</span>
              </Link>
            ) : null}
          </section>
        ))}

        <section className="card border-l-2 border-l-[var(--color-border-strong)] p-4">
          <p className="text-[13px] leading-relaxed text-[var(--color-text)]/90">{t("closing")}</p>
        </section>

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
