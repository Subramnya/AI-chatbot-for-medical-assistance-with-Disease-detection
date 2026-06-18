const crypto = require("crypto");
const { MANUAL_STORE, loadManualDocuments, validateMedicalText } = require("./fileProcessor");
const { writeJson } = require("../utils/persistence");
const { buildDocument, cosineSimilarity, normalizeText, tokenize } = require("./vectorStore");

const TRUSTED_SEARCH_URL = "https://wsearch.nlm.nih.gov/ws/query";
const ONLINE_RESEARCH_TIMEOUT_MS = 3500;

const QUERY_HINTS = [
  "asthma",
  "pneumonia",
  "urinary tract infection",
  "diabetes",
  "high blood pressure",
  "hypertension",
  "back pain",
  "anxiety",
  "panic attack",
  "depression",
  "anemia",
  "sinusitis",
  "ear infection",
  "pink eye",
  "conjunctivitis",
  "heartburn",
  "gerd",
  "dehydration",
  "covid",
  "dengue",
  "malaria",
  "thyroid disease",
  "appendicitis",
  "kidney stones",
  "migraine",
  "skin infection",
  "cellulitis"
];

function remoteId() {
  return `remote-${crypto.randomBytes(8).toString("hex")}`;
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(value = "") {
  return normalizeText(decodeXml(value).replace(/<[^>]+>/g, " "));
}

function extractContent(block, name) {
  const pattern = new RegExp(`<content\\s+name=["']${name}["']>([\\s\\S]*?)<\\/content>`, "i");
  const match = block.match(pattern);
  return match ? stripTags(match[1]) : "";
}

function parseMedlineDocument(xml) {
  const docMatch = xml.match(/<document\b([^>]*)>([\s\S]*?)<\/document>/i);
  if (!docMatch) return null;

  const attributes = docMatch[1] || "";
  const block = docMatch[2] || "";
  const url = (attributes.match(/\burl=["']([^"']+)["']/i) || [])[1] || "";
  const title = extractContent(block, "title") || extractContent(block, "groupName") || "MedlinePlus health topic";
  const summary =
    extractContent(block, "FullSummary") ||
    extractContent(block, "fullSummary") ||
    extractContent(block, "snippet") ||
    extractContent(block, "mesh") ||
    stripTags(block).slice(0, 1200);

  if (!summary || summary.length < 80) return null;
  return { title, url, summary };
}

function deriveQueries(intake = {}) {
  const text = normalizeText([intake.symptoms, intake.visuals, intake.additional, intake.reportsDescription].filter(Boolean).join(" ")).toLowerCase();
  const queries = QUERY_HINTS.filter((hint) => text.includes(hint));
  if (queries.length) return [...new Set(queries)].slice(0, 2);

  const tokens = tokenize(text)
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 8);
  return tokens.length ? [tokens.join(" ")] : [];
}

async function searchMedlinePlus(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ONLINE_RESEARCH_TIMEOUT_MS);
  const url = `${TRUSTED_SEARCH_URL}?db=healthTopics&term=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DOC-local-medical-assistant-prototype/0.1"
      }
    });
    if (!response.ok) throw new Error(`MedlinePlus search failed with ${response.status}.`);
    const xml = await response.text();
    const parsed = parseMedlineDocument(xml);
    if (!parsed) return null;
    return {
      ...parsed,
      query,
      searchUrl: url
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isDuplicate(document, existingDocs) {
  return existingDocs.some((doc) => cosineSimilarity(document.vector, doc.vector || {}) > 0.9);
}

async function autoResearchAndTrain(intake = {}, existingDocs = []) {
  if (process.env.DOC_DISABLE_ONLINE_RESEARCH === "1") {
    return { attempted: false, status: "disabled", added: 0, message: "Online research is disabled." };
  }

  const queries = deriveQueries(intake);
  if (!queries.length) {
    return { attempted: false, status: "no-query", added: 0, message: "No research query could be derived from the intake." };
  }

  const duplicateDocs = existingDocs.length ? existingDocs : await loadManualDocuments();
  const manualDocs = await loadManualDocuments();
  const additions = [];
  const notes = [];

  for (const query of queries) {
    try {
      const result = await searchMedlinePlus(query);
      if (!result) {
        notes.push(`No trusted MedlinePlus topic found for "${query}".`);
        continue;
      }

      const text = `${result.title}. ${result.summary}`;
      const validation = validateMedicalText(text);
      if (!validation.ok) {
        notes.push(`Trusted result for "${query}" was not added: ${validation.reason}`);
        continue;
      }

      const document = buildDocument({
        id: remoteId(),
        title: result.title,
        category: "online-medlineplus",
        source: "remote",
        trusted: true,
        url: result.url,
        text,
        status: "active",
        metadata: {
          createdAt: new Date().toISOString(),
          origin: "medlineplus-web-service",
          query: result.query,
          searchUrl: result.searchUrl
        }
      });

      if (isDuplicate(document, duplicateDocs.concat(additions))) {
        notes.push(`"${result.title}" is already represented in local training data.`);
        continue;
      }

      additions.push(document);
      notes.push(`Added trusted MedlinePlus topic "${result.title}" to local vectors.`);
    } catch (error) {
      notes.push(`Online research for "${query}" was unavailable: ${error.message}`);
    }
  }

  if (additions.length) {
    await writeJson(MANUAL_STORE, manualDocs.concat(additions));
  }

  return {
    attempted: true,
    status: additions.length ? "trained" : "not-added",
    added: additions.length,
    queries,
    notes,
    message: additions.length ? "Trusted online topic was tokenized and added to training data." : "No new trusted topic was added."
  };
}

module.exports = {
  autoResearchAndTrain,
  deriveQueries,
  parseMedlineDocument
};
