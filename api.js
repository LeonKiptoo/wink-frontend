(function initWinkApi() {
  const { state } = window.WinkState;
  const { beginBackendActivity, endBackendActivity, qs, setHealth } = window.WinkUI;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function buildApiUrl(path) {
    if (!state.config?.apiBaseUrl) {
      throw new Error("The backend URL is not configured for this frontend deployment.");
    }
    return new URL(path, state.config.apiBaseUrl).toString();
  }

  async function apiHeaders() {
    const headers = {};
    const { data: { session } } = await state.sb.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  function shouldShowProgressForUrl(url) {
    const s = String(url || "");
    return !s.includes("/upload-jobs/") && !s.includes("/documents") && !s.includes("/upload-usage");
  }

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
      setHealth("offline", "Backend connection is not configured yet.");
      return false;
    }
    if (state.waking) return false;
    state.waking = true;
    beginBackendActivity();
    qs("status-copy").textContent = "Wink is waking up. This can take a moment on the free tier.";
    qs("status-banner").classList.add("show");
    setHealth("starting", "Starting backend...");
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
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

  window.WinkApi = {
    buildApiUrl,
    authedFetch,
    wakeApi,
    ensureApiReady
  };
})();
