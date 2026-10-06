"""One-off: extend the trading.replay i18n block with practice-log keys.

Written as a script rather than hand-edited JSON so both locales are guaranteed
to get exactly the same key set.
"""

import io
import json
import collections

TH = {
    "log": {
        "title": "บันทึกการฝึกทุกไม้",
        "subtitle": "ทุกไม้ที่กดไว้ พร้อมราคาเข้า ราคาออก และกำไร/ขาดทุนจริง",
        "empty": "ยังไม่ได้กดไม้ไหนเลย ลองกดทายทิศดูก่อน",
        "entry": "ราคาเข้า",
        "stop": "จุดตัดขาดทุน (SL)",
        "target": "เป้าทำกำไร (TP)",
        "exit": "ราคาออก",
        "move": "ราคาวิ่งไป",
        "held": "ถือไว้",
        "bars": "แท่ง",
        "atCandle": "แท่งที่",
        "mfe": "ไปได้ไกลสุด",
        "mae": "สวนหนักสุด",
        "open": "ยังไม่ปิด",
        "result": "ผล",
        "hitTarget": "ถึงเป้า TP",
        "hitStop": "โดน SL",
        "windowClose": "หมดเวลาวัด ปิดตามราคาตลาด",
        "ambiguous": "แท่งเดียวกันแตะทั้ง SL และ TP ข้อมูลระดับแท่งไม่บอกว่าอันไหนมาก่อน ระบบจึงนับเป็น SL (ฝั่งที่เสียเปรียบเรา) ไม่เดาเข้าข้างตัวเอง",
        "noEnginePlan": "ตอนนั้นเอนจินไม่ได้ให้แผน ระบบใช้ SL 1.5×ATR และเป้า 2R แทน เพื่อให้วัดผลได้",
        "engineAtCall": "สิ่งที่เอนจินเห็นตอนกด",
        "stayedOut": "เลือกไม่เข้า",
        "stayedOutGood": "ไม่เข้าถูกแล้ว ราคาแทบไม่ไปไหน",
        "stayedOutMissed": "ราคาวิ่งจริง ไม่เข้าก็พลาดไป (แต่ถ้าเหตุผลตอนนั้นถูก ก็ยังเป็นการตัดสินใจที่ดี)",
        "priceRose": "ราคาขึ้น",
        "priceFell": "ราคาลง",
        "reviewHint": "ดูย้อนหลังได้ว่าตอนนั้นคิดอะไร แล้วกราฟออกมาแบบไหน นี่คือส่วนที่ทำให้ฝึกแล้วเก่งขึ้นจริง ไม่ใช่แค่ดูว่าถูกหรือผิด",
    },
    "summary": {
        "title": "สรุปผลการฝึกรอบนี้",
        "calls": "กดไปแล้ว",
        "resolved": "รู้ผลแล้ว",
        "pending": "รอผล",
        "wins": "ไม้กำไร",
        "losses": "ไม้ขาดทุน",
        "totalR": "รวม R",
        "avgR": "เฉลี่ยต่อไม้",
        "bestR": "ไม้ดีสุด",
        "worstR": "ไม้แย่สุด",
        "hitRate": "อัตราเข้าเป้า",
        "notEnough": "ไม้ยังน้อย ตัวเลขพวกนี้ยังบอกฝีมืออะไรไม่ได้ ดูเหตุผลรายไม้จะได้ประโยชน์กว่า",
        "reset": "ล้างบันทึกการฝึก",
    },
    "callRecorded": "จดไม้ไว้แล้ว เดินกราฟต่อไปเรื่อย ๆ จนโดน SL หรือถึง TP ระบบจะสรุปผลให้เอง",
    "window": "วัดผลภายใน",
}

EN = {
    "log": {
        "title": "Every practice trade",
        "subtitle": "Each call you made, with the entry price, the exit price and the real result.",
        "empty": "No calls yet. Make one to start the log.",
        "entry": "Entry",
        "stop": "Stop loss",
        "target": "Take profit",
        "exit": "Exit",
        "move": "Price travelled",
        "held": "Held for",
        "bars": "candles",
        "atCandle": "candle",
        "mfe": "Best excursion",
        "mae": "Worst excursion",
        "open": "Still open",
        "result": "Result",
        "hitTarget": "Target hit",
        "hitStop": "Stopped out",
        "windowClose": "Measurement window closed, exited at market",
        "ambiguous": "One candle touched both the stop and the target. Candle data does not say which came first, so this is scored as a stop — the outcome against us. We do not guess in our own favour.",
        "noEnginePlan": "The engine had no plan at that moment, so a 1.5xATR stop and a 2R target were used to make the call measurable.",
        "engineAtCall": "What the engine saw when you called it",
        "stayedOut": "Stood aside",
        "stayedOutGood": "Standing aside was right: price barely moved.",
        "stayedOutMissed": "Price did travel, so this one was missed (which is still fine if your reasoning was sound).",
        "priceRose": "Price rose",
        "priceFell": "Price fell",
        "reviewHint": "Review what you were thinking and what the chart then did. That is the part that builds skill — not the hit rate.",
    },
    "summary": {
        "title": "This session",
        "calls": "Calls made",
        "resolved": "Resolved",
        "pending": "Awaiting result",
        "wins": "Winners",
        "losses": "Losers",
        "totalR": "Total R",
        "avgR": "Average per trade",
        "bestR": "Best trade",
        "worstR": "Worst trade",
        "hitRate": "Target hit rate",
        "notEnough": "Too few trades for these numbers to say anything about skill. The per-trade reasoning is the useful part.",
        "reset": "Clear practice log",
    },
    "callRecorded": "Call recorded. Keep stepping the chart; it settles when the stop or the target is reached.",
    "window": "Measured within",
}


def merge(locale: str, additions: dict) -> None:
    path = f"apps/web/src/i18n/locales/{locale}/trading.json"
    with io.open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)
    replay = data["replay"]
    for key, value in additions.items():
        replay[key] = value
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{path}: replay now has {len(replay)} keys")


merge("th", TH)
merge("en", EN)
