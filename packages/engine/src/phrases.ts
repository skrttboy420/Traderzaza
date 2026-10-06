import type {
  Direction,
  EntryType,
  Locale,
  MarketRegime,
  Phrase,
  PhraseVar,
  PullbackVerdict,
  ScannerState,
  SetupStatus,
  TrendPhase,
  TrendState,
  ZoneFreshness,
  ZoneKind,
  ZoneStructuralImpact,
} from "@atc/types";

/**
 * The phrase catalogue.
 *
 * Every sentence the engine can say, in English and Thai, side by side. The
 * engine chooses a key and supplies the numbers; this file owns the wording.
 *
 * Two rules keep it honest:
 *
 *  1. No engine module may build a user-facing string with template literals.
 *     If a sentence is not in here, it cannot be shown. That is what stopped
 *     the Thai UI from leaking English.
 *  2. `th` is spoken Thai, not translated English. Technical terms stay in
 *     English (BOS, CHoCH, ATR, displacement) because that is how Thai traders
 *     actually say them, with the Thai explanation around them.
 *
 * `{name}` placeholders are filled from `Phrase.vars`. A var may itself be a
 * phrase, which is how enum labels get localised without a second mechanism.
 */
type Pair = { en: string; th: string };

export const PHRASES = {
  // ---------------------------------------------------------------- labels
  // Enum renderings. Referenced as nested vars, never shown alone.
  "label.trend.strong_bullish": { en: "strongly bullish", th: "ขาขึ้นแข็งแรง" },
  "label.trend.bullish": { en: "bullish", th: "ขาขึ้น" },
  "label.trend.weak_bullish": { en: "weakly bullish", th: "ขาขึ้นแต่เริ่มอ่อนแรง" },
  "label.trend.ranging": { en: "ranging", th: "ออกข้าง (Ranging)" },
  "label.trend.transition": { en: "in transition", th: "กำลังเปลี่ยนโครงสร้าง (Transition)" },
  "label.trend.weak_bearish": { en: "weakly bearish", th: "ขาลงแต่เริ่มอ่อนแรง" },
  "label.trend.bearish": { en: "bearish", th: "ขาลง" },
  "label.trend.strong_bearish": { en: "strongly bearish", th: "ขาลงแข็งแรง" },

  "label.phase.continuation": { en: "continuation", th: "ไปต่อ (Continuation)" },
  "label.phase.weakening": { en: "weakening", th: "เริ่มอ่อนแรง (Weakening)" },
  "label.phase.reversal_risk": { en: "reversal risk", th: "เสี่ยงกลับตัว (Reversal Risk)" },
  "label.phase.consolidation": { en: "consolidation", th: "สะสมกำลัง (Consolidation)" },
  "label.phase.expansion": { en: "expansion", th: "ขยายตัว (Expansion)" },
  "label.phase.compression": { en: "compression", th: "บีบตัว (Compression)" },

  // Pure predicates, with no leading "ตลาด". Every template that interpolates
  // these already supplies the subject ("สภาพตลาดตอนนี้คือ{regime}"), so a label
  // carrying its own one printed "สภาพตลาดเป็นตลาดเป็นเทรนด์ขึ้น" on screen.
  "label.regime.trending_up": { en: "trending up", th: "เทรนด์ขึ้น" },
  "label.regime.trending_down": { en: "trending down", th: "เทรนด์ลง" },
  "label.regime.ranging": { en: "ranging", th: "ออกข้าง (Ranging)" },
  "label.regime.expansion": { en: "expansion", th: "กำลังขยายช่วงราคา" },
  "label.regime.compression": { en: "compression", th: "บีบตัวแคบ" },
  "label.regime.high_volatility": { en: "high volatility", th: "ความผันผวนสูง" },
  "label.regime.low_volatility": { en: "low volatility", th: "ความผันผวนต่ำ" },

  "label.freshness.fresh": { en: "fresh, never tested", th: "โซนสด ยังไม่เคยถูกทดสอบ" },
  "label.freshness.tested_once": { en: "tested once", th: "ถูกทดสอบแล้ว 1 ครั้ง" },
  "label.freshness.tested_twice": { en: "tested twice", th: "ถูกทดสอบแล้ว 2 ครั้ง" },
  "label.freshness.tested_multiple": { en: "tested several times", th: "ถูกทดสอบมาหลายครั้ง" },
  "label.freshness.weak": { en: "weak", th: "โซนอ่อนแล้ว" },
  "label.freshness.invalid": { en: "invalid", th: "โซนเสียแล้ว" },

  "label.impact.caused_bos": { en: "caused a BOS", th: "เคยทำให้เกิด BOS (เบรกโครงสร้าง)" },
  "label.impact.caused_choch": { en: "caused a CHoCH", th: "เคยทำให้เกิด CHoCH (เปลี่ยนโครงสร้าง)" },
  "label.impact.caused_mss": { en: "caused an MSS", th: "เคยทำให้เกิด MSS (เปลี่ยนโครงสร้างแบบมีแรง)" },
  "label.impact.strong_rejection": { en: "produced a strong rejection", th: "เคยทำให้ราคาเด้งแรง" },
  "label.impact.continuation": { en: "produced a continuation", th: "เคยทำให้ราคาไปต่อ" },
  "label.impact.none": { en: "no recorded structural effect", th: "ยังไม่เคยสร้างผลกับโครงสร้าง" },

  "label.status.WATCHING": { en: "watching", th: "เฝ้าดูอยู่" },
  "label.status.ZONE_APPROACHING": { en: "zone approaching", th: "ราคากำลังเข้าใกล้โซน" },
  "label.status.IN_ZONE": { en: "in zone", th: "ราคาอยู่ในโซนแล้ว" },
  "label.status.WAITING_CONFIRMATION": { en: "waiting for confirmation", th: "รอสัญญาณยืนยัน" },
  "label.status.ENTRY_VALID": { en: "entry valid", th: "จุดเข้าใช้ได้แล้ว" },
  "label.status.ACTIVE": { en: "active trade", th: "ถือออเดอร์อยู่" },
  "label.status.MANAGING": { en: "managing", th: "กำลังบริหารออเดอร์" },
  "label.status.COMPLETED": { en: "completed", th: "ปิดจบแล้ว" },
  "label.status.INVALIDATED": { en: "entry invalidated", th: "จุดเข้าถูกยกเลิกแล้ว" },

  "label.scanner.ENTRY_NOW": { en: "entry now", th: "เข้าได้เลย" },
  "label.scanner.WAIT_CONFIRMATION": { en: "wait for confirmation", th: "รอยืนยันก่อน" },
  "label.scanner.LIMIT_ZONE": { en: "limit at the zone", th: "ตั้งลิมิตรอที่โซน" },
  "label.scanner.WATCHLIST": { en: "watchlist", th: "อยู่ในลิสต์เฝ้าดู" },
  "label.scanner.NO_TRADE": { en: "no trade", th: "ไม่เทรด" },

  "label.entryType.aggressive": { en: "aggressive limit", th: "เข้าแบบรุก (ลิมิตที่ขอบโซน)" },
  "label.entryType.confirmation": { en: "confirmation entry", th: "เข้าหลังเห็นสัญญาณยืนยัน" },
  "label.entryType.retest": { en: "retest entry", th: "เข้าตอนราคากลับมารีเทสต์" },
  "label.entryType.probe": { en: "probe entry", th: "เข้าไม้เล็กทดลอง" },

  /**
   * All three must be NOUN PHRASES, because every slot they fill is a noun
   * slot: "with {verdict} into a zone", "classified as {verdict}",
   * "แล้วเกิด{verdict} กลับเข้ามาหา", "ถูกจัดเป็น{verdict}".
   *
   * `unclear` used to be the adjectival "ยังอ่านไม่ชัด" / bare "unclear", which
   * reads fine on its own and breaks all four sentences the moment it is
   * substituted: "แล้วเกิดยังอ่านไม่ชัด กลับเข้ามาหา..." and "with unclear
   * into a 15m supply zone". One mismatched label, three broken sentences, in
   * both languages — see the shape test in engine.test.ts.
   */
  "label.verdict.pullback": { en: "a pullback", th: "การย่อ (Pullback)" },
  "label.verdict.reversal": { en: "a reversal", th: "การกลับตัว (Reversal)" },
  "label.verdict.unclear": { en: "an unclear move", th: "การเคลื่อนไหวที่อ่านไม่ชัด" },

  "label.zoneKind.demand": { en: "demand", th: "โซนอุปสงค์ (Demand)" },
  "label.zoneKind.supply": { en: "supply", th: "โซนอุปทาน (Supply)" },

  "label.direction.long": { en: "long", th: "ฝั่ง Buy" },
  "label.direction.short": { en: "short", th: "ฝั่ง Sell" },
  "label.direction.none": { en: "no direction", th: "ยังไม่มีฝั่ง" },

  // The Thai labels carry their own "ฝั่ง", so a template interpolating them
  // must not prefix one as well — that printed "ฝั่งฝั่งลง" on screen.
  "label.bias.bullish": { en: "bullish", th: "ฝั่งขึ้น" },
  "label.bias.bearish": { en: "bearish", th: "ฝั่งลง" },
  "label.bias.neutral": { en: "neutral", th: "ยังไม่มีฝั่งชัด" },

  "label.side.above": { en: "above", th: "สูงกว่า" },
  "label.side.below": { en: "below", th: "ต่ำกว่า" },
  "label.side.up": { en: "up", th: "ขึ้น" },
  "label.side.down": { en: "down", th: "ลง" },
  "label.side.swingHigh": { en: "swing high", th: "สวิงไฮ" },
  "label.side.swingLow": { en: "swing low", th: "สวิงโลว์" },
  "label.side.higherLow": { en: "higher low", th: "ไฮเออร์โลว์ (Higher Low)" },
  "label.side.lowerHigh": { en: "lower high", th: "โลเวอร์ไฮ (Lower High)" },
  "label.side.aligned": { en: "aligned", th: "สอดคล้องกัน" },
  "label.side.notAligned": { en: "not aligned", th: "ยังไม่สอดคล้อง" },

  // ------------------------------------------------------------- structure
  "structure.swingSequence": {
    en: "{tf}: swing sequence {sequence}.",
    th: "{tf}: ลำดับสวิงคือ {sequence}",
  },
  "structure.lastEvent": {
    en: "{tf}: last structure event was a {bias} {type} at {price}, with {displacement} ATR of displacement.",
    th: "{tf}: โครงสร้างล่าสุดคือ {type} {bias} ที่ราคา {price} แรงส่ง (displacement) {displacement} ATR",
  },
  "structure.noEvent": {
    en: "{tf}: no confirmed structure break in the loaded range.",
    th: "{tf}: ยังไม่มีการเบรกโครงสร้างที่ยืนยันได้ในช่วงข้อมูลที่โหลดมา",
  },
  "structure.lastSwingHigh": {
    en: "{tf}: last swing high at {price}.",
    th: "{tf}: สวิงไฮล่าสุดอยู่ที่ {price}",
  },
  "structure.lastSwingLow": {
    en: "{tf}: last swing low at {price}.",
    th: "{tf}: สวิงโลว์ล่าสุดอยู่ที่ {price}",
  },
  "structure.trendPhase": {
    en: "{tf}: trend reads {trend}, phase {phase}.",
    th: "{tf}: เทรนด์อ่านได้ว่า{trend} อยู่ในเฟส{phase}",
  },

  // ------------------------------------------------------------------ zone
  "zone.range": {
    en: "{tf} {kind} zone between {bottom} and {top}.",
    th: "{kind} บนไทม์เฟรม {tf} ช่วงราคา {bottom} ถึง {top}",
  },
  "zone.freshness": {
    en: "Zone is {freshness} after {tests} test(s).",
    th: "สถานะโซน: {freshness} (ถูกแตะมา {tests} ครั้ง)",
  },
  "zone.displacement": {
    en: "Price left the zone with {displacement} ATR of displacement and travelled {travelled} ATR away.",
    th: "ราคาออกจากโซนด้วยแรง {displacement} ATR แล้ววิ่งห่างออกไป {travelled} ATR",
  },
  "zone.impact": {
    en: "Structural track record: this zone {impact}.",
    th: "ประวัติของโซน: {impact}",
  },
  "zone.htfAlignment": {
    en: "Higher-timeframe alignment: {alignment}.",
    th: "ความสอดคล้องกับไทม์เฟรมใหญ่: {alignment}",
  },
  "zone.score": {
    en: "Zone quality score {score}/100.",
    th: "คะแนนคุณภาพโซน {score}/100",
  },

  // -------------------------------------------------------------- pullback
  "pullback.noDirection": {
    en: "No dominant higher-timeframe direction, so a retracement cannot be classified.",
    th: "ไทม์เฟรมใหญ่ยังไม่มีทิศทางชัด เลยยังจัดประเภทการย่อไม่ได้",
  },
  "pullback.notEnoughSwings": {
    en: "Not enough confirmed swings to measure the leg.",
    th: "สวิงที่ยืนยันแล้วยังน้อยเกินไป วัดความยาวของขาไม่ได้",
  },
  "pullback.noLegSize": {
    en: "The last leg has no measurable size.",
    th: "ขาล่าสุดสั้นเกินกว่าจะวัดได้",
  },
  "pullback.inBand": {
    en: "Price has retraced {percent}% of the last leg, inside the normal pullback band.",
    th: "ราคาย่อมาแล้ว {percent}% ของขาล่าสุด ซึ่งอยู่ในโซนย่อปกติ",
  },
  "pullback.erased": {
    en: "Price has fully erased the last leg ({percent}% retrace).",
    th: "ราคาย่อกลืนขาล่าสุดไปหมดแล้ว (ย่อ {percent}%)",
  },
  "pullback.deep": {
    en: "The retrace is deep at {percent}%, which weakens the pullback read.",
    th: "ย่อลึกถึง {percent}% ทำให้การอ่านว่าเป็นการย่อเริ่มอ่อนลง",
  },
  "pullback.shallow": {
    en: "The retrace is shallow at {percent}%.",
    th: "ย่อตื้นแค่ {percent}%",
  },
  "pullback.counterShift": {
    en: "A {type} against the higher-timeframe direction printed with {displacement} ATR of displacement.",
    th: "มี {type} สวนทางไทม์เฟรมใหญ่ ด้วยแรงส่ง {displacement} ATR",
  },
  "pullback.noCounterShift": {
    en: "No structure break against the higher-timeframe direction.",
    th: "ยังไม่มีการเบรกโครงสร้างสวนทางไทม์เฟรมใหญ่",
  },
  "pullback.impulsiveCounter": {
    en: "Counter-trend candles are large ({body} ATR of body across the last 6), which is impulsive rather than corrective.",
    th: "แท่งสวนเทรนด์ตัวใหญ่ ({body} ATR รวม 6 แท่งหลัง) ดูเป็นแรงจริงมากกว่าการพักตัว",
  },
  "pullback.heavyCounterVolume": {
    en: "Counter-trend candles are carrying the heavier volume.",
    th: "แท่งสวนเทรนด์กินวอลุ่มหนักกว่าฝั่งตามเทรนด์",
  },
  "pullback.correctiveCounter": {
    en: "Counter-trend candles are small ({body} ATR of body), which looks corrective.",
    th: "แท่งสวนเทรนด์ตัวเล็ก ({body} ATR) ดูเป็นการพักตัวตามปกติ",
  },
  "pullback.mixedCounter": {
    en: "Counter-trend momentum is mixed.",
    th: "โมเมนตัมฝั่งสวนเทรนด์ยังก้ำกึ่ง",
  },

  // ------------------------------------------------------------------ mtf
  "mtf.notEnoughTimeframes": {
    en: "Not enough timeframes are loaded to confirm alignment.",
    th: "ไทม์เฟรมที่โหลดมายังไม่พอจะยืนยันความสอดคล้องกัน",
  },
  "mtf.conflict": {
    en: "{tfA} is {trendA} while {tfB} is {trendB}.",
    th: "{tfA} เป็น{trendA} แต่ {tfB} เป็น{trendB}",
  },
  "mtf.agreement": {
    en: "Timeframe chain agreement is {agreement}/100.",
    th: "ความสอดคล้องของไทม์เฟรม (MTF agreement) = {agreement}/100",
  },
  "mtf.leg": {
    en: "{tf}: structure is {trend}, in the {phase} phase.",
    th: "{tf}: โครงสร้างเป็น{trend} อยู่ในเฟส{phase}",
  },

  // ---------------------------------------------------------- regime notes
  "regime.note.trending_up": {
    en: "Trending up: pullbacks into demand are the higher-quality entries.",
    th: "ตลาดเป็นเทรนด์ขึ้น จุดเข้าที่คุณภาพดีคือรอย่อลงมาหาโซน Demand",
  },
  "regime.note.trending_down": {
    en: "Trending down: pullbacks into supply are the higher-quality entries.",
    th: "ตลาดเป็นเทรนด์ลง จุดเข้าที่คุณภาพดีคือรอเด้งขึ้นไปหาโซน Supply",
  },
  "regime.note.ranging": {
    en: "Ranging: the edges of the range matter more than breakouts, and trend-continuation setups degrade.",
    th: "ตลาดออกข้าง ขอบกรอบสำคัญกว่าการเบรก และเซ็ตอัพแบบไปต่อตามเทรนด์จะคุณภาพตกลง",
  },
  "regime.note.expansion": {
    en: "Expansion: moves run further, but entries chase more easily.",
    th: "ตลาดกำลังขยายช่วง ราคาวิ่งไกลกว่าเดิม แต่ก็วิ่งตามราคาง่ายกว่าเดิมด้วย",
  },
  "regime.note.compression": {
    en: "Compression: stops get hit by noise and breakouts fail more often.",
    th: "ตลาดบีบตัว SL โดนลากจากนอยส์ง่าย และการเบรกมักหลอก",
  },
  "regime.note.high_volatility": {
    en: "High volatility: widen the stop structurally or cut size instead of forcing the normal stop distance.",
    th: "ความผันผวนสูง ให้ขยาย SL ตามโครงสร้างหรือลดไซส์ลง อย่าฝืนใช้ระยะ SL เดิม",
  },
  "regime.note.low_volatility": {
    en: "Low volatility: trim the targets, because the range is unlikely to extend.",
    th: "ความผันผวนต่ำ ควรลดเป้าลง เพราะราคาไม่น่าจะวิ่งไกล",
  },

  // ---------------------------------------------------------------- score
  "score.label.zone": { en: "Zone quality", th: "คุณภาพโซน" },
  "score.label.htf": { en: "HTF trend alignment", th: "ไปทางเดียวกับไทม์เฟรมใหญ่" },
  "score.label.mtf": { en: "Multi-timeframe agreement", th: "ไทม์เฟรมสอดคล้องกัน" },
  "score.label.pullback": { en: "Pullback clarity", th: "ความชัดของการย่อ" },
  "score.label.confirmation": { en: "Confirmation present", th: "มีสัญญาณยืนยันแล้ว" },
  "score.label.riskReward": { en: "Risk / reward", th: "ความคุ้มค่า (R:R)" },
  "score.label.regime": { en: "Regime fit", th: "เข้ากับสภาพตลาด" },

  "score.note.zone": {
    en: "{kind} zone, {freshness}, reaction strength {strength}/100.",
    th: "{kind} สถานะ {freshness} แรงเด้งตอนออกจากโซน {strength}/100",
  },
  "score.note.noZone": {
    en: "No qualifying supply or demand zone is in range.",
    th: "ยังไม่มีโซน Supply/Demand ที่เข้าเกณฑ์ในระยะที่ราคาเอื้อมถึง",
  },
  "score.note.htf": {
    en: "Higher timeframe is {trend}; the setup direction is {direction}.",
    th: "ไทม์เฟรมใหญ่เป็น{trend} ส่วนเซ็ตอัพนี้เป็น{direction}",
  },
  "score.note.mtfClean": {
    en: "Chain agreement {agreement}/100 with no direct conflict.",
    th: "ไทม์เฟรมสอดคล้องกัน {agreement}/100 และไม่มีจุดขัดกันตรงๆ",
  },
  "score.note.pullback": {
    en: "Classified {verdict} at {strength}/100 classifier strength.",
    th: "จัดเป็น{verdict} ที่ความชัด {strength}/100",
  },
  "score.note.confirmationComplete": {
    en: "All required confirmations are already visible on the chart.",
    th: "สัญญาณยืนยันที่ต้องรอ มาครบแล้วบนกราฟ",
  },
  "score.note.confirmationPending": {
    en: "{count} confirmation condition(s) are still outstanding.",
    th: "ยังเหลือเงื่อนไขยืนยันอีก {count} ข้อ",
  },
  "score.note.riskReward": {
    en: "The best plan offers {rr}R to the first structural target.",
    th: "แผนที่ดีที่สุดให้ {rr}R ถึงเป้าแรกตามโครงสร้าง",
  },
  "score.note.regime": {
    en: "Market regime is {regime}.",
    th: "สภาพตลาดตอนนี้คือ{regime}",
  },

  // --------------------------------------------------------------- noTrade
  "noTrade.thinHistory": {
    en: "Only {count} candles are loaded on the entry timeframe, which is not enough history to confirm structure.",
    th: "ไทม์เฟรมที่ใช้เข้ามีแท่งเทียนแค่ {count} แท่ง ยังน้อยเกินไปที่จะยืนยันโครงสร้างได้",
  },
  "noTrade.neutralHtf": {
    en: "The higher timeframe has no clear direction, so a trend-pullback entry has nothing to align with.",
    th: "ไทม์เฟรมใหญ่ยังไม่มีทิศทางชัด การเข้าแบบรอย่อตามเทรนด์จึงไม่มีอะไรให้อ้างอิง",
  },
  "noTrade.timeframeDisagreement": {
    en: "Timeframes disagree: {conflict}",
    th: "ไทม์เฟรมขัดกัน: {conflict}",
  },
  "noTrade.reversal": {
    en: "The current retracement classifies as a reversal, not a pullback, so continuation entries are invalid.",
    th: "การย่อรอบนี้ถูกจัดเป็นการกลับตัว ไม่ใช่การย่อ เลยเข้าแบบไปต่อตามเทรนด์ไม่ได้",
  },
  "noTrade.compression": {
    en: "The market is compressed: stop distance is dominated by noise and breaks fail more often here.",
    th: "ตลาดบีบตัวแคบ ระยะ SL เจอแต่นอยส์ และการเบรกมักหลอกในสภาพนี้",
  },
  "noTrade.noZoneInRange": {
    en: "Price is not near any supply or demand zone of tradable quality.",
    th: "ราคายังไม่ได้อยู่ใกล้โซน Supply/Demand ที่คุณภาพพอจะเทรดได้",
  },
  "noTrade.noQualifyingZone": {
    en: "No supply or demand zone of tradable quality is in range of the current price.",
    th: "ไม่มีโซน Supply/Demand ที่คุณภาพพอจะเทรดได้ในระยะที่ราคาปัจจุบันเอื้อมถึง",
  },

  // ---------------------------------------------------------- confirmation
  "confirm.met.rejection": {
    en: "A rejection candle with a long wick into the zone has printed.",
    th: "มีแท่งปฏิเสธ (หางยาวแทงเข้าไปในโซน) ปิดแล้ว",
  },
  "confirm.pending.rejectionLong": {
    en: "A bullish rejection candle closing back inside or above the demand zone.",
    th: "รอแท่งปฏิเสธฝั่งซื้อ หางยาวลงล่าง แล้วปิดกลับขึ้นมาในหรือเหนือโซน Demand",
  },
  "confirm.pending.rejectionShort": {
    en: "A bearish rejection candle closing back inside or below the supply zone.",
    th: "รอแท่งปฏิเสธฝั่งขาย หางยาวขึ้นบน แล้วปิดกลับลงมาในหรือใต้โซน Supply",
  },
  "confirm.met.shift": {
    en: "A lower-timeframe {bias} {type} has already printed.",
    th: "ไทม์เฟรมเล็กเกิด {type} {bias} ไปแล้ว",
  },
  "confirm.pending.shift": {
    en: "A lower-timeframe {bias} CHoCH or BOS, confirming that buyers or sellers actually defended the zone.",
    th: "รอ CHoCH หรือ BOS {bias} ในไทม์เฟรมเล็ก เพื่อยืนยันว่ามีคนมาปกป้องโซนจริง",
  },
  "confirm.met.displacement": {
    en: "A displacement candle leaving the zone has printed.",
    th: "มีแท่ง displacement ออกจากโซนแล้ว",
  },
  "confirm.pending.displacement": {
    en: "A displacement candle — a body of at least 0.8 ATR — leaving the zone in your direction.",
    th: "รอแท่ง displacement (ตัวแท่งใหญ่กว่า 0.8 ATR) ที่ออกจากโซนไปทางเดียวกับเรา",
  },
  "confirm.fact.rejection": {
    en: "Rejection candle closed {side} with a dominant wick.",
    th: "แท่งปฏิเสธปิด{side} และหางยาวกินตัวแท่ง",
  },
  "confirm.fact.shift": {
    en: "{type} {bias} at {price} with {displacement} ATR of displacement.",
    th: "{type} {bias} ที่ราคา {price} แรงส่ง {displacement} ATR",
  },
  "confirm.fact.notTouched": {
    en: "Price has not traded into the zone in the last 6 candles.",
    th: "ราคายังไม่ได้เข้ามาในโซนเลยใน 6 แท่งที่ผ่านมา",
  },

  // ---------------------------------------------------------- setup facts
  "setup.fact.price": {
    en: "Current price is {price} on {tf}, with ATR {atr}.",
    th: "ราคาปัจจุบัน {price} บนไทม์เฟรม {tf} ค่า ATR {atr}",
  },
  "setup.fact.distance": {
    en: "Distance from price to the zone: {distance} ATR.",
    th: "ระยะจากราคาถึงโซน: {distance} ATR",
  },
  "setup.fact.quality": {
    en: "Setup Quality Score is {score}/100, grade {grade} — a quality grade, not a win probability.",
    th: "คะแนนคุณภาพเซ็ตอัพ {score}/100 เกรด {grade} — เป็นคะแนน \"คุณภาพ\" ไม่ใช่โอกาสชนะ",
  },
  "setup.fact.confidence": {
    en: "Analysis confidence is {confidence}/100, which is a separate number from Setup Quality.",
    th: "ความมั่นใจของระบบวิเคราะห์ {confidence}/100 ซึ่งเป็นคนละตัวกับคะแนนคุณภาพ",
  },
  "setup.fact.dataQuality": {
    en: "Data quality is {quality} from {provider}, using {count} candles.",
    th: "คุณภาพข้อมูล {quality} จาก {provider} ใช้แท่งเทียน {count} แท่ง",
  },

  // ----------------------------------------------------- setup assumptions
  "setup.assume.htfHolds": {
    en: "Assumes the current higher-timeframe direction holds while price works through the zone.",
    th: "สมมติว่าทิศทางของไทม์เฟรมใหญ่ยังไม่เปลี่ยน ตอนที่ราคากำลังทำงานอยู่ในโซนนี้",
  },
  "setup.assume.zoneIntact": {
    en: "Assumes the zone has not been consumed by order flow that candle data cannot show.",
    th: "สมมติว่าโซนยังไม่ถูกกินออเดอร์ไปแล้วแบบที่กราฟแท่งเทียนมองไม่เห็น",
  },
  "setup.assume.candlesComplete": {
    en: "Assumes {provider} candles are complete and the last candle is still forming.",
    th: "สมมติว่าแท่งเทียนจาก {provider} ครบถ้วน และแท่งสุดท้ายยังวิ่งไม่จบ",
  },
  "setup.assume.disciplinedFill": {
    en: "Assumes you execute at the planned level rather than chasing price.",
    th: "สมมติว่าคุณเข้าที่ราคาตามแผน ไม่ใช่วิ่งตามราคา",
  },
  "setup.assume.dataNotLive": {
    en: "Data quality is {quality}, so levels are indicative and must be re-checked against your broker feed.",
    th: "ข้อมูลเป็นแบบ {quality} ราคาที่เห็นจึงเป็นตัวเลขอ้างอิง ต้องเทียบกับฟีดโบรกเกอร์ก่อนเข้าจริง",
  },
  "setup.assume.notLookingForReason": {
    en: "Assumes you are not looking for a reason to be in the market.",
    th: "สมมติว่าคุณไม่ได้กำลังหาเหตุผลเพื่อจะได้เข้าตลาด",
  },

  // -------------------------------------------------------- setup whyEnter
  "setup.enter.withTrend": {
    en: "The higher timeframe is {trend} and this is a {direction} back in that direction, not against it.",
    th: "ไทม์เฟรมใหญ่เป็น{trend} และไม้นี้เป็น{direction} ไปทางเดียวกับเทรนด์ ไม่ได้สวน",
  },
  "setup.enter.zoneQuality": {
    en: "The {kind} zone is {freshness} with reaction strength {strength}/100 — price left it with {displacement} ATR of displacement.",
    th: "{kind} สถานะ {freshness} แรงเด้ง {strength}/100 — ราคาเคยออกจากโซนนี้ด้วยแรง {displacement} ATR",
  },
  "setup.enter.trackRecord": {
    en: "This zone previously {impact}, so it has a track record of mattering.",
    th: "โซนนี้{impact} แปลว่ามีประวัติว่า \"ใช้ได้จริง\"",
  },
  "setup.enter.htfAligned": {
    en: "The zone sits on the right side of the higher-timeframe bias.",
    th: "โซนอยู่ฝั่งเดียวกับ bias ของไทม์เฟรมใหญ่",
  },
  "setup.enter.hasTarget": {
    en: "There is a defined first target: {reason}",
    th: "มีเป้าแรกที่ชัดเจน: {reason}",
  },
  "setup.enter.plan": {
    en: "The plan is concrete: {entryType}, entry {low} to {high}, stop {stop}, {rr}R to the first target.",
    th: "แผนชัดเจน: {entryType} โซนเข้า {low} ถึง {high} SL {stop} และได้ {rr}R ถึงเป้าแรก",
  },
  "setup.enter.score": {
    en: "Setup Quality Score is {score}/100 — a grade for how well this matches the plan, not a forecast of the outcome.",
    th: "คะแนนคุณภาพ {score}/100 — เป็นคะแนนว่าตรงกับแผนแค่ไหน ไม่ใช่การทำนายผล",
  },

  // --------------------------------------------------------- setup whyWait
  "setup.wait.midRange": {
    en: "Price is still {distance} ATR away from the zone. Entering here is entering mid-range.",
    th: "ราคายังห่างจากโซนอีก {distance} ATR ถ้าเข้าตอนนี้คือเข้ากลางทาง",
  },
  "setup.wait.missing": {
    en: "Missing: {condition}",
    th: "ยังขาด: {condition}",
  },
  "setup.wait.notPullback": {
    en: "The retracement is classified as {verdict} at {strength}/100, so continuation is not yet established.",
    th: "การย่อรอบนี้ถูกจัดเป็น{verdict} ที่ {strength}/100 จึงยังยืนยันไม่ได้ว่าจะไปต่อ",
  },
  "setup.wait.conflict": {
    en: "Timeframe conflict: {conflict}",
    th: "ไทม์เฟรมขัดกัน: {conflict}",
  },
  "setup.wait.nothingOutstanding": {
    en: "Nothing is outstanding on the chart. The remaining reason to wait is your own risk state, not the setup.",
    th: "บนกราฟไม่มีอะไรค้างแล้ว เหลือแค่ความพร้อมของตัวเราเอง ไม่ใช่เรื่องเซ็ตอัพ",
  },

  // ----------------------------------------------------- setup invalidation
  "setup.invalid.closeBeyondZone": {
    en: "A candle closing {side} {price}, the far edge of the zone, invalidates this setup.",
    th: "ถ้ามีแท่งปิด{side} {price} ซึ่งเป็นขอบไกลของโซน ถือว่าเซ็ตอัพนี้เสีย",
  },
  "setup.invalid.counterChoch": {
    en: "A {bias} CHoCH through {price} means structure has shifted against the idea.",
    th: "ถ้าเกิด CHoCH {bias} ผ่าน {price} แปลว่าโครงสร้างเปลี่ยนข้างไปสวนกับไอเดียนี้แล้ว",
  },
  "setup.invalid.absorbed": {
    en: "Price sitting inside the zone for more than roughly {candles} candles without reacting means the zone is being absorbed rather than defended.",
    th: "ถ้าราคานิ่งอยู่ในโซนเกินประมาณ {candles} แท่งโดยไม่มีปฏิกิริยา แปลว่าโซนกำลังถูกกินออเดอร์ ไม่ใช่ถูกปกป้อง",
  },
  "setup.invalid.testedAlready": {
    en: "This zone has already been tested {tests} times; another test without a reaction makes it a weak zone.",
    th: "โซนนี้ถูกทดสอบไปแล้ว {tests} ครั้ง ถ้าแตะอีกครั้งแล้วไม่เด้ง ให้ลดชั้นเป็นโซนอ่อน",
  },
  "setup.invalid.secondTest": {
    en: "A second test without a reaction downgrades the zone.",
    th: "ถ้าแตะโซนครั้งที่สองแล้วไม่มีปฏิกิริยา ให้ลดชั้นโซนลง",
  },
  "setup.invalid.keptInHistory": {
    en: "Invalidated setups are kept in history and marked ENTRY INVALIDATED — they are never deleted.",
    th: "เซ็ตอัพที่เสียจะถูกเก็บไว้ในประวัติและติดป้าย ENTRY INVALIDATED ไม่ลบทิ้ง",
  },
  "setup.invalid.noTradeChanges": {
    en: "This NO TRADE call changes as soon as price reaches a qualifying zone with the chain aligned.",
    th: "คำว่าไม่เทรดนี้จะเปลี่ยนทันทีที่ราคาเข้าโซนที่เข้าเกณฑ์ และไทม์เฟรมเรียงตรงกัน",
  },

  // --------------------------------------------------- setup interpretation
  "setup.read.shape": {
    en: "Reading: {trend} higher-timeframe structure with {verdict} into a {tf} {kind} zone. That is the shape this plan is built around.",
    th: "อ่านได้ว่า: โครงสร้างไทม์เฟรมใหญ่{trend} แล้วเกิด{verdict} กลับเข้ามาหา{kind} บน {tf} — แผนนี้สร้างขึ้นจากรูปแบบนี้",
  },
  "setup.read.regime": {
    en: "The regime is {regime}, which affects how far targets can realistically run.",
    th: "สภาพตลาดตอนนี้คือ{regime} ซึ่งมีผลกับระยะที่เป้าหมายจะวิ่งไปถึงได้จริง",
  },
  "setup.read.chainClean": {
    en: "Timeframe chain agreement is {agreement}/100 with no direct conflict.",
    th: "ไทม์เฟรมสอดคล้องกัน {agreement}/100 และไม่มีจุดขัดกันตรงๆ",
  },
  "setup.read.chainConflict": {
    en: "Timeframe chain agreement is {agreement}/100, with one conflict: {conflict}",
    th: "ไทม์เฟรมสอดคล้องกัน {agreement}/100 แต่มีจุดขัดกันหนึ่งจุด: {conflict}",
  },
  "setup.read.lifecycle": {
    en: "The lifecycle state is {status}. The score of {score}/100 reflects how well this matches the plan, not how likely it is to win.",
    th: "สถานะวงจรของเซ็ตอัพคือ{status} คะแนน {score}/100 บอกว่าตรงกับแผนแค่ไหน ไม่ได้บอกว่าจะชนะแค่ไหน",
  },
  "setup.read.defenders": {
    en: "Interpretation: {side} are expected to defend this area, because that is where the last impulse originated.",
    th: "ตีความ: คาด{side}จะเข้ามาปกป้องโซนนี้ เพราะเป็นจุดที่แรงครั้งก่อนออกตัวมา",
  },
  "setup.read.buyers": { en: "buyers", th: "ฝั่งซื้อ" },
  "setup.read.sellers": { en: "sellers", th: "ฝั่งขาย" },
  "setup.read.noSetup": {
    en: "Interpretation: there is no setup that matches the trading plan right now. That is a normal, frequent outcome.",
    th: "ตีความ: ตอนนี้ไม่มีเซ็ตอัพที่ตรงกับแผนเทรด ซึ่งเป็นเรื่องปกติและเกิดบ่อย",
  },
  "setup.read.noSetupContext": {
    en: "The regime is {regime} and the higher timeframe reads {trend}.",
    th: "สภาพตลาดตอนนี้คือ{regime} และไทม์เฟรมใหญ่อ่านได้ว่า{trend}",
  },
  "setup.read.zoneHasOrders": {
    en: "This zone is interesting because real buying or selling pressure once left it with {displacement} ATR of displacement — that is evidence of orders, not a drawing.",
    th: "โซนนี้น่าสนใจเพราะเคยมีแรงซื้อ/แรงขายจริงดันราคาออกไปด้วย displacement {displacement} ATR — เป็นหลักฐานว่ามีออเดอร์จริง ไม่ใช่แค่ลากกรอบ",
  },

  // ----------------------------------------------------------------- plans
  "plan.note.conservative1": {
    en: "Waits for confirmation first, then enters on the retest. Worst fill, least guesswork.",
    th: "รอสัญญาณยืนยันก่อน แล้วเข้าตอนราคากลับมารีเทสต์ ได้ราคาแย่สุดแต่เดาน้อยสุด",
  },
  "plan.note.conservative2": {
    en: "If price never retests, this plan simply does not trigger — and that is acceptable.",
    th: "ถ้าราคาไม่กลับมารีเทสต์ แผนนี้ก็ไม่ทำงาน ซึ่งไม่เป็นไร",
  },
  "plan.note.balanced": {
    en: "Enters once confirmation prints inside the zone.",
    th: "เข้าเมื่อสัญญาณยืนยันเกิดขึ้นในโซน",
  },
  "plan.note.balancedLive": {
    en: "Confirmation is already visible, so this plan is live.",
    th: "สัญญาณยืนยันมาแล้ว แผนนี้พร้อมใช้งาน",
  },
  "plan.note.balancedPending": {
    en: "Still needs: {condition}",
    th: "ยังต้องรอ: {condition}",
  },
  "plan.note.aggressiveLimit": {
    en: "Limit order at the far edge of the zone. Best price, highest chance of being skipped.",
    th: "ตั้งลิมิตที่ขอบไกลของโซน ได้ราคาดีที่สุด แต่มีโอกาสสูงที่ราคาจะไม่ลงมาถึง",
  },
  "plan.note.probe1": {
    en: "Probe entry — this is NOT the full position. Half the normal risk unit.",
    th: "ไม้ทดลอง — ยังไม่ใช่ไม้เต็ม ใช้ความเสี่ยงครึ่งเดียวของปกติ",
  },
  "plan.note.probe2": {
    en: "Only add the rest once confirmation prints; if it does not, the probe is closed, not defended.",
    th: "จะเติมไม้ที่เหลือก็ต่อเมื่อสัญญาณยืนยันมา ถ้าไม่มา ให้ปิดไม้ทดลองทิ้ง ไม่ใช่ถือสู้",
  },
  "plan.note.noTrade": {
    en: "Standing aside is a position. Nothing here matches the plan.",
    th: "การอยู่เฉยก็เป็นการตัดสินใจอย่างหนึ่ง ตอนนี้ไม่มีอะไรตรงกับแผน",
  },
  "plan.stop.none": {
    en: "No entry, so no stop is defined.",
    th: "ไม่มีจุดเข้า จึงไม่มี SL",
  },

  // --------------------------------------------------------------- targets
  "target.priorSwing": {
    en: "The previous {swing} — the first place where the move is likely to stall.",
    th: "{swing}ก่อนหน้า — จุดแรกที่ราคามักจะชะลอ",
  },
  "target.measuredMove": {
    en: "Measured move: 1.5x the leg that created this zone, projected from the entry area.",
    th: "วัดจากขาที่สร้างโซนนี้ คูณ 1.5 แล้วทาบจากโซนเข้า",
  },
  "target.trendExtension": {
    en: "Trend extension target for the runner portion, 6 ATR from the entry area.",
    th: "เป้าไกลสำหรับไม้ที่ปล่อยให้วิ่ง ห่างจากโซนเข้า 6 ATR",
  },

  // ------------------------------------------------------------------ risk
  "risk.stop.structural": {
    en: "Placed {pad} ATR beyond {level} ({price}), because price trading through that level is what invalidates the idea.",
    th: "วาง SL ห่างออกไป {pad} ATR จาก{level} ({price}) เพราะถ้าราคาผ่านระดับนั้น ไอเดียนี้ถือว่าเสีย",
  },
  "risk.stop.zoneEdge": { en: "the far edge of the zone", th: "ขอบไกลของโซน" },
  "risk.stop.protectedSwing": { en: "the protected swing {side}", th: "{side}ที่ปกป้องไม้นี้" },

  "risk.warn.balance": {
    en: "Account balance must be greater than zero.",
    th: "ยอดเงินในพอร์ตต้องมากกว่าศูนย์",
  },
  "risk.warn.riskPercentZero": {
    en: "Risk percent must be greater than zero.",
    th: "เปอร์เซ็นต์ความเสี่ยงต้องมากกว่าศูนย์",
  },
  "risk.warn.riskPercentHigh": {
    en: "Risking {percent}% per trade is above the 2% ceiling in your plan. Four losses in a row would cost about {total}% of the account.",
    th: "เสี่ยง {percent}% ต่อไม้ เกินเพดาน 2% ที่แผนกำหนด ถ้าแพ้ติดกัน 4 ไม้จะเสียพอร์ตประมาณ {total}%",
  },
  "risk.warn.stopEqualsEntry": {
    en: "The stop loss equals the entry price, so no position size can be calculated.",
    th: "SL อยู่ที่เดียวกับราคาเข้า จึงคำนวณขนาดไม้ไม่ได้",
  },
  "risk.warn.belowMinLot": {
    en: "The calculated size is below the smallest tradable lot (0.01). Either the stop is too wide for this account or the risk percent is too small.",
    th: "ขนาดไม้ที่คำนวณได้น้อยกว่าล็อตต่ำสุด (0.01) อาจเพราะ SL กว้างเกินไปสำหรับพอร์ตนี้ หรือเปอร์เซ็นต์ความเสี่ยงต่ำเกินไป",
  },
  "risk.warn.smallAccount": {
    en: "Small account mode: at this balance one normal-sized loss is a large share of the account. Consider a probe entry and fewer concurrent positions.",
    th: "โหมดพอร์ตเล็ก: ด้วยยอดเงินเท่านี้ การแพ้ไม้ปกติหนึ่งไม้กินสัดส่วนพอร์ตเยอะ ลองใช้ไม้ทดลองและถือพร้อมกันน้อยลง",
  },
  "risk.warn.above5": {
    en: "Above 5% per trade, a short losing streak is account-threatening.",
    th: "เสี่ยงเกิน 5% ต่อไม้ แพ้ติดกันไม่กี่ไม้ก็อันตรายถึงพอร์ต",
  },
  "risk.warn.above2": {
    en: "Above 2% per trade is outside the plan this coach is built around.",
    th: "เสี่ยงเกิน 2% ต่อไม้ ออกนอกแผนที่โค้ชตัวนี้ยึดอยู่",
  },

  "risk.be.noStopDistance": {
    en: "Stop distance is zero, so there is nothing to move.",
    th: "ระยะ SL เป็นศูนย์ จึงไม่มีอะไรให้ขยับ",
  },
  "risk.be.notEnoughProgress": {
    en: "The trade is only {progress}R in profit. Moving the stop now would shrink the stop before the market has proved the idea.",
    th: "ไม้นี้กำไรแค่ {progress}R ถ้าขยับ SL ตอนนี้คือบีบ SL ก่อนที่ตลาดจะพิสูจน์ไอเดีย",
  },
  "risk.be.noNewSwing": {
    en: "The trade is {progress}R in profit, but no new swing has formed to protect, so break-even would be an arbitrary level.",
    th: "ไม้นี้กำไร {progress}R แล้ว แต่ยังไม่มีสวิงใหม่ให้ปกป้อง การเลื่อนมาเท่าทุนจึงเป็นการเลือกระดับแบบไม่มีเหตุผล",
  },
  "risk.be.swingNotBeyond": {
    en: "The newest swing is not beyond the current stop, so moving the stop would not reduce risk.",
    th: "สวิงใหม่ยังไม่เลย SL เดิม การขยับ SL จึงไม่ได้ลดความเสี่ยงลง",
  },
  "risk.be.move": {
    en: "Price is {progress}R in profit and a new {swing} formed at {level}. Moving the stop behind that swing reduces risk for a structural reason.",
    th: "ราคากำไร {progress}R แล้ว และเกิด{swing}ใหม่ที่ {level} การเลื่อน SL ไปหลังสวิงนั้นลดความเสี่ยงโดยมีเหตุผลทางโครงสร้างรองรับ",
  },

  // -------------------------------------------------------------- re-entry
  "reentry.ok.differentSymbol": {
    en: "A different instrument, so this is not a re-entry.",
    th: "เป็นสินทรัพย์ตัวอื่น จึงไม่นับเป็นการเข้าซ้ำ",
  },
  "reentry.no.sameZone": {
    en: "Same zone as the trade that just failed. Re-entering here is revenge, not a new setup.",
    th: "โซนเดิมกับไม้ที่เพิ่งเสียไป เข้าซ้ำที่นี่คือการแก้แค้นตลาด ไม่ใช่เซ็ตอัพใหม่",
  },
  "reentry.ok.oppositeDirection": {
    en: "Opposite direction after a structure shift, so this is a new idea.",
    th: "คนละทิศหลังโครงสร้างเปลี่ยน ถือเป็นไอเดียใหม่",
  },
  "reentry.no.lowerScore": {
    en: "The new setup scores {candidate}/100, lower than the {previous}/100 setup that already failed.",
    th: "เซ็ตอัพใหม่ได้ {candidate}/100 ต่ำกว่าเซ็ตอัพ {previous}/100 ที่เพิ่งเสียไป",
  },
  "reentry.ok.freshConfirmation": {
    en: "A new zone with fresh confirmation after the previous idea was invalidated.",
    th: "โซนใหม่ที่มีสัญญาณยืนยันใหม่ หลังไอเดียก่อนหน้าเสียไปแล้ว",
  },
  "reentry.no.missingConfirmation": {
    en: "Confirmation is still missing: {condition} Waiting is the re-entry rule.",
    th: "ยังขาดสัญญาณยืนยัน: {condition} กฎของการเข้าซ้ำคือต้องรอ",
  },

  // ---------------------------------------------------------------- alerts
  "alert.newSetup": {
    en: "New {direction} setup on {symbol} {tf}: {state}.",
    th: "มีเซ็ตอัพ{direction}ใหม่บน {symbol} {tf}: {state}",
  },
  "alert.invalidated": {
    en: "The {symbol} {direction} setup is now ENTRY INVALIDATED: {reason}",
    th: "เซ็ตอัพ{direction} {symbol} ตอนนี้ ENTRY INVALIDATED แล้ว: {reason}",
  },
  "alert.invalidatedZoneBroken": {
    en: "the zone was broken",
    th: "โซนถูกทำลาย",
  },
  "alert.stateChange": {
    en: "{symbol} moved from {from} to {to}.",
    th: "{symbol} เปลี่ยนจาก{from} ไปเป็น{to}",
  },
  "alert.statusChange": {
    en: "The {symbol} setup status went from {from} to {to}.",
    th: "สถานะเซ็ตอัพ {symbol} เปลี่ยนจาก{from} เป็น{to}",
  },
  "alert.qualityJump": {
    en: "{symbol} Setup Quality moved from {from} to {to}.",
    th: "คะแนนคุณภาพของ {symbol} ขยับจาก {from} เป็น {to}",
  },

  // ------------------------------------------------------------ psychology
  "psych.earlyEntry.pending": {
    en: "The entry was taken while {count} confirmation condition(s) were still outstanding on the linked setup.",
    th: "เข้าไม้ตอนที่เซ็ตอัพที่ผูกไว้ยังเหลือเงื่อนไขยืนยันอีก {count} ข้อ",
  },
  "psych.directionMismatch": {
    en: "The trade direction did not match the analysed setup direction.",
    th: "ทิศทางของไม้ไม่ตรงกับทิศทางของเซ็ตอัพที่วิเคราะห์ไว้",
  },
  "psych.outsideZone": {
    en: "The fill at {price} was outside the planned entry zone {low} to {high}.",
    th: "ได้ราคา {price} ซึ่งอยู่นอกโซนเข้าที่วางแผนไว้ {low} ถึง {high}",
  },
  "psych.movedStop": {
    en: "Adverse excursion reached {mae}R, which is beyond the original stop — the stop was widened or ignored.",
    th: "ราคาสวนไปถึง {mae}R ซึ่งเลย SL เดิมไปแล้ว แปลว่า SL ถูกขยายหรือถูกเมิน",
  },
  "psych.earlyBreakeven": {
    en: "The trade ran to {mfe}R but closed at break-even, so the management rule cut the winner short.",
    th: "ไม้นี้วิ่งไปถึง {mfe}R แต่ปิดเท่าทุน กฎการบริหารไม้ตัดไม้ที่กำไรทิ้งเร็วเกินไป",
  },
  "psych.noResult": {
    en: "The trade has no result yet, or it was logged as a setup that was never taken.",
    th: "ไม้นี้ยังไม่มีผล หรือถูกบันทึกไว้เป็นเซ็ตอัพที่ไม่ได้เข้า",
  },
  "psych.winOnBadSetup": {
    en: "Profitable, but the setup only scored {score}/100 — the outcome does not validate the process.",
    th: "ได้กำไร แต่เซ็ตอัพได้แค่ {score}/100 — ผลลัพธ์ไม่ได้รับรองว่ากระบวนการถูก",
  },
  "psych.badExecution": {
    en: "The setup was acceptable; the loss came from how it was executed or managed.",
    th: "เซ็ตอัพใช้ได้ การเสียมาจากวิธีเข้าหรือวิธีบริหารไม้",
  },
  "psych.badSetup": {
    en: "The setup scored {score}/100 before entry, so this loss was avoidable at the analysis stage.",
    th: "เซ็ตอัพได้ {score}/100 ก่อนเข้า การเสียครั้งนี้เลี่ยงได้ตั้งแต่ตอนวิเคราะห์",
  },
  "psych.noSetupLinked": {
    en: "No setup was linked to this trade, so there is no recorded plan it followed.",
    th: "ไม้นี้ไม่ได้ผูกกับเซ็ตอัพไหน จึงไม่มีแผนที่บันทึกไว้ว่าทำตาม",
  },
  "psych.validLoss": {
    en: "The setup matched the plan and the execution followed it. This is the cost of doing business.",
    th: "เซ็ตอัพตรงแผนและเข้าตามแผน อันนี้คือต้นทุนของการทำธุรกิจนี้",
  },
  "psych.evidence.tagged": {
    en: "Trade {id} on {symbol} was tagged {tag} in the journal.",
    th: "ไม้ {id} บน {symbol} ถูกติดแท็ก {tag} ไว้ในบันทึก",
  },
  "psych.evidence.revenge": {
    en: "Trade {id} opened only {minutes} minutes after the losing trade {previous}.",
    th: "ไม้ {id} เปิดห่างจากไม้ที่เสีย ({previous}) แค่ {minutes} นาที",
  },
  "psych.evidence.oversizing": {
    en: "Trade {id} used size {size} after a loss on {previous} sized {previousSize}.",
    th: "ไม้ {id} ใช้ไซส์ {size} หลังเสียไม้ {previous} ที่ใช้ไซส์ {previousSize}",
  },
  "psych.evidence.overconfidence": {
    en: "Trade {id} increased size to {size} immediately after a {result}R win on {previous}.",
    th: "ไม้ {id} เพิ่มไซส์เป็น {size} ทันทีหลังชนะ {result}R จากไม้ {previous}",
  },
  "psych.report.tradeCount": {
    en: "{count} trade(s) logged in the window.",
    th: "มีไม้ที่บันทึกไว้ในช่วงนี้ {count} ไม้",
  },
  "psych.report.classification": {
    en: "{count} trade(s) classified as {classification}.",
    th: "ไม้ที่ถูกจัดเป็น{classification} มี {count} ไม้",
  },
  "psych.report.pattern": {
    en: "Pattern {tag} appeared {count} time(s), costing {cost}R in total.",
    th: "พฤติกรรม {tag} เกิดขึ้น {count} ครั้ง เสียไปรวม {cost}R",
  },
  "psych.report.noPattern": {
    en: "No behavioural pattern has enough journal evidence to report.",
    th: "ยังไม่มีพฤติกรรมไหนที่มีหลักฐานในบันทึกมากพอจะรายงานได้",
  },

  "label.classification.valid_loss": { en: "a valid loss", th: "การเสียที่ถูกต้องตามแผน" },
  "label.classification.bad_setup": { en: "a bad setup", th: "เซ็ตอัพไม่ดี" },
  "label.classification.good_setup_bad_execution": {
    en: "a good setup with bad execution",
    th: "เซ็ตอัพดีแต่เข้าไม่ดี",
  },
  "label.classification.emotional_trade": { en: "an emotional trade", th: "เทรดด้วยอารมณ์" },
  "label.classification.missed_trade": { en: "a missed trade", th: "ไม้ที่พลาดไป" },
  "label.classification.valid_win": { en: "a valid win", th: "การชนะที่ถูกต้องตามแผน" },
} as const satisfies Record<string, Pair>;

export type PhraseKey = keyof typeof PHRASES;

/** Build a phrase. The key is checked at compile time against the catalogue. */
export function p(key: PhraseKey, vars?: Record<string, PhraseVar>): Phrase {
  return vars === undefined ? { key } : { key, vars };
}

// Enum -> label phrase. Keeps call sites free of string concatenation.
export const trendPhrase = (v: TrendState): Phrase => ({ key: `label.trend.${v}` });
export const phasePhrase = (v: TrendPhase): Phrase => ({ key: `label.phase.${v}` });
export const regimePhrase = (v: MarketRegime): Phrase => ({ key: `label.regime.${v}` });
export const freshnessPhrase = (v: ZoneFreshness): Phrase => ({ key: `label.freshness.${v}` });
export const impactPhrase = (v: ZoneStructuralImpact): Phrase => ({ key: `label.impact.${v}` });
export const statusPhrase = (v: SetupStatus): Phrase => ({ key: `label.status.${v}` });
export const scannerPhrase = (v: ScannerState): Phrase => ({ key: `label.scanner.${v}` });
export const entryTypePhrase = (v: EntryType): Phrase => ({ key: `label.entryType.${v}` });
export const verdictPhrase = (v: PullbackVerdict): Phrase => ({ key: `label.verdict.${v}` });
export const zoneKindPhrase = (v: ZoneKind): Phrase => ({ key: `label.zoneKind.${v}` });
export const directionPhrase = (v: Direction): Phrase => ({ key: `label.direction.${v}` });
export const biasPhrase = (v: "bullish" | "bearish" | "neutral"): Phrase => ({
  key: `label.bias.${v}`,
});

/**
 * Render a phrase in one language.
 *
 * An unknown key renders as `[key]` rather than throwing or returning "": a
 * missing translation has to be *visible*, because a silently empty reason on a
 * trading screen is worse than an ugly one.
 */
export function renderPhrase(phrase: Phrase, locale: Locale): string {
  const entry = (PHRASES as Record<string, Pair | undefined>)[phrase.key];
  if (!entry) return `[${phrase.key}]`;
  const template = locale === "th" ? entry.th : entry.en;
  if (!phrase.vars) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = phrase.vars?.[name];
    if (value === undefined) return whole;
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return renderPhrase(value, locale);
  });
}

export function renderPhrases(phrases: Phrase[], locale: Locale): string[] {
  return phrases.map((phrase) => renderPhrase(phrase, locale));
}
