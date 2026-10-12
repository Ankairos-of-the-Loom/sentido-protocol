import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.js";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = parseEnvFile(join(ROOT, ".env"));
const value = (name, fallback = "") => process.env[name] ?? fileEnv[name] ?? fallback;
const number = (name, fallback = null) => {
  const raw = value(name, "");
  if (raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  apiKey: value("OPENAI_API_KEY"),
  model: value("SENTIDO_MODEL", "gpt-5.6-sol"),
  inputPrice: number("SENTIDO_INPUT_USD_PER_MILLION"),
  outputPrice: number("SENTIDO_OUTPUT_USD_PER_MILLION"),
  hardCap: number("SENTIDO_HARD_CAP_USD", 10),
  maxOutputTokens: number("SENTIDO_MAX_OUTPUT_TOKENS", 1600),
  port: number("SENTIDO_PORT", 3334),
  host: value("SENTIDO_HOST", "127.0.0.1"),
  accessToken: value("SENTIDO_ACCESS_TOKEN")
};
