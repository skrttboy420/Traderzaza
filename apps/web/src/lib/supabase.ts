import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase browser client, plus the username/email translation that sits on
 * top of it.
 *
 * Two deliberate decisions are recorded here because neither is obvious from
 * the call sites:
 *
 * 1. **Accounts are username-only, but Supabase Auth is email-only.** The
 *    brief was explicit: sign up with a username and a password, nothing else,
 *    no verification step. Supabase has no username credential, so every
 *    account gets a synthetic address derived from its username. The mapping
 *    has to be a pure function of the username, because login computes it
 *    again from whatever the user typed — there is no lookup table to consult
 *    before the user is authenticated.
 *
 * 2. **The client is created lazily and may not exist at all.** The app is
 *    designed to work with no backend configured (see lib/store.ts), so every
 *    caller has to cope with `null` rather than assume a client. Creating it
 *    at module scope would also mean `createClient` runs during SSR, where it
 *    would try to attach a localStorage-backed session store.
 */

/**
 * Domain for synthetic addresses.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, which is the point:
 * these addresses exist only to satisfy Supabase's unique-credential column, no
 * mail is ever sent to them, and a reserved TLD guarantees that a typo can
 * never deliver one of our emails into a real stranger's inbox.
 *
 * DO NOT CHANGE THIS after accounts exist. The address is the primary
 * credential, so changing the domain orphans every existing account — they
 * would still be in auth.users, but no login form could ever produce their
 * address again.
 */
export const USERNAME_EMAIL_DOMAIN = "traderzaza.invalid";

/** Lower bound we enforce ourselves; Supabase's own default is a weak 6. */
export const PASSWORD_MIN_LENGTH = 8;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

/**
 * Usernames are case-insensitive.
 *
 * Normalising on the way in is what makes that true: "Poom" and "poom" have to
 * resolve to one address or the same person gets two accounts depending on how
 * their keyboard felt that morning.
 */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase();
}

export type UsernameProblem = "empty" | "tooShort" | "tooLong" | "charset" | "start";

/**
 * Validate a username, returning the specific problem rather than a boolean so
 * the form can show the user which rule they broke.
 *
 * The charset is narrow on purpose. It has to survive being spliced into an
 * email address, so anything that needs quoting in the local part of an
 * address is out, and so is a leading digit (which reads as an id, not a name).
 */
export function usernameProblem(input: string): UsernameProblem | null {
  const name = normaliseUsername(input);
  if (name.length === 0) return "empty";
  if (name.length < USERNAME_MIN_LENGTH) return "tooShort";
  if (name.length > USERNAME_MAX_LENGTH) return "tooLong";
  if (!/^[a-z0-9._-]+$/.test(name)) return "charset";
  if (!/^[a-z]/.test(name)) return "start";
  return null;
}

/** `poom` -> `poom@traderzaza.invalid`. Pure, and must stay pure. */
export function usernameToEmail(username: string): string {
  return `${normaliseUsername(username)}@${USERNAME_EMAIL_DOMAIN}`;
}

/** The inverse, for displaying the signed-in account. */
export function emailToUsername(email: string | undefined | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local) return null;
  return domain === USERNAME_EMAIL_DOMAIN ? local : email;
}

/**
 * Let the login field take an address as well as a username.
 *
 * Sign-up is username-only as asked, but an account created any other way (a
 * seeded admin, or a future real-email signup) still has to be able to get in,
 * and the cost of allowing it is one `includes("@")`.
 */
export function loginIdentifierToEmail(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : usernameToEmail(trimmed);
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Both values are NEXT_PUBLIC_ by design — they are inlined into the browser
 * bundle and are not secrets. Row Level Security is what protects the data
 * (§77); see supabase/migrations/0001_init.sql.
 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let cached: SupabaseClient | null = null;

/**
 * The one browser client for the whole app.
 *
 * A singleton because each client installs its own `onAuthStateChange`
 * listener and its own token-refresh timer; two of them racing to refresh the
 * same stored session is a known way to get randomly signed out.
 */
export function supabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;

  const config = supabaseConfig();
  if (!config) return null;

  cached = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Nothing in this app authenticates by redirect (no OAuth, no magic
      // link), so there is never a token in the URL to detect. Leaving it on
      // would make every page load parse the hash for credentials it will
      // never find.
      detectSessionInUrl: false,
      storageKey: "atc.auth",
    },
  });
  return cached;
}
