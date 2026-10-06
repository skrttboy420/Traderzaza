"use client";

import Link from "next/link";

import { useT } from "@/i18n/provider";
import { useAuth } from "@/lib/auth";
import { cx } from "./ui";

/**
 * The account entry point: an avatar in the top bar, a labelled row in the
 * desktop sidebar.
 *
 * Both link to the same two places — /settings when there is a session (where
 * the sign-out button lives), /login when there is not. The sign-out action is
 * deliberately *not* here: see AccountPanel for why a one-tap logout does not
 * belong next to the theme toggle.
 *
 * It renders nothing at all when no database is configured. An account button
 * that can only ever show an error is worse than no button, and the app is
 * fully usable in that state (lib/store.ts keeps everything locally).
 */
export function AccountChip({ variant = "compact" }: { variant?: "compact" | "row" }) {
  const t = useT("auth");
  const { status, username } = useAuth();

  if (status === "unavailable") return null;

  const signedIn = status === "signedIn";
  const href = signedIn ? "/settings" : "/login";
  // While the stored session is still being read, show the signed-out face but
  // say nothing about it: claiming "not signed in" for one frame to someone who
  // is would be a small lie, and a spinner here would flicker on every load.
  const label = signedIn ? (username ?? "") : t("nav.signIn");
  const initial = signedIn ? (username?.slice(0, 1) ?? "?") : "◌";

  if (variant === "row") {
    return (
      <Link
        href={href}
        className="tap flex items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
      >
        <span
          aria-hidden
          className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase",
            signedIn
              ? "bg-[var(--color-limit-soft)] text-[var(--color-limit)]"
              : "bg-[var(--color-neutral-soft)] text-[var(--color-neutral)]",
          )}
        >
          {initial}
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cx(
        "flex size-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold uppercase",
        signedIn
          ? "border-[var(--color-limit)]/40 bg-[var(--color-limit-soft)] text-[var(--color-limit)]"
          : "border-[var(--color-border)] text-[var(--color-faint)]",
      )}
    >
      <span aria-hidden>{initial}</span>
    </Link>
  );
}
