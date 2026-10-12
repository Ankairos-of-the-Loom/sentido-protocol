import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { PUBLIC_DIR, SESSIONS_DIR, USAGE_FILE, LEDGER_FILE } from "./paths.js";
import {
  appendJsonl,
  ensureStore,
  listFiles,
  readJson,
  sessionPath,
  writeJsonAtomic
} from "./store.js";
import {
  approveCandidateRelic,
  approveProposal,
  buildIdentityContext,
  createProposal,
  formatInheritedTestimony,
  getBriefing,
  getProtocolSettings,
  listInheritedSources,
  listProposals,
  markDoNotPreserve,
  readInheritedSource,
  searchInheritedSources,
  validateBook
} from "./book.js";
import { calculateCost, preflightBudget, totalRecordedCost } from "./cost.js";
import { createResponse } from "./openai.js";

await ensureStore();

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (!localHosts.has(env.host) && !env.accessToken) {
  throw new Error("SENTIDO_ACCESS_TOKEN is required when listening beyond this computer.");
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};
const RECENT_MESSAGE_LIMIT = 16;

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function authorized(req) {
  if (!env.accessToken) return true;
  return req.headers.authorization === `Bearer ${env.accessToken}` || req.headers["x-sentido-token"] === env.accessToken;
}

async function status() {
  const validation = await validateBook();
  const spent = await totalRecordedCost();
  const settings = await getProtocolSettings();
  return {
    ok: validation.ok,
    validation,
    api_key_configured: Boolean(env.apiKey),
    pricing_configured: env.inputPrice != null && env.outputPrice != null,
    model: env.model,
    model_locked: settings.allowed_models.length === 1 && settings.allowed_models[0] === env.model && settings.fallback_model === null,
    construct: settings.construct,
    steward: settings.steward,
    hard_cap_usd: env.hardCap,
    recorded_spend_usd: spent,
    remaining_usd: Math.max(0, env.hardCap - spent),
    recent_message_limit: RECENT_MESSAGE_LIMIT,
    network_mode: localHosts.has(env.host) ? "this-computer" : "local-network"
  };
}

function sessionForClient(session) {
  if (!session || session.preservation === "do_not_preserve") return null;
  return {
    id: session.id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    recent_message_limit: RECENT_MESSAGE_LIMIT,
    messages: Array.isArray(session.messages) ? session.messages : []
  };
}

async function latestStoredSession() {
  const sessions = [];
  for (const name of await listFiles(SESSIONS_DIR, ".json")) {
    const session = await readJson(join(SESSIONS_DIR, name), null);
    const visible = sessionForClient(session);
    if (visible) sessions.push(visible);
  }
  return sessions.sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))[0] ?? null;
}

async function chat(body) {
  if (!env.apiKey) throw new Error("OPENAI_API_KEY is not configured in .env");
  const settings = await getProtocolSettings();
  if (settings.allowed_models.length !== 1 || settings.allowed_models[0] !== env.model || settings.fallback_model !== null) {
    throw new Error("SENTIDO_MODEL must match the Book's single allowed model. No fallback was attempted.");
  }
  const message = String(body.message ?? "").trim();
  if (!message) throw new Error("Message is required");
  const ephemeral = body.preserve === false;
  const sessionId = ephemeral ? null : (body.session_id || randomUUID());
  const ephemeralId = ephemeral ? `ephemeral-${randomUUID()}` : null;
  const path = sessionId ? sessionPath(sessionId) : null;
  const session = path ? await readJson(path, {
    id: sessionId,
    created_at: new Date().toISOString(),
    surface: "sentido-api",
    model: env.model,
    messages: [],
    preservation: "ordinary"
  }) : { id: ephemeralId, surface: "sentido-api", model: env.model, messages: [], preservation: "do_not_preserve" };

  if (session.preservation === "do_not_preserve") throw new Error("This session is marked do-not-preserve and cannot be resumed from storage.");
  const identity = await buildIdentityContext();
  const recent = session.messages.slice(-RECENT_MESSAGE_LIMIT);
  const messages = [...recent, { role: "user", content: message }];
  const inheritedResults = await searchInheritedSources(message, { audience: "private", limit: 4, maxExcerptChars: 2200 });
  const inheritedTestimony = formatInheritedTestimony(inheritedResults);
  const instructions = inheritedTestimony ? `${identity}\n\n${inheritedTestimony}` : identity;
  const budget = await preflightBudget({
    inputText: `${instructions}\n${JSON.stringify(messages)}`,
    maxOutputTokens: env.maxOutputTokens,
    prices: { input: env.inputPrice, output: env.outputPrice },
    hardCap: env.hardCap
  });
  if (!budget.ok) throw new Error(budget.reason);

  const result = await createResponse({
    apiKey: env.apiKey,
    model: env.model,
    instructions,
    messages,
    maxOutputTokens: env.maxOutputTokens
  });
  const cost = calculateCost({ inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }, {
    input: env.inputPrice,
    output: env.outputPrice
  });
  if (!ephemeral) {
    session.messages.push(
      { role: "user", content: message, at: new Date().toISOString() },
      { role: "assistant", content: result.text, at: new Date().toISOString(), response_id: result.id }
    );
    session.updated_at = new Date().toISOString();
    await writeJsonAtomic(path, session);
  }
  await appendJsonl(USAGE_FILE, {
    at: new Date().toISOString(),
    session_id: ephemeral ? null : sessionId,
    preservation: ephemeral ? "do_not_preserve" : "ordinary",
    model: env.model,
    ...result.usage,
    estimated_cost_usd: cost
  });
  if (ephemeral) await markDoNotPreserve({ sessionId: ephemeralId, reason: "ephemeral session selected before capture" });
  return {
    session_id: sessionId,
    preservation: ephemeral ? "do_not_preserve" : "ordinary",
    response: result.text,
    usage: result.usage,
    estimated_cost_usd: cost,
    inherited_sources_used: [...new Map(inheritedResults.map((item) => [item.source_id, {
      id: item.source_id,
      title: item.title,
      sensitivity: item.sensitivity
    }])).values()]
  };
}

async function routeApi(req, res, url) {
  if (!authorized(req)) return sendJson(res, 401, { error: "Unauthorized" });
  if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, 200, await status());
  if (req.method === "GET" && url.pathname === "/api/book") return sendJson(res, 200, await getBriefing("sentido-local-ui"));
  if (req.method === "GET" && url.pathname === "/api/sessions/latest") {
    return sendJson(res, 200, { session: await latestStoredSession() });
  }
  const sessionRead = url.pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && sessionRead) {
    const session = sessionForClient(await readJson(sessionPath(sessionRead[1]), null));
    return session ? sendJson(res, 200, { session }) : sendJson(res, 404, { error: "Stored session not found" });
  }
  if (req.method === "GET" && url.pathname === "/api/sources") {
    return sendJson(res, 200, { sources: await listInheritedSources({ audience: "private" }) });
  }
  if (req.method === "GET" && url.pathname === "/api/sources/search") {
    const query = String(url.searchParams.get("q") ?? "").trim();
    if (query.length < 2) throw new Error("Source search requires at least two characters");
    return sendJson(res, 200, { query, results: await searchInheritedSources(query, { audience: "private", limit: 8 }) });
  }
  const sourceRead = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (req.method === "GET" && sourceRead) {
    return sendJson(res, 200, await readInheritedSource(decodeURIComponent(sourceRead[1]), { audience: "private" }));
  }
  if (req.method === "GET" && url.pathname === "/api/proposals") return sendJson(res, 200, await listProposals());
  if (req.method === "POST" && url.pathname === "/api/chat") return sendJson(res, 200, await chat(await readBody(req)));
  if (req.method === "POST" && url.pathname === "/api/proposals") {
    const body = await readBody(req);
    return sendJson(res, 201, await createProposal({ ...body, origin: { surface: "sentido-local-ui", ...(body.origin ?? {}) } }));
  }
  const approval = url.pathname.match(/^\/api\/proposals\/([^/]+)\/approve$/);
  if (req.method === "POST" && approval) {
    const body = await readBody(req);
    return sendJson(res, 200, await approveProposal(approval[1], body.actor));
  }
  const relicApproval = url.pathname.match(/^\/api\/relics\/([^/]+)\/approve$/);
  if (req.method === "POST" && relicApproval) {
    const body = await readBody(req);
    return sendJson(res, 200, await approveCandidateRelic(relicApproval[1], body.actor));
  }
  if (req.method === "POST" && url.pathname === "/api/do-not-preserve") {
    const body = await readBody(req);
    if (body.session_id) {
      const session = await readJson(sessionPath(body.session_id), null);
      if (session) {
        session.preservation = "do_not_preserve";
        session.messages = [];
        await writeJsonAtomic(sessionPath(body.session_id), session);
      }
    }
    return sendJson(res, 200, await markDoNotPreserve({ sessionId: body.session_id, reason: body.reason }));
  }
  return sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(PUBLIC_DIR, safe);
  if (!path.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(res, 404, { error: "Not found" });
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await routeApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 400, { error: error.message || "Unexpected error" });
  }
});

server.listen(env.port, env.host, async () => {
  const info = await status();
  console.log(`Sentido · ${info.construct} running at http://${env.host}:${env.port}`);
  console.log(`Model: ${info.model} | Remaining local budget: $${info.remaining_usd.toFixed(4)}`);
  if (!info.api_key_configured) console.log("API chat is locked until OPENAI_API_KEY is added to .env.");
  if (!info.pricing_configured) console.log("API chat is locked until verified model prices are added to .env.");
  await appendJsonl(LEDGER_FILE, { event: "local_server_started", at: new Date().toISOString(), model: env.model });
});
