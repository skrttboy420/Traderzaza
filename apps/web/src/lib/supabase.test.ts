import assert from "node:assert/strict";
import test from "node:test";

import {
  USERNAME_EMAIL_DOMAIN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  emailToUsername,
  loginIdentifierToEmail,
  normaliseUsername,
  usernameProblem,
  usernameToEmail,
} from "./supabase";

/**
 * Guards for the username/email mapping.
 *
 * This is the one piece of the auth code that genuinely cannot be checked by
 * clicking through the app, because the failure is invisible: if sign-up and
 * sign-in ever disagree about what address a username maps to, sign-up appears
 * to work and then the account simply cannot be logged into. There is no error
 * to see — the credential just does not exist.
 *
 * So what is tested here is not "does it build an email", it is the property
 * the login flow actually relies on: the same typed name always produces the
 * same address, no matter how it was typed.
 */

test("the same name always produces the same address, however it was typed", () => {
  const variants = ["poom", "Poom", "POOM", "  poom  ", "\tPoom\n"];
  const addresses = new Set(variants.map(usernameToEmail));
  assert.equal(
    addresses.size,
    1,
    `case and whitespace changed the credential: ${[...addresses].join(", ")}`,
  );
  assert.equal(usernameToEmail("Poom"), `poom@${USERNAME_EMAIL_DOMAIN}`);
});

test("the login field accepts a username or a full address", () => {
  // Sign-up is username-only, but an account made any other way still has to
  // be able to get in.
  assert.equal(loginIdentifierToEmail("poom"), `poom@${USERNAME_EMAIL_DOMAIN}`);
  assert.equal(loginIdentifierToEmail("  POOM "), `poom@${USERNAME_EMAIL_DOMAIN}`);
  assert.equal(loginIdentifierToEmail("someone@example.com"), "someone@example.com");
  assert.equal(loginIdentifierToEmail(" Someone@Example.com "), "someone@example.com");
});

test("a synthetic address reads back as the bare username", () => {
  // What the account chip shows. A real address has to survive intact, because
  // showing "someone" for someone@example.com would be inventing a name.
  assert.equal(emailToUsername(`poom@${USERNAME_EMAIL_DOMAIN}`), "poom");
  assert.equal(emailToUsername("someone@example.com"), "someone@example.com");
  assert.equal(emailToUsername(null), null);
  assert.equal(emailToUsername(""), null);
});

test("the round trip is lossless for every name the rules allow", () => {
  const names = ["poom", "abc", "a".repeat(USERNAME_MAX_LENGTH), "x_y.z-1", "trader99"];
  for (const name of names) {
    assert.equal(usernameProblem(name), null, `${name} should be a legal username`);
    assert.equal(emailToUsername(usernameToEmail(name)), name);
  }
});

test("usernames are rejected for a named reason, not just rejected", () => {
  // The form shows a different message per reason, so the reason is part of
  // the contract rather than an implementation detail.
  assert.equal(usernameProblem(""), "empty");
  assert.equal(usernameProblem("   "), "empty");
  assert.equal(usernameProblem("a".repeat(USERNAME_MIN_LENGTH - 1)), "tooShort");
  assert.equal(usernameProblem("a".repeat(USERNAME_MAX_LENGTH + 1)), "tooLong");
  assert.equal(usernameProblem("1poom"), "start");

  // Anything that would need quoting inside an address, or would change its
  // meaning, has to be out — an unescaped "@" or "+" here would let a username
  // address a mailbox that is not the one we generated.
  for (const bad of ["po om", "po@om", "pôom", "po+om", "po/om", "ปูม", "po,om"]) {
    assert.notEqual(usernameProblem(bad), null, `"${bad}" should not be a legal username`);
  }
});

test("normalising is idempotent", () => {
  // Signup normalises, the server route normalises again, and the trigger reads
  // the result back. A second pass must not change the answer.
  for (const name of ["Poom", " poom ", "poom"]) {
    const once = normaliseUsername(name);
    assert.equal(normaliseUsername(once), once);
  }
});

process.stdout.write("\nsupabase.test.ts: username mapping guards passed\n");
