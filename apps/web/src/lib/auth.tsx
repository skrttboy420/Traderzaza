"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import {
  PASSWORD_MIN_LENGTH,
  emailToUsername,
  loginIdentifierToEmail,
  normaliseUsername,
  supabaseBrowser,
  supabaseConfig,
  usernameProblem,
  usernameToEmail,
} from "./supabase";

/**
 * Session state for the whole app.
 *
 * Signing in is optional, not a gate. Everything on every screen works without
 * an account — settings, journal and rules fall back to localStorage (see
 * lib/store.ts) — so this provider's job is to answer "is someone signed in,
 * and what are they called", never to block rendering. A login wall would be a
 * regression: the analysis does not need to know who is looking at it.
 *
 * Which also means there is deliberately no middleware and no cookie-based
 * server session. Nothing is rendered on the server per-user yet, so paying
 * for a cookie round-trip on every request would buy nothing. When journal
 * sync lands and a server component needs the user, that is the moment to add
 * @supabase/ssr — not before.
 */

/**
 * Why a sign-up or sign-in attempt failed, in terms the UI can translate.
 *
 * Mapped from Supabase's `error_code` rather than passed through as a message:
 * the raw strings are English-only, and §61 says every word the user reads is
 * translated. `unknown` carries the original text so a surprise is still
 * debuggable instead of silently swallowed.
 */
export type AuthErrorCode =
  | "notConfigured"
  | "invalidCredentials"
  | "usernameTaken"
  | "weakPassword"
  | "usernameInvalid"
  | "passwordMismatch"
  | "rateLimited"
  | "needsConfirmation"
  | "signupDisabled"
  | "offline"
  | "unknown";

export interface AuthError {
  code: AuthErrorCode;
  /** The provider's own wording, for the console and for `unknown`. */
  detail?: string;
}

export type AuthStatus = "loading" | "signedIn" | "signedOut" | "unavailable";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** The display name: user metadata first, then the synthetic address. */
  username: string | null;
  /** False when NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are absent. */
  configured: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthError | null>;
  signUp: (username: string, password: string) => Promise<AuthError | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function usernameOf(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata?.["username"];
  if (typeof meta === "string" && meta.length > 0) return meta;
  return emailToUsername(user.email);
}

/** Supabase error -> our code. The string codes are the stable part of its API. */
function classify(code: string | undefined, message: string): AuthError {
  switch (code) {
    case "invalid_credentials":
    case "invalid_grant":
      return { code: "invalidCredentials", detail: message };
    case "user_already_exists":
    case "email_exists":
      return { code: "usernameTaken", detail: message };
    case "weak_password":
      return { code: "weakPassword", detail: message };
    case "email_address_invalid":
      // The address is ours, not the user's — they only ever typed a username,
      // so this is a configuration problem and must not be reported as "your
      // username is bad".
      return { code: "unknown", detail: message };
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return { code: "rateLimited", detail: message };
    case "email_not_confirmed":
      return { code: "needsConfirmation", detail: message };
    case "signup_disabled":
      return { code: "signupDisabled", detail: message };
    default:
      return { code: "unknown", detail: message };
  }
}

/**
 * Whether accounts exist on this installation.
 *
 * Read at module scope, and from the config rather than from the client,
 * because both NEXT_PUBLIC_ values are inlined at build time and are therefore
 * identical on the server and in the browser. That is what makes it safe to
 * use as the initial state: deriving it from `supabaseBrowser()` instead would
 * give `false` during SSR and `true` on hydration, and the account controls
 * would mismatch on every single page load.
 */
const CONFIGURED = supabaseConfig() !== null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(CONFIGURED ? "loading" : "unavailable");

  useEffect(() => {
    // Only obtainable in the browser, so it is fetched here rather than during
    // render. When it is null the initial state already says "unavailable" —
    // there is nothing to correct.
    const client = supabaseBrowser();
    if (!client) return;

    let cancelled = false;

    // getSession() reads the stored token without a network round-trip, so the
    // signed-in state settles in the same tick the page becomes interactive.
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setStatus(data.session ? "signedIn" : "signedOut");
    });

    // Covers the refresh timer, sign-out in another tab, and a token that
    // expired while the laptop was asleep — all of which have to move the UI,
    // not just the stored token.
    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? "signedIn" : "signedOut");
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (identifier, password) => {
      // supabaseBrowser() is a cached singleton, so asking for it per call is
      // free and keeps the client out of render state entirely.
      const client = supabaseBrowser();
      if (!client) return { code: "notConfigured" };
      try {
        const { error } = await client.auth.signInWithPassword({
          email: loginIdentifierToEmail(identifier),
          password,
        });
        if (error) return classify(error.code, error.message);
        return null;
      } catch (cause) {
        return { code: "offline", detail: cause instanceof Error ? cause.message : undefined };
      }
    },
    [],
  );

  /**
   * Create an account, preferring the server route.
   *
   * The route uses the service-role key to create the user already confirmed,
   * which is the only way to honour "no verification step" on a project that
   * has email confirmation switched on — and it sends no mail, so it is not
   * subject to Supabase's built-in email rate limit either.
   *
   * When that key is absent the route says so and we fall back to the ordinary
   * client-side signup, which works if confirmation is disabled in the project
   * instead. Two doors to the same room: whichever one the project is set up
   * for, signup works, and if neither is, the user gets a specific reason
   * rather than a dead button.
   */
  const signUp = useCallback<AuthContextValue["signUp"]>(
    async (rawUsername, password) => {
      const client = supabaseBrowser();
      if (!client) return { code: "notConfigured" };

      const username = normaliseUsername(rawUsername);
      if (usernameProblem(username)) return { code: "usernameInvalid" };
      if (password.length < PASSWORD_MIN_LENGTH) return { code: "weakPassword" };

      let fallbackReason: AuthError | null = null;
      try {
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          code?: AuthErrorCode;
          detail?: string;
          /** Set when the route cannot act and the client should try itself. */
          fallback?: boolean;
        };

        if (response.ok && payload.ok) {
          // Created and confirmed server-side; sign in with the same
          // credentials so the user lands logged in rather than on a form.
          return await signIn(username, password);
        }
        if (!payload.fallback) {
          return { code: payload.code ?? "unknown", detail: payload.detail };
        }
        fallbackReason = { code: payload.code ?? "unknown", detail: payload.detail };
      } catch (cause) {
        fallbackReason = {
          code: "offline",
          detail: cause instanceof Error ? cause.message : undefined,
        };
      }

      try {
        const { data, error } = await client.auth.signUp({
          email: usernameToEmail(username),
          password,
          options: { data: { username } },
        });
        if (error) return classify(error.code, error.message);
        // No session means the project still wants a confirmation click, which
        // we cannot deliver to a .invalid address. Report the server route's
        // reason instead — the fix is the service-role key, not the password.
        if (!data.session) return fallbackReason ?? { code: "needsConfirmation" };
        return null;
      } catch (cause) {
        return { code: "offline", detail: cause instanceof Error ? cause.message : undefined };
      }
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    const client = supabaseBrowser();
    if (!client) return;
    await client.auth.signOut();
    // onAuthStateChange will fire, but setting it here too means the button
    // feels instant even if the network call is slow to come back.
    setSession(null);
    setStatus("signedOut");
  }, []);

  const user = session?.user ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      username: usernameOf(user),
      configured: CONFIGURED,
      signIn,
      signUp,
      signOut,
    }),
    [status, user, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
