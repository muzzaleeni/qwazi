import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

export function readAuditEventsJsonl(pathToJsonl: string, limit = 50): PostpartumAuditEvent[] {
  const absolutePath = resolve(pathToJsonl);
  if (!existsSync(absolutePath)) return [];

  const raw = readFileSync(absolutePath, "utf8");
  if (!raw.trim()) return [];

  const parsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as PostpartumAuditEvent;
      } catch {
        return null;
      }
    })
    .filter((item): item is PostpartumAuditEvent => item !== null);

  const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  return parsed.slice(-boundedLimit).reverse();
}
