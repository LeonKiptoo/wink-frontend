(function initWinkState() {
  const state = {
    config: null,
    sb: null,
    user: null,
    profile: null,
    docsByWorkspace: {},
    conversations: [],
    workspacePreviews: {},
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

  function generateWorkspaceId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function humanizeIdentifier(value, fallback = "Untitled Workspace") {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, match => match.toUpperCase());
  }

  function workspaceLabel(workspaceId, title = "") {
    const titleLabel = humanizeIdentifier(title, "");
    if (titleLabel) return titleLabel;
    const rawId = String(workspaceId || "").trim();
    if (!rawId || rawId === "general") return "General Workspace";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId) || rawId.startsWith("workspace-")) {
      return "New Workspace";
    }
    const idLabel = humanizeIdentifier(workspaceId, "General Workspace");
    return idLabel === "Matrixgeneral" ? "Matrix General" : idLabel;
  }

  function workspaceIdFor(item) {
    return item?.workspace_id || item?.workspaceId || state.activeWorkspaceId || "general";
  }

  function activeWorkspaceConversations() {
    return state.conversations.filter(item => workspaceIdFor(item) === state.activeWorkspaceId);
  }

  function activeWorkspaceDocs() {
    return state.docsByWorkspace[state.activeWorkspaceId || "general"] || [];
  }

  function activeWorkspaceTitle() {
    const current = state.conversations.find(item => item.id === state.convId);
    const latest = activeWorkspaceConversations()[0];
    const source = current || latest;
    return workspaceLabel(workspaceIdFor(source), source?.workspace_title || source?.title || "");
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

  function normaliseDocs(list = []) {
    return list.map(doc => ({
      name: doc.filename || doc.name || "Untitled",
      ext: String(doc.extension || "").replace(/^\./, "").toUpperCase().slice(0, 4) || "FILE",
      indexed: Boolean(doc.indexed),
      size: Number(doc.size_bytes || doc.size || 0),
      summary: doc.summary || "",
      workspace_id: doc.workspace_id || doc.workspaceId || null
    }));
  }

  window.WinkState = {
    state,
    generateWorkspaceId,
    humanizeIdentifier,
    workspaceLabel,
    workspaceIdFor,
    activeWorkspaceConversations,
    activeWorkspaceDocs,
    activeWorkspaceTitle,
    groupConversationsByWorkspace,
    normaliseDocs
  };
})();
