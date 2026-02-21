const rowsEl = document.getElementById("rows");
const statusEl = document.getElementById("status");
const limitEl = document.getElementById("limit");
const queueFilterEl = document.getElementById("queue-filter");
const refreshBtn = document.getElementById("refresh");

const authActorEl = document.getElementById("auth-actor");
const authPasscodeEl = document.getElementById("auth-passcode");
const authLoginBtn = document.getElementById("auth-login");
const authLogoutBtn = document.getElementById("auth-logout");
const authStateEl = document.getElementById("auth-state");

const metricComplianceEl = document.getElementById("metric-compliance");
const metricMedianTimeEl = document.getElementById("metric-median-time");
const metricEmergencyShareEl = document.getElementById("metric-emergency-share");
const metricUncertaintyShareEl = document.getElementById("metric-uncertainty-share");
const metricOverdueOpenEl = document.getElementById("metric-overdue-open");
const metricTimeToCloseEl = document.getElementById("metric-time-to-close");
const metricOpenHighRiskEl = document.getElementById("metric-open-high-risk");

const editorEl = document.getElementById("outcome-editor");
const editorMetaEl = document.getElementById("editor-meta");
const outcomeForm = document.getElementById("outcome-form");
const outcomeCancelBtn = document.getElementById("outcome-cancel");

const fieldEventId = document.getElementById("outcome-event-id");
const fieldStatus = document.getElementById("workflow-status");
const fieldOwner = document.getElementById("workflow-owner");
const fieldFollowUpDue = document.getElementById("workflow-follow-up-due");
const fieldLastContact = document.getElementById("workflow-last-contact");
const fieldCareSought = document.getElementById("outcome-care-sought");
const fieldCareTime = document.getElementById("outcome-care-time");
const fieldCareType = document.getElementById("outcome-care-type");
const fieldResolved = document.getElementById("outcome-resolved");
const fieldNotes = document.getElementById("outcome-notes");

let currentEvents = [];
let filteredEvents = [];
let authSession = { authenticated: false, actor: null, expires_at: null };

refreshBtn.addEventListener("click", () => load());
limitEl.addEventListener("change", () => load());
queueFilterEl.addEventListener("change", () => applyFilterAndRender());
outcomeCancelBtn.addEventListener("click", () => hideEditor());
outcomeForm.addEventListener("submit", onSaveCase);
authLoginBtn.addEventListener("click", onLogin);
authLogoutBtn.addEventListener("click", onLogout);
authActorEl.addEventListener("keydown", onAuthInputKeydown);
authPasscodeEl.addEventListener("keydown", onAuthInputKeydown);

initialize().catch((error) => {
  statusEl.textContent = `Failed to initialize dashboard: ${error.message}`;
});

async function initialize() {
  await refreshSession();
  await load();
}

async function load() {
  const limit = normalizeLimit(limitEl.value);
  statusEl.textContent = "Loading...";
  const response = await fetch(`/api/postpartum/audit/recent?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  currentEvents = Array.isArray(body.events) ? body.events : [];
  applyFilterAndRender();
  statusEl.textContent = `${filteredEvents.length} shown / ${currentEvents.length} total`;
}

function applyFilterAndRender() {
  const filter = queueFilterEl.value || "ALL";
  filteredEvents = applyQueueFilter(currentEvents, filter);
  renderRows(filteredEvents);
  renderMetrics(currentEvents);
}

function applyQueueFilter(events, filter) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  if (filter === "NEEDS_FOLLOW_UP_TODAY") {
    return events.filter((event) => {
      if (event.workflow?.status === "CLOSED") return false;
      const due = parseDate(event.workflow?.follow_up_due_at);
      if (!due) return false;
      return due >= todayStart && due < tomorrowStart;
    });
  }

  if (filter === "OVERDUE") {
    return events.filter((event) => isOverdue(event, now));
  }

  if (filter === "CLOSED") {
    return events.filter((event) => event.workflow?.status === "CLOSED");
  }

  return events;
}

function renderRows(events) {
  rowsEl.innerHTML = "";
  if (events.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="15">No events in this queue.</td>';
    rowsEl.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement("tr");
    const flags = (event.firedRedFlagIds || []).join(", ") || "none";
    const escalated = event.escalatedByUncertainty ? "yes" : "no";
    const score = `${event.scoreBreakdown?.total ?? 0} (MH ${event.scoreBreakdown?.mentalHealth ?? 0}/PF ${event.scoreBreakdown?.pelvicFloorAndRecovery ?? 0}/Ctx ${event.scoreBreakdown?.historyAndContext ?? 0})`;
    const outcomeText = formatOutcome(event.outcome);
    const status = event.workflow?.status || "NEW";
    const owner = event.workflow?.owner || "-";
    const due = formatDate(event.workflow?.follow_up_due_at);
    const lastUpdated = formatLastUpdated(event);

    row.innerHTML = `
      <td>${formatDate(event.timestamp)}</td>
      <td>${escapeHtml(event.finalLevel || "")}</td>
      <td>${escapeHtml(event.primaryRoute || "")}</td>
      <td>${escalated}</td>
      <td>${escapeHtml(flags)}</td>
      <td>${escapeHtml(score)}</td>
      <td>${escapeHtml(event.confidenceBucket || "")}</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(owner)}</td>
      <td>${escapeHtml(due || "-")}</td>
      <td>${escapeHtml(outcomeText)}</td>
      <td>${escapeHtml(lastUpdated)}</td>
      <td>${escapeHtml(event.source || "")}</td>
      <td>${escapeHtml(event.runId || "")}</td>
      <td>${renderActionButtons(event)}</td>
    `;
    rowsEl.appendChild(row);
  });

  rowsEl.querySelectorAll("button[data-event-id][data-action]").forEach((button) => {
    button.addEventListener("click", onRowAction);
  });
}

function renderActionButtons(event) {
  const status = event.workflow?.status || "NEW";
  const canEdit = authSession.authenticated;
  const startDisabled = !canEdit || status === "IN_PROGRESS";
  const closeDisabled = !canEdit || status === "CLOSED";
  const updateDisabled = !canEdit;

  return `<div class="table-actions">
    <button type="button" data-action="mark_in_progress" data-event-id="${escapeAttr(event.eventId)}" ${startDisabled ? "disabled" : ""}>Start</button>
    <button type="button" data-action="mark_closed" data-event-id="${escapeAttr(event.eventId)}" ${closeDisabled ? "disabled" : ""}>Close</button>
    <button type="button" data-action="update" data-event-id="${escapeAttr(event.eventId)}" ${updateDisabled ? "disabled" : ""}>Update</button>
  </div>`;
}

async function onRowAction(event) {
  const button = event.currentTarget;
  const eventId = button.getAttribute("data-event-id");
  const action = button.getAttribute("data-action");
  if (!eventId || !action) return;

  if (action === "update") {
    openEditor(eventId);
    return;
  }

  if (action === "mark_in_progress") {
    await quickWorkflowUpdate(eventId, { status: "IN_PROGRESS" });
    return;
  }

  if (action === "mark_closed") {
    await quickWorkflowUpdate(eventId, { status: "CLOSED" });
  }
}

async function quickWorkflowUpdate(eventId, workflowPatch) {
  const authed = await ensureAuthenticated();
  if (!authed) return;

  statusEl.textContent = "Updating case status...";
  const response = await postJson("/api/postpartum/audit/workflow", {
    eventId,
    workflow: workflowPatch,
  });

  if (!response.ok) {
    statusEl.textContent = response.body?.error || `Status update failed (HTTP ${response.status})`;
    return;
  }

  statusEl.textContent = "Case status updated.";
  hideEditor();
  await load();
}

function renderMetrics(events) {
  const total = events.length;
  if (total === 0) {
    metricComplianceEl.textContent = "-";
    metricMedianTimeEl.textContent = "-";
    metricEmergencyShareEl.textContent = "-";
    metricUncertaintyShareEl.textContent = "-";
    metricOverdueOpenEl.textContent = "-";
    metricTimeToCloseEl.textContent = "-";
    metricOpenHighRiskEl.textContent = "-";
    return;
  }

  const emergencies = events.filter((event) => event.finalLevel === "EMERGENCY_NOW").length;
  const uncertaintyEscalations = events.filter((event) => event.escalatedByUncertainty).length;

  const escalatedEvents = events.filter(
    (event) => event.finalLevel === "EMERGENCY_NOW" || event.finalLevel === "URGENT_SAME_DAY"
  );
  const escalatedKnown = escalatedEvents.filter(
    (event) => typeof event.outcome?.care_sought === "boolean"
  );
  const escalatedCompliant = escalatedKnown.filter((event) => event.outcome?.care_sought === true);

  const careTimes = events
    .map((event) => event.outcome?.care_time)
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

  const now = new Date();
  const openCases = events.filter((event) => event.workflow?.status !== "CLOSED");
  const overdueOpen = openCases.filter((event) => isOverdue(event, now));
  const openHighRisk = openCases.filter(
    (event) => event.finalLevel === "EMERGENCY_NOW" || event.finalLevel === "URGENT_SAME_DAY"
  );
  const closedTimes = events
    .filter((event) => event.workflow?.status === "CLOSED")
    .map((event) => hoursBetween(event.timestamp, event.workflow?.updated_at))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);

  metricComplianceEl.textContent =
    escalatedKnown.length > 0
      ? `${percent(escalatedCompliant.length, escalatedKnown.length)} (${escalatedCompliant.length}/${escalatedKnown.length})`
      : "n/a";
  metricMedianTimeEl.textContent =
    careTimes.length > 0 ? `${median(careTimes).toFixed(1)} h` : "n/a";
  metricEmergencyShareEl.textContent = `${percent(emergencies, total)} (${emergencies}/${total})`;
  metricUncertaintyShareEl.textContent = `${percent(
    uncertaintyEscalations,
    total
  )} (${uncertaintyEscalations}/${total})`;
  metricOverdueOpenEl.textContent = `${percent(overdueOpen.length, openCases.length)} (${overdueOpen.length}/${openCases.length})`;
  metricTimeToCloseEl.textContent =
    closedTimes.length > 0 ? `${median(closedTimes).toFixed(1)} h` : "n/a";
  metricOpenHighRiskEl.textContent = `${openHighRisk.length}`;
}

function openEditor(eventId) {
  const event = currentEvents.find((item) => item.eventId === eventId);
  if (!event) return;
  if (!authSession.authenticated) {
    statusEl.textContent = "Sign in required before editing cases.";
    return;
  }

  fieldEventId.value = event.eventId;
  fieldStatus.value = event.workflow?.status || "NEW";
  fieldOwner.value = event.workflow?.owner || "";
  fieldFollowUpDue.value = toDateTimeLocal(event.workflow?.follow_up_due_at);
  fieldLastContact.value = toDateTimeLocal(event.workflow?.last_contact_at);

  fieldCareSought.value =
    typeof event.outcome?.care_sought === "boolean" ? String(event.outcome.care_sought) : "";
  fieldCareTime.value =
    typeof event.outcome?.care_time === "number" ? String(event.outcome.care_time) : "";
  fieldCareType.value = event.outcome?.care_type || "";
  fieldResolved.value =
    typeof event.outcome?.resolved === "boolean" ? String(event.outcome.resolved) : "";
  fieldNotes.value = event.outcome?.notes || "";

  const actor = event.last_updated_by || event.workflow?.updated_by || event.outcome?.updated_by || "system";
  const updatedAt = event.last_updated_at || event.workflow?.updated_at || event.outcome?.updated_at || event.timestamp;
  editorMetaEl.textContent = `Last updated by ${actor} at ${formatDate(updatedAt)}.`;

  editorEl.classList.remove("hidden");
  editorEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideEditor() {
  fieldEventId.value = "";
  fieldStatus.value = "NEW";
  fieldOwner.value = "";
  fieldFollowUpDue.value = "";
  fieldLastContact.value = "";
  fieldCareSought.value = "";
  fieldCareTime.value = "";
  fieldCareType.value = "";
  fieldResolved.value = "";
  fieldNotes.value = "";
  editorMetaEl.textContent = "";
  editorEl.classList.add("hidden");
}

async function onSaveCase(event) {
  event.preventDefault();
  const eventId = fieldEventId.value.trim();
  if (!eventId) return;

  const authed = await ensureAuthenticated();
  if (!authed) return;

  statusEl.textContent = "Saving case update...";

  const outcomePayload = {
    eventId,
    outcome: {
      care_sought: parseTriState(fieldCareSought.value),
      care_time: parseOptionalNumberOrNull(fieldCareTime.value),
      care_type: parseOptionalStringOrNull(fieldCareType.value),
      resolved: parseTriState(fieldResolved.value),
      notes: parseOptionalStringOrNull(fieldNotes.value),
    },
  };

  const workflowPayload = {
    eventId,
    workflow: {
      status: fieldStatus.value || "NEW",
      owner: parseOptionalStringOrNull(fieldOwner.value),
      follow_up_due_at: parseDateTimeLocalOrNull(fieldFollowUpDue.value),
      last_contact_at: parseDateTimeLocalOrNull(fieldLastContact.value),
    },
  };

  const outcomeResp = await postJson("/api/postpartum/audit/outcome", outcomePayload);
  if (!outcomeResp.ok) {
    statusEl.textContent = outcomeResp.body?.error || `Save failed (HTTP ${outcomeResp.status})`;
    return;
  }

  const workflowResp = await postJson("/api/postpartum/audit/workflow", workflowPayload);
  if (!workflowResp.ok) {
    statusEl.textContent =
      workflowResp.body?.error || `Workflow save failed (HTTP ${workflowResp.status})`;
    return;
  }

  statusEl.textContent = "Case updated.";
  hideEditor();
  await load();
}

async function refreshSession() {
  const response = await fetch("/api/postpartum/auth/session");
  const body = await safeJson(response);
  if (!response.ok || !body?.authenticated) {
    authSession = { authenticated: false, actor: null, expires_at: null };
    renderAuthState();
    return authSession;
  }

  authSession = {
    authenticated: true,
    actor: typeof body.actor === "string" ? body.actor : "coordinator",
    expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
  };
  renderAuthState();
  return authSession;
}

function renderAuthState() {
  const signedIn = authSession.authenticated;
  authActorEl.disabled = signedIn;
  authPasscodeEl.disabled = signedIn;
  authLoginBtn.classList.toggle("hidden", signedIn);
  authLogoutBtn.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    const expiryText = authSession.expires_at ? ` (expires ${formatDate(authSession.expires_at)})` : "";
    authStateEl.textContent = `Signed in as ${authSession.actor}.${expiryText}`;
  } else {
    authStateEl.textContent = "Not signed in. Sign in required for updates.";
    hideEditor();
  }

  applyFilterAndRender();
}

async function onLogin() {
  const passcode = authPasscodeEl.value.trim();
  if (!passcode) {
    authStateEl.textContent = "Passcode is required.";
    return;
  }

  authStateEl.textContent = "Signing in...";
  const payload = {
    actor: parseOptionalStringOrNull(authActorEl.value),
    passcode,
  };
  const response = await postJson("/api/postpartum/auth/login", payload, {
    refreshOnUnauthorized: false,
  });

  if (!response.ok) {
    authStateEl.textContent = response.body?.error || `Sign-in failed (HTTP ${response.status})`;
    return;
  }

  authPasscodeEl.value = "";
  await refreshSession();
  statusEl.textContent = `Authenticated as ${authSession.actor}.`;
}

async function onLogout() {
  authStateEl.textContent = "Signing out...";
  await postJson("/api/postpartum/auth/logout", {}, { refreshOnUnauthorized: false });
  await refreshSession();
  statusEl.textContent = "Signed out.";
}

function onAuthInputKeydown(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onLogin();
}

async function ensureAuthenticated() {
  if (authSession.authenticated) return true;
  await refreshSession();
  if (authSession.authenticated) return true;
  statusEl.textContent = "Sign in as coordinator to update cases.";
  authPasscodeEl.focus();
  return false;
}

async function postJson(url, payload, options = {}) {
  const refreshOnUnauthorized = options.refreshOnUnauthorized !== false;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await safeJson(response);
  if (response.status === 401 && refreshOnUnauthorized) {
    await refreshSession();
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function formatLastUpdated(event) {
  const actor = event.last_updated_by || event.workflow?.updated_by || event.outcome?.updated_by || "system";
  const updatedAt = event.last_updated_at || event.workflow?.updated_at || event.outcome?.updated_at || event.timestamp;
  return `${actor} @ ${formatDate(updatedAt)}`;
}

function isOverdue(event, now) {
  if (event.workflow?.status === "CLOSED") return false;
  const due = parseDate(event.workflow?.follow_up_due_at);
  return Boolean(due && due < now);
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseTriState(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseOptionalNumberOrNull(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseDateTimeLocalOrNull(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseOptionalStringOrNull(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  return trimmed;
}

function toDateTimeLocal(iso) {
  const date = parseDate(iso);
  if (!date) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function formatOutcome(outcome) {
  if (!outcome) return "pending";
  const sought =
    typeof outcome.care_sought === "boolean"
      ? outcome.care_sought
        ? "care:yes"
        : "care:no"
      : "care:unk";
  const time =
    typeof outcome.care_time === "number" ? `time:${outcome.care_time}h` : "time:unk";
  const resolved =
    typeof outcome.resolved === "boolean"
      ? outcome.resolved
        ? "resolved:yes"
        : "resolved:no"
      : "resolved:unk";
  return `${sought} | ${time} | ${resolved}`;
}

function normalizeLimit(raw) {
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 200);
}

function percent(num, den) {
  if (den <= 0) return "0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function median(values) {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return (values[mid - 1] + values[mid]) / 2;
  return values[mid];
}

function hoursBetween(startIso, endIso) {
  const start = parseDate(startIso);
  const end = parseDate(endIso);
  if (!start || !end) return null;
  return (end.getTime() - start.getTime()) / 3_600_000;
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

function escapeAttr(value) {
  return escapeHtml(value);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
