import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LIQUIDITY_LEVELS, SESSIONS } from "@atc/engine";

import { DICTIONARIES, LOCALES, NAMESPACES, lookup, type DictionaryNode } from "./dictionaries";

/**
 * Parity guard for the two locale trees.
 *
 * `translate()` falls back to the other locale before it falls back to the key,
 * which is the right behaviour at runtime but makes a missing Thai string
 * invisible: the screen quietly renders English and nobody notices. Every
 * locale edit is therefore a pair of edits, and a pair of edits made by hand is
 * a pair of edits that eventually gets made singly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function flatten(node: DictionaryNode, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push(path);
    else out.push(...flatten(value, path));
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "").sort();
}

function stringAt(node: DictionaryNode, path: string): string {
  let current: string | DictionaryNode | undefined = node;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) break;
    current = current[part];
  }
  assert.equal(typeof current, "string", `${path} is not a string`);
  return current as string;
}

test("every namespace defines exactly the same keys in both locales", () => {
  for (const namespace of NAMESPACES) {
    const th = new Set(flatten(DICTIONARIES.th[namespace]));
    const en = new Set(flatten(DICTIONARIES.en[namespace]));

    const missingTh = [...en].filter((k) => !th.has(k)).sort();
    const missingEn = [...th].filter((k) => !en.has(k)).sort();

    assert.deepEqual(missingTh, [], `${namespace}: missing from th`);
    assert.deepEqual(missingEn, [], `${namespace}: missing from en`);
    assert.ok(th.size > 0, `${namespace} is empty`);
  }
});

test("no translation is blank", () => {
  for (const locale of LOCALES) {
    for (const namespace of NAMESPACES) {
      const dict = DICTIONARIES[locale][namespace];
      for (const path of flatten(dict)) {
        assert.ok(
          stringAt(dict, path).trim().length > 0,
          `${locale}/${namespace}.${path} is blank`,
        );
      }
    }
  }
});

test("a key interpolates the same variables in both locales", () => {
  // A translation that drops {{lang}} does not throw, it just silently stops
  // saying the thing the sentence was written to say.
  for (const namespace of NAMESPACES) {
    const th = DICTIONARIES.th[namespace];
    const en = DICTIONARIES.en[namespace];
    for (const path of flatten(th)) {
      assert.deepEqual(
        placeholders(stringAt(th, path)),
        placeholders(stringAt(en, path)),
        `${namespace}.${path}: placeholders differ between locales`,
      );
    }
  }
});

test("every placeholder is written in the form interpolate actually substitutes", () => {
  // `interpolate` replaces `{{name}}` and nothing else. A string written with
  // single braces type-checks, passes the parity test above (both locales are
  // equally wrong), and ships `{points}` to the screen as literal text. The
  // failure is invisible to every other guard here precisely because it is
  // symmetric, so it has to be checked against the substitution rule itself.
  const single = /(?<!\{)\{(\w+)\}(?!\})/;
  for (const locale of LOCALES) {
    for (const namespace of NAMESPACES) {
      const dict = DICTIONARIES[locale][namespace];
      for (const path of flatten(dict)) {
        const value = stringAt(dict, path);
        const found = single.exec(value);
        assert.equal(
          found,
          null,
          `${locale}/${namespace}.${path}: "${found?.[0]}" will never be substituted — write {{${found?.[1]}}}`,
        );
      }
    }
  }
});

test("the dictionary names every session and liquidity level the engine can emit", () => {
  // SessionStrip builds its keys as `session.name.${id}` and
  // `session.liquidity.${level}`. A key assembled at runtime is a key the
  // compiler cannot check and the parity test cannot miss, because a level
  // absent from both locales is absent symmetrically.
  for (const locale of LOCALES) {
    const trading = DICTIONARIES[locale].trading;
    for (const id of SESSIONS) {
      assert.equal(
        typeof lookup(trading, `session.name.${id}`),
        "string",
        `${locale}: session.name.${id} is missing`,
      );
    }
    for (const level of LIQUIDITY_LEVELS) {
      assert.equal(
        typeof lookup(trading, `session.liquidity.${level}`),
        "string",
        `${locale}: session.liquidity.${level} is missing`,
      );
    }
  }
});

test("the guide renders every bullet its translations define", () => {
  // GuideView holds the bullet count per section so a *missing* translation
  // shows as a visible key. The reverse is silent: a bullet written in JSON
  // past the declared count never renders at all.
  const source = readFileSync(join(HERE, "../app/guide/GuideView.tsx"), "utf8");
  const declared = [...source.matchAll(/id:\s*"(\w+)",\s*glyph:\s*"[^"]*",\s*items:\s*(\d+)/g)];
  assert.ok(declared.length >= 10, "could not read the guide's SECTIONS list");

  for (const [, id = "", count = "0"] of declared) {
    for (const locale of LOCALES) {
      const section = DICTIONARIES[locale].guide[id];
      assert.equal(typeof section, "object", `${locale}: guide.${id} is missing`);
      const items = Object.keys(section as DictionaryNode).filter((k) => /^item\d+$/.test(k));
      assert.equal(
        items.length,
        Number(count),
        `${locale}: guide.${id} has ${items.length} bullets but GuideView renders ${count}`,
      );
    }
  }
});
