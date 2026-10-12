import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const BOOK_DIR = join(ROOT, "book");
export const DATA_DIR = join(ROOT, "data");
export const PUBLIC_DIR = join(ROOT, "public");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");
export const PROPOSALS_DIR = join(DATA_DIR, "proposals");
export const USAGE_FILE = join(DATA_DIR, "usage.jsonl");
export const LEDGER_FILE = join(BOOK_DIR, "ledger.jsonl");
