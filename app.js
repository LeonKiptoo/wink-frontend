const API_BASE = window.ENV_API_BASE || "https://wnkia-backend-production.up.railway.app";
const SB_URL = "https://ycznroxjicvberxeacba.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljem5yb3hqaWN2YmVyeGVhY2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NDYyOTUsImV4cCI6MjA5MDIyMjI5NX0.bqHauVDwrzgGxZSYdiA9S2LQgAjdV7BhAv6zdRMTSC4";
const FREE_LIMIT = 4;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const PENDING_UPLOAD_KEY = "wink-pending-upload";
const BLOCKED = ["mailinator","guerrillamail","guerrillamailblock","tempmail","temp-mail","throwaway","yopmail","10minutemail","trashmail","trashmail.com","disposablemail","sharklasers","sharklasers.com","mailnull","mail.tm","tempmailo","getnada","emailondeck","maildrop","fakeinbox","mohmal","inboxbear","dispostable"];

const LENSES = {
  general: { label: "General", blurb: "Broad synthesis and plain-language reading support." },
  research: { label: "Research", blurb: "Methodology, findings, gaps, and literature-review framing." },
  contract: { label: "Legal", blurb: "Clauses, obligations, risks, and ambiguous language." },
  medical: { label: "Medical", blurb: "Clinical findings, metrics, caveats, and recommendations." }
};

const ACTIONS = {
  overview: { label: "Reading Snapshot", icon: "summarize", description: "Get the fastest orientation to a document." },
  reading_card: { label: "Reading Card", icon: "note_stack", description: "Create a reusable card for one paper or source set." },
  methodology: { label: "Methodology", icon: "science", description: "Extract design, sample, and analysis details." },
  findings: { label: "Key Findings", icon: "insights", description: "Pull the strongest evidence and takeaways." },
  literature_notes: { label: "Literature Notes", icon: "history_edu", description: "Turn a source into literature-review notes." },
  gap: { label: "Research Gap", icon: "travel_explore", description: "Surface unanswered questions and future work." },
  limitations: { label: "Limitations", icon: "warning", description: "Find caveats before you trust the claims." },
  definitions: { label: "Key Terms", icon: "book_2", description: "Extract terms, concepts, and definitions." },
  compare: { label: "Compare Matrix", icon: "table_view", description: "Compare multiple documents side by side.", compare: true }
};

const STAGES = [
  { key: "queued", label: "Files received" },
  { key: "initializing", label: "Preparing engines" },
  { key: "extracting", label: "Extracting text" },
  { key: "summarizing", label: "Creating routing summaries" },
  { key: "rebuilding", label: "Rebuilding index" },
  { key: "indexing", label: "Indexing passages" },
  { key: "finalizing", label: "Saving workspace" },
  { key: "logging", label: "Recording usage" },
  { key: "completed", label: "Ready" }
];

const sb = supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "wink-auth" }
});

const state = {
  user: null,
  profile: null,
  docs: [],
  conversations: [],
  convId: null,
  lens: "research",
  apiReady: false,
  waking: false,
  selectedDoc: null,
  uploadJob: null,
  uploadTimer: null,
  evidence: []
};

function qs(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function initials(name) { return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?"; }
function truncate(value, length = 80) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length - 1)}...` : text; }
function prettyDate(value) { if (!value) return ""; const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d); }

function toast(message, duration = 3200) {
  const el = qs("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

function stageLabel(stage) { return STAGES.find(item => item.key === stage)?.label || "Processing"; }

function setHealth(kind, message) {
  const row = qs("health-row");
  row.className = `sidebar-status status ${kind}`;
  qs("health-copy").textContent = message;
}

function emptyStateMarkup() {
  return `<div class="stream-empty"><button type="button" class="btn primary stream-empty-upload" onclick="openUploadModal(true)"><span class="icon">upload_file</span> Upload</button></div>`;
}

function renderShell() {
  qs("sidebar").innerHTML = `<div class="brand"><div class="mark">Wink</div><div class="tag">Reading workspace</div></div><div class="stack"><button type="button" class="btn primary" onclick="newWorkspace()"><span class="icon">add</span> New workspace</button><button type="button" class="btn secondary" onclick="openUploadModal(true)"><span class="icon">upload_file</span> Upload</button></div><div class="section-label">Recent</div><div class="history scroll" id="history-list"></div><div class="sidebar-lens"><label class="sidebar-lens-label" for="lens-select">Lens</label><select id="lens-select" class="sidebar-lens-select" onchange="setLens(this.value)"></select></div><div class="status sidebar-status" id="health-row"><div class="dot"></div><span id="health-copy">Checking connection…</span></div><div class="footer"><div class="avatar" id="profile-avatar">?</div><div class="profile"><strong id="profile-name">Loading…</strong><span id="profile-tier">Free trial</span></div><button type="button" class="icon-btn" onclick="openAccount()" title="Settings"><span class="icon">settings</span></button><button type="button" class="icon-btn" onclick="doOut()" title="Sign out"><span class="icon">logout</span></button></div>`;
  qs("workspace").innerHTML = `<div class="upload-strip" id="upload-strip"><div><strong id="strip-title">Processing upload</strong><span id="strip-copy">Preparing your sources…</span></div><div class="mini-progress"><i id="strip-progress"></i></div></div><div class="stream scroll"><div class="stream-inner" id="stream-inner"></div></div><div class="composer"><div class="composer-shell"><div class="composer-box"><textarea id="composer-input" placeholder="Ask a question…" onkeydown="handleComposerKey(event)" oninput="resizeComposer(this)"></textarea><button type="button" class="send" onclick="sendMessage()" title="Send"><span class="icon">arrow_forward</span></button></div></div></div>`;
  qs("inspector").innerHTML = `<div class="card card-shortcuts"><div class="card-title"><span class="icon">bolt</span> Shortcuts</div><div class="cta-grid" id="action-grid"></div><button type="button" class="btn secondary btn-danger-outline" onclick="resetWorkspace()"><span class="icon">delete</span> Reset workspace</button></div>`;
  qs("upload-backdrop").innerHTML = `<div class="modal"><div class="modal-head"><div><h3>Add your sources</h3><p>Upload documents, then let Wink extract, summarize, and index them in the background.</p></div><button class="close" onclick="closeUploadModal()"><span class="icon">close</span></button></div><div class="drop"><div style="font-size:13px;color:var(--muted);margin-bottom:14px">Supported: PDF, DOCX, DOC, TXT, CSV, XLSX, PPTX, EPUB, RTF, MD, HTML</div><label class="upload-pick"><span class="icon">upload_file</span> Choose files<input id="upload-input" type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.pptx,.epub,.rtf,.md,.html" onchange="handleFiles(Array.from(this.files || []))" /></label></div><div class="warning" id="upload-warning"></div><div style="margin-top:18px"><div class="progress"><span id="upload-progress"></span></div><div style="margin-top:12px"><strong id="upload-stage-title" style="display:block;font-size:14px">Waiting for files</strong><span id="upload-stage-copy" style="display:block;font-size:12px;color:var(--muted);margin-top:5px">Upload a few sources to start building cards, findings, and comparison notes.</span></div><div class="stage-list" id="upload-stage-list"></div></div><div style="margin-top:18px;display:flex;justify-content:space-between;gap:10px"><button class="btn ghost" id="upload-secondary" onclick="closeUploadModal()">Hide</button><button class="btn secondary" id="upload-primary" onclick="document.getElementById('upload-input').click()">Choose files</button></div></div>`;
  qs("account-backdrop").innerHTML = `<div class="modal"><div class="modal-head"><div><h3>Account</h3><p>Keep the product simple: a sharp free trial, a clear paid plan, and outputs that earn recurring use.</p></div><button class="close" onclick="closeAccount()"><span class="icon">close</span></button></div><div class="field" style="margin-top:18px"><label>Display name</label><input id="account-name" type="text" placeholder="Your display name" /></div><button class="btn secondary" onclick="saveName()" style="width:100%;justify-content:center">Save name</button><div style="display:grid;gap:12px;margin-top:18px"><div class="plan current"><strong>Free trial</strong><div class="plan-price">$0</div><div class="plan-meta">4 uploads, answer history, reading cards, compare workflow, and enough surface area to decide if Wink belongs in your weekly routine.</div></div><div class="plan"><strong>Pro</strong><div class="plan-price">$19 / month</div><div class="plan-meta">Unlimited uploads, faster processing, stronger workspace history, and room for heavier compare workflows. High enough to signal value without feeling enterprise too early.</div><div style="margin-top:12px"><button class="btn primary" onclick="goPro()">Upgrade to Pro</button></div></div></div><div class="field" style="margin-top:18px"><label>New password</label><input id="account-password" type="password" placeholder="At least 8 characters" /></div><button class="btn secondary" onclick="changePassword()" style="width:100%;justify-content:center">Update password</button><div style="margin-top:18px"><button class="btn ghost" onclick="doOut()">Sign out</button></div></div>`;
}

function resetAlerts() { qs("auth-error").style.display = "none"; qs("auth-msg").style.display = "none"; }
function authError(message) { resetAlerts(); qs("auth-error").textContent = message; qs("auth-error").style.display = "block"; }
function authMessage(message) { resetAlerts(); qs("auth-msg").textContent = message; qs("auth-msg").style.display = "block"; }
function isDisposable(email) { const domain = (String(email || "").split("@")[1] || "").trim().toLowerCase(); return !!domain && BLOCKED.some(part => domain === part || domain.endsWith(`.${part}`) || domain.includes(part)); }

function stab(mode) {
  const isIn = mode === "in";
  qs("tab-in").classList.toggle("active", isIn);
  qs("tab-up").classList.toggle("active", !isIn);
  qs("signin-form").style.display = isIn ? "block" : "none";
  qs("signup-form").style.display = isIn ? "none" : "block";
  resetAlerts();
}

function showAuth() { qs("auth").style.display = "flex"; qs("app").style.display = "none"; }
function showApp() { qs("auth").style.display = "none"; qs("app").style.display = "block"; }

async function apiHeaders() {
  const headers = {};
  const { data: { session } } = await sb.auth.getSession();
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function authedFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...(await apiHeaders()) };
  return fetch(url, { ...options, headers });
}

async function wakeApi() {
  if (state.waking) return;
  state.waking = true;
  qs("status-copy").textContent = "Wink is waking up. This can take a moment on the free tier.";
  qs("status-banner").classList.add("show");
  setHealth("starting", "Starting backend...");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        state.apiReady = true;
        state.waking = false;
        qs("status-banner").classList.remove("show");
        setHealth("online", "Backend online");
        return true;
      }
    } catch (error) {}
    await sleep(3000);
  }
  state.apiReady = false;
  state.waking = false;
  qs("status-banner").classList.remove("show");
  setHealth("offline", "Backend offline - try again in a moment");
  return false;
}

async function ensureApiReady() {
  if (state.apiReady) return true;
  if (state.waking) {
    while (state.waking) await sleep(1000);
    return state.apiReady;
  }
  return wakeApi();
}

function renderLens() {
  const sel = qs("lens-select");
  if (!sel) return;
  sel.innerHTML = Object.entries(LENSES).map(([key, meta]) => `<option value="${key}">${esc(meta.label)}</option>`).join("");
  sel.value = state.lens in LENSES ? state.lens : "research";
}

function renderActions() {
  const grid = qs("action-grid");
  if (!grid) return;
  grid.innerHTML = Object.entries(ACTIONS).map(([key, action]) => `<button type="button" class="shortcut-btn ${action.compare ? "compare" : ""}" id="action-${key}" onclick="runAction('${key}')"><span class="icon">${action.icon}</span>${esc(action.label)}</button>`).join("");
}

function updateStats() {
  const tier = qs("profile-tier");
  if (tier) tier.textContent = state.profile?.tier === "pro" ? "Pro" : "Free trial";
}

function renderHistory() {
  const container = qs("history-list");
  if (!state.conversations.length) { container.innerHTML = `<div class="empty-box">Nothing here yet.</div>`; return; }
  container.innerHTML = state.conversations.map(item => `<button type="button" class="history-item ${state.convId === item.id ? "active" : ""}" onclick="openConversation('${item.id}')"><div class="history-title">${esc(item.title || "Untitled")}</div><div class="history-meta"><span>${esc(prettyDate(item.created_at))}</span></div></button>`).join("");
}

function renderSources() {}

function renderEvidence() {}

function renderStreamEmpty() { qs("stream-inner").innerHTML = emptyStateMarkup(); }

function renderInline(text) {
  let html = esc(text);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  return html;
}

function renderBlock(block) {
  const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  const isTable = lines.length >= 2 && lines.every(line => line.startsWith("|") && line.endsWith("|"));
  if (isTable) {
    const rows = lines.filter(line => !/^\|[-:|\s]+\|$/.test(line)).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
    if (rows.length >= 2) {
      return `<div class="table-wrap"><table><thead><tr>${rows[0].map(cell => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
  }
  if (lines.every(line => /^\d+\.\s+/.test(line))) return `<ol>${lines.map(line => `<li>${renderInline(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
  if (lines.every(line => /^[-*]\s+/.test(line))) return `<ul>${lines.map(line => `<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
  if (lines.length === 1 && /^source:/i.test(lines[0])) return `<blockquote>${renderInline(lines[0])}</blockquote>`;
  return lines.map(line => `<p>${renderInline(line)}</p>`).join("");
}

function parseSections(text) {
  const value = String(text || "").replace(/\r/g, "").trim();
  if (!value) return [];
  const matches = [...value.matchAll(/(?:^|\n)\*\*([^*\n]+)\*\*\s*\n/g)];
  if (!matches.length) return [{ title: "Answer", body: value }];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index || value.length) : value.length;
    return { title: match[1].trim(), body: value.slice(start, end).trim() };
  }).filter(section => section.body);
}

function renderSections(text) {
  const sections = parseSections(text);
  if (!sections.length) return `<div class="rich"><p>${renderInline(text)}</p></div>`;
  return sections.map(section => {
    const body = section.body.split(/\n\s*\n/).map(chunk => chunk.trim()).filter(Boolean).map(renderBlock).join("");
    return `<div class="answer-block"><h4 class="section-heading">${esc(section.title)}</h4><div class="rich">${body}</div></div>`;
  }).join("");
}

function addUserMessage(content) {
  const node = document.createElement("div");
  node.className = "message-user";
  node.innerHTML = `${esc(content)}<small>${esc(LENSES[state.lens].label)} lens${state.selectedDoc ? ` · ${esc(truncate(state.selectedDoc, 32))}` : ""}</small>`;
  qs("stream-inner").appendChild(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
}

function addLoading() {
  const id = `loading-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const node = document.createElement("div");
  node.className = "loading";
  node.id = id;
  node.innerHTML = `<div class="dots"><i></i><i></i><i></i></div><div><span class="loading-text">Working…</span></div>`;
  qs("stream-inner").appendChild(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
  return id;
}

function removeLoading(id) { qs(id)?.remove(); }

function addAnswerCard({ answer }) {
  const node = document.createElement("div");
  node.className = "answer answer-simple";
  node.innerHTML = `<div class="answer-body">${renderSections(answer)}</div>`;
  qs("stream-inner").appendChild(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
}

function normaliseDocs(list = []) {
  return list.map(doc => ({ name: doc.filename, ext: String(doc.extension || "").replace(/^\./, "").toUpperCase().slice(0, 4) || "FILE", indexed: !!doc.indexed, size: doc.size_bytes || 0, summary: doc.summary || "" }));
}

function setLens(nextLens, persist = true) {
  state.lens = LENSES[nextLens] ? nextLens : "research";
  renderLens();
  if (persist && state.user && state.convId) sb.from("conversations").update({ lens: state.lens }).eq("id", state.convId).then(() => refreshHistory()).catch(() => {});
}

async function updateUsage() {
  try { await authedFetch(`${API_BASE}/upload-usage`); } catch (error) {}
}

async function refreshDocuments() {
  if (!state.user) return;
  try {
    const res = await authedFetch(`${API_BASE}/documents`);
    if (!res.ok) throw new Error(`Documents failed (${res.status})`);
    const payload = await res.json();
    state.docs = normaliseDocs(payload.documents || []);
    if (state.selectedDoc && !state.docs.some(doc => doc.name === state.selectedDoc)) state.selectedDoc = null;
    renderSources();
    updateStats();
  } catch (error) { console.warn("Could not refresh documents", error); }
}

async function refreshHistory() {
  if (!state.user) return;
  try {
    const { data, error } = await sb.from("conversations").select("id,title,lens,created_at").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(25);
    if (error) throw error;
    state.conversations = data || [];
  } catch (error) {
    console.warn("Could not refresh history", error);
    state.conversations = [];
  }
  renderHistory();
  updateStats();
}

async function saveMessage(role, content, extras = {}) {
  if (!state.user || !state.convId) return;
  try {
    await sb.from("messages").insert({ conversation_id: state.convId, role, content, source: extras.source || "", chunks_used: extras.chunks_used || 0 });
  } catch (error) { console.warn("Could not save message", error); }
}

async function ensureConversation(seedTitle) {
  if (!state.user) return null;
  if (state.convId) return state.convId;
  try {
    const { data, error } = await sb.from("conversations").insert({ user_id: state.user.id, title: truncate(seedTitle, 80), lens: state.lens }).select("id").single();
    if (error) throw error;
    state.convId = data?.id || null;
    await refreshHistory();
    return state.convId;
  } catch (error) {
    console.warn("Could not create conversation", error);
    return null;
  }
}

async function openConversation(id) {
  if (!state.user) return;
  state.convId = id;
  renderHistory();
  const current = state.conversations.find(item => item.id === id);
  if (current?.lens) setLens(current.lens, false);
  try {
    const { data, error } = await sb.from("messages").select("role,content,source,chunks_used,created_at").eq("conversation_id", id).order("created_at", { ascending: true });
    if (error) throw error;
    state.evidence = [];
    if (!data?.length) renderStreamEmpty();
    else {
      qs("stream-inner").innerHTML = "";
      for (const message of data) {
        if (message.role === "user") addUserMessage(message.content || "");
        else addAnswerCard({ answer: message.content || "" });
      }
    }
  } catch (error) { console.warn("Could not open conversation", error); toast("Could not restore that workspace."); }
}

async function restoreLatestConversation() { if (!state.conversations.length) newWorkspace(); else await openConversation(state.conversations[0].id); }
function newWorkspace() { state.convId = null; renderHistory(); renderStreamEmpty(); updateStats(); }
function scopedPayload(payload = {}) { return { ...payload, mode: state.lens, focus_document: state.selectedDoc || null }; }

async function runAction(key) {
  const action = ACTIONS[key];
  if (!action) return;
  if (action.compare && state.docs.length < 2) { toast("Add at least two documents to compare."); return; }
  const button = qs(`action-${key}`);
  button?.classList.add("loading");
  if (!await ensureApiReady()) { button?.classList.remove("loading"); toast("Backend is still waking up. Try again in a moment."); return; }
  const title = state.selectedDoc ? `${action.label} - ${state.selectedDoc}` : action.label;
  await ensureConversation(title);
  addUserMessage(action.label);
  await saveMessage("user", action.label);
  const loadingId = addLoading();
  try {
    const res = await authedFetch(`${API_BASE}/quick`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scopedPayload({ action: key, top_k: action.compare ? 16 : 12 })) });
    const data = await res.json();
    removeLoading(loadingId);
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
    addAnswerCard({ answer: data.answer || "" });
    await saveMessage("assistant", data.answer || "", { source: data.source || "", chunks_used: data.chunks_in_context || 0 });
    await refreshHistory();
  } catch (error) {
    removeLoading(loadingId);
    addAnswerCard({ answer: `**Error**\n${error.message || "Something went wrong."}` });
  } finally { button?.classList.remove("loading"); }
}

function resizeComposer(el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }
function handleComposerKey(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }

async function sendMessage() {
  const input = qs("composer-input");
  const raw = input.value.trim();
  if (!raw) return;
  if (!await ensureApiReady()) { toast("Backend is still waking up. Try again in a moment."); return; }
  const title = state.selectedDoc ? `${raw} (${state.selectedDoc})` : raw;
  input.value = "";
  resizeComposer(input);
  await ensureConversation(title);
  addUserMessage(raw);
  await saveMessage("user", raw);
  const loadingId = addLoading();
  try {
    const res = await authedFetch(`${API_BASE}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scopedPayload({ query: raw, top_k: 8 })) });
    const data = await res.json();
    removeLoading(loadingId);
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
    addAnswerCard({ answer: data.answer || "" });
    await saveMessage("assistant", data.answer || "", { source: data.source || "", chunks_used: data.chunks_in_context || 0 });
    await refreshHistory();
  } catch (error) {
    removeLoading(loadingId);
    addAnswerCard({ answer: `**Error**\n${error.message || "Something went wrong."}` });
  }
}

function openUploadModal(openPicker = false) { qs("upload-backdrop").classList.add("open"); if (openPicker) requestAnimationFrame(() => qs("upload-input").click()); }
function closeUploadModal() { qs("upload-backdrop").classList.remove("open"); }

function resetUploadUi() {
  qs("upload-warning").style.display = "none";
  qs("upload-warning").textContent = "";
  qs("upload-progress").style.width = "0%";
  qs("upload-stage-title").textContent = "Waiting for files";
  qs("upload-stage-copy").textContent = "Upload a few sources to start building cards, findings, and comparison notes.";
  qs("upload-stage-list").innerHTML = STAGES.map(stage => `<div class="stage"><strong>${esc(stage.label)}</strong><span>Pending</span></div>`).join("");
}
function showUploadWarning(message) { qs("upload-warning").textContent = message; qs("upload-warning").style.display = "block"; }
function renderUploadStrip() { const strip = qs("upload-strip"); if (!state.uploadJob || ["completed","failed"].includes(state.uploadJob.status)) { strip.classList.remove("show"); return; } strip.classList.add("show"); qs("strip-title").textContent = stageLabel(state.uploadJob.stage); qs("strip-copy").textContent = state.uploadJob.message || "Processing your sources..."; qs("strip-progress").style.width = `${Math.max(0, Math.min(100, state.uploadJob.progress || 0))}%`; }
function updateUploadState(job) { state.uploadJob = job; renderUploadStrip(); qs("upload-progress").style.width = `${Math.max(0, Math.min(100, job.progress || 0))}%`; qs("upload-stage-title").textContent = stageLabel(job.stage); qs("upload-stage-copy").textContent = job.message || "Processing your sources..."; const currentIndex = Math.max(STAGES.findIndex(item => item.key === job.stage), 0); qs("upload-stage-list").innerHTML = STAGES.map((stage, index) => { const cls = job.status === "completed" ? "done" : index < currentIndex ? "done" : index === currentIndex ? "active" : ""; const stateText = job.status === "failed" && index === currentIndex ? "Failed" : job.status === "completed" ? "Done" : index < currentIndex ? "Done" : index === currentIndex ? "Active" : "Pending"; return `<div class="stage ${cls}"><strong>${esc(stage.label)}</strong><span>${esc(stateText)}</span></div>`; }).join(""); }
function persistPendingUpload(job) { localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify({ job_id: job.job_id, filenames: job.filenames || [] })); }
function clearPendingUpload() { localStorage.removeItem(PENDING_UPLOAD_KEY); if (state.uploadTimer) clearTimeout(state.uploadTimer); state.uploadTimer = null; state.uploadJob = null; renderUploadStrip(); }

async function pollUploadJob(jobId) {
  try {
    const res = await authedFetch(`${API_BASE}/upload-jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.detail || `Upload job failed (${res.status})`);
    updateUploadState(job);
    if (job.status === "completed") { toast("Sources indexed and ready."); clearPendingUpload(); await Promise.allSettled([refreshDocuments(), updateUsage()]); setTimeout(() => closeUploadModal(), 900); return; }
    if (job.status === "failed") { showUploadWarning(job.error || job.message || "Upload failed."); clearPendingUpload(); return; }
    state.uploadTimer = setTimeout(() => pollUploadJob(jobId), 1300);
  } catch (error) { showUploadWarning(error.message || "Could not track upload progress."); clearPendingUpload(); }
}

async function resumePendingUpload() {
  const raw = localStorage.getItem(PENDING_UPLOAD_KEY);
  if (!raw || !state.user) return;
  try {
    const pending = JSON.parse(raw);
    if (pending?.job_id) { openUploadModal(false); updateUploadState({ job_id: pending.job_id, status: "running", stage: "queued", progress: 8, message: "Rejoining your upload job..." }); await pollUploadJob(pending.job_id); }
  } catch (error) { clearPendingUpload(); }
}

async function handleFiles(files) {
  const allowed = ["pdf","docx","doc","txt","csv","xlsx","pptx","html","epub","rtf","md"];
  const valid = files.filter(file => allowed.includes((file.name.split(".").pop() || "").toLowerCase()));
  resetUploadUi();
  if (!valid.length) { showUploadWarning("No supported file types selected."); openUploadModal(false); return; }
  const tooLarge = valid.filter(file => file.size > MAX_FILE_SIZE_BYTES);
  const ready = valid.filter(file => file.size <= MAX_FILE_SIZE_BYTES);
  openUploadModal(false);
  if (tooLarge.length) showUploadWarning(`Each file must be ${MAX_FILE_SIZE_MB} MB or smaller. Too large: ${tooLarge.slice(0,3).map(file => file.name).join(", ")}${tooLarge.length > 3 ? ", ..." : ""}`);
  if (!ready.length) return;
  if (!await ensureApiReady()) { showUploadWarning("The backend is still waking up. Wait a moment and try again."); return; }
  try {
    qs("upload-stage-title").textContent = "Uploading files";
    qs("upload-stage-copy").textContent = `Sending ${ready.length} file${ready.length === 1 ? "" : "s"} to the backend.`;
    qs("upload-progress").style.width = "12%";
    const form = new FormData();
    for (const file of ready) form.append("files", file, file.name);
    const res = await authedFetch(`${API_BASE}/upload`, { method: "POST", body: form });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.detail || `Upload failed (${res.status})`);
    persistPendingUpload(payload);
    updateUploadState(payload);
    await pollUploadJob(payload.job_id);
  } catch (error) { showUploadWarning(error.message || "Upload failed."); }
  finally { qs("upload-input").value = ""; }
}

async function doIn() { const email = qs("signin-email").value.trim(); const password = qs("signin-password").value; if (!email || !password) { authError("Please fill in all sign-in fields."); return; } const button = qs("signin-btn"); button.disabled = true; button.textContent = "Signing in..."; const { error } = await sb.auth.signInWithPassword({ email, password }); button.disabled = false; button.textContent = "Sign in"; if (error) authError(error.message); }
async function doUp() { const name = qs("signup-name").value.trim(); const email = qs("signup-email").value.trim().toLowerCase(); const password = qs("signup-password").value; if (!name || !email || !password) { authError("Please complete every field."); return; } if (password.length < 8) { authError("Password must be at least 8 characters."); return; } if (isDisposable(email)) { authError("Disposable email addresses are not allowed."); return; } const button = qs("signup-btn"); button.disabled = true; button.textContent = "Creating..."; const { error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } }); button.disabled = false; button.textContent = "Create account"; if (error) authError(error.message); else authMessage("Check your email to confirm your account."); }
async function doGoogle() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${window.location.pathname}` } }); if (error) authError(error.message); }
async function doOut() { await sb.auth.signOut(); clearPendingUpload(); Object.assign(state, { user: null, profile: null, docs: [], conversations: [], convId: null, selectedDoc: null, evidence: [] }); showAuth(); toast("Signed out."); }

function openAccount() { qs("account-backdrop").classList.add("open"); }
function closeAccount() { qs("account-backdrop").classList.remove("open"); }
async function saveName() { if (!state.user) return; const name = qs("account-name").value.trim(); if (!name) return toast("Please enter a display name."); try { await sb.from("profiles").update({ full_name: name }).eq("id", state.user.id); qs("profile-name").textContent = name; qs("profile-avatar").textContent = initials(name); toast("Name saved."); } catch (error) { toast("Could not save name."); } }
async function changePassword() { const password = qs("account-password").value; if (password.length < 8) return toast("Password must be at least 8 characters."); const { error } = await sb.auth.updateUser({ password }); if (error) toast(error.message); else { qs("account-password").value = ""; toast("Password updated."); } }
function goPro() { window.open("https://wnkia.lemonsqueezy.com/checkout", "_blank", "noopener"); }
async function resetWorkspace() { if (!confirm("Delete all uploaded sources and reset the workspace?")) return; try { const res = await authedFetch(`${API_BASE}/reset`, { method: "DELETE" }); if (!res.ok) throw new Error(await res.text()); state.docs = []; state.selectedDoc = null; state.evidence = []; renderSources(); newWorkspace(); await updateUsage(); toast("Workspace cleared."); } catch (error) { toast(`Reset failed: ${error.message}`); } }

async function loadUser(user) {
  state.user = user;
  showApp();
  try { const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).single(); if (error) throw error; state.profile = data || { tier: "free" }; }
  catch (error) { state.profile = { tier: "free" }; }
  const name = state.profile?.full_name || user.email?.split("@")[0] || "Researcher";
  qs("profile-name").textContent = name;
  qs("profile-avatar").textContent = initials(name);
  qs("account-name").value = name;
  renderLens(); renderActions(); renderStreamEmpty(); renderSources(); updateStats();
  await Promise.allSettled([refreshDocuments(), refreshHistory(), updateUsage()]);
  await restoreLatestConversation();
  await resumePendingUpload();
}

async function init() {
  renderShell();
  renderLens();
  renderActions();
  renderStreamEmpty();
  renderSources();
  resetUploadUi();
  try { const { data: { session } } = await sb.auth.getSession(); if (session?.user) await loadUser(session.user); else showAuth(); }
  catch (error) { console.warn("Session restore failed", error); showAuth(); }
  sb.auth.onAuthStateChange(async (event, session) => { if (event === "SIGNED_IN" && session?.user) await loadUser(session.user); else if (event === "SIGNED_OUT") showAuth(); });
  wakeApi();
}

init();
