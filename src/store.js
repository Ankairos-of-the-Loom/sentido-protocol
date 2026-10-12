import { appendFile, mkdir, readFile, rename, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, SESSIONS_DIR, PROPOSALS_DIR } from "./paths.js";

export async function ensureStore() {
  await Promise.all([
    mkdir(DATA_DIR, { recursive: true }),
    mkdir(SESSIONS_DIR, { recursive: true }),
    mkdir(PROPOSALS_DIR, { recursive: true })
  ]);
}

export async function readText(path, fallback = null) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}

export async function readJson(path, fallback = null) {
  const text = await readText(path, fallback === null ? null : JSON.stringify(fallback));
  return JSON.parse(text);
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export async function appendJsonl(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonl(path) {
  const text = await readText(path, "");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function listFiles(path, suffix = "") {
  try {
    return (await readdir(path)).filter((name) => !suffix || name.endsWith(suffix)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function sessionPath(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid session id");
  return join(SESSIONS_DIR, `${id}.json`);
}

export function proposalPath(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid proposal id");
  return join(PROPOSALS_DIR, `${id}.json`);
}
