import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ConfidenceBucket,
  Progression,
  TriageInput,
  TriageLevel,
  TriageResult,
  TriageRules,
} from "./types";

const EMERGENCY: TriageLevel = "EMERGENCY_NOW";
const URGENT: TriageLevel = "URGENT_SAME_DAY";
const FOLLOW_UP: TriageLevel = "BOOK_WITHIN_72H";

export function loadRulesFromFile(pathToRulesJson: string): TriageRules {
  const absolutePath = resolve(pathToRulesJson);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as TriageRules;
}

export function evaluateTriage(input: TriageInput, rules: TriageRules): TriageResult {
  const redFlags = evaluateRedFlags(input, rules);
  const firedRedFlags = redFlags.filter((r) => r.fired);

  if (firedRedFlags.length > 0) {
    return {
      level: EMERGENCY,
      isEmergency: true,
      rulesVersion: rules.version,
      rationale: [
        "At least one emergency red-flag condition was met.",
        ...firedRedFlags.map((f) => `Triggered: ${f.label}`),
      ],
      redFlags,
      scoreBreakdown: {
        symptoms: 0,
        history: 0,
        womenSpecific: 0,
        age: 0,
        total: 0,
      },
      confidence: buildConfidenceTrace(input),
      uncertainty: {
        triggered: false,
        reasons: [],
      },
    };
  }

  const scoreBreakdown = calculateScore(input, rules);
  const baseLevel =
    scoreBreakdown.total >= rules.thresholds.urgentSameDayMin ? URGENT : FOLLOW_UP;

  const confidence = buildConfidenceTrace(input);
  const uncertainty = evaluateUncertainty(input, confidence.bucket);
  const finalLevel = uncertainty.triggered ? escalateOneLevel(baseLevel) : baseLevel;

  const rationale = [
    `No emergency red flag triggered under rules ${rules.version}.`,
    `Risk score total: ${scoreBreakdown.total}.`,
    `Base triage level: ${baseLevel}.`,
    `Confidence: ${confidence.bucket}.`,
  ];

  if (uncertainty.triggered && finalLevel !== baseLevel) {
    rationale.push(
      `Escalated to ${finalLevel} due to uncertainty conditions: ${uncertainty.reasons.join(", ")}.`
    );
  } else if (uncertainty.triggered) {
    rationale.push(`Uncertainty present but level remained ${finalLevel}.`);
  }

  return {
    level: finalLevel,
    isEmergency: finalLevel === EMERGENCY,
    rulesVersion: rules.version,
    rationale,
    redFlags,
    scoreBreakdown,
    confidence,
    uncertainty: {
      ...uncertainty,
      escalatedFrom: uncertainty.triggered ? baseLevel : undefined,
      escalatedTo: uncertainty.triggered ? finalLevel : undefined,
    },
  };
}

function evaluateRedFlags(input: TriageInput, rules: TriageRules) {
  const hasChest = input.chestDiscomfortSeverity !== undefined && input.chestDiscomfortSeverity !== "NONE";
  const severeChest = input.chestDiscomfortSeverity === "SEVERE";
  const chestDuration = input.chestDiscomfortDurationMinutes ?? 0;
  const shortnessAtRest = Boolean(input.shortnessOfBreathAtRest);
  const nearSyncope = Boolean(input.lightheadedOrNearSyncope || input.syncope);
  const coldSweat = Boolean(input.coldSweat);
  const nausea = Boolean(input.nauseaOrVomiting);
  const neuro = Boolean(input.neurologicSymptoms);
  const rapidWorsening = Boolean(input.rapidlyWorseningDuringSession);
  const lifeThreatening = Boolean(input.symptomsFeelLifeThreateningNow);

  const firedMap: Record<string, boolean> = {
    RF001: severeChest && chestDuration >= 10,
    RF002: hasChest && shortnessAtRest,
    RF003: hasChest && nearSyncope,
    RF004: hasChest && coldSweat && nausea,
    RF005: neuro,
    RF006: rapidWorsening,
    RF007: lifeThreatening,
  };

  return rules.redFlagRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    fired: Boolean(firedMap[rule.id]),
  }));
}

function calculateScore(input: TriageInput, rules: TriageRules) {
  const w = rules.scoring;

  const hasChest = input.chestDiscomfortSeverity !== undefined && input.chestDiscomfortSeverity !== "NONE";
  const nonSevereChest =
    hasChest &&
    input.chestDiscomfortSeverity !== "SEVERE";
  const hasShortness = Boolean(input.shortnessOfBreath);
  const hasReferred = Boolean(input.jawNeckBackShoulderArmDiscomfort);
  const hasNausea = Boolean(input.nauseaOrVomiting);
  const hasColdSweat = Boolean(input.coldSweat);
  const hasLightheaded = Boolean(input.lightheadedOrNearSyncope);
  const hasPalpitations = Boolean(input.palpitations);
  const hasFatigue = Boolean(input.unusualSevereFatigue);
  const worsening = isWorsening(input.progression);
  const longEpisode = (input.symptomDurationMinutes ?? 0) >= 20;

  let symptoms = 0;
  if (nonSevereChest) symptoms += w.symptoms.chestDiscomfortNonSevere;
  if (hasShortness) symptoms += w.symptoms.shortnessOfBreathNonSevere;
  if (hasReferred) symptoms += w.symptoms.referredDiscomfortJawNeckBackShoulderArm;
  if (hasNausea) symptoms += w.symptoms.nauseaOrVomiting;
  if (hasColdSweat) symptoms += w.symptoms.coldSweat;
  if (hasLightheaded) symptoms += w.symptoms.lightheadedOrNearSyncope;
  if (hasPalpitations) symptoms += w.symptoms.palpitations;
  if (hasFatigue) symptoms += w.symptoms.unusualSevereFatigue;
  if (worsening) symptoms += w.symptoms.worseningPatternRecent;
  if (longEpisode) symptoms += w.symptoms.episodeDurationAtLeast20Min;

  let history = 0;
  if (input.priorCardiovascularDisease) history += w.history.priorCardiovascularDisease;
  if (input.hypertension) history += w.history.hypertension;
  if (input.diabetes) history += w.history.diabetes;
  if (input.highCholesterol) history += w.history.highCholesterol;
  if (input.currentOrRecentSmoking) history += w.history.currentOrRecentSmoking;
  if (input.familyHistoryPrematureCVD) history += w.history.familyHistoryPrematureCVD;

  let womenSpecific = 0;
  if (input.pregnancyHypertensiveDisorderOrGDMHistory) {
    womenSpecific += w.womenSpecific.pregnancyHypertensiveDisorderOrGDMHistory;
  }
  if (input.earlyMenopauseBefore45) {
    womenSpecific += w.womenSpecific.earlyMenopauseBefore45;
  }
  if (input.autoimmuneDisease) womenSpecific += w.womenSpecific.autoimmuneDisease;
  if (input.migraineWithAura) womenSpecific += w.womenSpecific.migraineWithAura;

  const age = w.ageBand[input.ageBand] ?? 0;

  return {
    symptoms,
    history,
    womenSpecific,
    age,
    total: symptoms + history + womenSpecific + age,
  };
}

function buildConfidenceTrace(input: TriageInput) {
  const criticalInputsStatus: Record<string, boolean> = {
    chestDiscomfortPresence: input.chestDiscomfortSeverity !== undefined,
    shortnessOfBreathPresence: input.shortnessOfBreath !== undefined,
    onsetTiming: input.onsetMinutesAgo !== undefined,
    progression: input.progression !== undefined,
    faintingOrNearFaintingPresence:
      input.syncope !== undefined || input.lightheadedOrNearSyncope !== undefined,
  };

  const missingCriticalInputs = Object.values(criticalInputsStatus).filter((present) => !present).length;
  const inconsistencyLevel = input.inconsistencyLevel ?? "NONE";
  const userUncertainOnKeyItems = Boolean(input.userUncertainOnKeyItems);

  let bucket: ConfidenceBucket = "HIGH";
  if (
    userUncertainOnKeyItems ||
    inconsistencyLevel === "MAJOR" ||
    missingCriticalInputs >= 2
  ) {
    bucket = "LOW";
  } else if (inconsistencyLevel === "MINOR" || missingCriticalInputs === 1) {
    bucket = "MEDIUM";
  }

  return {
    bucket,
    missingCriticalInputs,
    criticalInputsStatus,
    inconsistencyLevel,
    userUncertainOnKeyItems,
  };
}

function evaluateUncertainty(input: TriageInput, confidence: ConfidenceBucket) {
  const reasons: string[] = [];
  const missingCriticalInputs = buildConfidenceTrace(input).missingCriticalInputs;

  if (input.cannotCharacterizeSeverityOrDuration) {
    reasons.push("cannotCharacterizeSeverityOrDuration");
  }
  if ((input.inconsistencyLevel ?? "NONE") !== "NONE") {
    reasons.push("inconsistencyPresent");
  }
  if (missingCriticalInputs > 2) {
    reasons.push("missingMoreThanTwoCriticalInputs");
  }
  if (confidence === "LOW") {
    reasons.push("lowConfidence");
  }

  return {
    triggered: reasons.length > 0,
    reasons,
  };
}

function escalateOneLevel(level: TriageLevel): TriageLevel {
  if (level === FOLLOW_UP) return URGENT;
  if (level === URGENT) return EMERGENCY;
  return EMERGENCY;
}

function isWorsening(progression?: Progression): boolean {
  return progression === "WORSENING";
}
