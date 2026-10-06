"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useT } from "@/i18n/provider";
import { useAuth } from "@/lib/auth";
import { SectionTitle, cx } from "./ui";

/**
 * The account block on the settings screen: who you are, and the sign-out
 * button.
 *
 * Settings is where sign-out belongs rather than the top bar. It is a rare,
 * deliberate action, and a one-tap logout next to the theme and language
 * controls on a trading screen used one-handed is a mis-tap waiting to happen
 * — hence both the placement and the confirm.
 */
export function AccountPanel() {
  const t = useT("auth");
  const router = useRouter();
  const { status, username, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const signedIn = status === "signedIn";

  return (
    <section className="card p-4">
      <SectionTitle title={t("account.title")} />

      {status === "unavailable" ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          {t("account.unavailable")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className={cx(
                "flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold uppercase",
                signedIn
                  ? "bg-[var(--color-limit-soft)] text-[var(--color-limit)]"
                  : "bg-[var(--color-neutral-soft)] text-[var(--color-neutral)]",
              )}
            >
              {signedIn ? (username?.slice(0, 1) ?? "?") : "–"}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {signedIn ? t("account.signedInAs") : t("account.guest")}
              </div>
              {signedIn ? (
                <div className="truncate text-[14px] font-semibold text-[var(--color-text)]">
                  {username}
                </div>
              ) : null}
            </div>
          </div>

          <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
            {signedIn ? t("account.signedInHint") : t("account.guestHint")}
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {signedIn ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("account.signOutConfirm"))) return;
                  setBusy(true);
                  await signOut();
                  setBusy(false);
                  // Stay on settings: nothing here is account-gated, so
                  // bouncing to a login page would imply the app stopped
                  // working when it did not.
                  router.refresh();
                }}
                className="tap flex-1 rounded-lg border border-[var(--color-short)]/40 text-[12.5px] font-medium text-[var(--color-short)]"
              >
                {t("account.signOut")}
              </button>
            ) : (
              <>
                <Link
                  href="/login"
                  className="tap flex flex-1 items-center justify-center rounded-lg bg-[var(--color-limit)] text-[12.5px] font-semibold text-white"
                >
                  {t("account.signIn")}
                </Link>
                <Link
                  href="/signup"
                  className="tap flex flex-1 items-center justify-center rounded-lg border border-[var(--color-border)] text-[12.5px] font-medium text-[var(--color-muted)]"
                >
                  {t("account.signUp")}
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
