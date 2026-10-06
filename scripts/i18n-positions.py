"""One-off: explain what the Positions screen actually connects to (§27), and
give it an open-a-position flow of its own instead of sending the user to the
journal and hoping they work it out.
"""

import collections
import io
import json

TH = {
    "positions": {
        "howItWorks": "หน้านี้ทำงานยังไง",
        "notConnected": "ไม่ได้ต่อกับโบรกเกอร์",
        "howItWorksBody": "หน้านี้ไม่ได้เชื่อมกับพอร์ตโบรกเกอร์ และไม่ได้ส่งคำสั่งซื้อขายแทนคุณ มันคือสมุดบันทึกไม้ที่คุณเปิดไว้ด้วยมือ คุณกดเทรดที่โบรกเกอร์ของคุณเอง แล้วมาจดไว้ที่นี่ ระบบจะดึงราคาปัจจุบันมาคำนวณ R ให้ และคอยดูให้ว่าควรเลื่อน SL มาเท่าทุนหรือยัง",
        "whyManual": "ทำไมต้องจดเอง",
        "whyManualBody": "เพราะระบบนี้ตั้งใจไม่ให้ยิงออเดอร์แทนคุณ การตัดสินใจและการกดเทรดเป็นของคุณ ระบบมีหน้าที่อ่านตลาด เตือน และวัดผลย้อนหลัง",
        "step1": "ดูเซ็ตอัพในหน้า Setups แล้วถ้าจะเอาจริง ให้กดเทรดที่โบรกเกอร์ของคุณ",
        "step2": "กลับมาที่หน้านี้ กด \"เปิดไม้ใหม่\" แล้วใส่ราคาเข้ากับ SL ตามที่ทำจริง",
        "step3": "ระบบจะดึงราคาสดมาคำนวณ R ให้ และบอกว่าถึงจุดเลื่อน SL มาเท่าทุนหรือยัง",
        "step4": "ปิดไม้ที่โบรกเกอร์แล้ว กด \"ปิดไม้\" ที่นี่ ไม้จะไหลไปอยู่ในสมุดบันทึก (Journal) ให้วิเคราะห์ต่อ",
        "openNew": "เปิดไม้ใหม่",
        "openNewHint": "ใส่ราคาที่เข้าจริงที่โบรกเกอร์ ไม่ต้องใส่ให้สวย ใส่ให้ตรง",
        "prefillFromSetup": "ดึงราคาจากเซ็ตอัพล่าสุด",
        "prefilled": "ดึงราคาจากแผนของเอนจินมาให้แล้ว แก้ให้ตรงกับที่เข้าจริงได้เลย",
        "closeAt": "ปิดที่ราคา",
        "closeAtMarket": "ปิดที่ราคาตลาดตอนนี้",
        "closeCustom": "ปิดที่ราคาอื่น",
        "riskNow": "ความเสี่ยงที่เหลืออยู่",
        "distanceToStop": "ห่างจาก SL",
        "distanceToTarget": "ห่างจากเป้า",
        "noQuote": "ยังดึงราคาปัจจุบันไม่ได้ ตัวเลข R จึงยังคำนวณไม่ได้",
        "liveNote": "ราคาปัจจุบันดึงจากเอนจินตัวเดียวกับที่ใช้ในหน้าอื่น เพื่อให้คำแนะนำตรงกับกราฟ",
        "tracked": "ไม้ที่กำลังติดตาม",
        "goJournal": "ไปดูสมุดบันทึก",
    }
}

EN = {
    "positions": {
        "howItWorks": "How this screen works",
        "notConnected": "Not connected to a broker",
        "howItWorksBody": "This screen is not linked to your broker account and never places an order for you. It is a manual log of the trades you opened yourself. You execute at your broker, record it here, and the app pulls the current price to track R and tell you when the stop can move to break-even.",
        "whyManual": "Why manual",
        "whyManualBody": "Because this system deliberately does not trade for you. The decision and the execution are yours. Its job is to read the market, warn you, and measure the result honestly afterwards.",
        "step1": "Find a setup on the Setups screen, and if you want it, execute at your broker.",
        "step2": "Come back here, tap \"Open a position\" and enter the price and stop you actually got.",
        "step3": "The app pulls the live price, tracks R, and tells you when break-even is genuinely earned.",
        "step4": "When you close at your broker, tap \"Close trade\" here. It moves into the Journal for review.",
        "openNew": "Open a position",
        "openNewHint": "Enter the price you actually filled at. Accurate beats flattering.",
        "prefillFromSetup": "Use prices from the latest setup",
        "prefilled": "Prices pulled from the engine's plan. Adjust them to your real fill.",
        "closeAt": "Close at price",
        "closeAtMarket": "Close at the current price",
        "closeCustom": "Close at another price",
        "riskNow": "Risk still on the table",
        "distanceToStop": "Distance to stop",
        "distanceToTarget": "Distance to target",
        "noQuote": "Could not fetch the current price, so R cannot be computed yet.",
        "liveNote": "The current price comes from the same engine endpoint the rest of the app uses, so management advice matches the chart.",
        "tracked": "Tracked trades",
        "goJournal": "Open the journal",
    }
}


def merge(locale: str, additions: dict) -> None:
    path = f"apps/web/src/i18n/locales/{locale}/journal.json"
    with io.open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)
    for section, values in additions.items():
        for key, value in values.items():
            data[section][key] = value
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{path}: positions now has {len(data['positions'])} keys")


merge("th", TH)
merge("en", EN)
