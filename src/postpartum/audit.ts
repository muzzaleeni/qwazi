import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  outcome?: PostpartumAuditOutcome;
  workflow: PostpartumCaseWorkflow;
}

export interface PostpartumAuditOutcome {
  care_sought?: boolean;
  care_time?: number;
  care_type?: string;
  resolved?: boolean;
  notes?: string;
  updated_at: string;
}

export type PostpartumCaseStatus = "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";

export interface PostpartumCaseWorkflow {
  status: PostpartumCaseStatus;
  owner?: string;
  follow_up_due_at?: string;
  last_contact_at?: string;
  updated_at: string;
}

export function createPostpartumAuditEvent(
  input: PostpartumInput,
  result: PostpartumResult,
  options: PostpartumAuditOptions = {}
): PostpartumAuditEvent {
  const now = new Date().toISOString();
  const firedRedFlagIds = result.redFlags.filter((flag) => flag.fired).map((flag) => flag.id);
  const baseLevel = result.uncertainty.escalatedFrom ?? result.level;
  const inputJson = JSON.stringify(input);
  const inputDigestSha256 = createHash("sha256").update(inputJson).digest("hex");

  const event: PostpartumAuditEvent = {
    eventId: randomUUID(),
    timestamp: now,
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
    workflow: {
      status: "NEW",
      updated_at: now,
    },
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
  const parsed = readAllAuditEventsJsonl(pathToJsonl);
  const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  return parsed.slice(-boundedLimit).reverse();
}

export function readAllAuditEventsJsonl(pathToJsonl: string): PostpartumAuditEvent[] {
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
    .filter((item): item is PostpartumAuditEvent => item !== null)
    .map((event) => normalizeWorkflow(event));
  return parsed;
}

export function updateAuditEventOutcome(
  pathToJsonl: string,
  eventId: string,
  outcomePatch: Partial<Omit<PostpartumAuditOutcome, "updated_at">>
): PostpartumAuditEvent | null {
  const absolutePath = resolve(pathToJsonl);
  const events = readAllAuditEventsJsonl(absolutePath);
  if (events.length === 0) return null;

  let updated: PostpartumAuditEvent | null = null;
  const next = events.map((event) => {
    if (event.eventId !== eventId) return event;
    const outcome: PostpartumAuditOutcome = {
      ...event.outcome,
      ...outcomePatch,
      updated_at: new Date().toISOString(),
    };
    updated = normalizeWorkflow({ ...event, outcome });
    return updated;
  });

  if (!updated) return null;

  mkdirSync(dirname(absolutePath), { recursive: true });
  const body = `${next.map((item) => JSON.stringify(item)).join("\n")}\n`;
  writeFileSync(absolutePath, body, "utf8");
  return updated;
}

export function updateAuditEventWorkflow(
  pathToJsonl: string,
  eventId: string,
  workflowPatch: Partial<Omit<PostpartumCaseWorkflow, "updated_at">>
): PostpartumAuditEvent | null {
  const absolutePath = resolve(pathToJsonl);
  const events = readAllAuditEventsJsonl(absolutePath);
  if (events.length === 0) return null;

  let updated: PostpartumAuditEvent | null = null;
  const next = events.map((event) => {
    if (event.eventId !== eventId) return event;
    const workflow: PostpartumCaseWorkflow = {
      ...event.workflow,
      ...workflowPatch,
      updated_at: new Date().toISOString(),
    };
    updated = normalizeWorkflow({ ...event, workflow });
    return updated;
  });

  if (!updated) return null;

  mkdirSync(dirname(absolutePath), { recursive: true });
  const body = `${next.map((item) => JSON.stringify(item)).join("\n")}\n`;
  writeFileSync(absolutePath, body, "utf8");
  return updated;
}

function normalizeWorkflow(event: PostpartumAuditEvent): PostpartumAuditEvent {
  if (event.workflow) return event;
  return {
    ...event,
    workflow: {
      status: event.outcome?.resolved === true ? "CLOSED" : "NEW",
      updated_at: event.timestamp,
    },
  };
}
