import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PostpartumInput, PostpartumResult } from "./types";

export interface PostpartumAuditOptions {
  source?: string;
  runId?: string;
  includeInput?: boolean;
}

export interface PostpartumAuditEvent {
  eventId: string;
  timestamp: string;
  source: string;
  runId: string;
  rulesVersion: string;
  emergencyNumber: string;
  finalLevel: PostpartumResult["level"];
  baseLevel: PostpartumResult["level"];
  isEmergency: boolean;
  escalatedByUncertainty: boolean;
  primaryRoute: PostpartumResult["actionPlan"]["primaryRoute"];
  timeframe: PostpartumResult["actionPlan"]["timeframe"];
  scoreBreakdown: PostpartumResult["scoreBreakdown"];
  confidenceBucket: PostpartumResult["confidence"]["bucket"];
  missingCriticalInputs: number;
  firedRedFlagIds: string[];
  uncertaintyReasons: string[];
  inputDigestSha256: string;
  inputSnapshot?: PostpartumInput;
}

export function createPostpartumAuditEvent(
  input: PostpartumInput,
  result: PostpartumResult,
  options: PostpartumAuditOptions = {}
): PostpartumAuditEvent {
  const firedRedFlagIds = result.redFlags.filter((flag) => flag.fired).map((flag) => flag.id);
  const baseLevel = result.uncertainty.escalatedFrom ?? result.level;
  const inputJson = JSON.stringify(input);
  const inputDigestSha256 = createHash("sha256").update(inputJson).digest("hex");

  const event: PostpartumAuditEvent = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    source: options.source ?? "postpartum-cli",
    runId: options.runId ?? randomUUID(),
    rulesVersion: result.rulesVersion,
    emergencyNumber: result.emergencyNumber,
    finalLevel: result.level,
    baseLevel,
    isEmergency: result.isEmergency,
    escalatedByUncertainty: Boolean(result.uncertainty.triggered && result.uncertainty.escalatedFrom),
    primaryRoute: result.actionPlan.primaryRoute,
    timeframe: result.actionPlan.timeframe,
    scoreBreakdown: result.scoreBreakdown,
    confidenceBucket: result.confidence.bucket,
    missingCriticalInputs: result.confidence.missingCriticalInputs,
    firedRedFlagIds,
    uncertaintyReasons: result.uncertainty.reasons,
    inputDigestSha256,
  };

  if (options.includeInput) {
    event.inputSnapshot = input;
  }

  return event;
}

export function appendAuditEventJsonl(pathToJsonl: string, event: PostpartumAuditEvent): void {
  const absolutePath = resolve(pathToJsonl);
  mkdirSync(dirname(absolutePath), { recursive: true });
  appendFileSync(absolutePath, `${JSON.stringify(event)}\n`, "utf8");
}
