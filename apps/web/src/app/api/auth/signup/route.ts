import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";
import { PASSWORD_MIN_LENGTH, usernameProblem, usernameToEmail } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup  { username, password }
 *
 * Creates an account with no verification step, as asked: a username, a
 * password, and you are in.
 *
 * It has to be a server route rather than a `supabase.auth.signUp()` call from
 * the browser, for one concrete reason. Accounts here have no real email
 * address — the credential is `<username>@traderzaza.invalid` (see
 * lib/supabase.ts) — so if the project has "Confirm email" enabled, an
 * ordinary signup creates an unusable account: Supabase holds the session back
 * until a confirmation link is clicked, and that link is posted to a domain
 * that cannot exist. The admin endpoint used below takes `email_confirm: true`,
 * which marks the address confirmed without sending anything.
 *
 * The service-role key therefore does two jobs here, and both are the reason
 * this cannot move to the client: it bypasses that confirmation requirement,
 * and it bypasses Supabase's per-project email send limit (which an ordinary
 * signup burns even though no human will ever read the mail).
 *
 * The key is read through serverEnv() and never leaves this module. The
 * response is a status and an error code — never a token, never a user record.
 */

interface SignupBody {
  username?: unknown;
  password?: unknown;
}

/** Shape shared with lib/auth.tsx: `fallback` means "try it from the client". */
function fail(
  status: number,
  code: string,
  options: { detail?: string; fallback?: boolean } = {},
) {
  return NextResponse.json(
    { ok: false, code, detail: options.detail, fallback: options.fallback ?? false },
    { status },
  );
}

export async function POST(request: Request) {
  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return fail(400, "usernameInvalid");
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Validated again on the server even though the form checks first: the form
  // is a convenience, this is the boundary.
  if (usernameProblem(username)) return fail(400, "usernameInvalid");
  if (password.length < PASSWORD_MIN_LENGTH) return fail(400, "weakPassword");

  const env = serverEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return fail(503, "notConfigured");
  }
  if (!env.supabaseServiceKey) {
    // Not an error the user can fix, and not necessarily fatal — a project
    // with email confirmation switched off can sign up straight from the
    // browser. Hand it back and let the client try that path.
    return fail(503, "needsConfirmation", {
      detail:
        "SUPABASE_SERVICE_ROLE_KEY is not set, so the server cannot create a pre-confirmed account. Either set it, or disable 'Confirm email' in the Supabase project's auth settings.",
      fallback: true,
    });
  }

  // A fresh client per request, with the session machinery switched off. This
  // one holds the service-role key: it must never persist a session, refresh a
  // token, or be reused across requests where it could pick one up.
  const admin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    // The whole point of the route: confirmed on creation, no mail sent.
    email_confirm: true,
    user_metadata: { username },
  });

  if (error) {
    const code = error.code ?? "";
    if (code === "email_exists" || code === "user_already_exists") {
      return fail(409, "usernameTaken");
    }
    if (code === "weak_password") return fail(400, "weakPassword");
    if (code === "email_address_invalid") {
      // The address was generated from a username we already validated, so
      // this is the project rejecting our synthetic domain, not bad input.
      return fail(500, "unknown", {
        detail: `Supabase rejected the generated address for "${username}". The synthetic email domain in lib/supabase.ts needs to be one this project accepts.`,
      });
    }
    return fail(500, "unknown", { detail: error.message });
  }

  // No session in the response on purpose. Minting one here would mean
  // shipping tokens back through our own route and storing them by hand; the
  // client signs in with the credentials it already has instead, which is one
  // code path for "log in" rather than two.
  return NextResponse.json({ ok: true });
}
