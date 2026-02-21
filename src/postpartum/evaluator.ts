import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPostpartumEnglishCopyPack } from "./copy/en";
import {
  ConfidenceBucket,
  PostpartumActionPlan,
  PostpartumInput,
  PostpartumResult,
  PostpartumRules,
  PostpartumTriageLevel,
} from "./types";

const EMERGENCY: PostpartumTriageLevel = "EMERGENCY_NOW";
const URGENT: PostpartumTriageLevel = "URGENT_SAME_DAY";
const ROUTINE: PostpartumTriageLevel = "ROUTINE_FOLLOW_UP";

export function loadPostpartumRulesFromFile(pathToRulesJson: string): PostpartumRules {
  const absolutePath = resolve(pathToRulesJson);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as PostpartumRules;
}

export function evaluatePostpartumTriage(
  input: PostpartumInput,
  rules: PostpartumRules
): PostpartumResult {
  const redFlags = evaluateRedFlags(input, rules);
  const fired = redFlags.filter((flag) => flag.fired);
  const confidence = buildConfidenceTrace(input, rules);

  if (fired.length > 0) {
    return {
      level: EMERGENCY,
      isEmergency: true,
      emergencyNumber: rules.metadata.emergencyNumber,
      rulesVersion: rules.version,
      rationale: [
        "At least one postpartum emergency red flag was triggered.",
        ...fired.map((flag) => `Triggered: ${flag.label}`),
      ],
      redFlags,
      scoreBreakdown: {
        mentalHealth: 0,
        pelvicFloorAndRecovery: 0,
        historyAndContext: 0,
        total: 0,
      },
      confidence,
      uncertainty: {
        triggered: false,
        reasons: [],
      },
      actionPlan: buildActionPlan(
        EMERGENCY,
        rules.metadata.emergencyNumber,
        "mixed"
      ),
    };
  }

  const scoreBreakdown = calculateScore(input, rules);
  const baseLevel =
    scoreBreakdown.total >= rules.thresholds.urgentSameDayMin ? URGENT : ROUTINE;
  const uncertainty = evaluateUncertainty(input, confidence, rules);
  const finalLevel = uncertainty.triggered ? escalateOneLevel(baseLevel) : baseLevel;

  const rationale = [
    `No postpartum emergency red flag triggered under rules ${rules.version}.`,
    `Risk score total: ${scoreBreakdown.total}.`,
    `Base triage level: ${baseLevel}.`,
    `Confidence: ${confidence.bucket}.`,
  ];

  if (uncertainty.triggered && finalLevel !== baseLevel) {
    rationale.push(
      `Escalated to ${finalLevel} due to uncertainty conditions: ${uncertainty.reasons.join(", ")}.`
    );
  }

  return {
    level: finalLevel,
    isEmergency: finalLevel === EMERGENCY,
    emergencyNumber: rules.metadata.emergencyNumber,
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
    actionPlan: buildActionPlan(
      finalLevel,
      rules.metadata.emergencyNumber,
      inferUrgentDomain(scoreBreakdown)
    ),
  };
}

function evaluateRedFlags(input: PostpartumInput, rules: PostpartumRules) {
  const firedMap: Record<string, boolean> = {
    PP_RF001: Boolean(input.suicidalIdeationNow && input.suicidalIntentOrPlan),
    PP_RF002: Boolean(input.thoughtsOfHarmingBaby),
    PP_RF003: Boolean(input.psychosisWarningSigns),
    PP_RF004: Boolean(input.heavyBleedingEmergencyPattern),
    PP_RF005: Boolean(input.highFeverAndSeverePain),
    PP_RF006: Boolean(input.syncopeOrCollapse || input.chestPainOrSevereBreathlessness),
  };

  return rules.redFlagRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    fired: Boolean(firedMap[rule.id]),
  }));
}

function calculateScore(input: PostpartumInput, rules: PostpartumRules) {
  const w = rules.scoring;

  let mentalHealth = 0;
  if (input.depressedMoodMostDays) mentalHealth += w.mentalHealth.depressedMoodMostDays;
  if (input.anxietyOrPanicMostDays) mentalHealth += w.mentalHealth.anxietyOrPanicMostDays;
  if (input.sleepSeverelyDisruptedNotByBaby) {
    mentalHealth += w.mentalHealth.sleepSeverelyDisruptedNotByBaby;
  }
  if (input.bondingDifficulty) mentalHealth += w.mentalHealth.bondingDifficulty;
  if (input.anhedonia) mentalHealth += w.mentalHealth.anhedonia;
  if (input.functionalImpairmentMental) {
    mentalHealth += w.mentalHealth.functionalImpairmentMental;
  }
  if (
    isLateOnset(input) &&
    (input.depressedMoodMostDays || input.anxietyOrPanicMostDays || input.anhedonia)
  ) {
    mentalHealth += w.mentalHealth.lateOnsetAfter6Weeks;
  }

  let pelvicFloorAndRecovery = 0;
  if (input.urinaryIncontinenceFrequent) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.urinaryIncontinenceFrequent;
  }
  if (input.fecalIncontinenceAny) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.fecalIncontinenceAny;
  }
  if (input.urinaryRetention) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.urinaryRetention;
  }
  if (input.severePerinealPainPersistent) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.severePerinealPainPersistent;
  }
  if (input.perinealWoundConcerns) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.perinealWoundConcerns;
  }
  if (input.prolapseBulgeSymptoms) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.prolapseBulgeSymptoms;
  }
  if (input.dyspareuniaPersistentSevere) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.dyspareuniaPersistentSevere;
  }
  if (input.functionalImpairmentPelvic) {
    pelvicFloorAndRecovery += w.pelvicFloorAndRecovery.functionalImpairmentPelvic;
  }

  let historyAndContext = 0;
  if (input.priorDepressionOrAnxiety) {
    historyAndContext += w.historyAndContext.priorDepressionOrAnxiety;
  }
  if (input.priorPostpartumDepression) {
    historyAndContext += w.historyAndContext.priorPostpartumDepression;
  }
  if (input.birthTraumaOrEmergencyDelivery) {
    historyAndContext += w.historyAndContext.birthTraumaOrEmergencyDelivery;
  }
  if (input.oasisHistory) {
    historyAndContext += w.historyAndContext.oasisHistory;
  }
  if (input.poorSocialSupport) {
    historyAndContext += w.historyAndContext.poorSocialSupport;
  }

  return {
    mentalHealth,
    pelvicFloorAndRecovery,
    historyAndContext,
    total: mentalHealth + pelvicFloorAndRecovery + historyAndContext,
  };
}

function buildConfidenceTrace(input: PostpartumInput, rules: PostpartumRules) {
  const criticalInputsStatus: Record<string, boolean> = {};
  for (const key of rules.confidencePolicy.criticalInputs) {
    criticalInputsStatus[key] = isCriticalInputPresent(key, input);
  }

  const missingCriticalInputs = Object.values(criticalInputsStatus).filter((v) => !v).length;
  const inconsistencyLevel = input.inconsistencyLevel ?? "NONE";
  const userUncertainOnSafetyQuestions = Boolean(input.userUncertainOnSafetyQuestions);

  let bucket: ConfidenceBucket = "HIGH";
  if (missingCriticalInputs >= 2 || inconsistencyLevel === "MAJOR" || userUncertainOnSafetyQuestions) {
    bucket = "LOW";
  } else if (missingCriticalInputs === 1 || inconsistencyLevel === "MINOR") {
    bucket = "MEDIUM";
  }

  return {
    bucket,
    missingCriticalInputs,
    criticalInputsStatus,
    inconsistencyLevel,
    userUncertainOnSafetyQuestions,
  };
}

function evaluateUncertainty(
  input: PostpartumInput,
  confidence: { bucket: ConfidenceBucket; missingCriticalInputs: number; inconsistencyLevel: string },
  _rules: PostpartumRules
) {
  const reasons: string[] = [];

  if (input.cannotAnswerCriticalQuestions) reasons.push("cannotAnswerCriticalQuestions");
  if (confidence.missingCriticalInputs > 2) reasons.push("missingMoreThanTwoCriticalInputs");
  if (confidence.inconsistencyLevel === "MAJOR") reasons.push("majorInconsistency");
  if (input.userUncertainOnSafetyQuestions) reasons.push("userUncertainOnSafetyQuestions");
  if (confidence.bucket === "LOW") reasons.push("lowConfidence");

  return {
    triggered: reasons.length > 0,
    reasons,
  };
}

function isLateOnset(input: PostpartumInput): boolean {
  return typeof input.weeksPostpartum === "number" && input.weeksPostpartum > 6;
}

function isCriticalInputPresent(key: string, input: PostpartumInput): boolean {
  if (key === "functionalImpairmentOverall") {
    return (
      input.functionalImpairmentMental !== undefined ||
      input.functionalImpairmentPelvic !== undefined
    );
  }

  const value = (input as Record<string, unknown>)[key];
  return value !== undefined;
}

function escalateOneLevel(level: PostpartumTriageLevel): PostpartumTriageLevel {
  if (level === ROUTINE) return URGENT;
  if (level === URGENT) return EMERGENCY;
  return EMERGENCY;
}

function inferUrgentDomain(score: {
  mentalHealth: number;
  pelvicFloorAndRecovery: number;
}): "mental" | "pelvic" | "mixed" {
  if (score.mentalHealth >= score.pelvicFloorAndRecovery + 2) return "mental";
  if (score.pelvicFloorAndRecovery >= score.mentalHealth + 2) return "pelvic";
  return "mixed";
}

function buildActionPlan(
  level: PostpartumTriageLevel,
  emergencyNumber: string,
  domain: "mental" | "pelvic" | "mixed"
): PostpartumActionPlan {
  const copy = buildPostpartumEnglishCopyPack(emergencyNumber);

  if (level === EMERGENCY) {
    const route = "CALL_EMERGENCY_112";
    return {
      level,
      title: copy.routeCopy[route].title,
      summary: copy.routeCopy[route].summary,
      primaryRoute: route,
      timeframe: "NOW",
      recommendedContacts: copy.routeCopy[route].recommendedContacts,
      instructions: copy.routeCopy[route].instructions,
      safetyNet: copy.commonSafetyNet,
    };
  }

  if (level === URGENT) {
    if (domain === "mental") {
      const route = "SAME_DAY_MENTAL_HEALTH_ASSESSMENT";
      return {
        level,
        title: copy.routeCopy[route].title,
        summary: copy.routeCopy[route].summary,
        primaryRoute: route,
        timeframe: "TODAY",
        recommendedContacts: copy.routeCopy[route].recommendedContacts,
        instructions: copy.routeCopy[route].instructions,
        safetyNet: copy.commonSafetyNet,
      };
    }

    if (domain === "pelvic") {
      const route = "SAME_DAY_OBGYN_OR_HAUSARZT";
      return {
        level,
        title: copy.routeCopy[route].title,
        summary: copy.routeCopy[route].summary,
        primaryRoute: route,
        timeframe: "TODAY",
        recommendedContacts: copy.routeCopy[route].recommendedContacts,
        instructions: copy.routeCopy[route].instructions,
        safetyNet: copy.commonSafetyNet,
      };
    }

    const route = "SAME_DAY_MIXED_MENTAL_AND_OBGYN";
    return {
      level,
      title: copy.routeCopy[route].title,
      summary: copy.routeCopy[route].summary,
      primaryRoute: route,
      timeframe: "TODAY",
      recommendedContacts: copy.routeCopy[route].recommendedContacts,
      instructions: copy.routeCopy[route].instructions,
      safetyNet: copy.commonSafetyNet,
    };
  }

  const route = "ROUTINE_POSTPARTUM_FOLLOWUP";
  return {
    level,
    title: copy.routeCopy[route].title,
    summary: copy.routeCopy[route].summary,
    primaryRoute: route,
    timeframe: "WITHIN_7_DAYS",
    recommendedContacts: copy.routeCopy[route].recommendedContacts,
    instructions: copy.routeCopy[route].instructions,
    safetyNet: copy.commonSafetyNet,
  };
}
