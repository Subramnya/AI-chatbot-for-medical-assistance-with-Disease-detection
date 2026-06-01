const { generateReport } = require("./medicalEngine");
const { spawnSync } = require("child_process");
const path = require("path");

function hasReportIntent(message) {
  return /report|perfect report|generate|treat me|treatment|care plan|summary/i.test(message);
}

function mergeFromMessage(session, message) {
  const parsed = parseVoiceInput({
    message,
    intake: session.intake || {},
    expectedSlot: session.expectedSlot || "name"
  });
  const intake = { ...(session.intake || {}), ...(parsed.updates || {}) };
  session.intake = intake;
  session.expectedSlot = parsed.expectedSlot || nextSlot(intake);
  session.lastParse = parsed;
  return session;
}

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

function fallbackParseVoiceInput({ message, intake = {}, expectedSlot = "name" }) {
  const clean = String(message || "").trim();
  const updates = {};
  const ageMatch = clean.match(/\b(\d{1,3})\b/);
  if (expectedSlot === "name" && /^[a-z .'-]{2,60}$/i.test(clean)) updates.name = clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
  else if (expectedSlot === "age" && ageMatch) updates.age = ageMatch[1];
  else if (expectedSlot === "visuals") updates.visuals = clean;
  else if (expectedSlot === "allergies") updates.allergies = /^(no|none|nil)$/i.test(clean) ? "No known allergies mentioned." : clean;
  else if (!intake.symptoms && !hasReportIntent(clean)) updates.symptoms = clean;
  else if (!hasReportIntent(clean)) updates.additional = [intake.additional, clean].filter(Boolean).join(" ");
  const merged = { ...intake, ...updates };
  return { updates, intent: hasReportIntent(clean) ? "report" : "continue", expectedSlot: nextSlot(merged) };
}

function nextSlot(intake = {}) {
  if (!intake.name) return "name";
  if (!intake.age) return "age";
  if (!intake.symptoms || intake.symptoms.length < 18) return "symptoms";
  if (!intake.visuals) return "visuals";
  if (!intake.allergies) return "allergies";
  return "ready";
}

function nextQuestion(intake = {}) {
  if (!intake.name) return "Please say the patient's name. A single name is fine.";
  if (!intake.age) return "Please say the age. You can just say the number.";
  if (!intake.symptoms || intake.symptoms.length < 18) return "Tell me what happened and the main symptoms.In a short sentence.";
  if (!intake.visuals) return "What can you see visually?( You can say swelling, redness, bruising, bleeding, rash, or say no visible change).";
  if (!intake.allergies) return "Any allergies, current medicines, pregnancy, kidney disease, liver disease, ulcer, or blood thinners? You can just say none.";
  return "I have enough for a concise safety report. Say generate report when ready, or add more details.";
}

function emergencyReply(message) {
  if (/chest pain|cannot breathe|shortness of breath|stroke|unconscious|seizure|heavy bleeding|bone.*out|swelling.*throat|swelling.*tongue/i.test(message)) {
    return "This sounds like it may include emergency warning signs. Please contact local emergency services or go to emergency care now. I can still organize a report, but urgent care comes first.";
  }
  return "";
}

function chatTurn({ session, message, files = [], documents = [] }) {
  const now = new Date().toISOString();
  const cleanMessage = String(message || "").trim();
  const nextSession = mergeFromMessage(
    {
      ...session,
      messages: session.messages || [],
      intake: session.intake || {},
      updatedAt: now
    },
    cleanMessage
  );

  if (files.length) {
    nextSession.intake.files = [...(nextSession.intake.files || []), ...files];
    nextSession.intake.visuals =
      nextSession.intake.visuals ||
      "User uploaded visual/report files in the assistant chat. Manual description is still needed for clinical interpretation.";
  }

  let reply = emergencyReply(cleanMessage);
  let report = null;

  if (!reply && (hasReportIntent(cleanMessage) || nextSession.lastParse?.intent === "report")) {
    report = generateReport({ ...nextSession.intake, source: "voice-chat" }, documents);
    reply = "I prepared your DOC report. Please review it carefully and use emergency care for red flags. You can open, print, or download it now.";
  }

  if (!reply) reply = nextQuestion(nextSession.intake);

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
