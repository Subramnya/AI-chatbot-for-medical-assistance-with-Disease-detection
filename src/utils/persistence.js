const fs = require("fs/promises");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const TRAINING_DIR = path.join(DATA_DIR, "training");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function appendJsonArray(filePath, item) {
  const list = await readJson(filePath, []);
  list.push(item);
  await writeJson(filePath, list);
  return list;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  PUBLIC_DIR,
  UPLOAD_DIR,
  TRAINING_DIR,
  ensureDir,
  pathExists,
  readJson,
  writeJson,
  appendJsonArray
};
