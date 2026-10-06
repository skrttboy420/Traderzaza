import assert from "node:assert/strict";
import type { Setup } from "@atc/types";
import {
  analyze,
  freshnessPhrase,
  renderPhrase,
  renderPhrases,
  statusPhrase,
  trendPhrase,
} from "@atc/engine";
import { generateCandles, requireAsset } from "@atc/market-data";
import { AiAnalysisSchema, guardLanguage, parseAiAnalysis, reconcileWithEngine } from "./schema";
import { LocalExplainer, buildLocalAnalysis } from "./local";
import { analysisUserPrompt, chatSystemPrompt, teachMePrompt } from "./prompt";
import type { ChatRequest } from "./provider";
import { createAiProvider } from "./claude";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

function buildSetup(symbol = "XAUUSD"): Setup {
  const result = analyze({
    asset: requireAsset(symbol),
    candles: {
      "4h": generateCandles({ symbol, timeframe: "4h", limit: 300 }),
      "1h": generateCandles({ symbol, timeframe: "1h", limit: 300 }),
      "15m": generateCandles({ symbol, timeframe: "15m", limit: 400 }),
      "5m": generateCandles({ symbol, timeframe: "5m", limit: 400 }),
    },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
  });
  const setup = result.setups[0];
  assert.ok(setup, "the engine must always produce a setup");
  return setup;
}

const validPayload = {
  asset: "XAUUSD",
  timeframe: "15m",
  market_regime: "trending_up",
  direction: "long" as const,
  setup_status: "WAITING_CONFIRMATION",
  setup_quality: 72,
  ai_confidence: 55,
  entry_zone: { low: 2640, high: 2648 },
  confirmation_required: ["A bullish rejection candle in the zone."],
  stop_loss: 2632,
  take_profit: [2665, 2690],
  risk_reward: 2.1,
  why_enter: ["4H is bullish and this is a pullback into fresh demand."],
  why_wait: ["No confirmation candle has printed yet."],
  invalidation: ["A close below 2632 ends the idea."],
  facts: ["15m: swing sequence HL -> HH."],
  interpretation: ["Buyers are expected to defend the origin of the last impulse."],
  assumptions: ["Assumes the 4H direction holds."],
};

test("the structured schema matches the required contract", () => {
  const parsed = AiAnalysisSchema.safeParse(validPayload);
  assert.equal(parsed.success, true);
  assert.deepEqual(
    Object.keys(AiAnalysisSchema.shape).sort(),
    [
      "ai_confidence",
      "asset",
      "assumptions",
      "confirmation_required",
      "direction",
      "entry_zone",
      "facts",
      "interpretation",
      "invalidation",
      "market_regime",
      "risk_reward",
      "setup_quality",
      "setup_status",
      "stop_loss",
      "take_profit",
      "timeframe",
      "why_enter",
      "why_wait",
    ],
  );
});

test("out-of-range scores are rejected", () => {
  assert.equal(AiAnalysisSchema.safeParse({ ...validPayload, setup_quality: 140 }).success, false);
  assert.equal(AiAnalysisSchema.safeParse({ ...validPayload, ai_confidence: -1 }).success, false);
  assert.equal(AiAnalysisSchema.safeParse({ ...validPayload, direction: "maybe" }).success, false);
});

test("JSON wrapped in prose or code fences still parses", () => {
  const fenced = "Here is the analysis:\n```json\n" + JSON.stringify(validPayload) + "\n```\nHope that helps.";
  const result = parseAiAnalysis(fenced);
  assert.equal(result.error, null);
  assert.equal(result.analysis?.asset, "XAUUSD");

  const bare = `Sure thing. ${JSON.stringify(validPayload)}`;
  assert.ok(parseAiAnalysis(bare).analysis);
});

test("malformed or incomplete model output is rejected, not patched", () => {
  assert.equal(parseAiAnalysis("I think you should buy gold.").analysis, null);
  assert.equal(parseAiAnalysis("{ not json }").analysis, null);

  const missing = { ...validPayload } as Record<string, unknown>;
  delete missing.invalidation;
  const result = parseAiAnalysis(JSON.stringify(missing));
  assert.equal(result.analysis, null);
  assert.ok(result.error?.includes("invalidation"));
});

test("guaranteed-outcome language is blocked in both languages", () => {
  const english = parseAiAnalysis(
    JSON.stringify({ ...validPayload, why_enter: ["This is a safe trade with a guaranteed win."] }),
  );
  assert.equal(english.analysis, null);
  assert.ok(english.error?.includes("banned language"));

  const thai = parseAiAnalysis(JSON.stringify({ ...validPayload, interpretation: ["เซ็ตอัพนี้การันตีกำไร"] }));
  assert.equal(thai.analysis, null);

  const probability = guardLanguage({
    ...validPayload,
    facts: ["Setup quality is the win probability of this trade."],
  });
  assert.equal(probability.ok, false);
  assert.ok(probability.violations.includes("win probability"));
});

test("clean output passes the language guard", () => {
  assert.equal(guardLanguage(validPayload).ok, true);
});

test("engine numbers always overwrite model numbers", () => {
  const setup = buildSetup();
  const tampered = { ...validPayload, setup_quality: 99, stop_loss: 1, risk_reward: 12, ai_confidence: 99 };
  const reconciled = reconcileWithEngine(tampered, setup, "en");

  assert.equal(reconciled.setup_quality, setup.quality.score);
  assert.equal(reconciled.ai_confidence, setup.aiConfidence);
  assert.equal(reconciled.asset, setup.symbol);
  assert.equal(reconciled.direction, setup.direction);
  assert.equal(reconciled.setup_status, setup.status);
  assert.deepEqual(reconciled.confirmation_required, renderPhrases(setup.confirmationRequired, "en"));

  const plan = setup.plans.find((p) => p.name === "Balanced") ?? setup.plans[0];
  assert.equal(reconciled.stop_loss, plan?.stopLoss ?? 0);
  assert.equal(reconciled.risk_reward, plan?.riskReward ?? 0);
  assert.notEqual(reconciled.risk_reward, 12);
});

test("the deterministic explainer produces schema-valid output in both languages", () => {
  const setup = buildSetup("BTCUSDT");
  for (const locale of ["en", "th"] as const) {
    const analysis = buildLocalAnalysis(setup, locale);
    const parsed = AiAnalysisSchema.safeParse(analysis);
    assert.equal(parsed.success, true, `${locale} output must satisfy the schema`);
    assert.equal(guardLanguage(analysis).ok, true, `${locale} output must pass the language guard`);
    assert.ok(analysis.facts.length > 0);
    assert.ok(analysis.interpretation.length > 0);
    assert.ok(analysis.assumptions.length > 0);
    assert.equal(analysis.setup_quality, setup.quality.score);
    assert.equal(analysis.ai_confidence, setup.aiConfidence);
  }
});

test("Thai output is actually Thai, not English passed through", () => {
  const thaiPattern = /[฀-๿]/;
  // Every narrative array, not just the three that used to be checked. The
  // reported bug was English leaking through `why_enter` and `invalidation`
  // specifically, which the old assertions did not cover — so a regression
  // there would have shipped with a green suite.
  const narrative = (a: ReturnType<typeof buildLocalAnalysis>) =>
    ({
      facts: a.facts,
      interpretation: a.interpretation,
      assumptions: a.assumptions,
      why_enter: a.why_enter,
      why_wait: a.why_wait,
      invalidation: a.invalidation,
      confirmation_required: a.confirmation_required,
    }) as Record<string, string[]>;

  // Several symbols, because which arrays are populated depends on the setup:
  // a "none"-direction setup has an empty why_enter and would vacuously pass.
  for (const symbol of ["EURUSD", "XAUUSD", "BTCUSDT"]) {
    const setup = buildSetup(symbol);
    const th = narrative(buildLocalAnalysis(setup, "th"));
    const en = narrative(buildLocalAnalysis(setup, "en"));

    for (const [field, lines] of Object.entries(th)) {
      for (const line of lines) {
        assert.ok(thaiPattern.test(line), `${symbol} th.${field} is not Thai: ${line}`);
        // `renderPhrase` falls back to "[key]" for a key missing from the
        // catalogue. That is visible but useless, so it must never survive.
        assert.ok(!line.startsWith("["), `${symbol} th.${field} has an unrendered key: ${line}`);
      }
    }
    for (const [field, lines] of Object.entries(en)) {
      for (const line of lines) {
        assert.ok(!thaiPattern.test(line), `${symbol} en.${field} leaked Thai: ${line}`);
        assert.ok(!line.startsWith("["), `${symbol} en.${field} has an unrendered key: ${line}`);
      }
    }
  }
});

test("enum labels are translated, and keep the technical term in English", () => {
  // Thai traders say "Ranging", so the Thai label carries the English term
  // alongside the translation rather than replacing it.
  assert.ok(renderPhrase(trendPhrase("ranging"), "th").includes("Ranging"));
  assert.ok(renderPhrase(freshnessPhrase("fresh"), "th").length > 0);

  // The real regression this guards: a label that renders identically in both
  // languages means the key is missing from one side of the catalogue, and
  // `renderPhrase` would be echoing the raw key back.
  const th = renderPhrase(statusPhrase("ENTRY_VALID"), "th");
  const en = renderPhrase(statusPhrase("ENTRY_VALID"), "en");
  assert.notEqual(th, en);
  assert.equal(en, "entry valid");
  assert.ok(!th.includes("label.status"), "a missing key must not reach the user");
});

test("the analysis prompt hands the model facts and forbids inventing numbers", () => {
  const setup = buildSetup();
  const prompt = analysisUserPrompt({ setup, locale: "th", level: "intermediate", mode: "coach" });
  assert.ok(prompt.includes("ENGINE FACTS"));
  assert.ok(prompt.includes("the only numbers you may use"));
  assert.ok(prompt.includes("COACH MODE"));
  assert.ok(prompt.includes("Thai"));
  assert.ok(prompt.includes(String(setup.quality.score)));
  // The prompt renders facts in the requested locale, so the Thai rendering is
  // what must appear — asserting on the English would pass even if the locale
  // were being ignored.
  for (const fact of renderPhrases(setup.facts, "th")) {
    assert.ok(prompt.includes(fact), "every engine fact must reach the model");
  }
});

test("the chat prompt forbids psychology claims when the journal is empty", () => {
  const setup = buildSetup();
  const empty = chatSystemPrompt({ messages: [], locale: "en", level: "beginner", mode: "direct", setup });
  assert.ok(empty.includes("journal is empty"));
  assert.ok(empty.includes("may NOT make any claim about the trader's psychology"));

  const noSetup = chatSystemPrompt({ messages: [], locale: "en", level: "beginner", mode: "direct", setup: null });
  assert.ok(noSetup.includes("No setup is loaded"));
});

test("the teach-me prompt walks the trader's own 10-step process", () => {
  const prompt = teachMePrompt(buildSetup(), "th");
  for (const needle of ["higher timeframe", "zone", "pullback", "confirmation", "stop", "targets", "drop this idea"]) {
    assert.ok(prompt.includes(needle), `teach-me prompt must cover ${needle}`);
  }
});

test("a chat answer is given a length budget; a Teach Me walkthrough is not", () => {
  // The request was short, spoken answers — and nothing in the prompt used to
  // bound length at all, so a one-line question came back as an essay. The
  // budget is the fix, but it must not reach Teach Me: the trader pressed a
  // button for a seven-step lesson, and four sentences would be a different
  // feature. One system prompt serves both, so the split is worth pinning.
  const setup = buildSetup();
  const base: ChatRequest = { messages: [], locale: "th", level: "beginner", mode: "coach", setup };

  const chat = chatSystemPrompt({ ...base, intent: "chat" });
  assert.ok(chat.includes("ANSWER LENGTH"), "chat must carry a length budget");
  assert.ok(chat.includes("120 words"));
  assert.ok(chat.includes("COACH MODE"), "coach mode applies to free conversation");

  const teach = chatSystemPrompt({ ...base, intent: "teach" });
  assert.ok(!teach.includes("120 words"), "the walkthrough must not be capped at a chat answer");
  assert.ok(teach.includes("every step you were asked for"));
  // Coach mode's "open with a question" fights a structured lesson: it would
  // start by asking the trader to explain the thing they asked to be taught.
  assert.ok(!teach.includes("COACH MODE"), "coach mode must not be stacked on a walkthrough");

  // Omitting the intent must pick the strict budget, not the loose one.
  assert.equal(chatSystemPrompt(base), chat);
});

test("the Thai register instruction is written in Thai and protects the English terms", () => {
  // Told in English to "reply in conversational Thai", a model reliably
  // produces translated-textbook Thai — including literal renderings of terms
  // traders only ever say in English. The guard is that the instruction itself
  // is Thai and names the specific words that must not be translated.
  const setup = buildSetup();
  const th = chatSystemPrompt({ messages: [], locale: "th", level: "beginner", mode: "direct", setup });
  assert.ok(/[฀-๿]/.test(th), "the Thai register block must be written in Thai");
  assert.ok(th.includes("อุปสงค์/อุปทาน"), "the mistranslation to avoid must be named explicitly");
  for (const term of ["supply", "demand", "BOS", "CHoCH", "R:R", "ATR"]) {
    assert.ok(th.includes(term), `${term} must be listed as untranslatable`);
  }

  const en = chatSystemPrompt({ messages: [], locale: "en", level: "beginner", mode: "direct", setup });
  assert.ok(!/[฀-๿]/.test(en), "the English prompt must not carry Thai instructions");
});

test("no API key falls back to the deterministic explainer, not a fake LLM", () => {
  const provider = createAiProvider({});
  assert.equal(provider.name, "deterministic");
  assert.equal(provider.available, true);

  const withKey = createAiProvider({ ANTHROPIC_API_KEY: "sk-test" });
  assert.equal(withKey.name, "claude");
});

async function run(): Promise<void> {
  await testAsync("the local provider reports itself as deterministic", async () => {
    const setup = buildSetup();
    const provider = new LocalExplainer();
    const result = await provider.analyze({ setup, locale: "th", level: "intermediate", mode: "direct" });
    assert.equal(result.source, "deterministic");
    assert.ok(result.note?.includes("โมเดลภาษา"));
    assert.equal(AiAnalysisSchema.safeParse(result.analysis).success, true);
  });

  await testAsync("chat answers are grounded in facts and separate fact from interpretation", async () => {
    const setup = buildSetup();
    const provider = new LocalExplainer();
    const answer = await provider.chat({
      messages: [{ role: "user", content: "ทำไมต้องรอ confirmation ก่อนเข้า" }],
      locale: "th",
      level: "beginner",
      mode: "coach",
      setup,
    });
    assert.equal(answer.source, "deterministic");
    assert.ok(answer.content.includes("ข้อเท็จจริง (FACT)"));
    assert.ok(answer.content.includes("การตีความ (INTERPRETATION)"));
    assert.ok(answer.content.includes("สมมติฐาน (ASSUMPTION)"));

    // The call itself has to be the first line, not something you scroll to.
    assert.ok(
      answer.content.split("\n")[0]?.includes(setup.symbol),
      "the answer must open with the call, not with a heading",
    );

    // No disclaimer in the body. Every screen that can render this already
    // prints it once at the page level, and a copy under each answer is the
    // padding the brevity rules exist to remove.
    assert.ok(
      !answer.content.includes("ไม่ใช่คำแนะนำการลงทุน"),
      "the disclaimer belongs to the screen, not to every message",
    );
  });

  await testAsync("the no-key answer stays short, and answers only what was asked", async () => {
    // This path cannot summarise — there is no model — so its only lever is
    // selection. Asking about the stop must not return the whole plan: that is
    // how the answer ends up buried in its own supporting evidence.
    const setup = buildSetup();
    const provider = new LocalExplainer();
    const ask = (content: string) =>
      provider.chat({ messages: [{ role: "user", content }], locale: "th", level: "beginner", mode: "direct", setup });

    const stop = (await ask("SL วางไว้ที่ไหน")).content;
    assert.ok(stop.includes("SL"), "the question was about the stop");
    assert.ok(!stop.includes("เข้าโซน"), "the entry zone was not asked about");

    const everything = (await ask("สรุปให้ฟังหน่อย")).content;
    assert.ok(everything.includes("เข้าโซน"), "naming nothing means give the whole plan");

    // "ทำไมยังไม่ควรเข้าตอนนี้" contains "เข้า". Matching on keywords alone
    // answered it with the entry zone — the single thing it did not ask for —
    // so the negation has to beat the keyword.
    const wait = (await ask("ทำไมยังไม่ควรเข้าตอนนี้")).content;
    assert.ok(wait.includes("ทำไมยังไม่เข้า"), "a wait question wants the engine's reasons");
    assert.ok(!wait.includes("เข้าโซน"), "a wait question must not be answered with the entry zone");

    // ...but "ทำไม SL ต้องอยู่จุดนี้" is *also* a why question and does still
    // want the level, so "why" alone must not suppress the plan.
    const whyStop = (await ask("ทำไม SL ต้องอยู่จุดนี้")).content;
    assert.ok(whyStop.includes("SL"), "a why question that names a level still prints it");

    const invalid = (await ask("อะไรจะทำให้เซ็ตอัพนี้เสีย")).content;
    assert.ok(invalid.includes("อะไรทำให้ไอเดียนี้เสีย"), "invalidation is its own question");

    // A phone screen next to a chart. Twelve bullet lines is already a lot.
    const bullets = everything.split("\n").filter((line) => line.startsWith("- "));
    assert.ok(bullets.length <= 10, `answer carried ${bullets.length} bullet lines, expected <= 10`);
  });

  await testAsync("chat refuses to answer about a chart when none is loaded", async () => {
    const provider = new LocalExplainer();
    const answer = await provider.chat({
      messages: [{ role: "user", content: "where is the entry" }],
      locale: "en",
      level: "advanced",
      mode: "direct",
      setup: null,
    });
    assert.ok(answer.content.includes("No setup is selected"));
  });
}

run().then(
  () => {
    process.stdout.write(`\nschema.test.ts: ${passed} passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(`\nschema.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
