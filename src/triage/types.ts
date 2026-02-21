export type TriageLevel = "EMERGENCY_NOW" | "URGENT_SAME_DAY" | "BOOK_WITHIN_72H";
export type ConfidenceBucket = "HIGH" | "MEDIUM" | "LOW";
export type AgeBand = "18-39" | "40-54" | "55-64" | "65+";
export type Progression = "STABLE" | "WORSENING" | "IMPROVING" | "INTERMITTENT";
export type InconsistencyLevel = "NONE" | "MINOR" | "MAJOR";
export type ChestSeverity = "NONE" | "MILD" | "MODERATE" | "SEVERE";

export interface ScoringWeights {
  symptoms: {
    chestDiscomfortNonSevere: number;
    shortnessOfBreathNonSevere: number;
    referredDiscomfortJawNeckBackShoulderArm: number;
    nauseaOrVomiting: number;
    coldSweat: number;
    lightheadedOrNearSyncope: number;
    palpitations: number;
    unusualSevereFatigue: number;
    worseningPatternRecent: number;
    episodeDurationAtLeast20Min: number;
  };
  history: {
    priorCardiovascularDisease: number;
    hypertension: number;
    diabetes: number;
    highCholesterol: number;
    currentOrRecentSmoking: number;
    familyHistoryPrematureCVD: number;
  };
  womenSpecific: {
    pregnancyHypertensiveDisorderOrGDMHistory: number;
    earlyMenopauseBefore45: number;
    autoimmuneDisease: number;
    migraineWithAura: number;
  };
  ageBand: Record<AgeBand, number>;
}

export interface TriageRules {
  version: string;
  redFlagRules: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  scoring: ScoringWeights;
  thresholds: {
    urgentSameDayMin: number;
  };
}

export interface TriageInput {
  ageBand: AgeBand;
  chestDiscomfortSeverity?: ChestSeverity;
  chestDiscomfortDurationMinutes?: number;
  shortnessOfBreath?: boolean;
  shortnessOfBreathAtRest?: boolean;
  jawNeckBackShoulderArmDiscomfort?: boolean;
  nauseaOrVomiting?: boolean;
  coldSweat?: boolean;
  lightheadedOrNearSyncope?: boolean;
  syncope?: boolean;
  palpitations?: boolean;
  unusualSevereFatigue?: boolean;
  neurologicSymptoms?: boolean;
  progression?: Progression;
  symptomDurationMinutes?: number;
  onsetMinutesAgo?: number;
  rapidlyWorseningDuringSession?: boolean;
  symptomsFeelLifeThreateningNow?: boolean;

  priorCardiovascularDisease?: boolean;
  hypertension?: boolean;
  diabetes?: boolean;
  highCholesterol?: boolean;
  currentOrRecentSmoking?: boolean;
  familyHistoryPrematureCVD?: boolean;

  pregnancyHypertensiveDisorderOrGDMHistory?: boolean;
  earlyMenopauseBefore45?: boolean;
  autoimmuneDisease?: boolean;
  migraineWithAura?: boolean;

  cannotCharacterizeSeverityOrDuration?: boolean;
  inconsistencyLevel?: InconsistencyLevel;
  userUncertainOnKeyItems?: boolean;
}

export interface RedFlagTrace {
  id: string;
  label: string;
  fired: boolean;
}

export interface ScoreBreakdown {
  symptoms: number;
  history: number;
  womenSpecific: number;
  age: number;
  total: number;
}

export interface ConfidenceTrace {
  bucket: ConfidenceBucket;
  missingCriticalInputs: number;
  criticalInputsStatus: Record<string, boolean>;
  inconsistencyLevel: InconsistencyLevel;
  userUncertainOnKeyItems: boolean;
}

export interface UncertaintyTrace {
  triggered: boolean;
  reasons: string[];
  escalatedFrom?: TriageLevel;
  escalatedTo?: TriageLevel;
}

export interface TriageResult {
  level: TriageLevel;
  isEmergency: boolean;
  rulesVersion: string;
  rationale: string[];
  redFlags: RedFlagTrace[];
  scoreBreakdown: ScoreBreakdown;
  confidence: ConfidenceTrace;
  uncertainty: UncertaintyTrace;
}
