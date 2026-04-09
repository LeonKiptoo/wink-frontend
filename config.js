(function initWinkConfig() {
  const STAGES = [
    { key: "queued", label: "Files received" },
    { key: "initializing", label: "Preparing your workspace" },
    { key: "extracting", label: "Reading your documents" },
    { key: "summarizing", label: "Preparing answers" },
    { key: "rebuilding", label: "Refreshing your workspace" },
    { key: "indexing", label: "Making answers searchable" },
    { key: "finalizing", label: "Saving workspace" },
    { key: "logging", label: "Updating usage" },
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
    insights: {
      label: "Key Insights",
      icon: "lightbulb",
      description: "Extract non-obvious, evidence-backed insights from the document."
    },
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
  const FALLBACK_STATUS = "Sign-in is unavailable because the Supabase connection details are missing.";

  function normalizeConfig(payload = {}) {
    const config = {
      apiBaseUrl: payload.apiBaseUrl || payload.api_base_url || payload.api_base || "",
      supabaseUrl: payload.supabaseUrl || payload.supabase_url || "",
      supabaseAnonKey: payload.supabaseAnonKey || payload.supabase_anon_key || "",
      checkoutUrl: payload.checkoutUrl || payload.checkout_url || "",
      appName: payload.appName || payload.app_name || "Wink",
      backendConfigured: payload.backendConfigured ?? Boolean(payload.apiBaseUrl || payload.api_base_url || payload.api_base),
      missingBackendConfig: payload.missingBackendConfig || payload.missing_backend_config || []
    };
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      const missing = [];
      if (!config.supabaseUrl) missing.push("SUPABASE_URL");
      if (!config.supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
      throw new Error(`${FALLBACK_STATUS}${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`);
    }
    return config;
  }

  async function loadRuntimeConfig() {
    const endpoints = ["/client-config", "/config"];
    let lastError = new Error(FALLBACK_STATUS);
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload || {};
          const missing = Array.isArray(detail?.missing) ? detail.missing : [];
          const message = typeof detail === "string"
            ? detail
            : `${detail?.message || `Config request failed with status ${response.status}`}${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`;
          lastError = new Error(message);
          continue;
        }
        return normalizeConfig(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(FALLBACK_STATUS);
      }
    }
    const fallback = window.__WINK_CONFIG_FALLBACK__ || null;
    if (fallback?.supabaseUrl && fallback?.supabaseAnonKey) {
      return normalizeConfig(fallback);
    }
    throw lastError;
  }

  function createSupabaseClient(config) {
    return supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "wink-auth"
      }
    });
  }

  window.WinkConfig = {
    STAGES,
    LENSES,
    ACTIONS,
    ALLOWED_FILE_TYPES,
    MAX_FILE_SIZE_MB,
    MAX_FILE_SIZE_BYTES,
    PENDING_UPLOAD_KEY,
    FALLBACK_STATUS,
    normalizeConfig,
    loadRuntimeConfig,
    createSupabaseClient
  };
})();
