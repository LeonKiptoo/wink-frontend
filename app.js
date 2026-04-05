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

const ALLOWED_FILE_TYPES = ["pdf", "docx", "doc", "txt", "csv", "xlsx", "pptx", "html", "epub", "rtf", "md"];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const PENDING_UPLOAD_KEY = "wink.pendingUpload.v1";
const FALLBACK_STATUS = "Connection details are unavailable. Check backend configuration.";

const state = {
  config: null,
  sb: null,
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
  evidence: [],
  activeWorkspaceId: null,
  uploadUsage: null
};

let backendActivityDepth = 0;

function qs(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(value, length = 80) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
}
function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?";
}
function prettyDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
function generateWorkspaceId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
function humanizeIdentifier(value, fallback = "Untitled Workspace") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/\b\w/g, match => match.toUpperCase());
}
function workspaceLabel(workspaceId, title = "") {
  const titleLabel = humanizeIdentifier(title, "");
  if (titleLabel) return titleLabel;
  const idLabel = humanizeIdentifier(workspaceId, "General Workspace");
  return idLabel === "Matrixgeneral" ? "Matrix General" : idLabel;
}
function stageLabel(stage) { return STAGES.find(item => item.key === stage)?.label || "Processing"; }
function toast(message, duration = 3200) {
  const el = qs("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), duration);
}
function setHealth(kind, message) {
  const row = qs("health-row");
  if (!row) return;
  row.className = `sidebar-status status ${kind}`;
  qs("health-copy").textContent = message;
}
function beginBackendActivity() { backendActivityDepth += 1; syncBackendProgressUi(); }
function endBackendActivity() { backendActivityDepth = Math.max(0, backendActivityDepth - 1); syncBackendProgressUi(); }
function syncBackendProgressUi() {
  const bar = qs("backend-progress");
  const active = backendActivityDepth > 0;
  if (bar) {
    bar.classList.toggle("active", active);
    bar.setAttribute("aria-busy", active ? "true" : "false");
  }
  document.body.classList.toggle("backend-busy", active);
}
async function withBackendActivity(fn) {
  beginBackendActivity();
  try { return await fn(); } finally { endBackendActivity(); }
}
function buildApiUrl(path) { return new URL(path, state.config.apiBaseUrl).toString(); }
function normalizeConfig(payload = {}) {
  const config = {
    apiBaseUrl: payload.apiBaseUrl || payload.api_base_url || payload.api_base || "",
    supabaseUrl: payload.supabaseUrl || payload.supabase_url || "",
    supabaseAnonKey: payload.supabaseAnonKey || payload.supabase_anon_key || "",
    checkoutUrl: payload.checkoutUrl || payload.checkout_url || "",
    appName: payload.appName || payload.app_name || "Wink"
  };
  if (!config.apiBaseUrl || !config.supabaseUrl || !config.supabaseAnonKey) throw new Error(FALLBACK_STATUS);
  return config;
}
async function loadRuntimeConfig() {
  const localConfig = window.__WINK_CONFIG__ || null;
  if (localConfig?.apiBaseUrl && localConfig?.supabaseUrl && localConfig?.supabaseAnonKey) return normalizeConfig(localConfig);
  const endpoints = ["/client-config", "/config"];
  let lastError = new Error(FALLBACK_STATUS);
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || payload || {};
        const message = typeof detail === "string" ? detail : detail?.message || `Config request failed with status ${response.status}`;
        lastError = new Error(message);
        continue;
      }
      return normalizeConfig(payload);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(FALLBACK_STATUS);
    }
  }
  throw lastError;
}
function createSupabaseClient(config) {
  return supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "wink-auth" }
  });
}
function emptyStateMarkup() {
  return `<div class="stream-empty"><div class="stream-empty-copy"><div class="stream-empty-kicker">Turn looong page PDFs into instant answers</div><p>Upload research papers, reports, contracts, or policy documents to start getting grounded answers in seconds.</p><button type="button" class="btn primary stream-empty-upload" onclick="openUploadModal(true)"><span class="icon">upload_file</span> Upload sources</button></div></div>`;
}
function renderShell() {
  qs("sidebar").innerHTML = `
    <div class="brand">
      <div class="mark">${esc(state.config?.appName || "Wink")}</div>
      <div class="tag">Get key insights, summaries, and findings in seconds.</div>
    </div>
    <div class="stack">
      <button type="button" class="btn primary" onclick="newWorkspace()"><span class="icon">add</span> New workspace</button>
      <button type="button" class="btn secondary" onclick="openUploadModal(true)"><span class="icon">upload_file</span> Upload</button>
    </div>
    <div class="section-label">Recent Workspaces</div>
    <div class="history scroll" id="history-list"></div>
    <div class="sidebar-lens">
      <label class="sidebar-lens-label" for="lens-select">Lens</label>
      <select id="lens-select" class="sidebar-lens-select" onchange="setLens(this.value)"></select>
    </div>
    <div class="status sidebar-status" id="health-row">
      <div class="dot"></div>
      <span id="health-copy">Checking connection...</span>
    </div>
    <div class="footer">
      <div class="avatar" id="profile-avatar">?</div>
      <div class="profile">
        <strong id="profile-name">Loading...</strong>
        <span id="profile-tier">Free trial</span>
      </div>
      <button type="button" class="icon-btn" onclick="openAccount()" title="Settings"><span class="icon">settings</span></button>
      <button type="button" class="icon-btn" onclick="doOut()" title="Sign out"><span class="icon">logout</span></button>
    </div>
  `;

  qs("workspace").innerHTML = `
    <div class="upload-strip" id="upload-strip">
      <div>
        <strong id="strip-title">Processing upload</strong>
        <span id="strip-copy">Preparing your sources...</span>
      </div>
      <div class="mini-progress"><i id="strip-progress"></i></div>
    </div>
    <div class="chat-header">
      <div>
        <div class="chat-kicker">Active workspace</div>
        <h2 id="chat-workspace-title">General Workspace</h2>
        <p id="chat-workspace-copy">Start a workspace, upload sources, and ask questions grounded in your materials.</p>
      </div>
      <button type="button" class="btn secondary" onclick="openUploadModal(true)"><span class="icon">add_circle</span> Add sources</button>
    </div>
    <div class="stream scroll"><div class="stream-inner" id="stream-inner"></div></div>
    <div class="composer">
      <div class="composer-shell">
        <div class="composer-box">
          <textarea id="composer-input" placeholder="Ask a question..." onkeydown="handleComposerKey(event)" oninput="resizeComposer(this)"></textarea>
          <button type="button" class="send" id="composer-send" onclick="sendMessage()" title="Send"><span class="icon">arrow_forward</span></button>
        </div>
      </div>
    </div>
  `;

  qs("inspector").innerHTML = `
    <div class="card card-shortcuts">
      <div class="card-title"><span class="icon">bolt</span> Shortcuts</div>
      <div class="card-subtitle">skip typing — get instant insights</div>
      <div class="cta-grid" id="action-grid"></div>
      <div class="section-label inspector-section">Sources</div>
      <div class="source-list scroll" id="source-list"></div>
      <button type="button" class="btn secondary btn-danger-outline" onclick="resetWorkspace()"><span class="icon">delete</span> Reset workspace</button>
    </div>
  `;

  qs("upload-backdrop").innerHTML = `
    <div class="modal" id="upload-modal">
      <div class="modal-head">
        <div>
          <h3>Add your sources</h3>
          <p>Upload documents, then let Wink extract, summarize, and index them in the background.</p>
        </div>
        <button class="close" onclick="closeUploadModal()"><span class="icon">close</span></button>
      </div>
      <div class="drop">
        <div class="drop-copy">Supported: PDF, DOCX, DOC, TXT, CSV, XLSX, PPTX, EPUB, RTF, MD, HTML</div>
        <label class="upload-pick">
          <span class="icon">upload_file</span> Choose files
          <input id="upload-input" type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.pptx,.epub,.rtf,.md,.html" onchange="handleFiles(Array.from(this.files || []))" />
        </label>
      </div>
      <div class="warning" id="upload-warning"></div>
      <div class="upload-progress-wrap">
        <div class="progress-bar"><span id="upload-progress"></span></div>
        <div class="upload-progress-copy">
          <strong id="upload-stage-title">Waiting for files</strong>
          <span id="upload-stage-copy">Upload a few sources to start building cards, findings, and comparison notes.</span>
        </div>
      </div>
      <div class="stage-list" id="upload-stage-list"></div>
      <div class="modal-actions">
        <button class="btn ghost" id="upload-secondary" onclick="closeUploadModal()">Hide</button>
        <button class="btn secondary" id="upload-primary" onclick="document.getElementById('upload-input').click()">Choose files</button>
      </div>
    </div>
  `;

  qs("account-backdrop").innerHTML = `
    <div class="modal" id="account-modal">
      <div class="modal-head">
        <div>
          <h3>Account</h3>
        </div>
        <button class="close" onclick="closeAccount()"><span class="icon">close</span></button>
      </div>
      <div class="field modal-section">
        <label>Display name</label>
        <input id="account-name" type="text" placeholder="Your display name" />
      </div>
      <button class="btn secondary modal-fill" onclick="saveName()">Save name</button>
      <div class="plan-grid">
        <div class="plan current">
          <strong>Free trial</strong>
          <div class="plan-price">$0</div>
          <div class="plan-meta">Metered access, saved history, and enough room to validate the workflow before upgrading.</div>
        </div>
        <div class="plan">
          <strong>Pro</strong>
          <div class="plan-price">$19 / month</div>
          <div class="plan-meta">Expanded limits, faster throughput, and room for heavier compare workflows.</div>
          <button class="btn primary modal-fill plan-upgrade" onclick="goPro()">Upgrade to Pro</button>
        </div>
      </div>
      <div class="field modal-section">
        <label>New password</label>
        <input id="account-password" type="password" placeholder="At least 8 characters" />
      </div>
      <button class="btn secondary modal-fill" onclick="changePassword()">Update password</button>
      <button class="btn ghost modal-signout" onclick="doOut()">Sign out</button>
    </div>
  `;
}

function renderLens() {
  const select = qs("lens-select");
  if (!select) return;
  select.innerHTML = Object.entries(LENSES).map(([key, meta]) => `<option value="${esc(key)}">${esc(meta.label)}</option>`).join("");
  select.value = LENSES[state.lens] ? state.lens : "research";
  updateChatHeader();
}

function renderActions() {
  const grid = qs("action-grid");
  if (!grid) return;
  grid.innerHTML = Object.entries(ACTIONS).map(([key, action]) => `
    <button type="button" class="shortcut-btn ${action.compare ? "compare" : ""} ${(action.compare && activeWorkspaceDocs().length < 2) ? "locked" : ""}" id="action-${key}" title="${esc((action.compare && activeWorkspaceDocs().length < 2) ? "Add a second source to unlock compare" : action.description)}" onclick="runAction('${esc(key)}')" ${(action.compare && activeWorkspaceDocs().length < 2) ? "disabled" : ""}>
      <span class="icon">${esc(action.icon)}</span>${esc(action.label)}
    </button>
  `).join("");
}

function workspaceIdFor(item) { return item?.workspace_id || item?.workspaceId || state.activeWorkspaceId || "general"; }
function activeWorkspaceConversations() { return state.conversations.filter(item => workspaceIdFor(item) === state.activeWorkspaceId); }
function activeWorkspaceDocs() { return state.docs.filter(doc => workspaceIdFor(doc) === state.activeWorkspaceId); }
function activeWorkspaceTitle() {
  const current = state.conversations.find(item => item.id === state.convId);
  const latest = activeWorkspaceConversations()[0];
  const source = current || latest;
  return workspaceLabel(workspaceIdFor(source), source?.workspace_title || source?.title || "");
}
function updateChatHeader() {
  const lens = LENSES[state.lens] || LENSES.research;
  const docCount = activeWorkspaceDocs().length;
  qs("chat-workspace-title").textContent = activeWorkspaceTitle();
  qs("chat-workspace-copy").textContent = `${lens.blurb} ${docCount ? `${docCount} source${docCount === 1 ? "" : "s"} available in this workspace.` : "Upload a source to begin."}`;
}
function groupConversationsByWorkspace(list) {
  const grouped = new Map();
  for (const item of list) {
    const workspaceId = workspaceIdFor(item);
    if (!grouped.has(workspaceId)) grouped.set(workspaceId, []);
    grouped.get(workspaceId).push(item);
  }
  return [...grouped.entries()].map(([workspaceId, items]) => ({
    workspaceId,
    title: workspaceLabel(workspaceId, items[0]?.workspace_title || items[0]?.title || ""),
    items
  }));
}
function renderHistory() {
  const container = qs("history-list");
  if (!container) return;
  if (!state.conversations.length) {
    container.innerHTML = `<div class="empty-box">No workspaces yet. Create one and upload a source to begin.</div>`;
    return;
  }
  container.innerHTML = groupConversationsByWorkspace(state.conversations).map(group => `
    <section class="workspace-group">
      <button type="button" class="workspace-group-trigger ${state.activeWorkspaceId === group.workspaceId ? "active" : ""}" onclick="activateWorkspace('${esc(group.workspaceId)}')">
        <span>${esc(group.title)}</span>
        <span>${group.items.length}</span>
      </button>
      <div class="workspace-group-list">
        ${group.items.map(item => `
          <button type="button" class="history-item ${state.convId === item.id ? "active" : ""}" onclick="openConversation('${esc(item.id)}')">
            <div class="history-title">${esc(item.title || "Untitled")}</div>
            <div class="history-meta">${esc(prettyDate(item.created_at))}</div>
          </button>
        `).join("")}
        ${group.items.length ? `<div class="history-thread">${group.items.slice(0, 3).map(item => `<div class="history-subitem">${esc(truncate(item.title || "Recent message", 42))}</div>`).join("")}</div>` : ""}
      </div>
    </section>
  `).join("");
}

function renderSources() {
  const container = qs("source-list");
  if (!container) return;
  const docs = activeWorkspaceDocs();
  if (!docs.length) {
    container.innerHTML = `<div class="empty-box">No sources in this workspace yet.</div>`;
    updateChatHeader();
    return;
  }
  container.innerHTML = docs.map(doc => `
    <button type="button" class="source-item ${state.selectedDoc === doc.name ? "active" : ""}" onclick="toggleDocumentFilter('${esc(doc.name)}')">
      <div>
        <strong>${esc(truncate(doc.name, 32))}</strong>
        <span>${esc(doc.ext)} | ${esc(doc.indexed ? "Indexed" : "Processing")}</span>
      </div>
      <span class="source-pill">${esc(Math.max(1, Math.round(doc.size / 1024)))} KB</span>
    </button>
  `).join("");
  updateChatHeader();
}

function renderEvidence() {}
function renderStreamEmpty() {
  qs("stream-inner").innerHTML = emptyStateMarkup();
  updateChatHeader();
}
function resetAlerts() {
  qs("auth-error").style.display = "none";
  qs("auth-msg").style.display = "none";
}
function authError(message) {
  resetAlerts();
  qs("auth-error").textContent = message;
  qs("auth-error").style.display = "block";
}
function authMessage(message) {
  resetAlerts();
  qs("auth-msg").textContent = message;
  qs("auth-msg").style.display = "block";
}
function showAuth() { qs("auth").style.display = "flex"; qs("app").style.display = "none"; }
function showApp() { qs("auth").style.display = "none"; qs("app").style.display = "block"; }
function updateStats() {
  const tier = qs("profile-tier");
  if (!tier) return;
  if (state.profile?.tier === "pro") {
    tier.textContent = "Pro";
    return;
  }
  const remaining = state.uploadUsage?.remaining;
  tier.textContent = typeof remaining === "number" ? `Free trial - ${remaining} upload${remaining === 1 ? "" : "s"} left` : "Free trial";
}
function toggleDocumentFilter(name) {
  state.selectedDoc = state.selectedDoc === name ? null : name;
  renderSources();
}
function activateWorkspace(workspaceId) {
  state.activeWorkspaceId = workspaceId;
  const latestConversation = state.conversations.find(item => workspaceIdFor(item) === workspaceId);
  if (latestConversation) openConversation(latestConversation.id);
  else {
    state.convId = null;
    renderHistory();
    renderSources();
    renderActions();
    renderStreamEmpty();
  }
}
function stab(mode) {
  const signIn = mode === "in";
  qs("tab-in").classList.toggle("active", signIn);
  qs("tab-up").classList.toggle("active", !signIn);
  qs("signin-form").style.display = signIn ? "block" : "none";
  qs("signup-form").style.display = signIn ? "none" : "block";
  resetAlerts();
}

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
  node.innerHTML = `<div>${esc(content)}</div><small>${esc(LENSES[state.lens].label)} lens${state.selectedDoc ? ` | ${esc(truncate(state.selectedDoc, 28))}` : ""}</small>`;
  qs("stream-inner").appendChild(node);
  node.scrollIntoView({ behavior: "smooth", block: "end" });
}
function addLoading() {
  const id = `loading-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const node = document.createElement("div");
  node.className = "loading";
  node.id = id;
  node.innerHTML = `<div class="dots"><i></i><i></i><i></i></div><div><span class="loading-text">Working...</span></div>`;
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
  return list.map(doc => ({
    name: doc.filename || doc.name || "Untitled",
    ext: String(doc.extension || "").replace(/^\./, "").toUpperCase().slice(0, 4) || "FILE",
    indexed: Boolean(doc.indexed),
    size: Number(doc.size_bytes || doc.size || 0),
    summary: doc.summary || "",
    workspace_id: doc.workspace_id || doc.workspaceId || state.activeWorkspaceId || "general"
  }));
}
function setLens(nextLens, persist = true) {
  state.lens = LENSES[nextLens] ? nextLens : "research";
  renderLens();
  if (persist && state.user && state.convId) {
    beginBackendActivity();
    state.sb.from("conversations").update({ lens: state.lens }).eq("id", state.convId).then(() => refreshHistory()).catch(() => {}).finally(() => endBackendActivity());
  }
}
async function apiHeaders() {
  const headers = {};
  const { data: { session } } = await state.sb.auth.getSession();
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}
function shouldShowProgressForUrl(url) { return !String(url || "").includes("/upload-jobs/"); }
async function authedFetch(url, options = {}) {
  const showProgress = shouldShowProgressForUrl(url);
  if (showProgress) beginBackendActivity();
  try {
    const headers = { ...(options.headers || {}), ...(await apiHeaders()) };
    return await fetch(url, { ...options, headers });
  } finally {
    if (showProgress) endBackendActivity();
  }
}

async function wakeApi() {
  if (!state.config?.apiBaseUrl) {
    setHealth("offline", FALLBACK_STATUS);
    return false;
  }
  if (state.waking) return false;
  state.waking = true;
  beginBackendActivity();
  qs("status-copy").textContent = "Wink is waking up. This can take a moment on the free tier.";
  qs("status-banner").classList.add("show");
  setHealth("starting", "Starting backend...");
  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await fetch(buildApiUrl("/health"), { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          state.apiReady = true;
          setHealth("online", "Backend online");
          return true;
        }
      } catch (error) {}
      await sleep(3000);
    }
    state.apiReady = false;
    setHealth("offline", "Backend offline. Try again in a moment.");
    return false;
  } finally {
    state.waking = false;
    qs("status-banner").classList.remove("show");
    endBackendActivity();
  }
}

async function ensureApiReady() {
  if (state.apiReady) return true;
  if (state.waking) {
    while (state.waking) await sleep(800);
    return state.apiReady;
  }
  return wakeApi();
}

async function updateUsage() {
  try {
    const response = await authedFetch(buildApiUrl("/upload-usage"));
    if (!response.ok) throw new Error(`Usage failed (${response.status})`);
    state.uploadUsage = await response.json();
  } catch (error) {
    state.uploadUsage = null;
  }
  updateStats();
}

async function refreshDocuments() {
  if (!state.user) return;
  try {
    const response = await authedFetch(buildApiUrl("/documents"));
    if (!response.ok) throw new Error(`Documents failed (${response.status})`);
    const payload = await response.json();
    state.docs = normaliseDocs(payload.documents || []);
    if (state.selectedDoc && !state.docs.some(doc => doc.name === state.selectedDoc)) state.selectedDoc = null;
    renderSources();
    renderActions();
  } catch (error) {
    console.warn("Could not refresh documents", error);
  }
}

async function fetchConversations() {
  const preferred = await state.sb.from("conversations").select("id,title,lens,created_at,workspace_id,workspace_title").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
  if (!preferred.error) return preferred;
  return state.sb.from("conversations").select("id,title,lens,created_at").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
}

async function refreshHistory() {
  if (!state.user) return;
  beginBackendActivity();
  try {
    const { data, error } = await fetchConversations();
    if (error) throw error;
    state.conversations = (data || []).map(item => ({ ...item, workspace_id: item.workspace_id || item.id || state.activeWorkspaceId || "general" }));
    if (!state.activeWorkspaceId && state.conversations.length) state.activeWorkspaceId = workspaceIdFor(state.conversations[0]);
  } catch (error) {
    console.warn("Could not refresh history", error);
    state.conversations = [];
  } finally {
    endBackendActivity();
  }
  renderHistory();
  renderSources();
  updateStats();
}

async function saveMessage(role, content, extras = {}) {
  if (!state.user || !state.convId) return;
  beginBackendActivity();
  try {
    await state.sb.from("messages").insert({ conversation_id: state.convId, role, content, source: extras.source || "", chunks_used: extras.chunks_used || 0 });
  } catch (error) {
    console.warn("Could not save message", error);
  } finally {
    endBackendActivity();
  }
}

async function createConversation(seedTitle) {
  const payload = {
    user_id: state.user.id,
    title: truncate(seedTitle, 80),
    lens: state.lens,
    workspace_id: state.activeWorkspaceId,
    workspace_title: workspaceLabel(state.activeWorkspaceId, seedTitle)
  };
  let result = await state.sb.from("conversations").insert(payload).select("id,workspace_id,workspace_title").single();
  if (!result.error) return result;
  return state.sb.from("conversations").insert({ user_id: state.user.id, title: truncate(seedTitle, 80), lens: state.lens }).select("id").single();
}

async function ensureConversation(seedTitle) {
  if (!state.user) return null;
  if (state.convId) return state.convId;
  return withBackendActivity(async () => {
    try {
      if (!state.activeWorkspaceId) state.activeWorkspaceId = generateWorkspaceId();
      const { data, error } = await createConversation(seedTitle);
      if (error) throw error;
      state.convId = data?.id || null;
      state.activeWorkspaceId = data?.workspace_id || state.activeWorkspaceId;
      await refreshHistory();
      return state.convId;
    } catch (error) {
      console.warn("Could not create conversation", error);
      return null;
    }
  });
}

async function openConversation(id) {
  if (!state.user) return;
  state.convId = id;
  const current = state.conversations.find(item => item.id === id);
  if (current?.lens) state.lens = current.lens;
  if (current) state.activeWorkspaceId = workspaceIdFor(current);
  renderHistory();
  renderLens();
  renderSources();
  renderActions();
  await withBackendActivity(async () => {
    try {
      const { data, error } = await state.sb.from("messages").select("role,content,source,chunks_used,created_at").eq("conversation_id", id).order("created_at", { ascending: true });
      if (error) throw error;
      state.evidence = [];
      if (!data?.length) {
        renderStreamEmpty();
        return;
      }
      qs("stream-inner").innerHTML = "";
      for (const message of data) {
        if (message.role === "user") addUserMessage(message.content || "");
        else addAnswerCard({ answer: message.content || "" });
      }
      updateChatHeader();
    } catch (error) {
      console.warn("Could not open conversation", error);
      toast("Could not restore that workspace.");
    }
  });
}

async function restoreLatestConversation() {
  if (!state.conversations.length) {
    newWorkspace();
    return;
  }
  await openConversation(state.conversations[0].id);
}

function newWorkspace() {
  state.convId = null;
  state.selectedDoc = null;
  state.activeWorkspaceId = generateWorkspaceId();
  renderHistory();
  renderSources();
  renderActions();
  renderStreamEmpty();
  updateStats();
}

function scopedPayload(payload = {}) {
  return { ...payload, mode: state.lens, focus_document: state.selectedDoc || null, workspace_id: state.activeWorkspaceId };
}
async function runAction(key) {
  const action = ACTIONS[key];
  if (!action) return;
  if (action.compare && activeWorkspaceDocs().length < 2) {
    toast("Add at least two documents to compare in this workspace.");
    return;
  }
  const button = qs(`action-${key}`);
  button?.classList.add("loading");
  if (!await ensureApiReady()) {
    button?.classList.remove("loading");
    toast("Backend is still waking up. Try again in a moment.");
    return;
  }
  const title = state.selectedDoc ? `${action.label} - ${state.selectedDoc}` : action.label;
  await ensureConversation(title);
  addUserMessage(`Quick action: ${action.label}`);
  await saveMessage("user", `Quick action: ${action.label}`);
  const loadingId = addLoading();
  try {
    const response = await authedFetch(buildApiUrl("/quick"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scopedPayload({ action: key, top_k: action.compare ? 16 : 12 }))
    });
    const data = await response.json();
    removeLoading(loadingId);
    if (!response.ok) throw new Error(data.detail || `Error ${response.status}`);
    addAnswerCard({ answer: data.answer || "" });
    await saveMessage("assistant", data.answer || "", { source: data.source || "", chunks_used: data.chunks_in_context || 0 });
    await refreshHistory();
  } catch (error) {
    removeLoading(loadingId);
    addAnswerCard({ answer: `**Error**\n${error.message || "Something went wrong."}` });
  } finally {
    button?.classList.remove("loading");
  }
}

function resizeComposer(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}
function handleComposerKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}
async function sendMessage() {
  const input = qs("composer-input");
  const raw = input.value.trim();
  if (!raw) return;
  if (!await ensureApiReady()) {
    toast("Backend is still waking up. Try again in a moment.");
    return;
  }
  const title = state.selectedDoc ? `${raw} (${state.selectedDoc})` : raw;
  input.value = "";
  resizeComposer(input);
  await ensureConversation(title);
  addUserMessage(raw);
  await saveMessage("user", raw);
  const loadingId = addLoading();
  try {
    const response = await authedFetch(buildApiUrl("/query"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scopedPayload({ query: raw, top_k: 8 }))
    });
    const data = await response.json();
    removeLoading(loadingId);
    if (!response.ok) throw new Error(data.detail || `Error ${response.status}`);
    addAnswerCard({ answer: data.answer || "" });
    await saveMessage("assistant", data.answer || "", { source: data.source || "", chunks_used: data.chunks_in_context || 0 });
    await refreshHistory();
  } catch (error) {
    removeLoading(loadingId);
    addAnswerCard({ answer: `**Error**\n${error.message || "Something went wrong."}` });
  }
}

function openUploadModal(openPicker = false) {
  qs("upload-backdrop").classList.add("open");
  if (openPicker) requestAnimationFrame(() => qs("upload-input")?.click());
}
function closeUploadModal() { qs("upload-backdrop").classList.remove("open"); }
function resetUploadUi() {
  qs("upload-warning").style.display = "none";
  qs("upload-warning").textContent = "";
  qs("upload-progress").style.width = "0%";
  qs("upload-stage-title").textContent = "Waiting for files";
  qs("upload-stage-copy").textContent = "Upload a few sources to start building cards, findings, and comparison notes.";
  qs("upload-stage-list").innerHTML = STAGES.map(stage => `<div class="stage"><strong>${esc(stage.label)}</strong><span>Pending</span></div>`).join("");
}
function showUploadWarning(message) {
  qs("upload-warning").textContent = message;
  qs("upload-warning").style.display = "block";
}
function renderUploadStrip() {
  const strip = qs("upload-strip");
  if (!state.uploadJob || ["completed", "failed"].includes(state.uploadJob.status)) {
    strip.classList.remove("show");
    return;
  }
  strip.classList.add("show");
  qs("strip-title").textContent = stageLabel(state.uploadJob.stage);
  qs("strip-copy").textContent = state.uploadJob.message || "Processing your sources...";
  qs("strip-progress").style.width = `${Math.max(0, Math.min(100, state.uploadJob.progress || 0))}%`;
}
function updateUploadState(job) {
  state.uploadJob = job;
  renderUploadStrip();
  qs("upload-progress").style.width = `${Math.max(0, Math.min(100, job.progress || 0))}%`;
  qs("upload-stage-title").textContent = stageLabel(job.stage);
  qs("upload-stage-copy").textContent = job.message || "Processing your sources...";
  const currentIndex = Math.max(STAGES.findIndex(item => item.key === job.stage), 0);
  qs("upload-stage-list").innerHTML = STAGES.map((stage, index) => {
    const cls = job.status === "completed" ? "done" : index < currentIndex ? "done" : index === currentIndex ? "active" : "";
    const stateText = job.status === "failed" && index === currentIndex ? "Failed" : job.status === "completed" ? "Done" : index < currentIndex ? "Done" : index === currentIndex ? "Active" : "Pending";
    return `<div class="stage ${cls}"><strong>${esc(stage.label)}</strong><span>${esc(stateText)}</span></div>`;
  }).join("");
}
function persistPendingUpload(job) {
  localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify({ job_id: job.job_id, filenames: job.filenames || [] }));
}
function clearPendingUpload() {
  localStorage.removeItem(PENDING_UPLOAD_KEY);
  if (state.uploadTimer) window.clearTimeout(state.uploadTimer);
  state.uploadTimer = null;
  state.uploadJob = null;
  renderUploadStrip();
}
async function pollUploadJob(jobId) {
  try {
    const response = await authedFetch(buildApiUrl(`/upload-jobs/${jobId}`));
    const job = await response.json();
    if (!response.ok) throw new Error(job.detail || `Upload job failed (${response.status})`);
    updateUploadState(job);
    if (job.status === "completed") {
      toast("Sources indexed and ready.");
      clearPendingUpload();
      await Promise.allSettled([refreshDocuments(), updateUsage(), refreshHistory()]);
      window.setTimeout(() => closeUploadModal(), 900);
      return;
    }
    if (job.status === "failed") {
      showUploadWarning(job.error || job.message || "Upload failed.");
      clearPendingUpload();
      return;
    }
    state.uploadTimer = window.setTimeout(() => pollUploadJob(jobId), 1300);
  } catch (error) {
    showUploadWarning(error.message || "Could not track upload progress.");
    clearPendingUpload();
  }
}

async function resumePendingUpload() {
  const raw = localStorage.getItem(PENDING_UPLOAD_KEY);
  if (!raw || !state.user) return;
  try {
    const pending = JSON.parse(raw);
    if (!pending?.job_id) return;
    openUploadModal(false);
    updateUploadState({ job_id: pending.job_id, status: "running", stage: "queued", progress: 8, message: "Rejoining your upload job..." });
    await pollUploadJob(pending.job_id);
  } catch (error) {
    clearPendingUpload();
  }
}

async function handleFiles(files) {
  const valid = files.filter(file => ALLOWED_FILE_TYPES.includes((file.name.split(".").pop() || "").toLowerCase()));
  resetUploadUi();
  if (!valid.length) {
    showUploadWarning("No supported file types selected.");
    openUploadModal(false);
    return;
  }
  const tooLarge = valid.filter(file => file.size > MAX_FILE_SIZE_BYTES);
  const ready = valid.filter(file => file.size <= MAX_FILE_SIZE_BYTES);
  openUploadModal(false);
  if (tooLarge.length) {
    showUploadWarning(`Each file must be ${MAX_FILE_SIZE_MB} MB or smaller. Too large: ${tooLarge.slice(0, 3).map(file => file.name).join(", ")}${tooLarge.length > 3 ? ", ..." : ""}`);
  }
  if (!ready.length) return;
  if (!await ensureApiReady()) {
    showUploadWarning("The backend is still waking up. Wait a moment and try again.");
    return;
  }
  const uploadModal = qs("upload-modal");
  uploadModal?.classList.add("is-backend-pending");
  try {
    qs("upload-stage-title").textContent = "Uploading files";
    qs("upload-stage-copy").textContent = `Sending ${ready.length} file${ready.length === 1 ? "" : "s"} to the backend.`;
    qs("upload-progress").style.width = "12%";
    const form = new FormData();
    for (const file of ready) form.append("files", file, file.name);
    form.append("workspace_id", state.activeWorkspaceId || generateWorkspaceId());
    const response = await authedFetch(buildApiUrl("/upload"), { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || `Upload failed (${response.status})`);
    if (!state.activeWorkspaceId) state.activeWorkspaceId = payload.workspace_id || generateWorkspaceId();
    persistPendingUpload(payload);
    updateUploadState(payload);
    await pollUploadJob(payload.job_id);
  } catch (error) {
    showUploadWarning(error.message || "Upload failed.");
  } finally {
    uploadModal?.classList.remove("is-backend-pending");
    qs("upload-input").value = "";
  }
}

async function doIn() {
  const email = qs("signin-email").value.trim();
  const password = qs("signin-password").value;
  if (!email || !password) {
    authError("Please fill in all sign-in fields.");
    return;
  }
  const button = qs("signin-btn");
  button.disabled = true;
  button.textContent = "Signing in...";
  const { error } = await state.sb.auth.signInWithPassword({ email, password });
  button.disabled = false;
  button.textContent = "Sign in";
  if (error) authError(error.message);
}
async function doUp() {
  const name = qs("signup-name").value.trim();
  const email = qs("signup-email").value.trim().toLowerCase();
  const password = qs("signup-password").value;
  if (!name || !email || !password) {
    authError("Please complete every field.");
    return;
  }
  if (password.length < 8) {
    authError("Password must be at least 8 characters.");
    return;
  }
  const button = qs("signup-btn");
  button.disabled = true;
  button.textContent = "Creating...";
  const { error } = await state.sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  button.disabled = false;
  button.textContent = "Create account";
  if (error) authError(error.message);
  else authMessage("Check your email to confirm your account.");
}
async function doGoogle() {
  const { error } = await state.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${window.location.pathname}` } });
  if (error) authError(error.message);
}
async function doOut() {
  await state.sb.auth.signOut();
  clearPendingUpload();
  Object.assign(state, { user: null, profile: null, docs: [], conversations: [], convId: null, selectedDoc: null, evidence: [], activeWorkspaceId: null, uploadUsage: null });
  showAuth();
  toast("Signed out.");
}
function openAccount() { qs("account-backdrop").classList.add("open"); }
function closeAccount() { qs("account-backdrop").classList.remove("open"); }
async function saveName() {
  if (!state.user) return;
  const name = qs("account-name").value.trim();
  if (!name) {
    toast("Please enter a display name.");
    return;
  }
  await withBackendActivity(async () => {
    try {
      await state.sb.from("profiles").update({ full_name: name }).eq("id", state.user.id);
      qs("profile-name").textContent = name;
      qs("profile-avatar").textContent = initials(name);
      toast("Name saved.");
    } catch (error) {
      toast("Could not save name.");
    }
  });
}
async function changePassword() {
  const password = qs("account-password").value;
  if (password.length < 8) return toast("Password must be at least 8 characters.");
  await withBackendActivity(async () => {
    const { error } = await state.sb.auth.updateUser({ password });
    if (error) toast(error.message);
    else {
      qs("account-password").value = "";
      toast("Password updated.");
    }
  });
}
function goPro() {
  if (!state.config?.checkoutUrl) {
    toast("Checkout is not configured yet.");
    return;
  }
  window.open(state.config.checkoutUrl, "_blank", "noopener");
}
async function resetWorkspace() {
  if (!confirm("Delete all uploaded sources and reset the active workspace?")) return;
  try {
    const response = await authedFetch(buildApiUrl("/reset"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: state.activeWorkspaceId }) });
    if (!response.ok) throw new Error(await response.text());
    state.docs = state.docs.filter(doc => workspaceIdFor(doc) !== state.activeWorkspaceId);
    state.conversations = state.conversations.filter(item => workspaceIdFor(item) !== state.activeWorkspaceId);
    state.selectedDoc = null;
    state.evidence = [];
    newWorkspace();
    await updateUsage();
    toast("Workspace cleared.");
  } catch (error) {
    toast(`Reset failed: ${error.message}`);
  }
}

async function loadUser(user) {
  state.user = user;
  showApp();
  try {
    const { data, error } = await state.sb.from("profiles").select("*").eq("id", user.id).single();
    if (error) throw error;
    state.profile = data || { tier: "free" };
  } catch (error) {
    state.profile = { tier: "free" };
  }
  const name = state.profile?.full_name || user.email?.split("@")[0] || "Researcher";
  qs("profile-name").textContent = name;
  qs("profile-avatar").textContent = initials(name);
  qs("account-name").value = name;
  renderLens();
  renderActions();
  renderStreamEmpty();
  renderSources();
  updateStats();
  await Promise.allSettled([refreshDocuments(), refreshHistory(), updateUsage()]);
  await restoreLatestConversation();
  await resumePendingUpload();
}

async function init() {
  try {
    state.config = await loadRuntimeConfig();
    state.sb = createSupabaseClient(state.config);
  } catch (error) {
    console.error("Runtime config failed", error);
  }
  renderShell();
  renderLens();
  renderActions();
  renderStreamEmpty();
  renderSources();
  resetUploadUi();
  if (!state.sb) {
    showAuth();
    authError(FALLBACK_STATUS);
    setHealth("offline", FALLBACK_STATUS);
    return;
  }
  await withBackendActivity(async () => {
    try {
      const { data: { session } } = await state.sb.auth.getSession();
      if (session?.user) await loadUser(session.user);
      else showAuth();
    } catch (error) {
      console.warn("Session restore failed", error);
      showAuth();
    }
  });
  state.sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session?.user) {
      await withBackendActivity(async () => { await loadUser(session.user); });
    } else if (event === "SIGNED_OUT") {
      showAuth();
    }
  });
  wakeApi();
}

Object.assign(window, {
  activateWorkspace,
  changePassword,
  closeAccount,
  closeUploadModal,
  doGoogle,
  doIn,
  doOut,
  doUp,
  goPro,
  handleComposerKey,
  handleFiles,
  newWorkspace,
  openAccount,
  openConversation,
  openUploadModal,
  resetWorkspace,
  resizeComposer,
  runAction,
  saveName,
  sendMessage,
  setLens,
  stab,
  toggleDocumentFilter
});

init();
