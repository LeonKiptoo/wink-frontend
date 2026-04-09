const {
  STAGES,
  LENSES,
  ACTIONS,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_MB,
  MAX_FILE_SIZE_BYTES,
  PENDING_UPLOAD_KEY,
  FALLBACK_STATUS,
  loadRuntimeConfig,
  createSupabaseClient
} = window.WinkConfig;

const {
  state,
  generateWorkspaceId,
  workspaceLabel,
  workspaceIdFor,
  activeWorkspaceConversations,
  activeWorkspaceDocs,
  activeWorkspaceTitle,
  groupConversationsByWorkspace,
  normaliseDocs
} = window.WinkState;

const {
  qs,
  esc,
  truncate,
  initials,
  prettyDate,
  stageLabel,
  toast,
  setHealth,
  beginBackendActivity,
  endBackendActivity,
  withBackendActivity,
  renderSections,
  addUserMessage,
  addLoading,
  removeLoading,
  addAnswerCard
} = window.WinkUI;

const {
  buildApiUrl,
  authedFetch,
  wakeApi,
  ensureApiReady
} = window.WinkApi;
function emptyStateMarkup() {
  return `
    <div class="stream-empty">
      <div class="stream-empty-icon"><span class="icon">auto_stories</span></div>
      <div class="stream-empty-title">What would you like to explore?</div>
      <div class="stream-empty-copy">Upload a research paper, report, contract, or any document — then ask questions, extract findings, and build reading notes in seconds.</div>
      <div class="stream-empty-actions">
        <button type="button" class="stream-empty-btn primary" onclick="openUploadModal(true)"><span class="icon">upload_file</span> Upload your first document</button>
        <button type="button" class="stream-empty-btn secondary" onclick="openUploadModal(true)"><span class="icon">help_outline</span> How does this work?</button>
      </div>
    </div>
  `;
}
function renderShell() {
  qs("sidebar").innerHTML = `
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-mark">${esc(state.config?.appName || "Wink")}</div>
        <div class="brand-tag">by Wnkia</div>
      </div>
      <div class="sidebar-actions">
        <button type="button" class="btn primary" onclick="newWorkspace()"><span class="icon">add</span> New workspace</button>
      </div>
    </div>
    <div class="sidebar-section-label">Recent workspaces</div>
    <div class="history" id="history-list"></div>
    <div class="sidebar-lens">
      <label class="sidebar-lens-label" for="lens-select">Lens</label>
      <select id="lens-select" class="sidebar-lens-select" onchange="setLens(this.value)"></select>
    </div>
    <div class="sidebar-status status" id="health-row">
      <div class="dot"></div>
      <span id="health-copy">Checking...</span>
    </div>
    <div class="footer">
      <div class="avatar" id="profile-avatar">?</div>
      <div class="profile">
        <strong id="profile-name">Loading...</strong>
        <span id="profile-tier">Free trial</span>
      </div>
      <button type="button" class="icon-btn" onclick="openAccount()" title="Settings"><span class="icon">settings</span></button>
    </div>
  `;

  qs("workspace").innerHTML = `
    <div id="status-banner">
      <div class="status-dot"></div>
      <span id="status-copy">Backend is starting up — this takes about 30 seconds on the first visit.</span>
    </div>
    <div id="backend-progress" aria-hidden="true"><div class="backend-progress-track"><div class="backend-progress-shimmer"></div></div></div>
    <div class="upload-strip" id="upload-strip">
      <div style="flex:1">
        <strong id="strip-title">Indexing your document</strong>
        <span id="strip-copy">Usually takes 15–30 seconds...</span>
      </div>
      <div class="mini-progress"><i id="strip-progress"></i></div>
    </div>
    <div class="chat-area">
      <div class="chat-header">
        <div>
          <div class="chat-kicker">Workspace</div>
          <h2 id="chat-workspace-title">New workspace</h2>
          <p id="chat-workspace-copy"></p>
        </div>
        <button type="button" class="btn secondary" onclick="openUploadModal(true)"><span class="icon">add_circle</span> Add sources</button>
      </div>
      <div class="stream"><div class="stream-inner" id="stream-inner"></div></div>
      <div class="composer">
        <div class="composer-inner">
          <div class="composer-shell">
            <div class="composer-box">
              <textarea id="composer-input" placeholder="Ask a question about your documents..." onkeydown="handleComposerKey(event)" oninput="resizeComposer(this)"></textarea>
              <button type="button" class="send" id="composer-send" onclick="sendMessage()" title="Send"><span class="icon">arrow_forward</span></button>
            </div>
            <div class="composer-actions">
              <label class="composer-upload" title="Upload a document">
                <span class="icon">upload_file</span> Upload
                <input type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.pptx,.epub,.rtf,.md,.html" onchange="handleFiles(Array.from(this.files || []))" />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  qs("inspector").innerHTML = `
    <div class="inspector-inner">
      <div>
        <div class="inspector-section-title"><span class="icon">bolt</span> Quick actions</div>
        <div class="shortcuts-grid" id="action-grid"></div>
      </div>
      <div>
        <div class="inspector-section-title"><span class="icon">description</span> Sources</div>
        <div class="source-list" id="source-list"></div>
      </div>
    </div>
    <div class="inspector-reset">
      <button type="button" class="btn danger-ghost" style="width:100%;font-size:11px" onclick="resetWorkspace()"><span class="icon">delete_sweep</span> Reset workspace</button>
    </div>
  `;

  qs("upload-backdrop").innerHTML = `
    <div class="modal" id="upload-modal">
      <div class="modal-head">
        <div>
          <h3>Add sources</h3>
          <p>Upload documents — Wink will extract, summarise, and index them.</p>
        </div>
        <button class="close" onclick="closeUploadModal()"><span class="icon">close</span></button>
      </div>
      <div class="warning" id="upload-warning"></div>
      <div class="drop-zone" onclick="document.getElementById('upload-input').click()">
        <div class="drop-zone-icon"><span class="icon">upload_file</span></div>
        <div class="drop-title">Drop files here</div>
        <div class="drop-copy">or click to browse your computer</div>
        <div style="margin-top:12px">
          <label class="upload-pick">
            <span class="icon">folder_open</span> Browse files
            <input id="upload-input" type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.pptx,.epub,.rtf,.md,.html" onchange="handleFiles(Array.from(this.files || []))" />
          </label>
        </div>
        <div class="drop-types" style="margin-top:10px">PDF · DOCX · TXT · CSV · XLSX · PPTX · EPUB · MD · HTML</div>
      </div>
      <div class="progress-wrap" id="upload-progress-wrap" style="display:none">
        <div class="progress-label">
          <strong id="upload-stage-title">Processing</strong>
          <span id="upload-stage-pct">0%</span>
        </div>
        <div class="progress-bar"><span id="upload-progress"></span></div>
        <div class="progress-message" id="upload-stage-copy"></div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick="closeUploadModal()">Hide</button>
      </div>
    </div>
  `;

  qs("account-backdrop").innerHTML = `
    <div class="modal" id="account-modal">
      <div class="modal-head">
        <div><h3>Account</h3></div>
        <button class="close" onclick="closeAccount()"><span class="icon">close</span></button>
      </div>
      <div class="field modal-section">
        <label>Display name</label>
        <input id="account-name" type="text" placeholder="Your display name" />
      </div>
      <button class="btn secondary modal-fill" onclick="saveName()">Save name</button>
      <div class="plan-grid">
        <div class="plan current">
          <strong>Free</strong>
          <div class="plan-price">$0</div>
          <div class="plan-meta">4 uploads per day. Full access to all quick actions.</div>
        </div>
        <div class="plan">
          <strong>Pro</strong>
          <div class="plan-price">$19<span style="font-size:12px;font-family:var(--sans)">/mo</span></div>
          <div class="plan-meta">Unlimited uploads, faster processing, priority support.</div>
          <button class="btn primary plan-upgrade modal-fill" onclick="goPro()">Upgrade</button>
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
  const docs = activeWorkspaceDocs();
  const hasDoc = docs.length > 0;
  grid.innerHTML = Object.entries(ACTIONS).map(([key, action]) => {
    const isCompare = Boolean(action.compare);
    const locked = !hasDoc || (isCompare && docs.length < 2);
    const title = !hasDoc
      ? "Upload a source to unlock"
      : (isCompare && docs.length < 2)
        ? "Add a second source to compare"
        : action.description;
    return `
      <button type="button"
        class="shortcut-btn${isCompare && hasDoc && docs.length >= 2 ? ' compare' : ''}${locked ? ' locked' : ''}"
        id="action-${key}"
        title="${esc(title)}"
        onclick="runAction('${esc(key)}')"
        ${locked ? 'disabled' : ''}>
        <span class="icon">${esc(action.icon)}</span>${esc(action.label)}
      </button>`;
  }).join("");
}

function updateChatHeader() {
  const lens = LENSES[state.lens] || LENSES.research;
  const docCount = activeWorkspaceDocs().length;
  qs("chat-workspace-title").textContent = activeWorkspaceTitle();
  qs("chat-workspace-copy").textContent = docCount
    ? `${docCount} source${docCount === 1 ? "" : "s"} · ${lens.label} lens`
    : "Upload a source to begin.";
}
function renderHistory() {
  const container = qs("history-list");
  if (!container) return;
  if (!state.conversations.length) {
    container.innerHTML = `<div class="empty-box">No recent workspaces yet.</div>`;
    return;
  }
  container.innerHTML = groupConversationsByWorkspace(state.conversations).map(group => `
    <div class="workspace-group">
      <button type="button"
        class="workspace-group-trigger ${state.activeWorkspaceId === group.workspaceId ? 'active' : ''}"
        onclick="activateWorkspace('${esc(group.workspaceId)}')">
        <span>${esc(group.title)}</span>
        <span>${group.items.length}</span>
      </button>
    </div>
  `).join("");
}

function renderSources() {
  const container = qs("source-list");
  if (!container) return;
  const docs = activeWorkspaceDocs();
  if (!docs.length) {
    container.innerHTML = `<div class="empty-box">No sources uploaded yet.</div>`;
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
function setAuthEnabled(enabled) {
  const ids = ["signin-btn", "signup-btn", "google-btn", "signin-email", "signin-password", "signup-name", "signup-email", "signup-password"];
  ids.forEach(id => {
    const el = qs(id);
    if (!el) return;
    el.disabled = !enabled;
  });
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
async function activateWorkspace(workspaceId) {
  state.activeWorkspaceId = workspaceId;
  const latestConversation = state.conversations.find(item => workspaceIdFor(item) === workspaceId);
  if (latestConversation) await openConversation(latestConversation.id);
  else {
    state.convId = null;
    state.docsByWorkspace[workspaceId] = state.docsByWorkspace[workspaceId] || [];
    await refreshDocuments(workspaceId);
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

function setLens(nextLens, persist = true) {
  state.lens = LENSES[nextLens] ? nextLens : "research";
  renderLens();
  if (persist && state.user && state.convId) {
    beginBackendActivity();
    state.sb.from("conversations").update({ lens: state.lens }).eq("id", state.convId).then(() => refreshHistory()).catch(() => {}).finally(() => endBackendActivity());
  }
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

async function refreshDocuments(workspaceId = state.activeWorkspaceId || "general") {
  if (!state.user) return;
  if (!state.config?.apiBaseUrl) {
    state.docsByWorkspace[workspaceId] = state.docsByWorkspace[workspaceId] || [];
    if (workspaceId === state.activeWorkspaceId) {
      if (state.selectedDoc && !activeWorkspaceDocs().some(doc => doc.name === state.selectedDoc)) state.selectedDoc = null;
      renderSources();
      renderActions();
    }
    return;
  }
  try {
    const response = await authedFetch(buildApiUrl(`/documents?workspace_id=${encodeURIComponent(workspaceId)}`));
    if (!response.ok) throw new Error(`Documents failed (${response.status})`);
    const payload = await response.json();
    state.docsByWorkspace[workspaceId] = normaliseDocs(payload.documents || []);
    if (workspaceId === state.activeWorkspaceId) {
      if (state.selectedDoc && !activeWorkspaceDocs().some(doc => doc.name === state.selectedDoc)) state.selectedDoc = null;
      renderSources();
      renderActions();
    }
  } catch (error) {
    console.warn("Could not refresh documents", error);
  }
}

async function fetchConversations() {
  const preferred = await state.sb.from("conversations").select("id,title,lens,created_at,workspace_id,workspace_title").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
  if (!preferred.error) return preferred;
  return state.sb.from("conversations").select("id,title,lens,created_at").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
}

async function fetchWorkspacePreviews(conversations) {
  const conversationIds = conversations.map(item => item.id).filter(Boolean);
  if (!conversationIds.length) return {};
  const workspaceByConversation = Object.fromEntries(conversations.map(item => [item.id, workspaceIdFor(item)]));
  const previews = {};
  const { data, error } = await state.sb
    .from("messages")
    .select("conversation_id,role,content,created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) throw error;
  for (const message of data || []) {
    if (message.role !== "user" || !String(message.content || "").trim()) continue;
    const workspaceId = workspaceByConversation[message.conversation_id];
    if (!workspaceId) continue;
    if (!previews[workspaceId]) previews[workspaceId] = [];
    if (previews[workspaceId].length >= 3) continue;
    previews[workspaceId].push(String(message.content).trim());
  }
  return previews;
}

async function refreshHistory() {
  if (!state.user) return;
  beginBackendActivity();
  try {
    const { data, error } = await fetchConversations();
    if (error) throw error;
    state.conversations = (data || []).map(item => ({ ...item, workspace_id: item.workspace_id || item.id || state.activeWorkspaceId || "general" }));
    state.workspacePreviews = await fetchWorkspacePreviews(state.conversations).catch(() => ({}));
    if (!state.activeWorkspaceId && state.conversations.length) state.activeWorkspaceId = workspaceIdFor(state.conversations[0]);
  } catch (error) {
    console.warn("Could not refresh history", error);
    state.conversations = [];
    state.workspacePreviews = {};
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
  await refreshDocuments(state.activeWorkspaceId);
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
  state.docsByWorkspace[state.activeWorkspaceId] = [];
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
    toast(state.config?.apiBaseUrl ? "Backend is still waking up. Try again in a moment." : "Backend connection is not configured yet.");
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
    toast(state.config?.apiBaseUrl ? "Backend is still waking up. Try again in a moment." : "Backend connection is not configured yet.");
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
  const wrap = qs("upload-progress-wrap");
  if (wrap) wrap.style.display = "none";
  const warning = qs("upload-warning");
  if (warning) { warning.style.display = "none"; warning.textContent = ""; }
  const bar = qs("upload-progress");
  if (bar) bar.style.width = "0%";
  const pct = qs("upload-stage-pct");
  if (pct) pct.textContent = "0%";
  const title = qs("upload-stage-title");
  if (title) title.textContent = "Processing";
  const copy = qs("upload-stage-copy");
  if (copy) copy.textContent = "";
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
  const wrap = qs("upload-progress-wrap");
  if (wrap) wrap.style.display = "block";
  const progress = Math.max(0, Math.min(100, job.progress || 0));
  const bar = qs("upload-progress");
  if (bar) bar.style.width = `${progress}%`;
  const pct = qs("upload-stage-pct");
  if (pct) pct.textContent = `${progress}%`;
  const title = qs("upload-stage-title");
  if (title) {
    if (job.status === "completed") title.textContent = "Ready";
    else if (job.status === "failed") title.textContent = "Upload failed";
    else title.textContent = stageLabel(job.stage) || "Processing";
  }
  const copy = qs("upload-stage-copy");
  if (copy) copy.textContent = job.message || "";
}
function persistPendingUpload(job) {
  localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify({ job_id: job.job_id, workspace_id: job.workspace_id || state.activeWorkspaceId || "general", filenames: job.filenames || [] }));
}
function clearPendingUpload() {
  localStorage.removeItem(PENDING_UPLOAD_KEY);
  if (state.uploadTimer) window.clearTimeout(state.uploadTimer);
  state.uploadTimer = null;
  state.uploadJob = null;
  renderUploadStrip();
}
async function pollUploadJob(jobId, workspaceId = state.activeWorkspaceId || "general") {
  try {
    const response = await authedFetch(buildApiUrl(`/upload-jobs/${jobId}?workspace_id=${encodeURIComponent(workspaceId)}`));
    const job = await response.json();
    if (!response.ok) throw new Error(job.detail || `Upload job failed (${response.status})`);
    updateUploadState(job);
    if (job.status === "completed") {
      toast("Sources indexed and ready.");
      clearPendingUpload();
      await Promise.allSettled([refreshDocuments(workspaceId), updateUsage(), refreshHistory()]);
      window.setTimeout(() => closeUploadModal(), 900);
      return;
    }
    if (job.status === "failed") {
      showUploadWarning(job.error || job.message || "Upload failed.");
      clearPendingUpload();
      return;
    }
      state.uploadTimer = window.setTimeout(() => pollUploadJob(jobId, workspaceId), 1300);
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
    state.activeWorkspaceId = pending.workspace_id || state.activeWorkspaceId || generateWorkspaceId();
    openUploadModal(false);
    updateUploadState({ job_id: pending.job_id, status: "running", stage: "queued", progress: 8, message: "Rejoining your upload job..." });
    await pollUploadJob(pending.job_id, state.activeWorkspaceId);
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
    showUploadWarning(state.config?.apiBaseUrl ? "The backend is still waking up. Wait a moment and try again." : "Backend connection is not configured yet.");
    return;
  }
  const uploadModal = qs("upload-modal");
  uploadModal?.classList.add("is-backend-pending");
  try {
    qs("upload-stage-title").textContent = "Uploading files";
    qs("upload-stage-copy").textContent = `Sending ${ready.length} file${ready.length === 1 ? "" : "s"} to the backend.`;
    qs("upload-progress").style.width = "12%";
    const targetWorkspaceId = state.activeWorkspaceId || generateWorkspaceId();
    state.activeWorkspaceId = targetWorkspaceId;
    state.docsByWorkspace[targetWorkspaceId] = state.docsByWorkspace[targetWorkspaceId] || [];
    if (!activeWorkspaceConversations().length && !state.convId) {
      await ensureConversation(ready[0]?.name?.replace(/\.[^.]+$/, "") || "New Workspace");
    }
    const form = new FormData();
    for (const file of ready) form.append("files", file, file.name);
    form.append("workspace_id", targetWorkspaceId);
    const response = await authedFetch(buildApiUrl("/upload"), { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || `Upload failed (${response.status})`);
    state.activeWorkspaceId = payload.workspace_id || targetWorkspaceId;
    persistPendingUpload(payload);
    updateUploadState(payload);
    await pollUploadJob(payload.job_id, state.activeWorkspaceId);
  } catch (error) {
    showUploadWarning(error.message || "Upload failed.");
  } finally {
    uploadModal?.classList.remove("is-backend-pending");
    qs("upload-input").value = "";
  }
}

async function doIn() {
  if (!state.sb) {
    authError("Supabase sign-in is not configured for this deployment yet.");
    return;
  }
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
  if (!state.sb) {
    authError("Supabase sign-up is not configured for this deployment yet.");
    return;
  }
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
  if (!state.sb) {
    authError("Google sign-in is not configured for this deployment yet.");
    return;
  }
  const { error } = await state.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${window.location.pathname}` } });
  if (error) authError(error.message);
}
async function doOut() {
  await state.sb.auth.signOut();
  clearPendingUpload();
  Object.assign(state, { user: null, profile: null, docsByWorkspace: {}, conversations: [], workspacePreviews: {}, convId: null, selectedDoc: null, evidence: [], activeWorkspaceId: null, uploadUsage: null });
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
  const workspaceId = state.activeWorkspaceId || "general";
  if (!confirm("Clear the uploaded sources and search index for this workspace?")) return;
  try {
    const response = await authedFetch(buildApiUrl("/reset"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId }) });
    if (!response.ok) throw new Error(await response.text());
    state.docsByWorkspace[workspaceId] = [];
    state.selectedDoc = null;
    state.evidence = [];
    qs("stream-inner").innerHTML = emptyStateMarkup();
    renderSources();
    renderActions();
    updateChatHeader();
    await updateUsage();
    toast("Workspace sources cleared.");
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
  await Promise.allSettled([refreshHistory(), updateUsage()]);
  if (state.conversations.length) await restoreLatestConversation();
  else newWorkspace();
  await resumePendingUpload();
}

async function init() {
  let configError = null;
  try {
    state.config = await loadRuntimeConfig();
    state.sb = createSupabaseClient(state.config);
  } catch (error) {
    configError = error instanceof Error ? error : new Error(FALLBACK_STATUS);
    console.error("Runtime config failed", error);
  }
  renderShell();
  renderLens();
  renderActions();
  renderStreamEmpty();
  renderSources();
  resetUploadUi();
  if (!state.sb) {
    setAuthEnabled(false);
    showAuth();
    const message = configError?.message || FALLBACK_STATUS;
    authError(message);
    setHealth("offline", message);
    return;
  }
  setAuthEnabled(true);
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
