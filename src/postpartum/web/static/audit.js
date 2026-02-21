const rowsEl = document.getElementById("rows");
const statusEl = document.getElementById("status");
const limitEl = document.getElementById("limit");
const refreshBtn = document.getElementById("refresh");

refreshBtn.addEventListener("click", () => load());
limitEl.addEventListener("change", () => load());

load().catch((error) => {
  statusEl.textContent = `Failed to load: ${error.message}`;
});

async function load() {
  const limit = normalizeLimit(limitEl.value);
  statusEl.textContent = "Loading…";
  const response = await fetch(`/api/postpartum/audit/recent?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  const events = Array.isArray(body.events) ? body.events : [];
  renderRows(events);
  statusEl.textContent = `${events.length} event(s) loaded`;
}

function renderRows(events) {
  rowsEl.innerHTML = "";
  if (events.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"9\">No events yet. Run triage from the form first.</td>";
    rowsEl.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement("tr");
    const flags = (event.firedRedFlagIds || []).join(", ") || "none";
    const escalated = event.escalatedByUncertainty ? "yes" : "no";
    const score = `${event.scoreBreakdown?.total ?? 0} (MH ${event.scoreBreakdown?.mentalHealth ?? 0}/PF ${event.scoreBreakdown?.pelvicFloorAndRecovery ?? 0}/Ctx ${event.scoreBreakdown?.historyAndContext ?? 0})`;

    row.innerHTML = `
      <td>${formatDate(event.timestamp)}</td>
      <td>${escapeHtml(event.finalLevel || "")}</td>
      <td>${escapeHtml(event.primaryRoute || "")}</td>
      <td>${escalated}</td>
      <td>${escapeHtml(flags)}</td>
      <td>${escapeHtml(score)}</td>
      <td>${escapeHtml(event.confidenceBucket || "")}</td>
      <td>${escapeHtml(event.source || "")}</td>
      <td>${escapeHtml(event.runId || "")}</td>
    `;
    rowsEl.appendChild(row);
  });
}

function normalizeLimit(raw) {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 200);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
