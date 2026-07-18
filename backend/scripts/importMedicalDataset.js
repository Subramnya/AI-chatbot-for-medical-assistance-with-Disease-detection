const fs = require("fs/promises");
const path = require("path");
const {
  ROOT_DIR,
  DATA_DIR,
  TRAINING_DIR,
  readJson,
  writeJson,
  appendJsonArray,
  pathExists
} = require("../utils/persistence");
const {
  buildDocument,
  cosineSimilarity,
  normalizeText,
  uniqueNewTokens
} = require("../training/vectorStore");

const DEFAULT_DATASET_ROOT = path.join(ROOT_DIR, ".codex-tmp", "repos", "medical-ai-project");
const SEED_FILE = path.join(DATA_DIR, "seed-medical-knowledge.json");
const MANUAL_STORE = path.join(TRAINING_DIR, "manual-knowledge.json");
const AUDIT_LOG = path.join(TRAINING_DIR, "audit-log.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function readCsvObjects(filePath) {
  const rows = parseCsv(await fs.readFile(filePath, "utf8"));
  const headers = rows.shift().map((header) => normalizeText(header));
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, normalizeText(row[index] || "")]))
  );
}

function key(value = "") {
  return normalizeText(value).toLowerCase();
}

function slug(value = "") {
  return key(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readableSymptom(value = "") {
  return normalizeText(value.replace(/_/g, " ").replace(/\s+/g, " "));
}

function compareDocument(newDoc, existingDocs) {
  let best = null;
  for (const doc of existingDocs) {
    const score = cosineSimilarity(newDoc.vector, doc.vector || {});
    if (!best || score > best.score) best = { doc, score };
  }

  if (!best) return { status: "new", score: 0 };

  const newTokens = uniqueNewTokens(newDoc.tokens, best.doc.tokens || []);
  if (best.score > 0.94 && newTokens.length < 8) {
    return {
      status: "duplicate",
      score: Number(best.score.toFixed(4)),
      matchedTitle: best.doc.title
    };
  }

  if (best.score > 0.72 && newTokens.length >= 8) {
    return {
      status: "extended",
      score: Number(best.score.toFixed(4)),
      matchedTitle: best.doc.title,
      newTokens: newTokens.slice(0, 25)
    };
  }

  return {
    status: "new",
    score: Number(best.score.toFixed(4)),
    matchedTitle: best.doc.title
  };
}

async function buildImportedDocuments(datasetRoot) {
  const diseaseDir = path.join(datasetRoot, "disease detection");
  const rows = await readCsvObjects(path.join(diseaseDir, "dataset.csv"));
  const descriptions = await readCsvObjects(path.join(diseaseDir, "symptom_Description.csv"));
  const precautions = await readCsvObjects(path.join(diseaseDir, "symptom_precaution.csv"));
  const severities = await readCsvObjects(path.join(diseaseDir, "Symptom-severity.csv"));

  const descriptionByDisease = new Map(descriptions.map((item) => [key(item.Disease), item.Description]));
  const precautionByDisease = new Map(
    precautions.map((item) => [
      key(item.Disease),
      ["Precaution_1", "Precaution_2", "Precaution_3", "Precaution_4"]
        .map((field) => item[field])
        .filter(Boolean)
    ])
  );
  const severityBySymptom = new Map(severities.map((item) => [key(readableSymptom(item.Symptom)), Number(item.weight) || 0]));
  const grouped = new Map();

  for (const row of rows) {
    const disease = normalizeText(row.Disease);
    if (!disease) continue;
    const diseaseKey = key(disease);
    if (!grouped.has(diseaseKey)) grouped.set(diseaseKey, { disease, symptoms: new Set() });

    for (const [field, value] of Object.entries(row)) {
      if (!field.startsWith("Symptom_") || !value) continue;
      grouped.get(diseaseKey).symptoms.add(readableSymptom(value));
    }
  }

  return [...grouped.values()].map(({ disease, symptoms }) => {
    const symptomList = [...symptoms].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const description = descriptionByDisease.get(key(disease)) || "";
    const precautionList = precautionByDisease.get(key(disease)) || [];
    const severity = Object.fromEntries(
      symptomList.map((symptom) => [symptom, severityBySymptom.get(key(symptom)) || 0])
    );
    const severityText = symptomList
      .map((symptom) => `${symptom} severity ${severity[symptom] || 0}`)
      .join("; ");
    const text = [
      `Disease: ${disease}.`,
      description ? `Description: ${description}` : "",
      symptomList.length ? `Symptoms linked in the imported dataset: ${symptomList.join(", ")}.` : "",
      severityText ? `Symptom severity weights: ${severityText}.` : "",
      precautionList.length ? `Source precautions: ${precautionList.join("; ")}.` : "",
      "Use this imported disease record as retrieval support only; urgent symptoms and medicine decisions still require clinician review."
    ]
      .filter(Boolean)
      .join(" ");
    const metadata = {
      origin: "sumeshverse/medical-ai-project",
      sourceFiles: ["dataset.csv", "symptom_Description.csv", "symptom_precaution.csv", "Symptom-severity.csv"],
      datasetDisease: true,
      diseaseName: disease,
      symptoms: symptomList,
      precautions: precautionList,
      severity,
      createdAt: new Date().toISOString()
    };

    return {
      seedEntry: {
        id: `dataset-sumeshverse-${slug(disease)}`,
        source: "seed",
        title: `${disease} imported disease profile`,
        category: "external-disease-dataset",
        trusted: false,
        url: "https://github.com/sumeshverse/medical-ai-project",
        text,
        metadata
      },
      manualEntry: buildDocument({
        id: `dataset-sumeshverse-${slug(disease)}`,
        title: `${disease} imported disease profile`,
        category: "external-disease-dataset",
        source: "manual",
        trusted: false,
        url: "https://github.com/sumeshverse/medical-ai-project",
        text,
        metadata
      })
    };
  });
}

async function run() {
  const datasetRoot = path.resolve(process.argv[2] || DEFAULT_DATASET_ROOT);
  if (!(await pathExists(datasetRoot))) {
    throw new Error(`Dataset repository was not found at ${datasetRoot}`);
  }

  const seed = await readJson(SEED_FILE, []);
  const manual = await readJson(MANUAL_STORE, []);
  const imported = await buildImportedDocuments(datasetRoot);
  const seedIds = new Set(seed.map((doc) => doc.id));
  const manualIds = new Set(manual.map((doc) => doc.id));
  const seedAdditions = [];
  const manualAdditions = [];
  const skipped = [];

  for (const pair of imported) {
    if (manualIds.has(pair.manualEntry.id) || seedIds.has(pair.seedEntry.id)) {
      skipped.push({ title: pair.manualEntry.title, status: "duplicate-id" });
      continue;
    }

    const comparison = compareDocument(pair.manualEntry, manual.concat(manualAdditions));
    if (comparison.status === "duplicate") {
      skipped.push({ title: pair.manualEntry.title, status: "duplicate", matchedTitle: comparison.matchedTitle });
      continue;
    }

    pair.manualEntry.metadata.comparison = comparison;
    pair.seedEntry.metadata.comparison = comparison;
    seedAdditions.push(pair.seedEntry);
    manualAdditions.push(pair.manualEntry);
  }

  if (seedAdditions.length) await writeJson(SEED_FILE, seed.concat(seedAdditions));
  if (manualAdditions.length) await writeJson(MANUAL_STORE, manual.concat(manualAdditions));

  await appendJsonArray(AUDIT_LOG, {
    id: `audit-${Date.now()}`,
    event: "external-dataset-import",
    origin: "sumeshverse/medical-ai-project",
    added: manualAdditions.length,
    skipped: skipped.length,
    medicineDataset: "medicine_dataset.csv was inspected but not imported for prescribing because it contains unverified generated names and exact strengths.",
    createdAt: new Date().toISOString()
  });

  console.log(
    JSON.stringify(
      {
        added: manualAdditions.length,
        skippedCount: skipped.length,
        addedTitles: manualAdditions.map((doc) => doc.title),
        skippedExamples: skipped.slice(0, 20)
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
