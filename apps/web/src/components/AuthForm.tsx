"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { useT } from "@/i18n/provider";
import { useAuth, type AuthError } from "@/lib/auth";
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameProblem,
} from "@/lib/supabase";
import { TopBar } from "./TopBar";
import { cx } from "./ui";

/**
 * One form for both /login and /signup.
 *
 * They differ by a confirm-password field and which function gets called, so
 * two separate components would mean maintaining two copies of the field
 * markup, the busy state, the error rendering and the keyboard behaviour — and
 * in practice the second copy is the one that drifts.
 */
export function AuthForm({ mode }: { mode: "signIn" | "signUp" }) {
  const t = useT("auth");
  const router = useRouter();
  const { signIn, signUp, status, configured } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const usernameFieldId = useId();
  const passwordFieldId = useId();
  const confirmFieldId = useId();

  const isSignUp = mode === "signUp";

  // Someone who is already signed in has no business on a login form. Done in
  // an effect rather than during render because redirecting while rendering is
  // what produces the "cannot update a component while rendering" warning.
  useEffect(() => {
    if (status === "signedIn") router.replace("/settings");
  }, [status, router]);

  const ready =
    username.trim().length > 0 &&
    password.length > 0 &&
    (!isSignUp || confirm.length > 0) &&
    !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (isSignUp) {
      // Checked before the network call so the obvious mistakes answer
      // instantly and do not consume a rate-limited request.
      if (usernameProblem(username)) {
        setError({ code: "usernameInvalid" });
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        setError({ code: "weakPassword" });
        return;
      }
      if (password !== confirm) {
        setError({ code: "passwordMismatch" });
        return;
      }
    }

    setBusy(true);
    setError(null);
    const failure = isSignUp ? await signUp(username, password) : await signIn(username, password);
    setBusy(false);

    if (failure) {
      setError(failure);
      // Keep the username — retyping it is pure friction when the password was
      // the thing that was wrong.
      setPassword("");
      setConfirm("");
      return;
    }
    router.replace("/settings");
  }

  return (
    <>
      <TopBar title={t(`${mode}.title`)} subtitle={t(`${mode}.subtitle`)} />

      <main className="mx-auto w-full max-w-md space-y-4 p-4">
        {!configured ? (
          <p className="card p-4 text-[12.5px] leading-relaxed text-[var(--color-wait)]">
            {t("error.notConfigured")}
          </p>
        ) : null}

        <form onSubmit={submit} className="card space-y-3 p-4">
          <div>
            <label
              htmlFor={usernameFieldId}
              className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]"
            >
              {t("field.username")}
            </label>
            <input
              id={usernameFieldId}
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("field.usernamePlaceholder")}
              // The username is lowercased on the way in anyway, so the mobile
              // keyboard should not offer a capital or try to correct it into a
              // dictionary word.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              maxLength={USERNAME_MAX_LENGTH}
              required
            />
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label
                htmlFor={passwordFieldId}
                className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]"
              >
                {t("field.password")}
              </label>
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="text-[11px] font-medium text-[var(--color-limit)]"
              >
                {reveal ? t("field.hide") : t("field.show")}
              </button>
            </div>
            <input
              id={passwordFieldId}
              className="input"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
            />
          </div>

          {isSignUp ? (
            <div>
              <label
                htmlFor={confirmFieldId}
                className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--color-faint)]"
              >
                {t("field.passwordConfirm")}
              </label>
              <input
                id={confirmFieldId}
                className="input"
                type={reveal ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          ) : null}

          {error ? (
            // role="alert" so a screen reader announces the failure instead of
            // leaving the user wondering why the button did nothing.
            <p
              role="alert"
              className="rounded-lg border border-[var(--color-short)]/40 bg-[var(--color-short-soft)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-short)]"
            >
              {t(`error.${error.code}`)}
              {error.code === "unknown" && error.detail ? (
                <span className="mt-1 block text-[11px] text-[var(--color-muted)]">
                  {error.detail}
                </span>
              ) : null}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!ready}
            className={cx(
              "tap w-full rounded-lg text-[13.5px] font-semibold transition-opacity",
              ready
                ? "bg-[var(--color-limit)] text-white"
                : "cursor-not-allowed bg-[var(--color-surface-3)] text-[var(--color-faint)]",
            )}
          >
            {busy ? t(`${mode}.working`) : t(`${mode}.submit`)}
          </button>

          {isSignUp ? (
            <ul className="space-y-1 pt-1 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
              <li>
                {t("rules.username", {
                  min: USERNAME_MIN_LENGTH,
                  max: USERNAME_MAX_LENGTH,
                })}
              </li>
              <li>{t("rules.password", { min: PASSWORD_MIN_LENGTH })}</li>
              {/* Said out loud because it is a genuine consequence of the
                  no-email design, not a detail to discover during a lockout. */}
              <li className="text-[var(--color-wait)]">{t("rules.noEmail")}</li>
            </ul>
          ) : null}
        </form>

        <p className="text-center text-[12.5px] text-[var(--color-muted)]">
          {t(`${mode}.switchPrompt`)}{" "}
          <Link
            href={isSignUp ? "/login" : "/signup"}
            className="font-semibold text-[var(--color-limit)]"
          >
            {t(`${mode}.switchCta`)}
          </Link>
        </p>

        <p className="text-center text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          {t("optional")}
        </p>
      </main>
    </>
  );
}
