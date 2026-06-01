const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");
const { UPLOAD_DIR, ensureDir } = require("../utils/persistence");

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

function runWhisper(audioPath, options = {}) {
  const scriptPath = path.resolve(__dirname, "faster_whisper_transcribe.py");
  const payload = JSON.stringify({
    audioPath,
    model: options.model,
    device: options.device,
    computeType: options.computeType,
    language: options.language || "en"
  });
  const commands = [process.env.PYTHON || "python", "py"];

  for (const command of commands) {
    const result = spawnSync(command, [scriptPath], {
      input: payload,
      encoding: "utf8",
      timeout: Number(process.env.DOC_WHISPER_TIMEOUT_MS || 120000)
    });
    if (result.error) continue;
    if (result.stdout) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return { ok: false, error: result.stdout.trim() || "Whisper returned invalid output." };
      }
    }
    if (result.stderr) return { ok: false, error: result.stderr.trim() };
  }

  return {
    ok: false,
    error: "Python was not available to run faster-whisper."
  };
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
