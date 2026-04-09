(function initWinkUi() {
  const { state } = window.WinkState;

  let backendActivityDepth = 0;

  function qs(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function truncate(value, length = 80) {
    const text = String(value || "");
    return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || "")
      .join("") || "?";
  }

  function prettyDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }

  function stageLabel(stage) {
    return window.WinkConfig.STAGES.find(item => item.key === stage)?.label || "Processing";
  }

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

  function syncBackendProgressUi() {
    const bar = qs("backend-progress");
    const active = backendActivityDepth > 0;
    if (bar) {
      bar.classList.toggle("active", active);
      bar.setAttribute("aria-busy", active ? "true" : "false");
    }
    document.body.classList.toggle("backend-busy", active);
  }

  function beginBackendActivity() {
    backendActivityDepth += 1;
    syncBackendProgressUi();
  }

  function endBackendActivity() {
    backendActivityDepth = Math.max(0, backendActivityDepth - 1);
    syncBackendProgressUi();
  }

  async function withBackendActivity(fn) {
    beginBackendActivity();
    try {
      return await fn();
    } finally {
      endBackendActivity();
    }
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
      const rows = lines
        .filter(line => !/^\|[-:|\s]+\|$/.test(line))
        .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
      if (rows.length >= 2) {
        return `<div class="table-wrap"><table><thead><tr>${rows[0].map(cell => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
    }
    if (lines.every(line => /^\d+\.\s+/.test(line))) {
      return `<ol>${lines.map(line => `<li>${renderInline(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
    }
    if (lines.every(line => /^[-*]\s+/.test(line))) {
      return `<ul>${lines.map(line => `<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    if (lines.length === 1 && /^source:/i.test(lines[0])) {
      return `<blockquote>${renderInline(lines[0])}</blockquote>`;
    }
    return lines.map(line => `<p>${renderInline(line)}</p>`).join("");
  }

  function parseSections(text) {
    const value = String(text || "").replace(/\r/g, "").trim();
    if (!value) return [];
    const matches = [...value.matchAll(/(?:^|\n)\*\*([^*\n]+)\*\*\s*\n/g)];
    if (!matches.length) return [{ title: "Answer", body: value }];
    return matches
      .map((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = index + 1 < matches.length ? (matches[index + 1].index || value.length) : value.length;
        return { title: match[1].trim(), body: value.slice(start, end).trim() };
      })
      .filter(section => section.body);
  }

  function renderSections(text) {
    const sections = parseSections(text);
    if (!sections.length) return `<div class="rich"><p>${renderInline(text)}</p></div>`;
    return sections
      .map(section => {
        const body = section.body
          .split(/\n\s*\n/)
          .map(chunk => chunk.trim())
          .filter(Boolean)
          .map(renderBlock)
          .join("");
        return `<div class="answer-block"><h4 class="section-heading">${esc(section.title)}</h4><div class="rich">${body}</div></div>`;
      })
      .join("");
  }

  function addUserMessage(content) {
    const lens = window.WinkConfig.LENSES[state.lens] || window.WinkConfig.LENSES.research;
    const node = document.createElement("div");
    node.className = "message-user";
    node.innerHTML = `<div>${esc(content)}</div>${state.selectedDoc ? `<small>${esc(truncate(state.selectedDoc, 28))}</small>` : ""}`;
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

  function removeLoading(id) {
    qs(id)?.remove();
  }

  function addAnswerCard({ answer }) {
    const node = document.createElement("div");
    node.className = "answer answer-simple";
    node.innerHTML = `<div class="answer-body">${renderSections(answer)}</div>`;
    qs("stream-inner").appendChild(node);
    node.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  window.WinkUI = {
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
    renderInline,
    renderBlock,
    parseSections,
    renderSections,
    addUserMessage,
    addLoading,
    removeLoading,
    addAnswerCard
  };
})();
