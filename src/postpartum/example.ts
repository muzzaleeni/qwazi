import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "./evaluator";
import { PostpartumInput } from "./types";

const rules = loadPostpartumRulesFromFile("src/config/rules.postpartum.de.v1.json");

const sampleInput: PostpartumInput = {
  weeksPostpartum: 10,
  suicidalIdeationNow: false,
  suicidalIntentOrPlan: false,
  thoughtsOfHarmingBaby: false,
  psychosisWarningSigns: false,
  heavyBleedingEmergencyPattern: false,
  highFeverAndSeverePain: false,
  syncopeOrCollapse: false,
  chestPainOrSevereBreathlessness: false,

  depressedMoodMostDays: true,
  anxietyOrPanicMostDays: true,
  sleepSeverelyDisruptedNotByBaby: true,
  bondingDifficulty: true,
  anhedonia: true,
  functionalImpairmentMental: true,

  urinaryIncontinenceFrequent: true,
  fecalIncontinenceAny: false,
  urinaryRetention: false,
  severePerinealPainPersistent: true,
  perinealWoundConcerns: false,
  prolapseBulgeSymptoms: false,
  dyspareuniaPersistentSevere: false,
  functionalImpairmentPelvic: false,

  priorDepressionOrAnxiety: true,
  priorPostpartumDepression: false,
  birthTraumaOrEmergencyDelivery: true,
  oasisHistory: false,
  poorSocialSupport: true,

  userUncertainOnSafetyQuestions: false,
  inconsistencyLevel: "NONE",
};

const result = evaluatePostpartumTriage(sampleInput, rules);
console.log(JSON.stringify(result, null, 2));
