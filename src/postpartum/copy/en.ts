import { PostpartumActionPlan } from "../types";

type Route = PostpartumActionPlan["primaryRoute"];

interface RouteCopy {
  title: string;
  summary: string;
  recommendedContacts: string[];
  instructions: string[];
}

export interface PostpartumEnglishCopyPack {
  commonSafetyNet: string[];
  routeCopy: Record<Route, RouteCopy>;
}

export function buildPostpartumEnglishCopyPack(
  emergencyNumber: string
): PostpartumEnglishCopyPack {
  const commonSafetyNet = [
    `Call ${emergencyNumber} immediately if suicidal thoughts with intent, thoughts of harming the baby, psychosis signs, heavy bleeding, collapse, or severe breathing/chest symptoms occur.`,
    "Do not wait for a scheduled appointment if symptoms rapidly worsen.",
  ];

  return {
    commonSafetyNet,
    routeCopy: {
      CALL_EMERGENCY_112: {
        title: "Emergency care needed now",
        summary: `Your answers indicate a high-risk postpartum emergency. Call ${emergencyNumber} now.`,
        recommendedContacts: [emergencyNumber, "nearest emergency department"],
        instructions: [
          `Call ${emergencyNumber} now.`,
          "Stay with a trusted adult if possible until emergency care is reached.",
          "If safe, bring medication list and postpartum timeline.",
        ],
      },
      SAME_DAY_MENTAL_HEALTH_ASSESSMENT: {
        title: "Same-day mental health assessment",
        summary:
          "Your answers suggest urgent postpartum mental health risk that needs same-day clinical assessment.",
        recommendedContacts: [
          "same-day psychiatric assessment service",
          "Hausarzt (same day)",
          "midwife/Hebamme for immediate escalation support",
        ],
        instructions: [
          "Arrange a same-day mental health assessment.",
          "If same-day psychiatry is unavailable, seek same-day Hausarzt/OB-GYN review.",
          "Do not remain alone if safety feels uncertain.",
        ],
      },
      SAME_DAY_OBGYN_OR_HAUSARZT: {
        title: "Same-day postpartum physical assessment",
        summary:
          "Your answers suggest urgent postpartum recovery or pelvic-floor symptoms requiring same-day review.",
        recommendedContacts: [
          "OB-GYN (same day)",
          "Hausarzt (same day)",
          "postpartum hospital clinic/ambulatory gyn service",
        ],
        instructions: [
          "Arrange same-day OB-GYN or Hausarzt assessment.",
          "Bring details of delivery type, tear history, and symptom timeline.",
          "Request pelvic floor and wound-focused evaluation if relevant.",
        ],
      },
      SAME_DAY_MIXED_MENTAL_AND_OBGYN: {
        title: "Same-day combined postpartum assessment",
        summary:
          "Your answers suggest urgent concerns across both mental and physical postpartum recovery.",
        recommendedContacts: [
          "same-day Hausarzt or OB-GYN",
          "same-day mental health assessment service",
          "midwife/Hebamme for routing support",
        ],
        instructions: [
          "Arrange same-day assessment covering both mental health and physical postpartum recovery.",
          "Prioritize whichever appointment is available first today.",
          "If safety risk increases, escalate to emergency immediately.",
        ],
      },
      ROUTINE_POSTPARTUM_FOLLOWUP: {
        title: "Routine postpartum follow-up",
        summary:
          "Current responses do not indicate emergency-level risk, but follow-up is still recommended.",
        recommendedContacts: [
          "scheduled OB-GYN follow-up",
          "Hausarzt follow-up",
          "midwife/Hebamme check-in if available",
        ],
        instructions: [
          "Book a routine follow-up within 7 days.",
          "Track symptom frequency and functional impact daily.",
          "Re-run triage immediately if symptoms worsen or new red flags appear.",
        ],
      },
    },
  };
}
