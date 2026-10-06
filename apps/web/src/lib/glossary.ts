import type { ExplanationLevel, Locale } from "@atc/types";

/**
 * §66 glossary / §65 terminology rule.
 *
 * The term itself always stays in English, because that is what the charts,
 * the books and every other trader use. Only the explanation is translated,
 * and the Thai explanation is written the way a trader would actually say it.
 */
export interface GlossaryTerm {
  /** Always English. Never translated. */
  term: string;
  /** Short expansion where the acronym hides something useful. */
  expands?: string;
  th: string;
  en: string;
  level: ExplanationLevel;
  tags: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    term: "Market Structure",
    th: "ลำดับของจุดสูง-จุดต่ำบนกราฟ ถ้าทำจุดสูงใหม่และจุดต่ำใหม่ที่สูงขึ้นเรื่อย ๆ คือขาขึ้น ถ้ากลับกันคือขาลง อ่านโครงสร้างให้ออกก่อน แล้วค่อยหาจุดเข้า",
    en: "The sequence of highs and lows. Rising highs and rising lows is an uptrend; falling highs and falling lows is a downtrend. Read structure first, then look for entries.",
    level: "beginner",
    tags: ["structure"],
  },
  {
    term: "HH / HL / LH / LL",
    expands: "Higher High / Higher Low / Lower High / Lower Low",
    th: "ชื่อเรียกจุดกลับตัวแต่ละจุดเทียบกับจุดก่อนหน้า HH = จุดสูงใหม่สูงกว่าเดิม, HL = จุดต่ำใหม่สูงกว่าเดิม ขาขึ้นที่แข็งแรงจะเป็น HH แล้ว HL สลับกันไป",
    en: "Labels for each swing point relative to the previous one. A healthy uptrend alternates Higher High then Higher Low.",
    level: "beginner",
    tags: ["structure"],
  },
  {
    term: "Swing High / Swing Low",
    th: "แท่งที่สูงกว่า (หรือต่ำกว่า) แท่งข้าง ๆ ทั้งซ้ายและขวา ระบบนี้ใช้วิธี fractal คือต้องสูงกว่าเพื่อนบ้านทั้งสองฝั่งจำนวนหนึ่งแท่ง จึงจะนับเป็นจุด swing",
    en: "A candle higher (or lower) than a set number of candles on both sides. The engine uses a fractal rule, so a swing is confirmed only after the candles to its right exist.",
    level: "beginner",
    tags: ["structure"],
  },
  {
    term: "BOS",
    expands: "Break of Structure",
    th: "ราคาทะลุจุดสูง/ต่ำเดิมไปในทิศทางเดียวกับเทรนด์ แปลว่าเทรนด์เดิมยังไปต่อ ไม่ใช่สัญญาณกลับตัว",
    en: "Price breaks the previous swing in the direction of the existing trend. It confirms continuation, not reversal.",
    level: "intermediate",
    tags: ["structure", "signal"],
  },
  {
    term: "CHoCH",
    expands: "Change of Character",
    th: "สัญญาณแรกที่บอกว่าเทรนด์เดิมเริ่มมีปัญหา เช่น ขาขึ้นแล้วหลุด HL ล่าสุด ยังไม่ใช่การกลับตัวที่ยืนยันแล้ว แต่เป็นสัญญาณเตือนให้ลดความมั่นใจกับฝั่งเดิม",
    en: "The first sign the existing trend is in trouble, such as an uptrend losing its most recent Higher Low. A warning, not yet a confirmed reversal.",
    level: "intermediate",
    tags: ["structure", "signal"],
  },
  {
    term: "MSS",
    expands: "Market Structure Shift",
    th: "การกลับตัวที่ยืนยันแล้ว คือหลังจาก CHoCH แล้วราคายังไปต่อและทะลุโครงสร้างในทิศใหม่ด้วยแรง ถึงจะนับว่าโครงสร้างเปลี่ยนข้างจริง",
    en: "A confirmed reversal: after a CHoCH, price continues and breaks structure in the new direction with displacement.",
    level: "advanced",
    tags: ["structure", "signal"],
  },
  {
    term: "Displacement",
    th: "แท่งหรือกลุ่มแท่งที่วิ่งแรงผิดปกติเทียบกับ ATR แปลว่ามีคนเข้าซื้อ/ขายจริงจัง ไม่ใช่แค่ราคาลอยไปเรื่อย ๆ ใช้ยืนยันว่าการทะลุมีน้ำหนัก",
    en: "An unusually large move relative to ATR. It signals real participation and gives a break its weight.",
    level: "intermediate",
    tags: ["momentum"],
  },
  {
    term: "Supply Zone",
    th: "โซนที่ราคาเคยถูกเทขายแรงจนร่วงลง ถ้าราคากลับมาแถวนั้นอีก มีโอกาสเจอแรงขายค้างอยู่ จึงเป็นโซนที่มองหาฝั่ง Short",
    en: "An area price previously sold off from hard. If price returns, leftover sell interest may still be there, so it is a short-side area of interest.",
    level: "beginner",
    tags: ["zones"],
  },
  {
    term: "Demand Zone",
    th: "โซนที่ราคาเคยถูกซื้อแรงจนดีดขึ้น ถ้าราคากลับมาแถวนั้นอีก มีโอกาสเจอแรงซื้อค้างอยู่ จึงเป็นโซนที่มองหาฝั่ง Long",
    en: "An area price previously rallied from hard. If price returns, leftover buy interest may still be there, so it is a long-side area of interest.",
    level: "beginner",
    tags: ["zones"],
  },
  {
    term: "Zone Freshness",
    th: "โซนยังไม่เคยถูกทดสอบ = fresh มีโอกาสทำงานดีที่สุด ยิ่งถูกทดสอบหลายครั้ง ออเดอร์ที่ค้างอยู่ก็ยิ่งถูกใช้ไปหมด โซนจะอ่อนลงเรื่อย ๆ",
    en: "An untested zone is fresh and usually reacts best. Each test consumes resting orders, so a zone weakens the more it is tested.",
    level: "intermediate",
    tags: ["zones"],
  },
  {
    term: "Pullback",
    th: "การย่อสวนทางเทรนด์ชั่วคราว โครงสร้างหลักยังไม่เสีย เป็นจังหวะที่ระบบนี้ออกแบบมาให้เทรด",
    en: "A temporary move against the trend while the main structure stays intact. This is the move this system is built to trade.",
    level: "beginner",
    tags: ["pullback"],
  },
  {
    term: "Reversal",
    th: "การกลับตัวจริง โครงสร้างเปลี่ยนข้าง การเข้าแบบคิดว่าเป็นการย่อแต่จริงๆ เป็นการกลับตัว เป็นสาเหตุที่คนขาดทุนหนักที่สุด",
    en: "A real change of trend where structure flips. Mistaking a reversal for a pullback is where the biggest losses come from.",
    level: "intermediate",
    tags: ["pullback"],
  },
  {
    term: "MTF",
    expands: "Multi-Timeframe Analysis",
    th: "ดูหลายไทม์เฟรมประกอบกัน ระบบนี้บังคับลำดับ 4H → 1H → 15M → 5M ไทม์เฟรมใหญ่บอกทิศ ไทม์เฟรมเล็กบอกจังหวะเข้า ห้ามดู 5M เดี่ยว ๆ",
    en: "Reading several timeframes together. This system enforces 4H → 1H → 15M → 5M: the higher timeframes set direction, the lower ones time the entry. Never read 5M alone.",
    level: "beginner",
    tags: ["mtf"],
  },
  {
    term: "ATR",
    expands: "Average True Range",
    th: "ค่าเฉลี่ยระยะที่ราคาวิ่งต่อแท่ง ใช้วัดว่าตลาดผันผวนแค่ไหน ระบบใช้ ATR ตั้งระยะกันชนของ SL เพราะ SL ที่แคบกว่าความผันผวนปกติจะโดนกินฟรี",
    en: "Average distance price travels per candle. Used to size the stop-loss buffer, because a stop tighter than normal volatility gets taken out by noise.",
    level: "intermediate",
    tags: ["risk", "momentum"],
  },
  {
    term: "R / R-Multiple",
    th: "วัดกำไร-ขาดทุนเป็นจำนวนเท่าของความเสี่ยงที่ยอมรับไว้ เสี่ยง 1 ได้ 2 = +2R วิธีนี้ทำให้เทียบเทรดคนละตลาดคนละขนาดไม้ได้",
    en: "Profit and loss measured in multiples of the risk taken. Risking 1 to make 2 is +2R. It lets you compare trades across markets and position sizes.",
    level: "beginner",
    tags: ["risk"],
  },
  {
    term: "R:R",
    expands: "Risk-to-Reward Ratio",
    th: "อัตราส่วนระหว่างระยะ SL กับระยะ TP ถ้า R:R ต่ำ แม้ชนะบ่อยก็ยังขาดทุนระยะยาวได้",
    en: "The ratio between stop distance and target distance. With poor R:R you can still lose over time even with a high win rate.",
    level: "beginner",
    tags: ["risk"],
  },
  {
    term: "MFE / MAE",
    expands: "Maximum Favourable / Adverse Excursion",
    th: "MFE = กำไรสูงสุดที่เคยเห็นระหว่างถือ, MAE = ติดลบมากสุดที่เคยเห็น MFE สูงแต่ปิดได้น้อย = ออกเร็ว, MAE ลึกบ่อย = จุดเข้ายังไม่ดี",
    en: "MFE is the best unrealised profit during the trade, MAE the worst drawdown. High MFE with a small result means exiting early; deep MAE repeatedly means poor entry timing.",
    level: "advanced",
    tags: ["risk", "journal"],
  },
  {
    term: "Expectancy",
    th: "กำไรเฉลี่ยที่คาดหวังได้ต่อ 1 ไม้ คิดเป็น R ถ้าค่านี้เป็นบวก การเทรดแบบเดิมซ้ำ ๆ จะได้เปรียบระยะยาว ถ้าเป็นลบ ยิ่งเทรดเยอะยิ่งเสีย",
    en: "Average R expected per trade. Positive expectancy means repeating the same process pays over time; negative means more trades make it worse.",
    level: "advanced",
    tags: ["journal"],
  },
  {
    term: "Setup Quality Score",
    th: "คะแนน 0-100 ที่บอกว่าเซ็ตอัพนี้ตรงตามเงื่อนไขของระบบมากแค่ไหน ย้ำว่านี่ไม่ใช่โอกาสชนะ เซ็ตอัพคะแนน 90 ก็แพ้ได้",
    en: "A 0-100 score for how well a setup matches the system's conditions. It is explicitly NOT a win probability: a 90-score setup can still lose.",
    level: "beginner",
    tags: ["scoring"],
  },
  {
    term: "AI Confidence",
    th: "ความมั่นใจของตัว AI ในการอ่านครั้งนี้ คนละเรื่องกับคะแนนคุณภาพเซ็ตอัพ เซ็ตอัพอาจคะแนนสูงแต่ AI ไม่มั่นใจเพราะข้อมูลน้อยหรือไทม์เฟรมขัดกัน",
    en: "How sure the AI is about this particular read. Different from Setup Quality: a high-quality setup can still come with low confidence when data is thin or timeframes conflict.",
    level: "intermediate",
    tags: ["scoring"],
  },
  {
    term: "Confirmation Entry",
    th: "รอให้เกิดสัญญาณยืนยันก่อนเข้า เช่น แท่งปิดกลับทิศในโซน เข้าช้ากว่าแต่ผิดน้อยกว่า เป็นแบบที่ระบบนี้แนะนำเป็นหลัก",
    en: "Waiting for a confirming signal before entering, such as a reversal close inside the zone. Later entry, fewer mistakes — the default this system recommends.",
    level: "beginner",
    tags: ["entry"],
  },
  {
    term: "Probe Entry",
    th: "เข้าด้วยไม้เล็กกว่าปกติเพราะเงื่อนไขยังไม่ครบ ย้ำว่านี่ไม่ใช่ไม้เต็ม ถ้าเงื่อนไขครบทีหลังจึงค่อยเพิ่ม",
    en: "A deliberately smaller entry when conditions are incomplete. This is not the full position; size up only if conditions complete.",
    level: "advanced",
    tags: ["entry"],
  },
  {
    term: "Invalidation",
    th: "เงื่อนไขที่ทำให้เซ็ตอัพนี้ใช้ไม่ได้อีกแล้ว เขียนไว้ล่วงหน้าก่อนเข้า ไม่ใช่มาหาเหตุผลทีหลัง ถ้าเงื่อนไขนี้เกิด ต้องเลิกมองเซ็ตอัพนี้",
    en: "The condition that kills the setup, written down before entry rather than rationalised afterwards. If it happens, the setup is done.",
    level: "beginner",
    tags: ["entry"],
  },
  {
    term: "Break-Even Stop",
    th: "การเลื่อน SL มาที่ราคาเข้าเพื่อไม่ให้เสีย แต่ถ้าเลื่อนเร็วเกินไปจะโดนกินออกก่อนราคาไป ระบบนี้จะเลื่อนให้เมื่อมีโครงสร้างใหม่รองรับจริงเท่านั้น",
    en: "Moving the stop to entry so the trade cannot lose. Done too early it just stops you out before the move. This engine only suggests it when a new structure actually protects the level.",
    level: "intermediate",
    tags: ["management"],
  },
  {
    term: "Market Regime",
    th: "สภาพตลาดโดยรวม เช่น เทรนด์แรง, แกว่งในกรอบ, บีบตัวแคบ กลยุทธ์ที่ใช้ได้ในเทรนด์จะพังในตลาดแกว่ง ระบบจึงปรับเกณฑ์ตามสภาพตลาด",
    en: "The overall state of the market — strong trend, range, compression. A method that works in a trend fails in a range, so the engine adapts its thresholds.",
    level: "advanced",
    tags: ["regime"],
  },
  {
    term: "FOMO",
    expands: "Fear Of Missing Out",
    th: "กลัวตกรถ เลยเข้าตามราคาที่วิ่งไปแล้ว มักเข้าที่จุดแย่ที่สุดของการเคลื่อนไหว อาการคือ 'เดี๋ยวไม่ทัน' แทนที่จะเป็น 'เงื่อนไขครบแล้ว'",
    en: "Chasing a move because you are afraid of missing it, which usually means entering at the worst price. The tell is thinking 'I'll miss it' instead of 'conditions are met'.",
    level: "beginner",
    tags: ["psychology"],
  },
  {
    term: "Revenge Trading",
    th: "เข้าใหม่ทันทีหลังขาดทุนเพื่อเอาคืน ไม่ได้เข้าเพราะเจอเซ็ตอัพใหม่ ระบบนี้นับเป็นคนละเทรดไม่ได้ ต้องมีเซ็ตอัพใหม่จริงเท่านั้น",
    en: "Re-entering straight after a loss to win it back rather than because a new setup appeared. A genuine re-entry requires a genuinely new setup.",
    level: "beginner",
    tags: ["psychology"],
  },
];

export function glossaryText(term: GlossaryTerm, locale: Locale): string {
  return locale === "th" ? term.th : term.en;
}

/** Simple substring search over the term, its expansion and both explanations. */
export function searchGlossary(query: string, locale: Locale): GlossaryTerm[] {
  const q = query.trim().toLowerCase();
  if (!q) return GLOSSARY;
  return GLOSSARY.filter((item) =>
    [item.term, item.expands ?? "", glossaryText(item, locale), ...item.tags]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}
