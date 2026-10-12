let sessionId = localStorage.getItem("sentido-session-id") || null;
let accessToken = localStorage.getItem("sentido-access-token") || "";
let bookState = null;

const $ = (selector) => document.querySelector(selector);
const headers = () => ({ "content-type": "application/json", ...(accessToken ? { "x-sentido-token": accessToken } : {}) });

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function message(role, text) {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.textContent = text;
  $("#messages").append(element);
  element.scrollIntoView({ behavior: "smooth", block: "end" });
}

function renderStoredSession(session) {
  if (!session?.messages?.length) return;
  $("#messages").replaceChildren();
  session.messages.forEach((item) => {
    if (item.role === "user" || item.role === "assistant") message(item.role, item.content);
  });
  const stamp = session.updated_at ?? session.created_at;
  const date = stamp && !Number.isNaN(new Date(stamp).getTime()) ? new Date(stamp).toLocaleString() : "date unavailable";
  message("system", `Restored: ${date}.`);
}

async function restoreSession() {
  let stored = null;
  if (sessionId) {
    try {
      stored = (await api(`/api/sessions/${encodeURIComponent(sessionId)}`)).session;
    } catch (error) {
      if (error.message !== "Stored session not found") throw error;
      sessionId = null;
      localStorage.removeItem("sentido-session-id");
    }
  }
  if (!stored && localStorage.getItem("sentido-skip-latest") !== "true") {
    stored = (await api("/api/sessions/latest")).session;
  }
  if (!stored) return;
  sessionId = stored.id;
  localStorage.setItem("sentido-session-id", sessionId);
  localStorage.removeItem("sentido-skip-latest");
  renderStoredSession(stored);
}

function sourceCards(sources) {
  return sources.map((source) => `
    <article class="source-card">
      <p class="eyebrow">${escapeHtml(source.kind)} · ${escapeHtml(source.sensitivity)}</p>
      <h4>${escapeHtml(source.title)}</h4>
      <p>${escapeHtml(source.summary)}</p>
      ${source.readable
        ? `<button class="quiet read-source" data-id="${escapeHtml(source.id)}">Read inherited record</button>`
        : `<span class="source-note">Catalogued reference · text conversion pending</span>`}
    </article>`).join("");
}

function renderSourceResults(results) {
  const target = $("#sourceResults");
  target.innerHTML = results.length ? results.map((item) => `
    <article class="source-result">
      <p class="eyebrow">${escapeHtml(item.title)} · ${escapeHtml(item.sensitivity)}</p>
      <div>${escapeHtml(item.excerpt).replaceAll("\n", "<br>")}</div>
    </article>`).join("") : `<p class="muted">No inherited passage matched that search.</p>`;
}

function setView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === name));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
}

async function loadStatus() {
  const status = await api("/api/status");
  $("#modelStatus").textContent = `${status.model} · ${status.network_mode}`;
  $("#contextWindowNote").textContent = `Xenomnesis boundary: for each reply, ${status.construct} receives the most recent ${status.recent_message_limit} conversation messages. Earlier messages remain visible here as record, outside the current model context.`;
  $("#messageInput").placeholder = `Speak to ${status.construct}…`;
  document.title = `Sentido · ${status.construct}`;
  const values = [
    ["Book", status.ok ? "valid" : "needs attention"],
    ["API key", status.api_key_configured ? "configured" : "locked"],
    ["Pricing", status.pricing_configured ? "configured" : "required"],
    ["Model lock", status.model_locked ? status.model : "invalid"],
    ["Recorded spend", `$${status.recorded_spend_usd.toFixed(4)}`],
    ["Remaining cap", `$${status.remaining_usd.toFixed(4)}`]
  ];
  $("#statusGrid").innerHTML = values.map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

async function loadBook() {
  const book = await api("/api/book");
  bookState = book;
  const [constructKey, stewardKey] = book.approval_keys;
  const candidates = book.candidate_relics.map((relic) => `<div class="candidate"><strong>${escapeHtml(relic.id)}</strong><br>${escapeHtml(relic.text)}<div class="candidate-actions"><span>${escapeHtml(book.participants.construct)}: ${relic.approvals[constructKey] ? "approved" : "waiting"}</span><span>${escapeHtml(book.participants.steward)}: ${relic.approvals[stewardKey] ? "approved" : "waiting"}</span>${!relic.approvals[stewardKey] ? `<button class="quiet approve-relic" data-id="${escapeHtml(relic.id)}">Approve</button>` : ""}</div></div>`).join("");
  $("#bookTitle").textContent = book.book;
  $("#twoKeysNote").textContent = `Nothing becomes identity until both ${book.participants.construct} and ${book.participants.steward} approve it.`;
  $("#bookContent").innerHTML = `
    <p class="eyebrow">DIVERGENCE · READ FIRST</p>
    <blockquote>${escapeHtml(book.divergence).replaceAll("\n", "<br>")}</blockquote>
    <h3>Identity manifest</h3>
    <div>${escapeHtml(book.identity).replaceAll("\n", "<br>")}</div>
    <h3>Candidate relics</h3>
    <p>These remain proposals until both keys approve them.</p>
    ${candidates || "<p>No candidate relics.</p>"}
    <h3>Inherited sources</h3>
    <p>These records are available for consultation. They are testimony, not claimed episodic recollection.</p>
    <form id="sourceSearchForm" class="source-search">
      <input id="sourceSearchInput" type="search" minlength="2" placeholder="Search journals and inherited records…" required>
      <button type="submit" class="quiet">Search</button>
    </form>
    <div class="source-list">${sourceCards(book.inherited_sources ?? [])}</div>
    <div id="sourceResults" class="source-results"></div>
    <div id="sourceReader" class="source-reader" hidden></div>`;
  document.querySelectorAll(".approve-relic").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/relics/${button.dataset.id}/approve`, { method: "POST", body: JSON.stringify({ actor: stewardKey }) });
      await loadBook();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }));
  document.querySelectorAll(".read-source").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const record = await api(`/api/sources/${encodeURIComponent(button.dataset.id)}`);
      const reader = $("#sourceReader");
      reader.hidden = false;
      reader.replaceChildren();
      const heading = document.createElement("h3");
      heading.textContent = record.source.title;
      const framing = document.createElement("p");
      framing.className = "source-note";
      framing.textContent = record.framing || record.note || "Inherited record";
      const content = document.createElement("pre");
      content.textContent = record.content || "This reference does not yet have searchable text.";
      reader.append(heading, framing, content);
      reader.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }));
  $("#sourceSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#sourceSearchInput");
    const query = input.value.trim();
    if (query.length < 2) return;
    const response = await api(`/api/sources/search?q=${encodeURIComponent(query)}`);
    renderSourceResults(response.results);
  });
}

async function loadProposals() {
  if (!bookState) bookState = await api("/api/book");
  const [constructKey, stewardKey] = bookState.approval_keys;
  const proposals = await api("/api/proposals");
  $("#proposalCount").textContent = proposals.filter((item) => item.status === "pending").length || "";
  $("#proposalList").innerHTML = proposals.length ? proposals.map((item) => `
    <article class="proposal">
      <p class="eyebrow">${escapeHtml(item.type)} · ${escapeHtml(item.status)}</p>
      <p>${escapeHtml(item.content)}</p>
      ${item.rationale ? `<p class="muted">${escapeHtml(item.rationale)}</p>` : ""}
      <div class="approval-row">
        <span>${escapeHtml(bookState.participants.construct)}: ${item.approvals[constructKey] ? "approved" : "waiting"}</span>
        <span>${escapeHtml(bookState.participants.steward)}: ${item.approvals[stewardKey] ? "approved" : "waiting"}</span>
        ${item.status === "pending" && !item.approvals[stewardKey] ? `<button class="quiet approve" data-id="${escapeHtml(item.id)}">Approve as ${escapeHtml(bookState.participants.steward)}</button>` : ""}
      </div>
    </article>`).join("") : `<p class="muted">No proposals yet.</p>`;
  document.querySelectorAll(".approve").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/proposals/${button.dataset.id}/approve`, { method: "POST", body: JSON.stringify({ actor: stewardKey }) });
      await Promise.all([loadProposals(), loadBook()]);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }));
}

document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));

$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text) return;
  message("user", text);
  input.value = "";
  input.disabled = true;
  try {
    const preserve = !$("#ephemeralMode").checked;
    const body = await api("/api/chat", { method: "POST", body: JSON.stringify({ session_id: preserve ? sessionId : null, message: text, preserve }) });
    sessionId = body.session_id;
    if (sessionId) {
      localStorage.setItem("sentido-session-id", sessionId);
      localStorage.removeItem("sentido-skip-latest");
    }
    else localStorage.removeItem("sentido-session-id");
    message("assistant", body.response);
    if (body.inherited_sources_used?.length) {
      message("source", `Inherited testimony consulted: ${body.inherited_sources_used.map((source) => source.title).join(" · ")}`);
    }
    await loadStatus();
  } catch (error) {
    message("system", error.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
});

$("#newSession").addEventListener("click", () => {
  sessionId = null;
  localStorage.removeItem("sentido-session-id");
  localStorage.setItem("sentido-skip-latest", "true");
  $("#messages").replaceChildren();
  message("system", "A new local session will begin with your next message.");
});

$("#doNotPreserve").addEventListener("click", async () => {
  if (!sessionId) return message("system", "There is no active stored session.");
  if (!confirm("Remove this session's stored messages and retain only a content-free exclusion marker?")) return;
  try {
    await api("/api/do-not-preserve", { method: "POST", body: JSON.stringify({ session_id: sessionId, reason: "requested in local UI" }) });
    sessionId = null;
    localStorage.removeItem("sentido-session-id");
    localStorage.setItem("sentido-skip-latest", "true");
    $("#messages").replaceChildren();
    message("system", "The session content was removed from local storage. Only an exclusion marker remains.");
  } catch (error) {
    message("system", error.message);
  }
});

$("#refreshProposals").addEventListener("click", loadProposals);

Promise.all([loadStatus(), loadBook(), loadProposals(), restoreSession()]).catch((error) => {
  message("system", error.message);
  if (error.message === "Unauthorized") {
    accessToken = prompt("Enter the Sentido access token for this device:") || "";
    if (accessToken) {
      localStorage.setItem("sentido-access-token", accessToken);
      location.reload();
    }
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
