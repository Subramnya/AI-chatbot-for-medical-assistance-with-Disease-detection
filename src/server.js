const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const {
  PUBLIC_DIR,
  UPLOAD_DIR,
  DATA_DIR,
  TRAINING_DIR,
  ensureDir,
  readJson,
  writeJson,
  pathExists
} = require("./utils/persistence");
const {
  initializeTrainingStore,
  loadAllDocuments,
  processManualTrainingUpload,
  addUserLearning,
  trainingSummary,
  loadManualDocuments,
  loadUserDocuments
} = require("./training/fileProcessor");
const { autoResearchAndTrain } = require("./training/remoteKnowledge");
const { generateReport } = require("./ai/medicalEngine");
const { chatTurn } = require("./ai/chatAssistant");
const { renderReportHtml } = require("./reports/reportRenderer");
const { transcribeAudio } = require("./voice/transcriptionService");

const PORT = Number(process.env.PORT || 3000);
const PORT_RETRY_LIMIT = Number(process.env.PORT_RETRY_LIMIT || 10);
const HOST = process.env.HOST || "127.0.0.1";
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const ADMIN_TOKEN = "local-admin-token";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": headers["Content-Type"] || (typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"),
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, data, { "Content-Type": "application/json; charset=utf-8" });
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function requireAdmin(req) {
  return req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

async function storeReport(report) {
  const reports = await readJson(REPORTS_FILE, []);
  reports.push(report);
  await writeJson(REPORTS_FILE, reports);
  return report;
}

async function buildReportWithResearch(intake = {}) {
  let docs = await loadAllDocuments();
  let report = generateReport(intake, docs);
  const weakLocalMatch =
    report.knowledgeUsed.length < 1 ||
    (report.possibleConditions.length === 1 && report.possibleConditions[0].name === "General symptom triage");

  if (!weakLocalMatch) return report;

  const research = await autoResearchAndTrain(intake, docs);
  if (research.attempted && research.added > 0) {
    docs = await loadAllDocuments();
    report = generateReport(intake, docs);
  }
  report.onlineResearch = research;
  return report;
}

async function getReport(id) {
  const reports = await readJson(REPORTS_FILE, []);
  return reports.find((report) => report.id === id);
}

async function getSession(id) {
  const sessions = await readJson(SESSIONS_FILE, {});
  const sessionId = id || `session-${crypto.randomBytes(8).toString("hex")}`;
  return {
    sessions,
    sessionId,
    session: sessions[sessionId] || { id: sessionId, createdAt: new Date().toISOString(), intake: {}, messages: [] }
  };
}

async function saveSession(sessions, sessionId, session) {
  sessions[sessionId] = session;
  await writeJson(SESSIONS_FILE, sessions);
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null;
  return targetPath;
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = safeJoin(PUBLIC_DIR, pathname);
  if (!filePath) return send(res, 403, "Forbidden");

  const exists = await pathExists(filePath);
  if (!exists) return send(res, 404, "Not found");

  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) return send(res, 403, "Forbidden");

  const ext = path.extname(filePath).toLowerCase();
  const content = await fs.readFile(filePath);
  return send(res, 200, content, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      app: "DOC",
      onlineHint: "Browser checks navigator.onLine; server is reachable locally.",
      time: new Date().toISOString()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readBody(req);
    const ok = body.username === "admin" && body.password === "admin123";
    return sendJson(res, ok ? 200 : 401, ok ? { ok: true, token: ADMIN_TOKEN } : { ok: false, error: "Invalid admin login." });
  }

  if (req.method === "POST" && url.pathname === "/api/report") {
    const body = await readBody(req);
    const report = await storeReport(await buildReportWithResearch(body.intake || body));
    return sendJson(res, 200, { ok: true, report, reportUrl: `/result.html?id=${encodeURIComponent(report.id)}` });
  }

  if (req.method === "POST" && url.pathname === "/api/voice/transcribe") {
    const body = await readBody(req, 50 * 1024 * 1024);
    const transcript = await transcribeAudio(body);
    return sendJson(res, transcript.ok ? 200 : 503, transcript);
  }

  const reportMatch = url.pathname.match(/^\/api\/report\/([^/]+)(\/download)?$/);
  if (req.method === "GET" && reportMatch) {
    const report = await getReport(reportMatch[1]);
    if (!report) return sendJson(res, 404, { ok: false, error: "Report not found." });
    if (reportMatch[2]) {
      return send(res, 200, renderReportHtml(report, { printable: true }), {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report.id}.html"`
      });
    }
    return sendJson(res, 200, { ok: true, report, html: renderReportHtml(report) });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readBody(req);
    const docs = await loadAllDocuments();
    const { sessions, sessionId, session } = await getSession(body.sessionId);
    if (body.reportId && (!session.intake || !session.intake.symptoms)) {
      const report = await getReport(body.reportId);
      if (report) {
        session.intake = {
          name: report.patient?.name || "",
          age: report.patient?.age || "",
          sex: report.patient?.sex || "",
          symptoms: report.rawInput?.symptoms || "",
          visuals: report.rawInput?.visuals || "",
          allergies: report.rawInput?.allergies || "",
          additional: report.rawInput?.additional || ""
        };
      }
    }
    const turn = chatTurn({
      session,
      message: body.message,
      files: body.files || [],
      documents: docs
    });
    if (turn.report) {
      turn.report = await buildReportWithResearch(turn.session.intake || {});
      const lastMessage = turn.session.messages[turn.session.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") lastMessage.reportId = turn.report.id;
      await storeReport(turn.report);
    }
    await saveSession(sessions, sessionId, turn.session);
    return sendJson(res, 200, {
      ok: true,
      sessionId,
      reply: turn.reply,
      report: turn.report,
      reportUrl: turn.report ? `/result.html?id=${encodeURIComponent(turn.report.id)}` : "",
      endConversation: Boolean(turn.session.ended)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const body = await readBody(req);
    const text = [body.correction, body.notes, body.message].filter(Boolean).join(" ");
    const result = await addUserLearning({
      text,
      context: {
        reportId: body.reportId || "",
        title: "User correction or feedback",
        category: "user-feedback"
      },
      confidence: "pending_review"
    });
    return sendJson(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/training/upload") {
    if (!requireAdmin(req)) return sendJson(res, 401, { ok: false, error: "Admin login required." });
    const body = await readBody(req);
    const result = await processManualTrainingUpload(body);
    return sendJson(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/api/training/summary") {
    if (!requireAdmin(req)) return sendJson(res, 401, { ok: false, error: "Admin login required." });
    const source = url.searchParams.get("source") === "user" ? "user" : "manual";
    return sendJson(res, 200, { ok: true, summary: await trainingSummary(source) });
  }

  if (req.method === "GET" && url.pathname === "/api/training/items") {
    if (!requireAdmin(req)) return sendJson(res, 401, { ok: false, error: "Admin login required." });
    const source = url.searchParams.get("source") === "user" ? "user" : "manual";
    const docs = source === "user" ? await loadUserDocuments() : await loadManualDocuments();
    return sendJson(res, 200, {
      ok: true,
      items: docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        source: doc.source,
        status: doc.status,
        tokenCount: doc.tokenCount,
        createdAt: doc.createdAt,
        url: doc.url,
        text: doc.text,
        tokens: (doc.tokens || []).slice(0, 120),
        metadata: doc.metadata
      }))
    });
  }

  return sendJson(res, 404, { ok: false, error: "API route not found." });
}

async function bootstrap() {
  await ensureDir(DATA_DIR);
  await ensureDir(UPLOAD_DIR);
  await ensureDir(TRAINING_DIR);
  await initializeTrainingStore();
  await writeJson(REPORTS_FILE, await readJson(REPORTS_FILE, []));
  await writeJson(SESSIONS_FILE, await readJson(SESSIONS_FILE, {}));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: error.message || "Server error." });
  }
});

function listen(port, remainingAttempts = PORT_RETRY_LIMIT) {
  const onListening = () => {
    server.off("error", onError);
    console.log(`DOC medical assistant running at http://${HOST}:${port}`);
  };

  const onError = (error) => {
    server.off("listening", onListening);
    if (error.code === "EADDRINUSE" && remainingAttempts > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying http://${HOST}:${nextPort} instead.`);
      listen(nextPort, remainingAttempts - 1);
      return;
    }
    throw error;
  };

  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, HOST);
}

bootstrap().then(() => {
  listen(PORT);
});
