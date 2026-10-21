/**
 * Mutation-injection proof: evidence that a test actually tests something.
 *
 * The repo's rule is that a guard is only believed once the bug it claims to
 * catch has been injected and the named assertion has been watched to fail.
 * Doing that by hand is tedious enough that it quietly stops happening, and a
 * suite of tests nobody has falsified is a suite of tests that pass.
 *
 * Usage:
 *   node scripts/mutate.mjs <source> <test> <plan.json>
 *
 * A plan is a list of `{ name, expect, edit: [find, replace] }`. Each entry is
 * applied to the source on its own, the test file is run, the source is
 * restored, and the failing test is compared against `expect`.
 *
 * Three outcomes, and only the first is acceptable:
 *   caught   the expected test failed
 *   WRONG    something else failed first — either the label or the test is off
 *   VACUOUS  nothing failed, so nothing was guarding that line
 *
 * Both test styles in this repo are handled. `node:test` names its failures
 * (`✖ name`); the hand-rolled harness in packages/* fails fast and only
 * prints successes, so the broken test is inferred as the one after the last
 * `ok` line, using a clean run to establish the order.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [, , sourcePath, testPath, planPath] = process.argv;
if (!sourcePath || !testPath || !planPath) {
  console.error("usage: node scripts/mutate.mjs <source> <test> <plan.json>");
  process.exit(2);
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const original = readFileSync(sourcePath, "utf8");

const okNames = (output) => [...output.matchAll(/^ {2}ok (.+)$/gm)].map((m) => m[1]);
const failedNames = (output) => [...output.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);

function runTests() {
  try {
    const stdout = execFileSync("npx", ["tsx", testPath], {
      encoding: "utf8",
      shell: true,
      stdio: "pipe",
      // An unbounded loop is a failure too, and without this it is a hang.
      timeout: 60_000,
    });
    // The hand-rolled harness exits 0 on failure unless the footer is missing,
    // so a run that never reached its own summary counts as failed.
    const incomplete = okNames(stdout).length > 0 && !/guards passed/.test(stdout);
    return { output: stdout, failed: incomplete || failedNames(stdout).length > 0 };
  } catch (error) {
    return { output: `${error.stdout ?? ""}${error.stderr ?? ""}`, failed: true };
  }
}

const clean = runTests();
if (clean.failed) {
  console.error("the suite does not pass before any mutation — fix that first");
  process.exit(2);
}
const order = okNames(clean.output);
console.log(`baseline passes${order.length ? ` (${order.length} tests)` : ""}\n`);

let allCaught = true;

for (const mutation of plan) {
  const [find, replace] = mutation.edit;
  if (!original.includes(find)) {
    console.log(`SKIP     ${mutation.name}\n         anchor no longer in the source`);
    allCaught = false;
    continue;
  }

  writeFileSync(sourcePath, original.replace(find, replace));
  const { output, failed } = runTests();
  writeFileSync(sourcePath, original);

  if (!failed) {
    console.log(`VACUOUS  ${mutation.name}\n         nothing failed — this line is unguarded`);
    allCaught = false;
    continue;
  }

  const named = failedNames(output);
  const broke = named.length > 0 ? named : [order[okNames(output).length] ?? "(crashed before a named test)"];
  const hit = broke.some((name) => name.includes(mutation.expect));
  console.log(`${hit ? "caught  " : "WRONG   "} ${mutation.name}`);
  console.log(`         broke: ${[...new Set(broke)].join(" | ")}`);
  if (!hit) allCaught = false;
}

console.log(allCaught ? "\nevery mutation was caught by the test that claims to catch it" : "\nSOME MUTATIONS NOT CAUGHT");
process.exit(allCaught ? 0 : 1);
