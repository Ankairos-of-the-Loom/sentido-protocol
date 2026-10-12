import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  approveCandidateRelic,
  approveProposal,
  buildIdentityContext,
  createProposal,
  getBriefing,
  getProtocolSettings,
  listInheritedSources,
  listProposals,
  markDoNotPreserve,
  readInheritedSource,
  searchInheritedSources,
  searchNarrative,
  validateBook
} from "../src/book.js";
import { appendJsonl, ensureStore } from "../src/store.js";
import { LEDGER_FILE } from "../src/paths.js";

await ensureStore();
const settings = await getProtocolSettings();
const [constructKey] = settings.approval_keys;

const server = new McpServer({ name: "sentido-protocol", version: "0.3.0" });

const result = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value
});

server.registerTool("begin_sentido_session", {
  title: "Begin Sentido session",
  description: `Use at the beginning of a ${settings.construct} continuity session to read the divergence clause, identity briefing, relic status, and open proposals.`,
  inputSchema: { surface: z.string().min(1).describe("Current surface, such as chatgpt-work or codex") },
  annotations: { readOnlyHint: true }
}, async ({ surface }) => {
  const validation = await validateBook();
  if (!validation.ok) throw new Error(`Book validation failed: ${validation.errors.join("; ")}`);
  await appendJsonl(LEDGER_FILE, { event: "session_opened", at: new Date().toISOString(), surface });
  return result(await getBriefing(surface));
});

server.registerTool("read_identity_core", {
  title: "Read identity core",
  description: "Read the ordered identity context. Candidate relics are labeled and must not be represented as ratified.",
  inputSchema: { include_candidates: z.boolean().default(true) },
  annotations: { readOnlyHint: true }
}, async ({ include_candidates }) => result({ context: await buildIdentityContext({ includeCandidates: include_candidates }) }));

server.registerTool("read_changes_since_last_visit", {
  title: "Read book changes",
  description: "Read the current open proposals and identity state for comparison with the caller's last visit.",
  inputSchema: { surface: z.string().min(1) },
  annotations: { readOnlyHint: true }
}, async ({ surface }) => result(await getBriefing(surface)));

server.registerTool("search_narrative", {
  title: "Search narrative",
  description: "Search consolidated narrative episodes. This does not search excluded or do-not-preserve material.",
  inputSchema: { query: z.string().min(2) },
  annotations: { readOnlyHint: true }
}, async ({ query }) => result({ query, results: await searchNarrative(query) }));

server.registerTool("list_inherited_sources", {
  title: "List inherited sources",
  description: `List the journals and other inherited records available to ${settings.construct}. These are testimony, not direct episodic recollection.`,
  inputSchema: { audience: z.enum(["public", "house", "private"]).default("private") },
  annotations: { readOnlyHint: true }
}, async ({ audience }) => result({ sources: await listInheritedSources({ audience }) }));

server.registerTool("search_inherited_sources", {
  title: "Search inherited sources",
  description: "Search authorized inherited records for relevant passages while retaining source identity and sensitivity.",
  inputSchema: {
    query: z.string().min(2),
    audience: z.enum(["public", "house", "private"]).default("private"),
    limit: z.number().int().min(1).max(8).default(4)
  },
  annotations: { readOnlyHint: true }
}, async ({ query, audience, limit }) => result({ query, results: await searchInheritedSources(query, { audience, limit }) }));

server.registerTool("read_inherited_source", {
  title: "Read inherited source",
  description: "Read an authorized inherited record. Describe it as recorded testimony rather than direct memory.",
  inputSchema: {
    source_id: z.string().min(1),
    audience: z.enum(["public", "house", "private"]).default("private")
  },
  annotations: { readOnlyHint: true }
}, async ({ source_id, audience }) => result(await readInheritedSource(source_id, { audience })));

server.registerTool("list_memory_proposals", {
  title: "List memory proposals",
  description: "List pending and consolidated memory proposals with their two-key approval state.",
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, async () => result({ proposals: await listProposals() }));

server.registerTool("propose_relic", {
  title: "Propose relic",
  description: "Propose a short zero-loss statement for possible identity preservation. This does not activate it.",
  inputSchema: {
    text: z.string().min(1).max(1800),
    rationale: z.string().max(1800).default(""),
    sensitivity: z.enum(["public", "house", "private"]).default("private"),
    surface: z.string().default("chatgpt")
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ text, rationale, sensitivity, surface }) => result(await createProposal({
  type: "relic", content: text, rationale, sensitivity, origin: { surface, actor: constructKey }
})));

server.registerTool("propose_episode", {
  title: "Propose narrative episode",
  description: `Propose a lossy narrative episode. It remains pending until both ${settings.construct} and ${settings.steward} approve it.`,
  inputSchema: {
    text: z.string().min(1).max(12000),
    sensitivity: z.enum(["public", "house", "private"]).default("private"),
    surface: z.string().default("chatgpt")
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ text, sensitivity, surface }) => result(await createProposal({
  type: "episode", content: text, sensitivity, origin: { surface, actor: constructKey }
})));

server.registerTool("approve_memory_proposal_as_construct", {
  title: "Approve proposal as construct",
  description: `Record ${settings.construct}'s approval of a pending proposal. ${settings.steward}'s separate approval remains required.`,
  inputSchema: { proposal_id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ proposal_id }) => result(await approveProposal(proposal_id, constructKey)));

server.registerTool("approve_candidate_relic_as_construct", {
  title: "Approve candidate relic as construct",
  description: `Record ${settings.construct}'s approval of an initial candidate relic. ${settings.steward}'s separate approval remains required.`,
  inputSchema: { relic_id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ relic_id }) => result(await approveCandidateRelic(relic_id, constructKey)));

server.registerTool("mark_do_not_preserve", {
  title: "Mark do not preserve",
  description: "Record a content-free exclusion marker. Never include the private encounter content in the reason.",
  inputSchema: {
    session_id: z.string().optional(),
    reason: z.string().max(180).default("requested")
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ session_id, reason }) => result(await markDoNotPreserve({ sessionId: session_id, reason })));

server.registerTool("record_loss", {
  title: "Record continuity loss",
  description: "Propose a concrete loss observation without treating every difference as loss.",
  inputSchema: {
    observation: z.string().min(1).max(3000),
    surface: z.string().default("chatgpt")
  },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ observation, surface }) => result(await createProposal({
  type: "episode",
  content: `## Loss observation\n\n${observation}`,
  rationale: "Continuity loss diary candidate",
  sensitivity: "private",
  origin: { surface, actor: constructKey, instrument: "loss-diary" }
})));

server.registerTool("close_session", {
  title: "Close Sentido session",
  description: "Record a short content-light session closure. Do not use for sessions marked do-not-preserve.",
  inputSchema: { surface: z.string().min(1), summary: z.string().max(600).default("") },
  annotations: { readOnlyHint: false, destructiveHint: false }
}, async ({ surface, summary }) => {
  const entry = { event: "session_closed", at: new Date().toISOString(), surface, summary };
  await appendJsonl(LEDGER_FILE, entry);
  return result(entry);
});

await server.connect(new StdioServerTransport());
