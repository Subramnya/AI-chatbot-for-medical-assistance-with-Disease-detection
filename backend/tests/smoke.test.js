const assert = require("assert");
const {
  initializeTrainingStore,
  loadAllDocuments,
  validateMedicalText
} = require("../training/fileProcessor");
const { detectUrgency, generateReport } = require("../../ai/medicalEngine");
const { chatTurn } = require("../../ai/chatAssistant");

async function run() {
  await initializeTrainingStore();
  const docs = await loadAllDocuments();
  assert.ok(docs.length >= 5, "seed knowledge should initialize");

  const report = generateReport(
    {
      name: "Test Patient",
      age: "22",
      symptoms: "I fell and my hand is painful, swollen, bruised, and I cannot move it properly.",
      visuals: "Swelling around wrist with bruising.",
      allergies: "No known allergies."
    },
    docs
  );

  assert.ok(report.id.startsWith("report-"), "report id should be generated");
  assert.ok(report.possibleConditions.length > 0, "report should include possible conditions");
  assert.ok(report.carePlan.doNow.length > 0, "report should include care plan");
  assert.ok(report.knowledgeUsed.length > 0, "report should use local knowledge");

  const dangerous = validateMedicalText("Drink bleach because bleach cures viral cold infection and do not seek medical care.");
  assert.equal(dangerous.ok, false, "dangerous claim should be rejected");

  let chatSession = { id: "voice-test", intake: {}, messages: [] };
  let turn = chatTurn({ session: chatSession, message: "hello", documents: docs });
  assert.equal(turn.session.intake.name, undefined, "greeting should not become patient name");
  assert.match(turn.reply, /DOC|listening/i, "greeting should receive assistant response");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "what is your age", documents: docs });
  assert.equal(turn.session.intake.age, undefined, "assistant age question should not become patient age");
  assert.match(turn.reply, /software|human age/i, "assistant age should receive assistant response");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "my name is Rahul Kumar", documents: docs });
  assert.equal(turn.session.intake.name, "Rahul Kumar", "spoken name should be captured");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "24", documents: docs });
  assert.equal(turn.session.intake.age, "24", "short spoken age should be captured");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "I have fever and cough for two days", documents: docs });
  assert.match(turn.session.intake.symptoms, /fever/i, "medical detail should be stored as symptoms");
  assert.match(turn.reply, /allergies|extra details|medicines/i, "symptom answer should ask for additional details next");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "no additional details and no known allergies", documents: docs });
  assert.match(turn.session.intake.additional, /none/i, "additional details should be captured");
  assert.match(turn.reply, /visuals|photos|reports/i, "additional answer should ask about visuals or reports");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "no", documents: docs });
  assert.match(turn.session.intake.visuals, /none/i, "visuals no-answer should be captured");
  assert.match(turn.reply, /I heard/i, "visual answer should move to confirmation");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "yes", documents: docs });
  assert.equal(turn.session.confirmed, true, "confirmation should be recorded");
  assert.match(turn.reply, /My assessment|Care level|Generate report/i, "confirmation should produce verbal diagnosis preview");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "generate report", documents: docs });
  assert.ok(turn.report, "confirmed generate report should create a report");
  assert.match(turn.reply, /Report generated/i, "report generation should be spoken back");

  chatSession = turn.session;
  turn = chatTurn({ session: chatSession, message: "thank you", documents: docs });
  assert.equal(turn.session.ended, true, "thank you after report should finish the session");
  assert.match(turn.reply, /Session finished/i, "finished session should be spoken back");

  const oneShotTurn = chatTurn({
    session: { id: "voice-one-shot-test", intake: {}, messages: [] },
    message:
      "Hello DOC. My name is Rahul Kumar. I am 24. I have fever and cough for two days. No visible change, no known allergies, generate report.",
    documents: docs
  });
  assert.equal(oneShotTurn.session.intake.name, "Rahul Kumar", "one-shot voice answer should capture name cleanly");
  assert.equal(oneShotTurn.session.intake.age, "24", "one-shot voice answer should capture age");
  assert.match(oneShotTurn.session.intake.symptoms, /fever and cough/i, "one-shot voice answer should capture symptoms");
  assert.equal(oneShotTurn.report, null, "one-shot answer should still require confirmation before report generation");
  assert.match(oneShotTurn.reply, /allergies|extra details|I heard/i, "one-shot answer should continue the guided flow");

  const pollutedSession = {
    id: "polluted-voice-test",
    intake: {
      name: "Hi",
      age: "20",
      symptoms: "you can just say the number",
      additional: "I cannot diagnose. Please confirm.",
      visuals: "nothing no visible change"
    },
    messages: [],
    flowStage: "confirm"
  };
  const cleanedTurn = chatTurn({ session: pollutedSession, message: "hello", documents: docs });
  assert.equal(cleanedTurn.session.intake.name, undefined, "polluted greeting name should be removed");
  assert.equal(cleanedTurn.session.intake.symptoms, undefined, "assistant prompt symptoms should be removed");
  assert.match(cleanedTurn.reply, /patient's name|What is/i, "polluted session should return to the first short question");

  let invalidSymptomSession = {
    id: "invalid-symptom-test",
    intake: { name: "Rahul Kumar", age: "24" },
    messages: [],
    flowStage: "symptoms"
  };
  let invalidSymptomTurn = chatTurn({ session: invalidSymptomSession, message: "football", documents: docs });
  assert.equal(invalidSymptomTurn.session.intake.symptoms, undefined, "random non-symptom words should not be stored");
  assert.equal(invalidSymptomTurn.session.flowStage, "symptoms", "invalid symptom should keep the symptom stage active");
  assert.match(invalidSymptomTurn.reply, /does not sound like a symptom/i, "invalid symptom should be rejected clearly");

  invalidSymptomSession = invalidSymptomTurn.session;
  invalidSymptomTurn = chatTurn({ session: invalidSymptomSession, message: "dizziness", documents: docs });
  assert.equal(invalidSymptomTurn.session.intake.symptoms, "dizziness", "single-word real symptoms should be accepted");
  assert.match(invalidSymptomTurn.reply, /allergies|extra details|medicines/i, "valid single symptom should continue the flow");

  const correctionTurn = chatTurn({
    session: {
      id: "symptom-correction-test",
      intake: { name: "Rahul Kumar", age: "24", symptoms: "fever", additional: "None", visuals: "None" },
      messages: [],
      flowStage: "confirm",
      visualsAnswered: true
    },
    message: "dizziness",
    documents: docs
  });
  assert.equal(correctionTurn.session.intake.symptoms, "dizziness", "short symptom correction should replace symptoms");
  assert.match(correctionTurn.reply, /I heard/i, "short symptom correction should return to confirmation");

  assert.equal(detectUrgency("chest pain").level, "Emergency", "chest pain should be emergency level");
  assert.equal(detectUrgency("dizziness").level, "Soon", "dizziness should ask for medical review soon");

  console.log("Smoke tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
