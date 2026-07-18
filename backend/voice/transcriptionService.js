const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");
const { UPLOAD_DIR, ensureDir } = require("../utils/persistence");
const { WHISPER_INITIAL_PROMPT } = require("./assistantLibrary");

const VOICE_TEMP_DIR = path.join(UPLOAD_DIR, "voice-temp");
const ALLOWED_EXTENSIONS = new Set([".webm", ".wav", ".mp3", ".m4a", ".ogg", ".flac"]);

function extensionFor(file = {}) {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName;
  const mime = String(file.type || file.mime || "").toLowerCase();
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  return ".webm";
}

function decodeFile(file = {}) {
  const content = file.content || file.data || "";
  if (!content) return Buffer.alloc(0);
  const base64 = String(content).includes(",") ? String(content).split(",").pop() : String(content);
  return Buffer.from(base64, "base64");
}

function whisperPayload(audioPath, options = {}) {
  return JSON.stringify({
    audioPath,
    model: options.model || process.env.DOC_WHISPER_MODEL || "base",
    device: options.device || process.env.DOC_WHISPER_DEVICE || "auto",
    computeType: options.computeType || process.env.DOC_WHISPER_COMPUTE || "",
    language: options.language || process.env.DOC_WHISPER_LANGUAGE || "en",
    beamSize: options.beamSize || process.env.DOC_WHISPER_BEAM_SIZE || 5,
    initialPrompt: options.initialPrompt || process.env.DOC_WHISPER_INITIAL_PROMPT || WHISPER_INITIAL_PROMPT,
    allowCpuFallback: options.allowCpuFallback !== false
  });
}

function parseWhisperStdout(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return { ok: false, error: stdout.trim() || "Whisper returned invalid output." };
  }
}

function pythonCommands() {
  return [...new Set([process.env.DOC_WHISPER_PYTHON, process.env.PYTHON, "python", "py"].filter(Boolean))];
}

function runWhisper(audioPath, options = {}) {
  const scriptPath = path.resolve(__dirname, "faster_whisper_transcribe.py");
  const payload = whisperPayload(audioPath, options);
  let lastFailure = null;

  for (const command of pythonCommands()) {
    const result = spawnSync(command, [scriptPath], {
      input: payload,
      encoding: "utf8",
      timeout: Number(process.env.DOC_WHISPER_TIMEOUT_MS || 120000)
    });

    if (result.error) {
      lastFailure = { ok: false, error: result.error.message, pythonCommand: command };
      continue;
    }

    const parsed = parseWhisperStdout(result.stdout);
    if (parsed) {
      parsed.pythonCommand = command;
      if (parsed.ok) return parsed;
      lastFailure = parsed;
      if (parsed.errorCode === "missing_dependency") continue;
      return parsed;
    }

    if (result.stderr) {
      lastFailure = { ok: false, error: result.stderr.trim(), pythonCommand: command };
      return lastFailure;
    }

    lastFailure = { ok: false, error: `Whisper exited with status ${result.status}.`, pythonCommand: command };
  }

  return lastFailure || { ok: false, error: "Python was not available to run faster-whisper." };
}

async function transcribeAudio(payload = {}) {
  const file = payload.file || {};
  const buffer = decodeFile(file);
  if (!buffer.length) {
    return { ok: false, error: "No audio content was received." };
  }

  await ensureDir(VOICE_TEMP_DIR);
  const audioPath = path.join(VOICE_TEMP_DIR, `voice-${crypto.randomBytes(10).toString("hex")}${extensionFor(file)}`);

  await fs.writeFile(audioPath, buffer);
  try {
    return runWhisper(audioPath, payload.options || {});
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}

module.exports = {
  transcribeAudio
};
