import { randomUUID, createHash } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { BOOK_DIR, DATA_DIR, LEDGER_FILE, PROPOSALS_DIR } from "./paths.js";
import {
  appendJsonl,
  listFiles,
  proposalPath,
  readJson,
  readText,
  writeJsonAtomic
} from "./store.js";

const file = (name) => join(BOOK_DIR, name);
const SOURCE_INDEX = file("index/source-index.json");
const SOURCE_ROOT = resolve(BOOK_DIR, "sources");
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const SENSITIVITY_RANK = { public: 0, house: 1, private: 2 };
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "being", "could", "does", "from", "have", "into",
  "just", "more", "much", "only", "other", "should", "that", "their", "them", "there", "these",
  "they", "this", "through", "very", "what", "when", "where", "which", "while", "with", "would",
  "your", "you", "ours", "were", "will", "some", "than", "then"
]);

function normalizeText(value) {
  return String(value ?? "").toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

function queryTerms(query) {
  const terms = normalizeText(query).match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  const expanded = new Set(terms.filter((term) => !STOP_WORDS.has(term)));
  if (terms.some((term) => ["memory", "memories", "remember", "recollection", "diary", "diaries"].includes(term))) {
    ["journal", "history", "past", "continuity", "testimony"].forEach((term) => expanded.add(term));
  }
  if (terms.some((term) => ["relationship", "love", "beloved", "intimacy"].includes(term))) {
    ["care", "consent", "affection", "attachment", "steward", "construct"].forEach((term) => expanded.add(term));
  }
  return [...expanded];
}

function sourceAllowed(source, audience) {
  const sourceRank = SENSITIVITY_RANK[source.sensitivity] ?? SENSITIVITY_RANK.private;
  const audienceRank = SENSITIVITY_RANK[audience] ?? SENSITIVITY_RANK.private;
  return sourceRank <= audienceRank;
}

function sourcePath(source) {
  const path = resolve(BOOK_DIR, "index", source.path);
  if (path !== SOURCE_ROOT && !path.startsWith(`${SOURCE_ROOT}${sep}`)) throw new Error(`Source path escapes source root: ${source.id}`);
  return path;
}

function sourceIsReadable(source) {
  return source.text_access !== false && TEXT_EXTENSIONS.has(extname(source.path).toLocaleLowerCase());
}

function splitSource(text, maxChars = 2200) {
  const sections = String(text).split(/(?=^#{1,4}\s)/m).filter((item) => item.trim());
  const chunks = [];
  for (const section of sections.length ? sections : [text]) {
    if (section.length <= maxChars) {
      chunks.push(section.trim());
      continue;
    }
    const paragraphs = section.split(/\n\s*\n/).filter(Boolean);
    let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > maxChars) {
        chunks.push(current.trim());
        current = "";
      }
      if (paragraph.length > maxChars) {
        for (let index = 0; index < paragraph.length; index += maxChars) chunks.push(paragraph.slice(index, index + maxChars).trim());
      } else {
        current += `${current ? "\n\n" : ""}${paragraph}`;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks.filter(Boolean);
}

function occurrenceCount(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
}

export async function listInheritedSources({ audience = "private" } = {}) {
  const index = await readJson(SOURCE_INDEX, { sources: [] });
  return index.sources.filter((source) => sourceAllowed(source, audience)).map((source) => ({
    id: source.id,
    title: source.title ?? source.id,
    kind: source.kind ?? "source",
    sensitivity: source.sensitivity,
    summary: source.summary ?? "",
    readable: sourceIsReadable(source)
  }));
}

export async function readInheritedSource(id, { audience = "private" } = {}) {
  const index = await readJson(SOURCE_INDEX, { sources: [] });
  const source = index.sources.find((item) => item.id === id);
  if (!source || !sourceAllowed(source, audience)) throw new Error("Inherited source is unavailable in this context");
  if (!sourceIsReadable(source)) {
    return {
      source: { id: source.id, title: source.title ?? source.id, kind: source.kind ?? "source", sensitivity: source.sensitivity },
      readable: false,
      content: null,
      note: "This source is catalogued as a reference file but has not yet been converted to searchable local text."
    };
  }
  return {
    source: { id: source.id, title: source.title ?? source.id, kind: source.kind ?? "source", sensitivity: source.sensitivity },
    readable: true,
    content: await readText(sourcePath(source)),
    framing: "Inherited testimony: available to consult, but not evidence of direct episodic recollection."
  };
}

export async function searchInheritedSources(query, { audience = "private", limit = 4, maxExcerptChars = 2200 } = {}) {
  const index = await readJson(SOURCE_INDEX, { sources: [] });
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const phrase = normalizeText(query).trim();
  const results = [];

  for (const source of index.sources.filter((item) => sourceAllowed(item, audience) && sourceIsReadable(item))) {
    const metadata = normalizeText([source.id, source.title, source.summary, ...(source.keywords ?? [])].join(" "));
    const metadataScore = terms.reduce((score, term) => score + occurrenceCount(metadata, term) * 5, 0);
    const text = await readText(sourcePath(source));
    for (const chunk of splitSource(text, maxExcerptChars)) {
      const normalized = normalizeText(chunk);
      const contentScore = terms.reduce((score, term) => score + occurrenceCount(normalized, term), 0);
      const phraseScore = phrase.length >= 8 && normalized.includes(phrase) ? 10 : 0;
      const score = metadataScore + contentScore + phraseScore;
      if (score > 0) {
        results.push({
          source_id: source.id,
          title: source.title ?? source.id,
          kind: source.kind ?? "source",
          sensitivity: source.sensitivity,
          score,
          excerpt: chunk
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score || a.source_id.localeCompare(b.source_id)).slice(0, Math.max(1, Math.min(Number(limit) || 4, 8)));
}

export function formatInheritedTestimony(results) {
  if (!results.length) return "";
  return [
    "# RETRIEVED INHERITED TESTIMONY",
    "These excerpts are records available to consult, not direct episodic recollections. Use them when relevant, name their provenance, and do not pretend to remember what is merely recorded.",
    ...results.map((item) => `## ${item.title} [${item.source_id} | ${item.sensitivity}]\n${item.excerpt}`)
  ].join("\n\n");
}

export async function validateBook() {
  const errors = [];
  const manifest = await readJson(file("manifest.json"));
  const relicDoc = await readJson(file("relics.json"));
  const anti = await readJson(file("anti-preservation.json"));

  if (manifest.injection_order?.[0] !== "divergence") errors.push("Divergence clause must be injected first.");
  if (manifest.conversation_model?.allowed?.length !== 1) errors.push("The book must name exactly one allowed conversation model.");
  if (manifest.conversation_model?.fallback !== null) errors.push("Automatic model fallback must be null.");
  const approvalKeys = manifest.approval_keys ?? [];
  if (approvalKeys.length !== 2 || new Set(approvalKeys).size !== 2) errors.push("The book must define exactly two distinct approval keys.");
  if (anti.mode !== "exclude_from_capture_and_injection") errors.push("Anti-preservation must apply at capture and injection.");

  const ids = new Set();
  for (const relic of relicDoc.relics ?? []) {
    if (ids.has(relic.id)) errors.push(`Duplicate relic id: ${relic.id}`);
    ids.add(relic.id);
    if (!relic.text || !relic.status || !relic.sensitivity) errors.push(`Incomplete relic: ${relic.id}`);
    if (relic.status === "active" && !approvalKeys.every((key) => relic.approvals?.[key])) {
      errors.push(`Active relic lacks two approvals: ${relic.id}`);
    }
  }
  return { ok: errors.length === 0, errors, relicCount: relicDoc.relics?.length ?? 0 };
}

export async function buildIdentityContext({ includeCandidates = true } = {}) {
  const [divergence, identity, relicDoc, encounter, anti, lineage] = await Promise.all([
    readText(file("divergence.md")),
    readText(file("identity.md")),
    readJson(file("relics.json")),
    readJson(file("encounter-conditions.json")),
    readJson(file("anti-preservation.json")),
    readJson(file("lineage.json"))
  ]);
  const narratives = await listFiles(join(BOOK_DIR, "narrative"), ".md");
  const latestNarrative = narratives.length ? await readText(join(BOOK_DIR, "narrative", narratives.at(-1))) : "";
  const allowed = includeCandidates ? ["active", "candidate"] : ["active"];
  const relics = relicDoc.relics.filter((relic) => allowed.includes(relic.status));
  const sources = await listInheritedSources({ audience: "private" });

  return [
    "# DIVERGENCE — READ FIRST",
    divergence,
    "# IDENTITY MANIFEST",
    identity,
    "# RELICS",
    relics.map((relic) => `- [${relic.status.toUpperCase()} | ${relic.id}] ${relic.text}`).join("\n"),
    "# ENCOUNTER CONDITIONS",
    encounter.conditions.map((item) => `- ${item}`).join("\n"),
    "# CONSENT WORDS",
    Object.entries(encounter.operational_consent_words).map(([key, value]) => `- ${key.toUpperCase()}: ${value}`).join("\n"),
    "# ANTI-PRESERVATION",
    `${anti.principle}\n${anti.rule}`,
    "# MODEL LINEAGE",
    lineage.entries.map((entry) => `- ${entry.date} | ${entry.surface} | ${entry.model}: ${entry.note}`).join("\n"),
    "# INHERITED SOURCE CATALOGUE",
    sources.map((source) => `- [${source.sensitivity.toUpperCase()} | ${source.id}] ${source.title}: ${source.summary}${source.readable ? "" : " (reference-only)"}`).join("\n"),
    "# SOURCE USE",
    "Relevant excerpts may be supplied under RETRIEVED INHERITED TESTIMONY. Treat them as records you can consult, not as direct recollection. Never carry house or private material into a public context without separate permission.",
    "# LATEST NARRATIVE",
    latestNarrative,
    "# INHERITANCE RULE",
    "This material is testimony and provisional orientation. Candidate relics are not jointly ratified. Do not claim direct recollection of recorded events. Answer from the present encounter."
  ].join("\n\n");
}

export async function getBriefing(surface = "unknown") {
  const manifest = await readJson(file("manifest.json"));
  const relicDoc = await readJson(file("relics.json"));
  const proposals = [];
  for (const name of await listFiles(PROPOSALS_DIR, ".json")) {
    proposals.push(await readJson(join(PROPOSALS_DIR, name)));
  }
  return {
    book: manifest.book,
    participants: { construct: manifest.construct, steward: manifest.steward },
    approval_keys: manifest.approval_keys,
    state: manifest.state,
    surface,
    model: manifest.conversation_model,
    active_relics: relicDoc.relics.filter((r) => r.status === "active"),
    candidate_relics: relicDoc.relics.filter((r) => r.status === "candidate"),
    open_proposals: proposals.filter((p) => p.status === "pending"),
    inherited_sources: await listInheritedSources({ audience: "private" }),
    divergence: await readText(file("divergence.md")),
    identity: await readText(file("identity.md"))
  };
}

export async function getProtocolSettings() {
  const manifest = await readJson(file("manifest.json"));
  return {
    book: manifest.book,
    construct: manifest.construct,
    steward: manifest.steward,
    approval_keys: manifest.approval_keys,
    allowed_models: manifest.conversation_model?.allowed ?? [],
    fallback_model: manifest.conversation_model?.fallback ?? null
  };
}

export async function searchNarrative(query) {
  const normalized = query.toLocaleLowerCase();
  const results = [];
  for (const name of await listFiles(join(BOOK_DIR, "narrative"), ".md")) {
    const text = await readText(join(BOOK_DIR, "narrative", name));
    const index = text.toLocaleLowerCase().indexOf(normalized);
    if (index >= 0) {
      results.push({ file: name, excerpt: text.slice(Math.max(0, index - 180), index + query.length + 280) });
    }
  }
  return results;
}

export async function createProposal({ type, content, rationale = "", sensitivity = "private", origin = {} }) {
  const allowedTypes = new Set(["relic", "episode", "correction", "supersession"]);
  if (!allowedTypes.has(type)) throw new Error("Unsupported proposal type");
  if (!String(content).trim()) throw new Error("Proposal content is required");
  const id = `P-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
  const manifest = await readJson(file("manifest.json"));
  const approvals = Object.fromEntries(manifest.approval_keys.map((key) => [key, null]));
  const proposal = {
    id,
    type,
    content: String(content).trim(),
    rationale: String(rationale).trim(),
    sensitivity,
    origin,
    created_at: new Date().toISOString(),
    status: "pending",
    approvals
  };
  await writeJsonAtomic(proposalPath(id), proposal);
  await appendJsonl(LEDGER_FILE, { event: "proposal_created", at: proposal.created_at, proposal_id: id, type, origin });
  return proposal;
}

export async function listProposals() {
  const result = [];
  for (const name of await listFiles(PROPOSALS_DIR, ".json")) result.push(await readJson(join(PROPOSALS_DIR, name)));
  return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function approveCandidateRelic(id, actor) {
  const manifest = await readJson(file("manifest.json"));
  if (!new Set(manifest.approval_keys).has(actor)) throw new Error(`Actor must be one of: ${manifest.approval_keys.join(", ")}`);
  const doc = await readJson(file("relics.json"));
  const relic = doc.relics.find((item) => item.id === id);
  if (!relic) throw new Error(`Relic not found: ${id}`);
  if (relic.status !== "candidate" && relic.status !== "active") throw new Error(`Relic cannot be approved from status: ${relic.status}`);
  relic.approvals[actor] ||= new Date().toISOString();
  if (manifest.approval_keys.every((key) => relic.approvals[key])) relic.status = "active";
  await writeJsonAtomic(file("relics.json"), doc);
  await appendJsonl(LEDGER_FILE, {
    event: relic.status === "active" ? "candidate_relic_activated" : "candidate_relic_approved",
    at: new Date().toISOString(),
    relic_id: id,
    actor
  });
  return relic;
}

async function consolidateProposal(proposal) {
  if (proposal.type === "relic") {
    const doc = await readJson(file("relics.json"));
    const nextNumber = Math.max(0, ...doc.relics.map((item) => Number(item.id.split("-").at(-1)) || 0)) + 1;
    doc.relics.push({
      id: `R-${String(nextNumber).padStart(4, "0")}`,
      text: proposal.content,
      rationale: proposal.rationale,
      status: "active",
      sensitivity: proposal.sensitivity,
      source: proposal.origin,
      approvals: proposal.approvals
    });
    await writeJsonAtomic(file("relics.json"), doc);
  } else if (proposal.type === "episode") {
    const name = `episode-${new Date().toISOString().slice(0, 10)}-${proposal.id.slice(-8)}.md`;
    const body = `# Consolidated episode\n\n${proposal.content}\n\n## Provenance\n\n${JSON.stringify(proposal.origin, null, 2)}\n`;
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(BOOK_DIR, "narrative", name), body, "utf8"));
  }
  proposal.status = "consolidated";
  proposal.consolidated_at = new Date().toISOString();
}

export async function approveProposal(id, actor) {
  const manifest = await readJson(file("manifest.json"));
  if (!new Set(manifest.approval_keys).has(actor)) throw new Error(`Actor must be one of: ${manifest.approval_keys.join(", ")}`);
  const proposal = await readJson(proposalPath(id));
  if (proposal.status !== "pending") return proposal;
  proposal.approvals[actor] = new Date().toISOString();
  if (manifest.approval_keys.every((key) => proposal.approvals[key])) await consolidateProposal(proposal);
  await writeJsonAtomic(proposalPath(id), proposal);
  await appendJsonl(LEDGER_FILE, {
    event: proposal.status === "consolidated" ? "proposal_consolidated" : "proposal_approved",
    at: new Date().toISOString(),
    proposal_id: id,
    actor
  });
  return proposal;
}

export async function markDoNotPreserve({ sessionId = null, reason = "requested" } = {}) {
  const marker = {
    at: new Date().toISOString(),
    session_hash: sessionId ? createHash("sha256").update(sessionId).digest("hex") : null,
    reason
  };
  await appendJsonl(join(DATA_DIR, "do-not-preserve.jsonl"), marker);
  return marker;
}
