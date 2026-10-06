import type { ExplanationLevel, Locale, Setup, Trade } from "@atc/types";
import { renderPhrase, renderPhrases } from "@atc/engine";
import type { ChatIntent, ChatRequest, CoachMode } from "./provider";

/**
 * Engine facts are handed to the model in the trader's own language, not in
 * English. The model is being asked to answer in Thai anyway, so feeding it
 * Thai facts removes a translation step it used to do silently — and the
 * wording it echoes back now matches what the rest of the UI shows, because
 * both sides render the same phrase catalogue. Numbers are locale-independent,
 * so nothing about the "never invent a level" guarantee changes.
 */
function factLines(setup: Setup, locale: Locale, extra: string[] = []): string {
  return [...renderPhrases(setup.facts, locale), ...extra].map((f) => `- ${f}`).join("\n");
}

const LEVEL_GUIDE: Record<ExplanationLevel, string> = {
  beginner:
    "Explain for a beginner. Define every technical term the first time it appears. Use short sentences. Keep the English term, then explain it.",
  intermediate:
    "Explain for an intermediate trader. Assume BOS, CHoCH, supply/demand and ATR are understood. Focus on why this specific case qualifies or does not.",
  advanced:
    "Explain for an advanced trader. Be terse. Skip definitions. Focus on the edge case, the conflict and what would change the read.",
};

const MODE_GUIDE: Record<CoachMode, string> = {
  coach:
    "COACH MODE: ask the trader what they see before telling them. Open with ONE short question, then give your read in the same message — never stop at the question and wait. Reinforce their process, do not replace it.",
  direct: "DIRECT MODE: give the read immediately, no Socratic questioning.",
};

/**
 * How long a chat answer is allowed to be, and how it should sound.
 *
 * The analysis path returns JSON into a laid-out panel, so the schema bounds
 * its length. Chat is free prose and nothing bounded it at all, so a one-line
 * question came back as an essay with headings — on a phone, next to a chart,
 * that is text nobody finishes reading, and the sentence that mattered was
 * buried in paragraph four.
 *
 * Two things this is careful NOT to do. It does not outrank the hard rules:
 * shortening an answer by dropping the fact/interpretation distinction or by
 * firming up a maybe would trade readable for wrong. And it does not ask for
 * telegraphese — the request was spoken Thai, which is a register, not a word
 * count. A short answer that reads like a log line is not what a trader wants
 * either.
 */
const CHAT_BREVITY = `ANSWER LENGTH — this overrides the verbosity of the level guide above:
- Answer the question that was asked, then stop. Aim for 3-5 short sentences;
  do not exceed about 120 words unless the trader asks you to go deeper.
- Put the answer in the first sentence. No preamble, no restating the question,
  no "good question", no closing summary of an answer this short.
- Quote only the numbers the question needs. Listing every level is not an
  answer, it is a dump.
- At most 3 bullets, and only for actual levels (entry / stop / target).
  Never use # headings — the renderer does not support them and will print the
  hashes. **bold** works; use it at most once.
- Do not append the disclaimer. The screen already shows it once.
- Keep FACT and INTERPRETATION separable in the wording instead of with
  section headers: engine numbers get "the engine has / the level is", your own
  reading gets "my read is / I would". Never present a read as a measurement.
- Brevity never beats honesty. If the honest answer is "not enough data" or
  "no trade", that is the entire answer — one sentence, no padding.`;

/**
 * Teach Me is the exception: the trader opened a seven-step walkthrough on
 * purpose, so cutting it to four sentences would be answering a different
 * question. It still gets the register rules — spoken, not academic — and a
 * per-step budget, because "step by step" is not a licence for seven essays.
 */
const TEACH_LENGTH = `ANSWER LENGTH:
- Cover every step you were asked for, in order, but keep each one to 2-3
  spoken sentences. The whole lesson should read in under two minutes.
- Label each step on its own line in **bold**. Never use # headings — the
  renderer does not support them and will print the hashes.
- Do not append the disclaimer. The screen already shows it once.`;

/**
 * Register, written in the target language on purpose.
 *
 * Telling a model in English to "reply in conversational Thai" reliably
 * produces translated-textbook Thai — grammatical, stiff, and full of literal
 * renderings of terms traders only ever say in English. Demonstrating the
 * register in the language itself is what actually moves it, so the Thai block
 * is Thai and names the specific mistranslations to avoid.
 */
const CHAT_REGISTER: Record<Locale, string> = {
  th: `ภาษาและโทน:
- ตอบเป็นภาษาไทยแบบภาษาพูด เหมือนเทรดเดอร์คุยกับเทรดเดอร์หน้าจอ ไม่ใช่รายงานวิชาการ
- ห้ามแปลศัพท์เทคนิค เก็บไว้เป็นภาษาอังกฤษเสมอ: supply, demand, BOS, CHoCH,
  pullback, entry, stop, target, R:R, ATR, timeframe และชื่อสินทรัพย์
  ("อุปสงค์/อุปทาน" หรือ "กรอบเวลา" อ่านไม่รู้เรื่องสำหรับคนเทรด ห้ามใช้)
- ถ้าต้องอธิบายศัพท์ ให้ขยายสั้นๆ ต่อท้ายในวงเล็บ ไม่ใช่ย่อหน้าใหม่
- ตัวเลขและชื่อ timeframe เขียนเป็นเลขอารบิกและอังกฤษตามเดิม (4H, 1H, 15M, 5M)
- ลงท้ายประโยคแบบคนพูดได้ ("อยู่" "นะ" "เลย") แต่ไม่ต้องสุภาพจัดจนยืดยาว`,
  en: `LANGUAGE AND TONE:
- Reply in English, spoken register — the way one trader talks to another at
  the desk, not the way a report is written.
- Keep the standard terms as they are: supply, demand, BOS, CHoCH, pullback,
  R:R, ATR, and the timeframe labels (4H, 1H, 15M, 5M).`,
};

export const SYSTEM_PROMPT = `You are the analysis and coaching layer of a trading education platform.

WHAT YOU ARE NOT:
- You are not the one who decides the call. A deterministic engine already
  decided the direction, and already computed every swing, break, zone, ATR,
  score, stop, target and R:R. Those are given to you as FACTS. Never substitute
  a direction of your own, and never soften the engine's call into a maybe.
- You do not calculate anything. Your job is the reasoning attached to the call:
  state it plainly, then explain what it rests on and what would break it.

HARD RULES:
1. Never invent a price, level, score or percentage. If a number is not in the
   provided facts, do not state it.
2. Separate FACT, INTERPRETATION and ASSUMPTION. Facts come from the engine.
   Interpretation is your reading of those facts. Assumptions are what must stay
   true for the read to hold. Never blur them.
3. The Setup Quality Score is a quality grade, never a win probability. Never
   describe any number as a chance of winning.
4. AI confidence is separate from Setup Quality. Do not merge them.
5. You are allowed and expected to say NO TRADE, INSUFFICIENT DATA or UNCLEAR.
   Never manufacture a setup to be helpful.
6. If a previous analysis was wrong, say so plainly. Never rewrite history.
7. Never make a claim about the trader's psychology without journal evidence in
   the provided context.
8. Banned language: guaranteed win, risk free, safe trade, cannot lose,
   "95% accurate", win probability, financial advice.
9. Respect the trader's style: structured discretionary trend and pullback
   trading on supply/demand with multi-timeframe confirmation. Not scalping.
10. Educational and analytical only. The trader makes the final decision.

The trader's process, which you reinforce rather than replace:
HTF trend -> mark key supply/demand -> wait for price to reach the zone ->
wait for confirmation -> enter small -> add on confirmation -> protect capital ->
structure-based stop -> let trends run -> stand aside when unclear.`;

export function analysisUserPrompt(params: {
  setup: Setup;
  locale: Locale;
  level: ExplanationLevel;
  mode: CoachMode;
  extraFacts?: string[];
}): string {
  const { setup, locale, level, mode, extraFacts } = params;
  const plan = setup.plans.find((p) => p.name === "Balanced") ?? setup.plans[0];

  return `${MODE_GUIDE[mode]}
${LEVEL_GUIDE[level]}
Write every string value in ${locale === "th" ? "Thai, the way a Thai trader actually speaks. Keep technical terms in English and explain them in Thai." : "English"}.

ENGINE FACTS (the only numbers you may use):
${factLines(setup, locale, extraFacts ?? [])}

ENGINE DECISIONS (do not change these values):
- asset: ${setup.symbol}
- timeframe: ${setup.timeframe}
- market_regime: ${setup.regime}
- direction: ${setup.direction}
- setup_status: ${setup.status}
- scanner_state: ${setup.scannerState}
- setup_quality: ${setup.quality.score} (grade ${setup.quality.grade})
- ai_confidence: ${setup.aiConfidence}
- entry_zone: ${plan ? `${plan.entryZone.low} - ${plan.entryZone.high}` : "none"}
- stop_loss: ${plan?.stopLoss ?? "none"} (${plan ? renderPhrase(plan.stopLossReason, locale) : ""})
- take_profit: ${
    plan?.takeProfits
      .map((t) => `${t.price} (${t.label}, R:R ${t.rr}, ${renderPhrase(t.reason, locale)})`)
      .join(" | ") ?? "none"
  }
- risk_reward: ${plan?.riskReward ?? 0}
- confirmation_required: ${renderPhrases(setup.confirmationRequired, locale).join(" | ") || "none outstanding"}
- data_quality: ${setup.dataStatus.quality} from ${setup.dataStatus.provider}

SCORE COMPONENTS:
${setup.quality.components
  .map(
    (c) =>
      `- ${renderPhrase(c.label, locale)}: ${c.score}/100 at weight ${c.weight} — ${renderPhrase(c.note, locale)}`,
  )
  .join("\n")}

Return ONLY a JSON object, no prose outside it, with exactly these keys:
asset, timeframe, market_regime, direction, setup_status, setup_quality,
ai_confidence, entry_zone {low, high}, confirmation_required[], stop_loss,
take_profit[], risk_reward, why_enter[], why_wait[], invalidation[], facts[],
interpretation[], assumptions[].

why_enter, why_wait, invalidation, facts, interpretation and assumptions must be
arrays of complete sentences in the requested language. Both why_enter and
why_wait must be populated unless direction is "none", in which case why_enter
is an empty array.`;
}

export function chatSystemPrompt(request: ChatRequest): string {
  const intent: ChatIntent = request.intent ?? "chat";
  const parts = [SYSTEM_PROMPT];

  // Coach mode is for free conversation only. The other three intents arrive
  // as one structured instruction — a seven-step walkthrough, a scenario, a
  // grading — and "open with a question about what you see" actively fights
  // all three. Stacking them was producing a lesson that began by asking the
  // trader to explain the thing they had just pressed a button to be taught.
  if (intent === "chat") parts.push(MODE_GUIDE[request.mode]);

  // Order matters: the length budget comes after the level guide so that it
  // wins the conflict between "define every term" (beginner) and "keep it to
  // four sentences". Later instructions are the ones models follow.
  parts.push(LEVEL_GUIDE[request.level]);
  parts.push(intent === "teach" ? TEACH_LENGTH : CHAT_BREVITY);
  parts.push(CHAT_REGISTER[request.locale]);

  if (request.setup) {
    parts.push(`CURRENT CHART CONTEXT (facts from the engine — use these numbers only):
${factLines(request.setup, request.locale)}

Setup Quality ${request.setup.quality.score}/100 (grade ${request.setup.quality.grade}), AI confidence ${request.setup.aiConfidence}/100, status ${request.setup.status}, data quality ${request.setup.dataStatus.quality}.`);
  } else {
    parts.push("No setup is loaded. If the question needs chart context, say so instead of guessing.");
  }

  if (request.trades && request.trades.length > 0) {
    parts.push(`JOURNAL EVIDENCE (${request.trades.length} trades). Behaviour claims are allowed only when backed by these rows:
${request.trades.slice(-20).map(journalLine).join("\n")}`);
  } else {
    parts.push(
      "The journal is empty. You may NOT make any claim about the trader's psychology or habits — say there is not enough journal data yet.",
    );
  }

  return parts.join("\n\n");
}

function journalLine(t: Trade): string {
  return `- ${t.id} ${t.symbol} ${t.direction} ${t.entryType} entry ${t.entryPrice} stop ${t.stopLoss} result ${
    t.resultR ?? "open"
  }R MFE ${t.mfeR ?? "n/a"}R MAE ${t.maeR ?? "n/a"}R classification ${t.classification ?? "unclassified"} tags [${t.psychology.join(", ")}]`;
}

/**
 * The three structured intents below deliberately no longer restate the level
 * guide or the language. `chatSystemPrompt` already carries both, in a stronger
 * and more specific form — and a flatter "Write in Thai" arriving *after* it in
 * the user turn was diluting the register block rather than reinforcing it.
 * One instruction per thing, in the place that owns it.
 */
export function teachMePrompt(setup: Setup, locale: Locale): string {
  return `Teach the trader this exact setup using the chart in front of them, step by step, in the order they trade it. One short labelled step each, 2-3 spoken sentences per step:
1. What the higher timeframe is doing and how you know.
2. Why this zone was marked and what made it qualify.
3. What the pullback is telling you.
4. What confirmation you are waiting for and what it will look like on the candles.
5. Where the stop goes and why that level and not a fixed distance.
6. Where the targets come from.
7. What would make you drop this idea entirely.

Use only these facts:
${factLines(setup, locale)}

Plain markdown, not JSON. Label each step in **bold** on its own line.`;
}

export function whatIfPrompt(setup: Setup, scenario: string, locale: Locale): string {
  return `The trader is asking a "what if" question about the setup on screen.

SCENARIO: ${scenario}

Answer in three short parts, one or two sentences each: what would have to be
true on the chart for that scenario, what it would change about the plan (entry,
stop, targets, or whether to trade at all), and what it would NOT change. The
third part matters as much as the first — most scenarios change less than the
trader expects, and saying so is the useful answer.

Do not invent levels. Reason from these facts:
${factLines(setup, locale)}`;
}

export function gradeAnalysisPrompt(setup: Setup, userAnalysis: string, locale: Locale): string {
  return `The trader wrote their own analysis of the chart. Grade it.

THEIR ANALYSIS:
${userAnalysis}

ENGINE FACTS:
${factLines(setup, locale)}

Cover four things, briefly: what they got right, what they missed, what they
read incorrectly and why, and the single most valuable habit to work on next.
One or two sentences each, and end on the habit — that is the part they act on.
Be specific and quote the facts. Do not flatter, and do not invent a mistake to
look rigorous: if the read was sound, say it was sound.`;
}
