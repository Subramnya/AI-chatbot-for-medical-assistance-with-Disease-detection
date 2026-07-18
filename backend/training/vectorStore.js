const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "you",
  "your",
  "have",
  "has",
  "had",
  "can",
  "will",
  "not",
  "but",
  "they",
  "their",
  "there",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "into",
  "about",
  "than",
  "then",
  "also",
  "been",
  "because",
  "should",
  "would",
  "could",
  "may",
  "might",
  "our",
  "all",
  "any",
  "each",
  "such",
  "use",
  "using",
  "used",
  "need",
  "needs",
  "needed"
]);

// Keep text cleanup small and deterministic so every training run produces the
// same tokens and therefore the same vectors for the same raw data.
function normalizeText(text = "") {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

// Raw training text becomes searchable features here:
// 1. lowercase the text,
// 2. keep words/numbers,
// 3. remove short/common words that do not help medical matching.
function tokenize(text = "") {
  const matches = normalizeText(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu) || [];
  return matches
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

// This is the main "raw data to vector" conversion.
// It counts how often each token appears, then normalizes those counts by the
// vector magnitude. Normalization keeps long documents from winning just
// because they contain more words.
function vectorize(tokens) {
  const vector = {};
  for (const token of tokens) vector[token] = (vector[token] || 0) + 1;
  const magnitude = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0)) || 1;
  for (const token of Object.keys(vector)) vector[token] = Number((vector[token] / magnitude).toFixed(6));
  return vector;
}

// Cosine similarity compares two normalized token vectors.
// Higher values mean the query and training document share more meaningful
// medical terms.
function cosineSimilarity(vectorA = {}, vectorB = {}) {
  const small = Object.keys(vectorA).length < Object.keys(vectorB).length ? vectorA : vectorB;
  const large = small === vectorA ? vectorB : vectorA;
  let dot = 0;
  for (const token of Object.keys(small)) {
    if (large[token]) dot += small[token] * large[token];
  }
  return dot;
}

// A training document stores both the original readable text and the searchable
// tokens/vector made from that text. The readable text is for admin inspection;
// the vector is what retrieval uses.
function buildDocument({ id, title, category, source, text, trusted = false, url = "", status = "active", metadata = {} }) {
  const cleanText = normalizeText(text);
  const tokens = tokenize(cleanText);
  return {
    id,
    title: title || "Untitled medical note",
    category: category || "general",
    source: source || "manual",
    trusted,
    url,
    status,
    text: cleanText,
    tokens,
    vector: vectorize(tokens),
    tokenCount: tokens.length,
    createdAt: metadata.createdAt || new Date().toISOString(),
    metadata
  };
}

// Search converts the user query into the same vector format as training data,
// scores every stored document, then returns the closest matches.
function searchDocuments(query, documents, options = {}) {
  const limit = options.limit || 5;
  const queryVector = vectorize(tokenize(query));
  const weights = options.sourceWeights || {};

  return documents
    .filter((doc) => doc && doc.status !== "rejected" && doc.text)
    .map((doc) => {
      const baseScore = cosineSimilarity(queryVector, doc.vector || {});
      const weight = weights[doc.source] ?? 1;
      return { ...doc, score: Number((baseScore * weight).toFixed(5)) };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Duplicate handling needs to know whether a related upload adds genuinely new
// medical words or simply repeats what is already trained.
function uniqueNewTokens(newTokens, oldTokens) {
  const oldSet = new Set(oldTokens);
  return [...new Set(newTokens.filter((token) => !oldSet.has(token)))];
}

module.exports = {
  normalizeText,
  tokenize,
  vectorize,
  cosineSimilarity,
  buildDocument,
  searchDocuments,
  uniqueNewTokens
};
