import { evaluateTriage, loadRulesFromFile } from "./evaluator";
import { TriageInput } from "./types";

const rules = loadRulesFromFile("src/config/rules.v1.json");

const sampleInput: TriageInput = {
  ageBand: "55-64",
  chestDiscomfortSeverity: "MODERATE",
  chestDiscomfortDurationMinutes: 12,
  shortnessOfBreath: true,
  shortnessOfBreathAtRest: false,
  jawNeckBackShoulderArmDiscomfort: true,
  nauseaOrVomiting: false,
  coldSweat: true,
  lightheadedOrNearSyncope: false,
  syncope: false,
  palpitations: false,
  unusualSevereFatigue: true,
  neurologicSymptoms: false,
  progression: "WORSENING",
  symptomDurationMinutes: 30,
  onsetMinutesAgo: 40,
  rapidlyWorseningDuringSession: false,
  symptomsFeelLifeThreateningNow: false,

  priorCardiovascularDisease: false,
  hypertension: true,
  diabetes: true,
  highCholesterol: true,
  currentOrRecentSmoking: false,
  familyHistoryPrematureCVD: true,

  pregnancyHypertensiveDisorderOrGDMHistory: true,
  earlyMenopauseBefore45: false,
  autoimmuneDisease: false,
  migraineWithAura: false,

  cannotCharacterizeSeverityOrDuration: false,
  inconsistencyLevel: "NONE",
  userUncertainOnKeyItems: false,
};

const result = evaluateTriage(sampleInput, rules);

console.log(JSON.stringify(result, null, 2));
