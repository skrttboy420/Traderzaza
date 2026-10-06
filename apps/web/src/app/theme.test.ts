import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Contrast guard for the two themes.
 *
 * The brief for light mode was blunt: a light theme you cannot read is worse
 * than no light theme. That is not something a typecheck or a screenshot can
 * hold onto — a screenshot proves it was right once, and the next person to
 * nudge a hex has no way of knowing they broke it. So the rule is written
 * down here and measured.
 *
 * This parses globals.css rather than importing a TS palette, because the CSS
 * custom properties *are* the palette: components reference them directly and
 * the canvas reads them back with getComputedStyle. Testing anything else
 * would be testing a copy.
 */

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

type Palette = Record<string, string>;

/**
 * Pull the custom properties out of one block.
 *
 * Deliberately naive: it finds the opening token, walks to the matching close
 * brace, and reads `--name: value;` pairs. The file is ours and small, so a
 * real CSS parser would be a dependency bought to solve a problem we do not
 * have — but the test asserts it found a plausible number of tokens, so a
 * silent mismatch shows up as a failure rather than a vacuous pass.
 */
function block(opener: string): Palette {
  const start = CSS.indexOf(opener);
  assert.notEqual(start, -1, `globals.css no longer contains a '${opener}' block`);

  let depth = 0;
  let end = start;
  for (let i = CSS.indexOf("{", start); i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    else if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const palette: Palette = {};
  for (const match of CSS.slice(start, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) palette[name] = value.trim();
  }
  return palette;
}

const dark = block("@theme {");
const light = block('html[data-theme="light"] {');

/** sRGB channels from `#rgb`, `#rrggbb`, or `rgba(r, g, b, a)`. */
function channels(value: string): [number, number, number] {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const parts = hex.length === 3 ? [...hex].map((c) => c + c) : (hex.match(/../g) ?? []);
    const [r, g, b] = parts.map((p) => parseInt(p, 16));
    assert.ok(
      r !== undefined && g !== undefined && b !== undefined,
      `cannot parse colour ${value}`,
    );
    return [r, g, b];
  }
  const numbers = value.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const [r, g, b] = numbers;
  assert.ok(r !== undefined && g !== undefined && b !== undefined, `cannot parse colour ${value}`);
  return [r, g, b];
}

/**
 * WCAG 2.1 relative luminance.
 *
 * Alpha is ignored, so a translucent fill is measured as if it were opaque.
 * That is the right direction to be wrong in: the zone fills are the only
 * translucent tokens, they are drawn over the chart background, and treating
 * them as opaque reports a *harsher* number than reality. A pass here is a
 * pass on screen.
 */
function luminance(value: string): number {
  const srgb = channels(value).map((c) => {
    const channel = c / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = srgb as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Light overrides the dark defaults, so a light token falls back to dark. */
function resolve(palette: Palette, token: string): string {
  const value = palette[token] ?? dark[token];
  assert.ok(value, `token ${token} is defined in neither theme`);
  return value;
}

const THEMES: [string, Palette][] = [
  ["dark", dark],
  ["light", light],
];

/** WCAG AA for body text. Everything here is small text, so 4.5 it is. */
const TEXT_MIN = 4.5;
/** WCAG AA for a graphical object that carries meaning. */
const GRAPHIC_MIN = 3;

test("both themes define exactly the same tokens", () => {
  // The failure this catches is a token added to one theme and forgotten in
  // the other, which does not error anywhere — it just inherits the dark value
  // and shows up as an invisible element on a white page.
  const darkTokens = Object.keys(dark).filter((t) => t.startsWith("--color-") || t.startsWith("--chart-"));
  const lightTokens = Object.keys(light);

  assert.ok(darkTokens.length > 20, `only found ${darkTokens.length} dark tokens; did the parser break?`);
  assert.deepEqual(
    darkTokens.filter((t) => !lightTokens.includes(t)),
    [],
    "tokens missing a light-theme override",
  );
  assert.deepEqual(
    lightTokens.filter((t) => !darkTokens.includes(t) && t !== "color-scheme"),
    [],
    "light theme overrides a token the default theme never defines",
  );
});

/**
 * Every background a foreground token can land on.
 *
 * All four, for every ink, rather than the pairings that happen to exist in
 * today's components: `faint` is on the page in one screen and inside a nested
 * card in the next, and a token that is only readable where it is currently
 * used is a trap for whoever reaches for it next.
 */
const SURFACES = ["--color-bg", "--color-surface", "--color-surface-2", "--color-surface-3"];

test("text tokens are readable on every surface they are drawn on", () => {
  // --color-neutral is absent on purpose: grep says it is never a text colour,
  // only a left-border accent, a score bar and a status dot. It is held to the
  // graphical bar in the test below instead. If that ever changes and it is
  // used for type, move it here — do not lower the threshold.
  const inks = [
    "--color-text",
    "--color-muted",
    "--color-faint",
    "--color-long",
    "--color-long-dim",
    "--color-short",
    "--color-wait",
    "--color-limit",
  ];

  const failures: string[] = [];
  for (const [name, palette] of THEMES) {
    for (const ink of inks) {
      for (const surface of SURFACES) {
        const value = contrast(resolve(palette, ink), resolve(palette, surface));
        if (value < TEXT_MIN) {
          failures.push(`${name}: ${ink} on ${surface} is ${value.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `text below ${TEXT_MIN}:1:\n${failures.join("\n")}`);
});

test("non-text tokens still carry their meaning on every surface", () => {
  // A status dot the user cannot see is a state the user cannot read, and
  // colour is never the only cue (§79) but it is still one of them.
  const failures: string[] = [];
  for (const [name, palette] of THEMES) {
    for (const surface of SURFACES) {
      const value = contrast(resolve(palette, "--color-neutral"), resolve(palette, surface));
      if (value < GRAPHIC_MIN) {
        failures.push(`${name}: --color-neutral on ${surface} is ${value.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `graphics below ${GRAPHIC_MIN}:1:\n${failures.join("\n")}`);
});

test("a semantic colour is readable on its own soft background", () => {
  // The badge pattern: `text-[var(--color-wait)]` over `bg-[var(--color-wait-soft)]`.
  // In the dark theme the soft variant is a deep tint and in the light theme a
  // pale one, so this pairing has to be checked per theme rather than assumed.
  // `neutral` is again the exception: its soft variant backs a muted-text
  // panel, never neutral-on-neutral text.
  const pairs = ["long", "short", "wait", "limit"];

  const failures: string[] = [];
  for (const [name, palette] of THEMES) {
    for (const pair of pairs) {
      const value = contrast(resolve(palette, `--color-${pair}`), resolve(palette, `--color-${pair}-soft`));
      if (value < TEXT_MIN) failures.push(`${name}: --color-${pair} on its soft bg is ${value.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `badge text below ${TEXT_MIN}:1:\n${failures.join("\n")}`);
});

test("chart marks stand out against the chart background", () => {
  // Candles, price lines and markers are graphical objects rather than text,
  // so the bar is 3:1 — except --chart-text, which really is text on an axis.
  // --chart-grid is excluded on purpose: a gridline that met 3:1 would be
  // shouting over the price action it exists to sit behind.
  const marks = [
    "--chart-up",
    "--chart-down",
    "--chart-entry",
    "--chart-stop",
    "--chart-target",
    "--chart-swing",
    "--chart-invalid",
    "--chart-demand-line",
    "--chart-supply-line",
  ];

  const failures: string[] = [];
  for (const [name, palette] of THEMES) {
    const background = resolve(palette, "--chart-bg");

    const axis = contrast(resolve(palette, "--chart-text"), background);
    if (axis < TEXT_MIN) failures.push(`${name}: --chart-text is ${axis.toFixed(2)}:1`);

    for (const mark of marks) {
      const value = contrast(resolve(palette, mark), background);
      if (value < GRAPHIC_MIN) failures.push(`${name}: ${mark} is ${value.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `chart marks below threshold:\n${failures.join("\n")}`);
});

test("the chart background matches the page it is embedded in", () => {
  // Not a contrast rule — a consistency one. The chart is a canvas sitting
  // inside a card, and the moment --chart-bg and --color-surface drift apart
  // the chart reads as a misaligned rectangle pasted onto the page.
  for (const [name, palette] of THEMES) {
    const difference = contrast(resolve(palette, "--chart-bg"), resolve(palette, "--color-surface"));
    assert.ok(
      difference < 1.2,
      `${name}: --chart-bg and --color-surface differ by ${difference.toFixed(2)}:1; the canvas will look pasted on`,
    );
  }
});

process.stdout.write("\ntheme.test.ts: contrast guards passed\n");
