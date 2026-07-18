const ASSISTANT_NAME = "DOC";

const WHISPER_INITIAL_PROMPT = [
  "DOC is a local medical voice assistant.",
  "Useful words include fever, cough, headache, dizziness, vertigo, fainting, vomiting, diarrhea, chest pain, shortness of breath, swelling, redness, bruising, bleeding, rash, wound, allergy, medicine, pregnancy, kidney disease, liver disease, ulcer, blood thinner, generate report.",
  "The user may say short answers such as Rahul, twenty four, no visible change, no known allergies, or generate report."
].join(" ");

const REPORT_INTENT = /\b(report|perfect report|generate|treat me|treatment|care plan|summary|prepare)\b/i;
const MEDICAL_HINT = /\b(pain|fever|cough|cold|vomit|nausea|diarrh?ea|rash|swelling|bleeding|injury|hurt|headache|chest|breath|dizz(?:y|iness)|vertigo|light[- ]?headed|faint|weakness|allergy|medicine|pregnan|kidney|liver|ulcer|wound|burn|urine|bp|diabetes|symptom)\b/i;

const CONVERSATION_PATTERNS = [
  {
    intent: "greeting",
    test: (text) => /^(hi|hello|hey|good morning|good afternoon|good evening|namaste|hii+)[.! ]*$/i.test(text)
  },
  {
    intent: "identity",
    test: (text) => /\b(who are you|what'?s your name|what is your name|your name|tell me your name)\b/i.test(text)
  },
  {
    intent: "wellbeing",
    test: (text) => /\b(how are you|how do you feel|are you ok|are you okay|how are you feeling)\b/i.test(text)
  },
  {
    intent: "assistant_age",
    test: (text) => /\b(how old are you|what'?s your age|what is your age|your age)\b/i.test(text)
  },
  {
    intent: "assistant_status",
    test: (text) => /\b(what happened to you|what is wrong with you|what'?s wrong with you|are you sick)\b/i.test(text)
  },
  {
    intent: "capabilities",
    test: (text) =>
      /\b(what can you do|what do you do|how do you work|what is your work|help me|help|guide me)\b/i.test(text) &&
      !MEDICAL_HINT.test(text)
  },
  {
    intent: "thanks",
    test: (text) => /^(thanks|thank you|thankyou|okay thanks|ok thanks|fine thanks)[.! ]*$/i.test(text)
  },
  {
    intent: "repeat",
    test: (text) => /^(repeat|say again|tell me again|come again|what did you say)[.! ]*$/i.test(text)
  },
  {
    intent: "pause",
    test: (text) => /^(stop|pause|cancel|be quiet|silence|stop listening)[.! ]*$/i.test(text)
  }
];

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasReportIntent(message = "") {
  return REPORT_INTENT.test(message);
}

function detectConversationalIntent(message = "") {
  const text = cleanText(message);
  if (!text) return "";
  for (const entry of CONVERSATION_PATTERNS) {
    if (entry.test(text)) return entry.intent;
  }
  return "";
}

function nextSlot(intake = {}) {
  if (!cleanText(intake.name)) return "name";
  if (!cleanText(intake.age)) return "age";
  if (!cleanText(intake.symptoms) || cleanText(intake.symptoms).length < 18) return "symptoms";
  if (!cleanText(intake.additional)) return "additional";
  if (!cleanText(intake.visuals)) return "visuals";
  return "ready";
}

function nextQuestion(intake = {}) {
  const slot = nextSlot(intake);
  if (slot === "name") return "What is the patient's name?";
  if (slot === "age") return "What is the age?";
  if (slot === "symptoms") return "What are the main symptoms?";
  if (slot === "additional") return "Any medicines, allergies, or extra details? Say none if not.";
  if (slot === "visuals") return "Any photos or reports to add? Say yes or no.";
  return "I have enough details. Let me confirm.";
}

function appendNextQuestion(reply, intake = {}, options = {}) {
  if (options.skipPrompt) return reply;
  const question = nextQuestion(intake);
  return `${reply} ${question}`;
}

function buildConversationalReply(intent, context = {}) {
  const intake = context.intake || {};
  const lastAssistantText = cleanText(context.lastAssistantText);

  if (intent === "greeting") {
    return appendNextQuestion(`Hi. I am ${ASSISTANT_NAME}.`, intake);
  }
  if (intent === "identity") {
    return appendNextQuestion(`I am ${ASSISTANT_NAME}, your medical voice assistant.`, intake);
  }
  if (intent === "wellbeing") {
    return appendNextQuestion("I am ready.", intake);
  }
  if (intent === "assistant_age") {
    return appendNextQuestion("I do not have a human age.", intake);
  }
  if (intent === "assistant_status") {
    return appendNextQuestion("I am okay. I am here to help.", intake);
  }
  if (intent === "capabilities") {
    return appendNextQuestion(
      "I collect health details and make a report.",
      intake
    );
  }
  if (intent === "thanks") {
    return appendNextQuestion("You are welcome.", intake);
  }
  if (intent === "repeat") {
    return lastAssistantText || nextQuestion(intake);
  }
  if (intent === "pause") {
    return "Paused. Press start when you want to talk again.";
  }
  return "";
}

function emergencyReply(message = "") {
  if (/chest pain|cannot breathe|shortness of breath|stroke|unconscious|seizure|heavy bleeding|bone.*out|swelling.*throat|swelling.*tongue|suicidal|self harm|want to die/i.test(message)) {
    return "This may include emergency warning signs. Please contact local emergency services or go to emergency care now. I can still organize a report, but urgent care comes first.";
  }
  return "";
}

function healthSummaryFromReport(report) {
  if (!report || !report.possibleConditions?.length) return "";
  const condition = report.possibleConditions[0];
  const urgency = report.urgency?.level ? `Care level: ${report.urgency.level}.` : "";
  const action = report.carePlan?.doNow?.[0] || "Track symptoms and seek clinician guidance if symptoms worsen.";
  return `I cannot diagnose, but I noted a ${condition.name.toLowerCase()} pattern. ${urgency} ${action}`;
}

module.exports = {
  ASSISTANT_NAME,
  WHISPER_INITIAL_PROMPT,
  buildConversationalReply,
  cleanText,
  detectConversationalIntent,
  emergencyReply,
  hasReportIntent,
  healthSummaryFromReport,
  nextQuestion,
  nextSlot
};
