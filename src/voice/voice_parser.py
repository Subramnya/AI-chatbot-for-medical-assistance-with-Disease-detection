import json
import re
import sys


NEGATIVE_ALLERGY = re.compile(r"\b(no|none|nothing|nil|no known|not any|don't have|do not have)\b", re.I)
REPORT_INTENT = re.compile(r"\b(report|perfect report|generate|treat me|treatment|care plan|summary|prepare)\b", re.I)
NAME_BLOCKLIST = re.compile(
    r"\b(pain|broken|fracture|fever|cough|cold|vomit|diarrhea|rash|swelling|bleeding|hurt|injury|burning|urine|headache|chest|breath|dizzy|allergy)\b",
    re.I,
)


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def first_number(text):
    match = re.search(r"\b(1[01]\d|120|\d{1,2})\b", text)
    return match.group(1) if match else ""


def parse_name(text):
    if NAME_BLOCKLIST.search(text):
        return ""
    patterns = [
        r"\bmy name is\s+([a-z][a-z .'-]{1,60})",
        r"\bpatient name is\s+([a-z][a-z .'-]{1,60})",
        r"\bname is\s+([a-z][a-z .'-]{1,60})",
        r"\bi am\s+([a-z][a-z .'-]{1,60})",
        r"\bthis is\s+([a-z][a-z .'-]{1,60})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            value = re.split(r"\b(and|age|years|symptom|problem|having|with)\b", match.group(1), flags=re.I)[0]
            return clean(value).title()

    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    if 1 <= len(words) <= 4 and not REPORT_INTENT.search(text):
        return " ".join(words).title()
    return ""


def parse_age(text):
    patterns = [
        r"\b(?:my age is|age is|aged|i am|i'm)\s+(\d{1,3})\b",
        r"\b(\d{1,3})\s*(?:years old|year old|yrs|yr)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1)
    return first_number(text)


def parse_visuals(text):
    visual_words = [
        "swelling",
        "redness",
        "bruise",
        "bruising",
        "bleeding",
        "rash",
        "cut",
        "deform",
        "pus",
        "blue",
        "pale",
        "lump",
        "wound",
    ]
    if any(word in text.lower() for word in visual_words):
        return clean(text)
    return ""


def parse_allergies(text):
    if NEGATIVE_ALLERGY.search(text):
        return "No known allergies or major medicine restrictions mentioned."
    if re.search(r"\b(allergy|allergic|pregnant|pregnancy|kidney|liver|ulcer|blood thinner|medicine|tablet|insulin|bp|diabetes)\b", text, re.I):
        return clean(text)
    return ""


def merge(existing, addition):
    existing = clean(existing)
    addition = clean(addition)
    if not addition:
        return existing
    if not existing:
        return addition
    if addition.lower() in existing.lower():
        return existing
    return f"{existing} {addition}"


def parse(payload):
    text = clean(payload.get("message", ""))
    intake = dict(payload.get("intake") or {})
    expected = payload.get("expectedSlot") or ""

    updates = {}
    intent = "report" if REPORT_INTENT.search(text) else "continue"

    if not text:
        return {"updates": updates, "intent": intent, "expectedSlot": expected}

    age = parse_age(text)
    explicit_name = parse_name(text)
    allergies = parse_allergies(text)
    visuals = parse_visuals(text)

    if expected == "name" and explicit_name:
        updates["name"] = explicit_name
    elif not intake.get("name") and explicit_name and not age and len(text.split()) <= 8:
        updates["name"] = explicit_name

    if expected == "age" and age:
        updates["age"] = age
    elif not intake.get("age") and age and re.search(r"\b(age|years|old|i am|i'm)\b", text, re.I):
        updates["age"] = age

    if expected == "symptoms":
        updates["symptoms"] = merge(intake.get("symptoms"), text)
    elif not intake.get("symptoms") and not updates.get("name") and not (updates.get("age") and len(text.split()) <= 5) and not allergies:
        updates["symptoms"] = text
    elif intake.get("symptoms") and not REPORT_INTENT.search(text) and expected not in {"name", "age", "visuals", "allergies"}:
        updates["additional"] = merge(intake.get("additional"), text)

    if expected == "visuals":
        updates["visuals"] = text if text else visuals
    elif visuals and not intake.get("visuals"):
        updates["visuals"] = visuals

    if expected == "allergies":
        updates["allergies"] = allergies or text
    elif allergies:
        updates["allergies"] = merge(intake.get("allergies"), allergies)

    next_intake = {**intake, **updates}
    if not next_intake.get("name"):
        next_slot = "name"
    elif not next_intake.get("age"):
        next_slot = "age"
    elif not next_intake.get("symptoms") or len(clean(next_intake.get("symptoms")).split()) < 4:
        next_slot = "symptoms"
    elif not next_intake.get("visuals"):
        next_slot = "visuals"
    elif not next_intake.get("allergies"):
        next_slot = "allergies"
    else:
        next_slot = "ready"

    return {
        "updates": updates,
        "intent": intent,
        "expectedSlot": next_slot,
        "understood": next_intake,
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(parse(payload)))
    except Exception as error:
        print(json.dumps({"updates": {}, "intent": "continue", "expectedSlot": "", "error": str(error)}))


if __name__ == "__main__":
    main()
