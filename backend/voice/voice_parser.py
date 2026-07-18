import json
import re
import sys


NEGATIVE_ALLERGY = re.compile(r"\b(no|none|nothing|nil|no known|not any|don't have|do not have)\b", re.I)
NEGATIVE_VISUAL = re.compile(r"\b(no visible|nothing visible|no swelling|no redness|no bruise|no bruising|looks normal|normal)\b", re.I)
REPORT_INTENT = re.compile(r"\b(report|perfect report|generate|treat me|treatment|care plan|summary|prepare)\b", re.I)
PROMPT_ECHO = re.compile(
    r"\b(please say|you can just say|tell me the main|what is the age|what are the main symptoms|please confirm|is this correct|i cannot diagnose|closest pattern|urgency level|generate the report|open the report|doc report|i heard)\b",
    re.I,
)
MEDICAL_HINT = re.compile(
    r"\b(ache|pain|fever|temperature|cough|cold|flu|vomit(?:ing)?|nausea|diarrh?ea|loose motion|rash|hives|itch(?:ing)?|swelling|bleed(?:ing)?|bruis(?:e|ing)|injur(?:y|ed)|hurt|broken|fracture|headache|migraine|chest|breath(?:ing|less)?|shortness of breath|wheez(?:e|ing)|dizz(?:y|iness)|vertigo|light[- ]?headed|faint(?:ing)?|weak(?:ness)?|fatigue|tired|numb(?:ness)?|tingl(?:e|ing)|palpitation|heart racing|sore throat|body aches?|chills|sweat(?:ing)?|abdominal|stomach|belly|back|neck|earache|ear pain|eye pain|vision|red eye|burn(?:ing)?|wound|cut|pus|urine|urination|blood|bp|diabetes|dehydrat(?:ed|ion)|thirsty|allerg(?:y|ic)|poison(?:ing)?|sick)\b",
    re.I,
)
NAME_BLOCKLIST = re.compile(
    r"\b(hello|hi|hey|help|thanks|thank|what|who|how|age|name|doc|doctor|assistant|pain|broken|fracture|fever|cough|cold|vomit|nausea|diarrh?ea|rash|swelling|bleeding|hurt|injury|burning|urine|headache|chest|breath|dizz(?:y|iness)|vertigo|faint|allergy|medicine|symptom|sick)\b",
    re.I,
)
NON_SYMPTOM_WORD = re.compile(
    r"^(food|football|call|hello|hi|hey|test|number|doc|doctor|assistant|name|age|report|yes|no|okay|ok|thanks?|thank you)$",
    re.I,
)
GENERIC_SYMPTOM_ONLY = re.compile(r"^(i am |i feel |feeling )?(sick|problem|issue|symptom|symptoms)$", re.I)
CONVERSATION_PATTERNS = [
    ("greeting", re.compile(r"^(hi|hello|hey|good morning|good afternoon|good evening|namaste|hii+)[.! ]*$", re.I)),
    ("identity", re.compile(r"\b(who are you|what'?s your name|what is your name|your name|tell me your name)\b", re.I)),
    ("wellbeing", re.compile(r"\b(how are you|how do you feel|are you ok|are you okay|how are you feeling)\b", re.I)),
    ("assistant_age", re.compile(r"\b(how old are you|what'?s your age|what is your age|your age)\b", re.I)),
    (
        "assistant_status",
        re.compile(r"\b(what happened to you|what is wrong with you|what'?s wrong with you|are you sick)\b", re.I),
    ),
    (
        "capabilities",
        re.compile(r"\b(what can you do|what do you do|how do you work|what is your work|help me|help|guide me)\b", re.I),
    ),
    ("thanks", re.compile(r"^(thanks|thank you|thankyou|okay thanks|ok thanks|fine thanks)[.! ]*$", re.I)),
    ("repeat", re.compile(r"^(repeat|say again|tell me again|come again|what did you say)[.! ]*$", re.I)),
    ("pause", re.compile(r"^(stop|pause|cancel|be quiet|silence|stop listening)[.! ]*$", re.I)),
]


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def looks_like_symptom(text):
    text = clean(text)
    if not text or detect_prompt_echo(text):
        return False
    if NON_SYMPTOM_WORD.search(text) or GENERIC_SYMPTOM_ONLY.search(text):
        return False
    conversational = detect_conversational_intent(text)
    if conversational and not MEDICAL_HINT.search(text):
        return False
    return bool(MEDICAL_HINT.search(text))


def detect_conversational_intent(text):
    text = clean(text)
    if not text:
        return ""
    for intent, pattern in CONVERSATION_PATTERNS:
        if intent == "capabilities" and MEDICAL_HINT.search(text):
            continue
        if pattern.search(text):
            return intent
    return ""


def detect_prompt_echo(text):
    return bool(PROMPT_ECHO.search(clean(text)))


def next_expected_slot(intake):
    if not intake.get("name"):
        return "name"
    if not intake.get("age"):
        return "age"
    if not looks_like_symptom(intake.get("symptoms")):
        return "symptoms"
    if not intake.get("additional"):
        return "additional"
    if not intake.get("visuals"):
        return "visuals"
    return "ready"


def first_number(text):
    match = re.search(r"\b(1[01]\d|120|\d{1,2})\b", text)
    return match.group(1) if match else ""


def parse_name(text):
    if detect_conversational_intent(text):
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
            value = re.split(
                r"[.!?]|\b(and|age|years|symptom|problem|having|with|i am|i'm|i have|have|no visible|no known|generate|report)\b",
                match.group(1),
                flags=re.I,
            )[0]
            if NAME_BLOCKLIST.search(value) or MEDICAL_HINT.search(value):
                return ""
            return clean(value).title()

    if NAME_BLOCKLIST.search(text):
        return ""

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
    if NEGATIVE_VISUAL.search(text):
        return "No visible changes mentioned."
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


def trim_medical_clause(value):
    value = clean(value)
    value = re.split(
        r"[.!?]|\b(no visible|nothing visible|looks normal|no known allergies|allergies?|allergic|generate report|generate|report|my name is|patient name is|name is|my age is|age is)\b",
        value,
        flags=re.I,
    )[0]
    return clean(value)


def parse_symptoms(text):
    patterns = [
        r"\b(?:i have|i am having|i'm having|having|main symptoms are|symptoms are|problem is|issue is)\s+(.+)",
        r"\b(?:what happened is|what happened was)\s+(.+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if not match:
            continue
        value = trim_medical_clause(match.group(1))
        if value and MEDICAL_HINT.search(value):
            return value

    if MEDICAL_HINT.search(text) and not detect_conversational_intent(text):
        cleaned = re.sub(
            r"\b(my name is|patient name is|name is)\s+[a-z][a-z .'-]{1,60}",
            " ",
            text,
            flags=re.I,
        )
        cleaned = re.sub(r"\b(?:my age is|age is|aged|i am|i'm)\s+\d{1,3}\b", " ", cleaned, flags=re.I)
        value = trim_medical_clause(cleaned)
        if value and MEDICAL_HINT.search(value):
            return value
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

    if detect_prompt_echo(text):
        return {
            "updates": updates,
            "intent": "echo",
            "expectedSlot": next_expected_slot(intake),
            "understood": intake,
        }

    conversational_intent = detect_conversational_intent(text)
    if conversational_intent:
        return {
            "updates": updates,
            "intent": conversational_intent,
            "expectedSlot": next_expected_slot(intake),
            "understood": intake,
        }

    age = parse_age(text)
    explicit_name = parse_name(text)
    symptoms = parse_symptoms(text)
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
        value = symptoms or text
        if looks_like_symptom(value):
            updates["symptoms"] = merge(intake.get("symptoms"), value)
        else:
            return {
                "updates": updates,
                "intent": "invalid_symptom",
                "expectedSlot": "symptoms",
                "understood": intake,
            }
    elif symptoms and not intake.get("symptoms"):
        updates["symptoms"] = symptoms
    elif (
        not intake.get("symptoms")
        and looks_like_symptom(text)
        and not updates.get("name")
        and not (updates.get("age") and len(text.split()) <= 5)
        and not allergies
    ):
        updates["symptoms"] = text
    elif intake.get("symptoms") and not REPORT_INTENT.search(text) and expected not in {"name", "age", "visuals", "allergies"}:
        updates["additional"] = merge(intake.get("additional"), text)

    if expected == "visuals":
        updates["visuals"] = visuals or text
    elif visuals and not intake.get("visuals"):
        updates["visuals"] = visuals

    if expected == "allergies":
        updates["allergies"] = allergies or text
    elif allergies:
        updates["allergies"] = merge(intake.get("allergies"), allergies)

    next_intake = {**intake, **updates}
    next_slot = next_expected_slot(next_intake)

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
