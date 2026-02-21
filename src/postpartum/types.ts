export type PostpartumTriageLevel =
  | "EMERGENCY_NOW"
  | "URGENT_SAME_DAY"
  | "ROUTINE_FOLLOW_UP";

export type ConfidenceBucket = "HIGH" | "MEDIUM" | "LOW";
export type InconsistencyLevel = "NONE" | "MINOR" | "MAJOR";

export interface PostpartumRules {
  version: string;
  metadata: {
    emergencyNumber: string;
  };
  redFlagRules: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  scoring: {
    mentalHealth: {
      depressedMoodMostDays: number;
      anxietyOrPanicMostDays: number;
      sleepSeverelyDisruptedNotByBaby: number;
      bondingDifficulty: number;
      anhedonia: number;
      functionalImpairmentMental: number;
      lateOnsetAfter6Weeks: number;
    };
    pelvicFloorAndRecovery: {
      urinaryIncontinenceFrequent: number;
      fecalIncontinenceAny: number;
      urinaryRetention: number;
      severePerinealPainPersistent: number;
      perinealWoundConcerns: number;
      prolapseBulgeSymptoms: number;
      dyspareuniaPersistentSevere: number;
      functionalImpairmentPelvic: number;
    };
    historyAndContext: {
      priorDepressionOrAnxiety: number;
      priorPostpartumDepression: number;
      birthTraumaOrEmergencyDelivery: number;
      oasisHistory: number;
      poorSocialSupport: number;
    };
  };
  thresholds: {
    urgentSameDayMin: number;
  };
  confidencePolicy: {
    criticalInputs: string[];
  };
}

export interface PostpartumInput {
  weeksPostpartum?: number;

  suicidalIdeationNow?: boolean;
  suicidalIntentOrPlan?: boolean;
  thoughtsOfHarmingBaby?: boolean;
  psychosisWarningSigns?: boolean;

  heavyBleedingEmergencyPattern?: boolean;
  highFeverAndSeverePain?: boolean;
  syncopeOrCollapse?: boolean;
  chestPainOrSevereBreathlessness?: boolean;

  depressedMoodMostDays?: boolean;
  anxietyOrPanicMostDays?: boolean;
  sleepSeverelyDisruptedNotByBaby?: boolean;
  bondingDifficulty?: boolean;
  anhedonia?: boolean;
  functionalImpairmentMental?: boolean;

  urinaryIncontinenceFrequent?: boolean;
  fecalIncontinenceAny?: boolean;
  urinaryRetention?: boolean;
  severePerinealPainPersistent?: boolean;
  perinealWoundConcerns?: boolean;
  prolapseBulgeSymptoms?: boolean;
  dyspareuniaPersistentSevere?: boolean;
  functionalImpairmentPelvic?: boolean;

  priorDepressionOrAnxiety?: boolean;
  priorPostpartumDepression?: boolean;
  birthTraumaOrEmergencyDelivery?: boolean;
  oasisHistory?: boolean;
  poorSocialSupport?: boolean;

  cannotAnswerCriticalQuestions?: boolean;
  userUncertainOnSafetyQuestions?: boolean;
  inconsistencyLevel?: InconsistencyLevel;
}

export interface PostpartumRedFlagTrace {
  id: string;
  label: string;
  fired: boolean;
}

export interface PostpartumScoreBreakdown {
  mentalHealth: number;
  pelvicFloorAndRecovery: number;
  historyAndContext: number;
  total: number;
}

export interface PostpartumConfidenceTrace {
  bucket: ConfidenceBucket;
  missingCriticalInputs: number;
  criticalInputsStatus: Record<string, boolean>;
  inconsistencyLevel: InconsistencyLevel;
  userUncertainOnSafetyQuestions: boolean;
}

export interface PostpartumUncertaintyTrace {
  triggered: boolean;
  reasons: string[];
  escalatedFrom?: PostpartumTriageLevel;
  escalatedTo?: PostpartumTriageLevel;
}

export interface PostpartumActionPlan {
  level: PostpartumTriageLevel;
  primaryRoute:
    | "CALL_EMERGENCY_112"
    | "SAME_DAY_MENTAL_HEALTH_ASSESSMENT"
    | "SAME_DAY_OBGYN_OR_HAUSARZT"
    | "SAME_DAY_MIXED_MENTAL_AND_OBGYN"
    | "ROUTINE_POSTPARTUM_FOLLOWUP";
  timeframe: "NOW" | "TODAY" | "WITHIN_7_DAYS";
  recommendedContacts: string[];
  instructions: string[];
  safetyNet: string[];
}

export interface PostpartumResult {
  level: PostpartumTriageLevel;
  isEmergency: boolean;
  emergencyNumber: string;
  rulesVersion: string;
  rationale: string[];
  redFlags: PostpartumRedFlagTrace[];
  scoreBreakdown: PostpartumScoreBreakdown;
  confidence: PostpartumConfidenceTrace;
  uncertainty: PostpartumUncertaintyTrace;
  actionPlan: PostpartumActionPlan;
}
