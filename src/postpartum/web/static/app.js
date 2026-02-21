const form = document.getElementById("triage-form");
const statusEl = document.getElementById("status");
const resultBlock = document.getElementById("result-block");

const presetUrgentBtn = document.getElementById("preset-urgent");
const presetEmergencyBtn = document.getElementById("preset-emergency");
const resetBtn = document.getElementById("reset-form");

const fields = {
  weeksPostpartum: "number",
  suicidalIdeationNow: "checkbox",
  suicidalIntentOrPlan: "checkbox",
  thoughtsOfHarmingBaby: "checkbox",
  psychosisWarningSigns: "checkbox",
  heavyBleedingEmergencyPattern: "checkbox",
  highFeverAndSeverePain: "checkbox",
  syncopeOrCollapse: "checkbox",
  chestPainOrSevereBreathlessness: "checkbox",
  depressedMoodMostDays: "checkbox",
  anxietyOrPanicMostDays: "checkbox",
  sleepSeverelyDisruptedNotByBaby: "checkbox",
  bondingDifficulty: "checkbox",
  anhedonia: "checkbox",
  functionalImpairmentMental: "checkbox",
  urinaryIncontinenceFrequent: "checkbox",
  fecalIncontinenceAny: "checkbox",
  urinaryRetention: "checkbox",
  severePerinealPainPersistent: "checkbox",
  perinealWoundConcerns: "checkbox",
  prolapseBulgeSymptoms: "checkbox",
  dyspareuniaPersistentSevere: "checkbox",
  functionalImpairmentPelvic: "checkbox",
  priorDepressionOrAnxiety: "checkbox",
  priorPostpartumDepression: "checkbox",
  birthTraumaOrEmergencyDelivery: "checkbox",
  oasisHistory: "checkbox",
  poorSocialSupport: "checkbox",
  cannotAnswerCriticalQuestions: "checkbox",
  userUncertainOnSafetyQuestions: "checkbox",
  inconsistencyLevel: "select",
};

form.addEventListener("submit", onSubmit);
presetUrgentBtn.addEventListener("click", () => applyPreset("urgent"));
presetEmergencyBtn.addEventListener("click", () => applyPreset("emergency"));
resetBtn.addEventListener("click", () => resetForm());

function onSubmit(event) {
  event.preventDefault();
  statusEl.textContent = "Running triage...";
  runTriage().catch((error) => {
    statusEl.textContent = `Request failed: ${error.message}`;
  });
}

async function runTriage() {
  const input = collectInput();
  const payload = {
    input,
    audit: {
      enabled: checked("auditEnabled"),
      includeInput: checked("auditIncludeInput"),
      source: value("auditSource") || "postpartum-web-ui",
      runId: value("auditRunId") || undefined,
    },
  };

  const response = await fetch("/api/postpartum/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error || `HTTP ${response.status}`);
  }

  const body = await response.json();
  const result = body.result;
  renderResult(result);
  statusEl.textContent = "Triage complete.";
}

function collectInput() {
  const input = {};

  Object.entries(fields).forEach(([key, type]) => {
    if (type === "checkbox") {
      input[key] = checked(key);
      return;
    }
    if (type === "number") {
      const raw = value(key).trim();
      if (raw.length > 0) input[key] = Number(raw);
      return;
    }
    if (type === "select") {
      input[key] = value(key);
    }
  });

  return input;
}

function renderResult(result) {
  resultBlock.classList.remove("hidden");
  setText("level", result.level);
  setText("summary", result.actionPlan.summary);
  setText("route", result.actionPlan.primaryRoute);
  setText("timeframe", result.actionPlan.timeframe);
  setText("emergencyNumber", result.emergencyNumber);
  setText(
    "score",
    `${result.scoreBreakdown.total} (MH ${result.scoreBreakdown.mentalHealth} / PF ${result.scoreBreakdown.pelvicFloorAndRecovery} / Ctx ${result.scoreBreakdown.historyAndContext})`
  );
  setText(
    "confidence",
    `${result.confidence.bucket} (missing critical: ${result.confidence.missingCriticalInputs})`
  );
  setText(
    "uncertainty",
    result.uncertainty.triggered
      ? `Yes (${result.uncertainty.reasons.join(", ") || "unspecified"})`
      : "No"
  );

  fillList("instructions", result.actionPlan.instructions);
  fillList("contacts", result.actionPlan.recommendedContacts);
  fillList("rationale", result.rationale);

  const fired = result.redFlags.filter((item) => item.fired).map((item) => item.label);
  fillList("redFlags", fired.length > 0 ? fired : ["No red flags fired."]);

  const levelEl = document.getElementById("level");
  levelEl.classList.remove("level-emergency", "level-urgent", "level-routine");
  if (result.level === "EMERGENCY_NOW") levelEl.classList.add("level-emergency");
  if (result.level === "URGENT_SAME_DAY") levelEl.classList.add("level-urgent");
  if (result.level === "ROUTINE_FOLLOW_UP") levelEl.classList.add("level-routine");

  document.getElementById("rawJson").textContent = JSON.stringify(result, null, 2);
}

function applyPreset(kind) {
  resetForm();
  if (kind === "urgent") {
    setNumber("weeksPostpartum", 12);
    setChecked("depressedMoodMostDays", true);
    setChecked("anxietyOrPanicMostDays", true);
    setChecked("sleepSeverelyDisruptedNotByBaby", true);
    setChecked("bondingDifficulty", true);
    setChecked("anhedonia", true);
    setChecked("functionalImpairmentMental", true);
    setChecked("priorDepressionOrAnxiety", true);
    setChecked("poorSocialSupport", true);
  } else if (kind === "emergency") {
    setNumber("weeksPostpartum", 8);
    setChecked("suicidalIdeationNow", true);
    setChecked("suicidalIntentOrPlan", true);
    setChecked("functionalImpairmentMental", true);
  }
}

function resetForm() {
  Object.entries(fields).forEach(([key, type]) => {
    if (type === "checkbox") setChecked(key, false);
    if (type === "number") setValue(key, "");
    if (type === "select") setValue(key, "NONE");
  });
  setChecked("auditEnabled", false);
  setChecked("auditIncludeInput", false);
  setValue("auditSource", "postpartum-web-ui");
  setValue("auditRunId", "");
}

function fillList(id, items) {
  const node = document.getElementById(id);
  node.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    node.appendChild(li);
  });
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function checked(id) {
  return document.getElementById(id).checked;
}

function value(id) {
  return document.getElementById(id).value;
}

function setChecked(id, val) {
  document.getElementById(id).checked = Boolean(val);
}

function setValue(id, val) {
  document.getElementById(id).value = val;
}

function setNumber(id, val) {
  document.getElementById(id).value = String(val);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
