const path = require("path");
const crypto = require("crypto");
const {
  DATA_DIR,
  TRAINING_DIR,
  readJson,
  writeJson,
  appendJsonArray
} = require("../utils/persistence");
const {
  buildDocument,
  cosineSimilarity,
  normalizeText,
  vectorize,
  tokenize,
  uniqueNewTokens
} = require("./vectorStore");

const MANUAL_STORE = path.join(TRAINING_DIR, "manual-knowledge.json");
const USER_STORE = path.join(TRAINING_DIR, "user-learning.json");
const AUDIT_LOG = path.join(TRAINING_DIR, "audit-log.json");
const SEED_FILE = path.join(DATA_DIR, "seed-medical-knowledge.json");

const DANGEROUS_CLAIMS = [
  /drink\s+bleach/i,
  /bleach\s+cures/i,
  /antibiotics?\s+(always\s+)?cure\s+(viral|viruses|cold|flu)/i,
  /ignore\s+(chest\s+pain|stroke|seizure|shortness\s+of\s+breath)/i,
  /children\s+should\s+take\s+aspirin/i,
  /mix\s+(opioids?|sleeping pills?)\s+with\s+alcohol/i,
  /do\s+not\s+seek\s+medical\s+care/i,
  /stop\s+(insulin|heart medicine|blood thinner)/i
];

const MEDICAL_HINTS = [
  "symptom",
  "treatment",
  "diagnosis",
  "medicine",
  "infection",
  "injury",
  "pain",
  "fever",
  "dose",
  "tablet",
  "blood",
  "heart",
  "bone",
  "skin",
  "allergy",
  "cough",
  "headache",
  "fracture",
  "disease",
  "clinical",
  "emergency",
  "doctor",
  "patient",
  "breathing",
  "urine",
  "sugar",
  "pressure",
  "mental",
  "eye",
  "ear",
  "lung",
  "kidney",
  "asthma",
  "diabetes",
  "anxiety",
  "depression"
];

function id(prefix = "doc") {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function detectFileType(file = {}) {
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || file.mime || "").toLowerCase();
  const ext = path.extname(name).replace(".", "");

  if (mime.includes("json") || ext === "json") return "json";
  if (ext === "data" || ext === "vec" || ext === "vector") return "vector";
  if (mime.includes("csv") || ext === "csv") return "csv";
  if (mime.includes("text") || ["txt", "md"].includes(ext)) return "text";
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.includes("spreadsheet") || ["xlsx", "xls"].includes(ext)) return "spreadsheet";
  if (mime.includes("word") || ["docx", "doc"].includes(ext)) return "document";
  if (mime.includes("image") || ["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  return ext || "unknown";
}

function decodeFileContent(file = {}) {
  if (file.text) return Buffer.from(String(file.text), "utf8");
  const content = file.content || file.data || "";
  if (!content) return Buffer.alloc(0);
  const base64 = String(content).includes(",") ? String(content).split(",").pop() : String(content);
  return Buffer.from(base64, "base64");
}

function printableTextFromBuffer(buffer) {
  return buffer
    .toString("latin1")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseStructuredText(type, text) {
  if (type === "json") {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  }
  if (type === "csv") {
    return text
      .split(/\r?\n/)
      .map((line) => line.split(",").map((cell) => cell.trim()).join(" | "))
      .join("\n");
  }
  return text;
}

function normalizeVector(vector = {}) {
  const entries = Object.entries(vector)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => [String(key).toLowerCase(), Number(value)]);
  const magnitude = Math.sqrt(entries.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
  return Object.fromEntries(entries.map(([key, value]) => [key, Number((value / magnitude).toFixed(6))]));
}

function parseVectorData(text, name) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const tokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.map(String)
      : parsed.vector && typeof parsed.vector === "object" && !Array.isArray(parsed.vector)
        ? Object.keys(parsed.vector)
        : [];
    const vector =
      parsed.vector && typeof parsed.vector === "object" && !Array.isArray(parsed.vector)
        ? normalizeVector(parsed.vector)
        : vectorize(tokens);
    const readable =
      parsed.text ||
      parsed.summary ||
      (tokens.length
        ? `Vector training data from ${name}. Labeled medical features: ${tokens.slice(0, 120).join(", ")}.`
        : "");

    return {
      type: "vector",
      text: normalizeText(readable),
      vector,
      tokens: tokens.length ? tokens : tokenize(readable),
      metadata: {
        vectorFormat: "json-labeled",
        originalTitle: parsed.title || "",
        originalCategory: parsed.category || ""
      }
    };
  }

  const tokenPairs = [...text.matchAll(/\b([a-z][a-z0-9-]{2,})\s*[:=]\s*(-?\d+(?:\.\d+)?)/gi)];
  if (tokenPairs.length) {
    const vector = normalizeVector(Object.fromEntries(tokenPairs.map((match) => [match[1], Number(match[2])])));
    const tokens = Object.keys(vector);
    return {
      type: "vector",
      text: `Vector training data from ${name}. Labeled medical features: ${tokens.slice(0, 120).join(", ")}.`,
      vector,
      tokens,
      metadata: { vectorFormat: "token-score-lines" }
    };
  }

  return {
    type: "vector",
    text: "",
    vector: {},
    tokens: [],
    metadata: { vectorFormat: "unsupported" }
  };
}

function extractTextFromFile(file = {}) {
  const type = detectFileType(file);
  const buffer = decodeFileContent(file);
  const name = file.name || "uploaded-file";

  if (type === "image") {
    return {
      type,
      text: `[Image file uploaded: ${name}. This prototype stores image evidence but does not perform diagnostic computer vision. Use the visual-observation field for clinical description.]`
    };
  }

  if (["text", "csv", "json"].includes(type)) {
    const text = parseStructuredText(type, buffer.toString("utf8"));
    return { type, text };
  }

  if (type === "vector") {
    return parseVectorData(buffer.toString("utf8"), name);
  }

  const extracted = printableTextFromBuffer(buffer);
  const note =
    type === "pdf" || type === "spreadsheet" || type === "document"
      ? `\n\n[Extractor note: ${name} was detected as ${type}. Built-in parsing uses readable embedded text only. For production, connect pypdf, openpyxl, and OCR/vision adapters.]`
      : "";

  return {
    type,
    text: `${extracted}${note}`.trim()
  };
}

function validateMedicalText(text) {
  const normalized = normalizeText(text);
  if (normalized.length < 40) {
    return {
      ok: false,
      reason: "The file did not contain enough readable medical text to train safely."
    };
  }

  for (const pattern of DANGEROUS_CLAIMS) {
    if (pattern.test(normalized)) {
      return {
        ok: false,
        reason: "The upload contains a dangerous or medically false claim and was rejected."
      };
    }
  }

  const lower = normalized.toLowerCase();
  const hasMedicalSignal = MEDICAL_HINTS.some((hint) => lower.includes(hint));
  if (!hasMedicalSignal) {
    return {
      ok: false,
      reason: "The content does not look like medical training material."
    };
  }

  return { ok: true, reason: "Accepted" };
}

async function loadManualDocuments() {
  return readJson(MANUAL_STORE, []);
}

async function loadUserDocuments() {
  return readJson(USER_STORE, []);
}

async function loadAllDocuments() {
  const manual = await loadManualDocuments();
  const user = await loadUserDocuments();
  return [...manual, ...user];
}

async function initializeTrainingStore() {
  const existing = await readJson(MANUAL_STORE, null);
  const seed = await readJson(SEED_FILE, []);
  const seedDocuments = seed.map((item) =>
    buildDocument({
      ...item,
      source: "manual",
      status: "active",
      metadata: {
        createdAt: new Date().toISOString(),
        origin: "seed-medical-knowledge"
      }
    })
  );

  if (existing && existing.length) {
    const existingIds = new Set(existing.map((doc) => doc.id));
    const missingSeedDocuments = seedDocuments.filter((doc) => !existingIds.has(doc.id));
    if (missingSeedDocuments.length) {
      const merged = existing.concat(missingSeedDocuments);
      await writeJson(MANUAL_STORE, merged);
      return merged;
    }
    return existing;
  }

  const documents = seedDocuments;
  await writeJson(MANUAL_STORE, documents);
  await writeJson(USER_STORE, await readJson(USER_STORE, []));
  await writeJson(AUDIT_LOG, await readJson(AUDIT_LOG, []));
  return documents;
}

function compareDocument(newDoc, existingDocs) {
  let best = null;
  for (const doc of existingDocs) {
    const score = cosineSimilarity(newDoc.vector, doc.vector || {});
    if (!best || score > best.score) best = { doc, score };
  }

  if (!best) return { status: "new", score: 0, message: "New medical training topic added." };

  const newTokens = uniqueNewTokens(newDoc.tokens, best.doc.tokens || []);
  if (best.score > 0.94 && newTokens.length < 8) {
    return {
      status: "duplicate",
      score: Number(best.score.toFixed(4)),
      message: "This appears to already be trained, so it was not added again.",
      matchedTitle: best.doc.title
    };
  }

  if (best.score > 0.72 && newTokens.length >= 8) {
    return {
      status: "extended",
      score: Number(best.score.toFixed(4)),
      message: "Related data was found, but this upload adds new terms and has been added as an extension.",
      matchedTitle: best.doc.title,
      newTokens: newTokens.slice(0, 25)
    };
  }

  return {
    status: "new",
    score: Number(best.score.toFixed(4)),
    message: "New medical training topic added.",
    matchedTitle: best.doc.title
  };
}

async function processManualTrainingUpload(payload = {}) {
  const existingDocs = await loadManualDocuments();
  const files = payload.files || [];
  const results = [];
  const additions = [];

  for (const file of files) {
    const extracted = extractTextFromFile(file);
    const title = payload.title || extracted.metadata?.originalTitle || file.name || "Manual training upload";
    const validation = validateMedicalText(extracted.text);

    if (!validation.ok) {
      results.push({
        file: file.name,
        status: "rejected",
        reason: validation.reason
      });
      await appendJsonArray(AUDIT_LOG, {
        id: id("audit"),
        event: "manual-upload-rejected",
        file: file.name,
        reason: validation.reason,
        createdAt: new Date().toISOString()
      });
      continue;
    }

    const document = buildDocument({
      id: id("manual"),
      title,
      category: payload.category || extracted.metadata?.originalCategory || extracted.type,
      source: "manual",
      text: extracted.text,
      trusted: false,
      status: "active",
      metadata: {
        uploadedFile: file.name,
        fileType: extracted.type,
        ...(extracted.metadata || {}),
        createdAt: new Date().toISOString()
      }
    });

    if (extracted.type === "vector" && extracted.tokens?.length && Object.keys(extracted.vector || {}).length) {
      document.tokens = extracted.tokens;
      document.vector = extracted.vector;
      document.tokenCount = extracted.tokens.length;
      document.metadata.usedUploadedVector = true;
    }

    const comparison = compareDocument(document, existingDocs.concat(additions));
    if (comparison.status === "duplicate") {
      results.push({
        file: file.name,
        status: "duplicate",
        message: comparison.message,
        matchedTitle: comparison.matchedTitle,
        similarity: comparison.score
      });
      continue;
    }

    document.metadata.comparison = comparison;
    additions.push(document);
    results.push({
      file: file.name,
      status: comparison.status,
      message: comparison.message,
      matchedTitle: comparison.matchedTitle,
      similarity: comparison.score,
      newTokens: comparison.newTokens || []
    });
  }

  if (additions.length) {
    await writeJson(MANUAL_STORE, existingDocs.concat(additions));
    await appendJsonArray(AUDIT_LOG, {
      id: id("audit"),
      event: "manual-upload-trained",
      count: additions.length,
      createdAt: new Date().toISOString(),
      files: additions.map((doc) => doc.metadata.uploadedFile)
    });
  }

  return {
    added: additions.length,
    results
  };
}

async function addUserLearning({ text, context = {}, confidence = "pending_review" }) {
  const cleanText = normalizeText(text);
  const validation = validateMedicalText(cleanText);
  if (!validation.ok) {
    return { added: false, status: "rejected", reason: validation.reason };
  }

  const allDocs = await loadAllDocuments();
  const userDocs = await loadUserDocuments();
  const doc = buildDocument({
    id: id("user"),
    title: context.title || "User interaction learning",
    category: context.category || "user-feedback",
    source: "user",
    trusted: false,
    status: confidence,
    text: cleanText,
    metadata: {
      ...context,
      createdAt: new Date().toISOString()
    }
  });
  const comparison = compareDocument(doc, allDocs);

  if (comparison.status === "duplicate") {
    return {
      added: false,
      status: "duplicate",
      message: "The user interaction matches existing training and was ignored."
    };
  }

  doc.metadata.comparison = comparison;
  await writeJson(USER_STORE, userDocs.concat(doc));
  await appendJsonArray(AUDIT_LOG, {
    id: id("audit"),
    event: "user-learning-added",
    docId: doc.id,
    status: doc.status,
    createdAt: new Date().toISOString()
  });
  return { added: true, status: doc.status, id: doc.id };
}

async function trainingSummary(source) {
  const docs = source === "user" ? await loadUserDocuments() : await loadManualDocuments();
  const grouped = {};
  for (const doc of docs) {
    grouped[doc.category] = grouped[doc.category] || {
      category: doc.category,
      count: 0,
      tokens: 0
    };
    grouped[doc.category].count += 1;
    grouped[doc.category].tokens += doc.tokenCount || 0;
  }
  return {
    source,
    count: docs.length,
    tokenCount: docs.reduce((sum, doc) => sum + (doc.tokenCount || 0), 0),
    categories: Object.values(grouped).sort((a, b) => b.count - a.count)
  };
}

module.exports = {
  MANUAL_STORE,
  USER_STORE,
  AUDIT_LOG,
  detectFileType,
  extractTextFromFile,
  validateMedicalText,
  initializeTrainingStore,
  loadManualDocuments,
  loadUserDocuments,
  loadAllDocuments,
  processManualTrainingUpload,
  addUserLearning,
  trainingSummary
};
