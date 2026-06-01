const assert = require("assert");
const {
  initializeTrainingStore,
  loadAllDocuments,
  validateMedicalText
} = require("../training/fileProcessor");
const { generateReport } = require("../ai/medicalEngine");

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

  console.log("Smoke tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
