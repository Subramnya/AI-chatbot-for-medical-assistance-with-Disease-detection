const { generateReport } = require("./medicalEngine");
const { spawnSync } = require("child_process");
const path = require("path");
const {
  buildConversationalReply,
  cleanText,
  detectConversationalIntent,
  emergencyReply,
  hasReportIntent,
  nextQuestion
} = require("../voice/assistantLibrary");

const CONVERSATIONAL_INTENTS = new Set([
  "greeting",
  "identity",
  "wellbeing",
  "assistant_age",
  "assistant_status",
  "capabilities",
  "thanks",
  "repeat",
  "pause"
]);

const PARSER_SLOTS = new Set(["name", "age", "symptoms", "additional", "visuals", "allergies"]);
const VOICE_FLOW_VERSION = "short-turns-6";
const PROMPT_ECHO = /\b(please say|you can just say|tell me the main|what is the age|what are the main symptoms|please confirm|is this correct|i cannot diagnose|closest pattern|urgency level|generate the report|open the report|doc report|i heard)\b/i;
const STAGE_ORDER = ["name", "age", "symptoms", "additional", "visuals", "confirm", "diagnosis", "report", "postReport", "ended"];
const SYMPTOM_HINT = /\b(ache|pain|fever|temperature|cough|cold|flu|vomit(?:ing)?|nausea|diarrh?ea|loose motion|rash|hives|itch(?:ing)?|swelling|bleed(?:ing)?|bruis(?:e|ing)|injur(?:y|ed)|hurt|broken|fracture|headache|migraine|chest|breath(?:ing|less)?|shortness of breath|wheez(?:e|ing)|dizz(?:y|iness)|vertigo|light[- ]?headed|faint(?:ing)?|weak(?:ness)?|fatigue|tired|numb(?:ness)?|tingl(?:e|ing)|palpitation|heart racing|sore throat|body aches?|chills|sweat(?:ing)?|abdominal|stomach|belly|back|neck|earache|ear pain|eye pain|vision|red eye|burn(?:ing)?|wound|cut|pus|urine|urination|blood|bp|diabetes|dehydrat(?:ed|ion)|thirsty|allerg(?:y|ic)|poison(?:ing)?|sick)\b/i;
const MEDICAL_CONTEXT_HINT = /\b(medicine|tablet|pregnan(?:t|cy)?|kidney|liver|ulcer|blood thinner|insulin|inhaler|antibiotic|medical history|allerg(?:y|ic))\b/i;
const NON_SYMPTOM_WORD = /^(?:food|football|call|hello|hi|hey|test|number|doc|doctor|assistant|name|age|report|yes|no|okay|ok|thanks?|thank you)$/i;
const GENERIC_SYMPTOM_ONLY = /^(?:i am |i feel |feeling )?(?:sick|problem|issue|symptom|symptoms)$/i;

function parseVoiceInput(payload) {
  const parserPath = path.resolve(__dirname, "..", "voice", "voice_parser.py");
  const pythonCommands = [process.env.PYTHON || "python", "py"];

  for (const command of pythonCommands) {
    const result = spawnSync(command, [parserPath], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 2500
    });
    if (!result.error && result.status === 0 && result.stdout) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return fallbackParseVoiceInput(payload);
      }
    }
  }
  return fallbackParseVoiceInput(payload);
}

function yesIntent(text = "") {
  return /\b(yes|yeah|yep|ok|okay|sure|correct|right|confirm|confirmed|go ahead|continue|uploaded|done|added)\b/i.test(text);
}

function noIntent(text = "") {
  return /\b(no|nope|none|nothing|skip|not now|no thanks|do not|don't)\b/i.test(text);
}

function changeIntent(text = "") {
  return /\b(change|correct|edit|modify|wrong|add|more|additional|update|instead)\b/i.test(text);
}

function resetIntent(text = "") {
  return /\b(reset|start over|restart|new chat|fresh start|clear)\b/i.test(text);
}

function confusedIntent(text = "") {
  return /\b(not accurate|inaccurate|wrong|can't understand|cannot understand|not understand|confused|bad answer)\b/i.test(text);
}

function looksLikeMedicalDetail(text = "") {
  const clean = cleanText(text);
  return SYMPTOM_HINT.test(clean) || MEDICAL_CONTEXT_HINT.test(clean);
}

function isLikelySymptomText(text = "") {
  const clean = cleanText(text).toLowerCase();
  if (!clean || isPromptEcho(clean)) return false;
  if (NON_SYMPTOM_WORD.test(clean) || GENERIC_SYMPTOM_ONLY.test(clean)) return false;
  const conversationalIntent = detectConversationalIntent(clean);
  if (conversationalIntent && !SYMPTOM_HINT.test(clean)) return false;
  return SYMPTOM_HINT.test(clean);
}

function invalidSymptomReply() {
  return "That does not sound like a symptom. Please tell the main symptom, like fever, chest pain, dizziness, cough, rash, vomiting, or injury.";
}

function titleCaseName(value = "") {
  return cleanText(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isPromptEcho(text = "") {
  return PROMPT_ECHO.test(cleanText(text));
}

function isValidName(value = "") {
  const text = cleanText(value).toLowerCase();
  if (!text || text.length < 2 || text.length > 60) return false;
  if (/^(hi|hello|hey|hii|doc|doctor|assistant|user|patient)$/i.test(text)) return false;
  if (isPromptEcho(text) || looksLikeMedicalDetail(text)) return false;
  return /^[a-z][a-z .'-]{1,59}$/i.test(text);
}

function fallbackName(clean) {
  const patterns = [
    /\bmy name is\s+([a-z][a-z .'-]{1,60})/i,
    /\bpatient name is\s+([a-z][a-z .'-]{1,60})/i,
    /\bname is\s+([a-z][a-z .'-]{1,60})/i,
    /\bi am\s+([a-z][a-z .'-]{1,60})/i,
    /\bthis is\s+([a-z][a-z .'-]{1,60})/i
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const value = cleanText(match[1].split(/\b(?:and|age|years|symptom|problem|having|with|i am|i have|no visible|generate)\b/i)[0]);
    if (isValidName(value)) return titleCaseName(value);
  }

  if (isValidName(clean)) return titleCaseName(clean);
  return "";
}

function fallbackParseVoiceInput({ message, intake = {}, expectedSlot = "name" }) {
  const clean = cleanText(message);
  const updates = {};
  if (isPromptEcho(clean)) {
    return { updates, intent: "echo", expectedSlot: nextFlowStage(intake), understood: intake };
  }

  const conversationalIntent = detectConversationalIntent(clean);
  if (conversationalIntent) {
    return { updates, intent: conversationalIntent, expectedSlot: nextFlowStage(intake), understood: intake };
  }

  const ageMatch = clean.match(/\b(\d{1,3})\b/);
  const name = fallbackName(clean);
  if (expectedSlot === "name" && name) updates.name = name;
  else if (expectedSlot === "age" && ageMatch) updates.age = ageMatch[1];
  else if (expectedSlot === "symptoms" && clean) {
    if (!isLikelySymptomText(clean)) {
      return { updates, intent: "invalid_symptom", expectedSlot: "symptoms", understood: intake };
    }
    updates.symptoms = clean;
  }
  else if (expectedSlot === "additional" && clean) updates.additional = noIntent(clean) ? "None" : clean;
  else if (expectedSlot === "visuals" && clean) updates.visuals = noIntent(clean) ? "None" : clean;
  else if (!intake.symptoms && !hasReportIntent(clean) && isLikelySymptomText(clean)) updates.symptoms = clean;
  else if (!hasReportIntent(clean)) updates.additional = [intake.additional, clean].filter(Boolean).join(" ");
  const merged = { ...intake, ...updates };
  return { updates, intent: hasReportIntent(clean) ? "report" : "continue", expectedSlot: nextFlowStage(merged), understood: merged };
}

function nextFlowStage(intake = {}, session = {}) {
  if (!cleanText(intake.name)) return "name";
  if (!cleanText(intake.age)) return "age";
  if (!isLikelySymptomText(intake.symptoms)) return "symptoms";
  if (!cleanText(intake.additional)) return "additional";
  if (!session.visualsAnswered && !cleanText(intake.visuals)) return "visuals";
  if (!session.confirmed) return "confirm";
  if (!session.diagnosisShared) return "diagnosis";
  if (!session.reportGenerated) return "report";
  return "postReport";
}

function parserSlotFor(stage) {
  return PARSER_SLOTS.has(stage) ? stage : "";
}

function stageRank(stage = "") {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? 0 : index;
}

function attachFiles(intake, files = []) {
  if (!files.length) return intake;
  return {
    ...intake,
    files: [...(intake.files || []), ...files],
    visuals: `${files.length} uploaded visual/report file(s) attached for the report.`
  };
}

function summaryValue(value = "", fallback = "") {
  return cleanText(value).replace(/[.!?]+$/g, "") || fallback;
}

function summarizeIntake(intake = {}) {
  return `Name ${summaryValue(intake.name, "not provided")}. Age ${summaryValue(intake.age, "not provided")}. Symptoms ${summaryValue(intake.symptoms, "not provided")}. Extra ${summaryValue(intake.additional, "none")}. Files ${summaryValue(intake.visuals, "none")}.`;
}

function confirmationQuestion(intake = {}) {
  return `I heard: ${summarizeIntake(intake)} Correct?`;
}

function promptForStage(stage, intake = {}) {
  if (stage === "name") return "What is the patient's name?";
  if (stage === "age") return cleanText(intake.name) ? `Thanks, ${intake.name}. What is the age?` : "What is the age?";
  if (stage === "symptoms") return "What symptoms are happening?";
  if (stage === "additional") return "Any allergies, medicines, or extra details? Say none if not.";
  if (stage === "visuals") return "Any photos or reports to add? Say yes or no.";
  if (stage === "confirm") return confirmationQuestion(intake);
  if (stage === "report") return "Generate the report now?";
  return nextQuestion(intake);
}

function compactConditionName(name = "") {
  const text = cleanText(name);
  if (/viral upper respiratory infection|common cold/i.test(text)) return "common cold or viral infection";
  if (/fracture|sprain|soft-tissue/i.test(text)) return "possible fracture or sprain";
  if (text.length <= 64) return text;
  return text.split(/,|;|\s+such\s+as\s+/i)[0].slice(0, 64).trim();
}

function diagnosisReply(intake = {}, documents = []) {
  const preview = generateReport({ ...intake, source: "voice-preview" }, documents);
  const condition = preview.possibleConditions[0];
  const conditionName = compactConditionName(condition?.name || "a general symptom pattern");
  const careLevel = voiceCareLevel(preview.urgency?.level);
  const action = (preview.carePlan?.doNow || [])[0] || "Monitor symptoms and seek care if they worsen.";
  const assessment = /general symptom triage/i.test(conditionName)
    ? "the details are too broad for a specific pattern yet"
    : `possible ${conditionName}`;
  return {
    preview,
    reply: `My assessment: ${assessment}. ${careLevel} First step: ${action} Generate report?`
  };
}

function reportReply(report) {
  const condition = compactConditionName(report.possibleConditions?.[0]?.name || "the recorded symptom pattern");
  const careLevel = voiceCareLevel(report.urgency?.level);
  const action = report.carePlan?.doNow?.[0] || "Review the report and seek clinician guidance if symptoms worsen.";
  return (
    `Report generated. Main pattern: ${condition}. ${careLevel} ${action} Open the report below.`
  );
}

function voiceCareLevel(level = "") {
  if (/emergency/i.test(level)) return "Care level: urgent emergency. Please seek emergency care now.";
  if (/soon/i.test(level)) return "Care level: medical review soon. Contact a clinician today, especially if it is new, severe, or worsening.";
  return "Care level: mild or routine. Monitor it, and seek care if it worsens or does not improve.";
}

function sanitizeIntake(intake = {}) {
  if (cleanText(intake.name) && !isValidName(intake.name)) return {};
  const next = { ...intake };
  if (!isValidName(next.name)) delete next.name;
  if (isPromptEcho(next.symptoms) || (cleanText(next.symptoms) && !isLikelySymptomText(next.symptoms))) delete next.symptoms;
  if (isPromptEcho(next.additional)) delete next.additional;
  if (isPromptEcho(next.visuals)) delete next.visuals;
  return next;
}

function validParsedUpdates(updates = {}) {
  const next = { ...updates };
  if (cleanText(next.symptoms) && !isLikelySymptomText(next.symptoms)) delete next.symptoms;
  return next;
}

function applyCorrection(intake = {}, message = "") {
  const text = cleanText(message);
  const next = { ...intake };
  let changed = false;
  let invalidSymptom = false;

  const name = text.match(/\b(?:change|correct|update)?\s*name\s*(?:to|is|as)?\s+([a-z][a-z .'-]{1,60})/i);
  if (name) {
    next.name = titleCaseName(name[1].split(/\b(?:and|age|symptoms?|additional)\b/i)[0]);
    changed = true;
  }

  const age = text.match(/\b(?:change|correct|update)?\s*age\s*(?:to|is|as)?\s+(\d{1,3})\b/i);
  if (age) {
    next.age = age[1];
    changed = true;
  }

  const symptoms = text.match(/\b(?:change|correct|update)?\s*symptoms?\s*(?:to|are|is|as)?\s+(.+)/i);
  if (symptoms) {
    const value = cleanText(symptoms[1]);
    if (isLikelySymptomText(value)) {
      next.symptoms = value;
      changed = true;
    } else {
      invalidSymptom = true;
    }
  }

  const additional = text.match(/\b(?:change|correct|update)?\s*additional(?: details)?\s*(?:to|are|is|as)?\s+(.+)/i);
  if (additional) {
    next.additional = cleanText(additional[1]);
    changed = true;
  }

  if (!changed && isLikelySymptomText(text)) {
    next.symptoms = text;
    changed = true;
  } else if (!changed && looksLikeMedicalDetail(text)) {
    next.additional = [next.additional, text].filter(Boolean).join(" ");
    changed = true;
  }

  return { intake: next, changed, invalidSymptom };
}

function currentAssistantText(messages = []) {
  return [...messages].reverse().find((item) => item.role === "assistant")?.text || "";
}

function chatTurn({ session, message, files = [], documents = [] }) {
  const now = new Date().toISOString();
  const cleanMessage = cleanText(message);
  const nextSession = {
    ...session,
    messages: session.messages || [],
    intake: sanitizeIntake(session.intake || {}),
    voiceFlowVersion: VOICE_FLOW_VERSION,
    updatedAt: now
  };

  if (resetIntent(cleanMessage)) {
    nextSession.intake = {};
    nextSession.flowStage = "name";
    nextSession.expectedSlot = "name";
    nextSession.confirmed = false;
    nextSession.diagnosisShared = false;
    nextSession.reportGenerated = false;
    nextSession.visualsAnswered = false;
    nextSession.ended = false;
    const reply = "Okay. Starting fresh. What is the patient's name?";
    nextSession.messages.push({ role: "user", text: cleanMessage, createdAt: now });
    nextSession.messages.push({ role: "assistant", text: reply, createdAt: now, reportId: "" });
    return { session: nextSession, reply, report: null };
  }

  if (files.length) {
    nextSession.intake = attachFiles(nextSession.intake, files);
    nextSession.visualsAnswered = true;
  }

  const naturalStage = nextFlowStage(nextSession.intake, nextSession);
  let stage = nextSession.flowStage || nextSession.expectedSlot || naturalStage;
  if (stageRank(naturalStage) < stageRank(stage)) stage = naturalStage;
  nextSession.flowStage = stage;
  const parsed = parseVoiceInput({
    message: cleanMessage,
    intake: nextSession.intake,
    expectedSlot: parserSlotFor(stage)
  });
  nextSession.lastParse = parsed;
  const parsedIntent = parsed.intent || "";

  if (isPromptEcho(cleanMessage) || parsedIntent === "echo") {
    const reply = promptForStage(stage, nextSession.intake);
    nextSession.flowStage = stage;
    nextSession.expectedSlot = stage;
    nextSession.messages.push({ role: "user", text: cleanMessage, createdAt: now });
    nextSession.messages.push({ role: "assistant", text: reply, createdAt: now, reportId: "" });
    return { session: nextSession, reply, report: null };
  }

  let report = null;
  const emergencyWarning = emergencyReply(cleanMessage);
  let reply = "";

  if (!reply && CONVERSATIONAL_INTENTS.has(parsedIntent) && stage === "name") {
    reply = buildConversationalReply(parsedIntent, {
      intake: nextSession.intake,
      lastAssistantText: currentAssistantText(nextSession.messages)
    });
    nextSession.flowStage = "name";
  }

  if (!reply) {
    if (stage === "symptoms" && parsedIntent === "invalid_symptom") {
      nextSession.flowStage = "symptoms";
      reply = invalidSymptomReply();
    } else if (stage === "visuals") {
      if (files.length || /\b(uploaded|added|attached|done)\b/i.test(cleanMessage)) {
        nextSession.visualsAnswered = true;
        nextSession.intake.visuals = nextSession.intake.visuals || "Uploaded visual/report files attached.";
        nextSession.flowStage = "confirm";
        reply = confirmationQuestion(nextSession.intake);
      } else if (yesIntent(cleanMessage)) {
        nextSession.flowStage = "visuals";
        reply = "Okay. Attach them, then say uploaded.";
      } else if (noIntent(cleanMessage)) {
        nextSession.visualsAnswered = true;
        nextSession.intake.visuals = "None";
        nextSession.flowStage = "confirm";
        reply = confirmationQuestion(nextSession.intake);
      }
    } else if (stage === "confirm") {
      if (yesIntent(cleanMessage) && !changeIntent(cleanMessage)) {
        nextSession.confirmed = true;
        nextSession.diagnosisShared = true;
        nextSession.flowStage = "report";
        reply = diagnosisReply(nextSession.intake, documents).reply;
      } else {
        const correction = applyCorrection(nextSession.intake, cleanMessage);
        if (correction.changed) {
          nextSession.intake = correction.intake;
          reply = confirmationQuestion(nextSession.intake);
        } else if (correction.invalidSymptom) {
          nextSession.flowStage = "confirm";
          reply = invalidSymptomReply();
        } else if (confusedIntent(cleanMessage)) {
          nextSession.intake = {};
          nextSession.flowStage = "name";
          nextSession.confirmed = false;
          nextSession.diagnosisShared = false;
          nextSession.visualsAnswered = false;
          reply = "Okay. Let's fix it. What is the patient's name?";
        } else {
          nextSession.flowStage = "confirm";
          reply = "Tell me the correction.";
        }
      }
    } else if (stage === "report") {
      if (hasReportIntent(cleanMessage) || (yesIntent(cleanMessage) && !changeIntent(cleanMessage))) {
        report = generateReport({ ...nextSession.intake, source: "voice-chat" }, documents);
        nextSession.reportGenerated = true;
        nextSession.flowStage = "postReport";
        reply = reportReply(report);
      } else if (changeIntent(cleanMessage) || looksLikeMedicalDetail(cleanMessage)) {
        const correction = applyCorrection(nextSession.intake, cleanMessage);
        if (correction.changed) {
          nextSession.intake = correction.intake;
          nextSession.confirmed = false;
          nextSession.diagnosisShared = false;
          nextSession.flowStage = "confirm";
          reply = confirmationQuestion(nextSession.intake);
        } else {
          nextSession.flowStage = "report";
          reply = correction.invalidSymptom ? invalidSymptomReply() : "Tell me what to change.";
        }
      } else {
        reply = "Say generate report, or tell me what to change.";
      }
    } else if (stage === "postReport") {
      if (CONVERSATIONAL_INTENTS.has(parsedIntent) && parsedIntent === "thanks") {
        nextSession.ended = true;
        nextSession.flowStage = "ended";
        reply = "Thank you for interacting with DOC. Session finished.";
      } else if (changeIntent(cleanMessage) || looksLikeMedicalDetail(cleanMessage)) {
        const correction = applyCorrection(nextSession.intake, cleanMessage);
        if (correction.changed) {
          nextSession.intake = correction.intake;
          nextSession.confirmed = false;
          nextSession.diagnosisShared = false;
          nextSession.reportGenerated = false;
          nextSession.ended = false;
          nextSession.flowStage = "confirm";
          reply = confirmationQuestion(nextSession.intake);
        } else {
          nextSession.flowStage = "postReport";
          reply = correction.invalidSymptom ? invalidSymptomReply() : "Report is ready. Add more info, or say thank you.";
        }
      } else {
        reply = "Report is ready. Add more info, or say thank you.";
      }
    }
  }

  if (!reply) {
    const updates = validParsedUpdates(parsed.updates || {});
    if (stage === "symptoms" && cleanMessage && !updates.symptoms) {
      nextSession.flowStage = "symptoms";
      reply = invalidSymptomReply();
    } else {
      nextSession.intake = { ...nextSession.intake, ...updates };
    }
    nextSession.intake = sanitizeIntake(nextSession.intake);

    if (stage === "additional" && noIntent(cleanMessage)) {
      nextSession.intake.additional = "None";
    }

    if (!reply) {
      nextSession.flowStage = nextFlowStage(nextSession.intake, nextSession);
      reply = promptForStage(nextSession.flowStage, nextSession.intake);
    }
  }

  nextSession.expectedSlot = nextSession.flowStage;
  if (emergencyWarning && reply && !reply.includes("emergency warning signs")) {
    reply = `${emergencyWarning} ${reply}`;
  }
  nextSession.messages.push({ role: "user", text: cleanMessage, createdAt: now });
  nextSession.messages.push({ role: "assistant", text: reply, createdAt: now, reportId: report ? report.id : "" });

  return {
    session: nextSession,
    reply,
    report
  };
}

module.exports = {
  chatTurn
};
