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
  last_updated_by?: string;
  last_updated_at?: string;
}

export interface PostpartumAuditOutcome {
  care_sought?: boolean;
  care_time?: number;
  care_type?: string;
  resolved?: boolean;
  notes?: string;
  updated_at: string;
  updated_by?: string;
}

export type PostpartumCaseStatus = "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";

export interface PostpartumCaseWorkflow {
  status: PostpartumCaseStatus;
  owner?: string;
  follow_up_due_at?: string;
  last_contact_at?: string;
  updated_at: string;
  updated_by?: string;
}

export interface PostpartumAuditUpdateResult {
  before: PostpartumAuditEvent;
  after: PostpartumAuditEvent;
}

export type PostpartumAuditChangeType = "OUTCOME_UPDATE" | "WORKFLOW_UPDATE";

export interface PostpartumAuditChangeEvent {
  changeId: string;
  eventId: string;
  timestamp: string;
  editor: string;
  changeType: PostpartumAuditChangeType;
  patch: Record<string, unknown>;
  before: {
    outcome?: PostpartumAuditOutcome;
    workflow: PostpartumCaseWorkflow;
    last_updated_by?: string;
    last_updated_at?: string;
  };
  after: {
    outcome?: PostpartumAuditOutcome;
    workflow: PostpartumCaseWorkflow;
    last_updated_by?: string;
    last_updated_at?: string;
  };
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

export function appendAuditChangeEventJsonl(
  pathToJsonl: string,
  event: PostpartumAuditChangeEvent
): void {
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
  outcomePatch: Partial<Omit<PostpartumAuditOutcome, "updated_at" | "updated_by">>,
  editor: string
): PostpartumAuditUpdateResult | null {
  const absolutePath = resolve(pathToJsonl);
  const events = readAllAuditEventsJsonl(absolutePath);
  if (events.length === 0) return null;

  let result: PostpartumAuditUpdateResult | null = null;
  const now = new Date().toISOString();
  const next = events.map((event) => {
    if (event.eventId !== eventId) return event;
    const before = normalizeWorkflow(event);
    const outcome: PostpartumAuditOutcome = {
      ...before.outcome,
      ...outcomePatch,
      updated_at: now,
      updated_by: editor,
    };
    const after = normalizeWorkflow({
      ...before,
      outcome,
      last_updated_by: editor,
      last_updated_at: now,
    });
    result = { before, after };
    return after;
  });

  if (!result) return null;

  mkdirSync(dirname(absolutePath), { recursive: true });
  const body = `${next.map((item) => JSON.stringify(item)).join("\n")}\n`;
  writeFileSync(absolutePath, body, "utf8");
  return result;
}

export function updateAuditEventWorkflow(
  pathToJsonl: string,
  eventId: string,
  workflowPatch: Partial<Omit<PostpartumCaseWorkflow, "updated_at" | "updated_by">>,
  editor: string
): PostpartumAuditUpdateResult | null {
  const absolutePath = resolve(pathToJsonl);
  const events = readAllAuditEventsJsonl(absolutePath);
  if (events.length === 0) return null;

  let result: PostpartumAuditUpdateResult | null = null;
  const now = new Date().toISOString();
  const next = events.map((event) => {
    if (event.eventId !== eventId) return event;
    const before = normalizeWorkflow(event);
    const workflow: PostpartumCaseWorkflow = {
      ...before.workflow,
      ...workflowPatch,
      updated_at: now,
      updated_by: editor,
    };
    const after = normalizeWorkflow({
      ...before,
      workflow,
      last_updated_by: editor,
      last_updated_at: now,
    });
    result = { before, after };
    return after;
  });

  if (!result) return null;

  mkdirSync(dirname(absolutePath), { recursive: true });
  const body = `${next.map((item) => JSON.stringify(item)).join("\n")}\n`;
  writeFileSync(absolutePath, body, "utf8");
  return result;
}

export function createAuditChangeEvent(
  changeType: PostpartumAuditChangeType,
  editor: string,
  patch: Record<string, unknown>,
  update: PostpartumAuditUpdateResult
): PostpartumAuditChangeEvent {
  return {
    changeId: randomUUID(),
    eventId: update.after.eventId,
    timestamp: new Date().toISOString(),
    editor,
    changeType,
    patch,
    before: {
      outcome: update.before.outcome,
      workflow: update.before.workflow,
      last_updated_by: update.before.last_updated_by,
      last_updated_at: update.before.last_updated_at,
    },
    after: {
      outcome: update.after.outcome,
      workflow: update.after.workflow,
      last_updated_by: update.after.last_updated_by,
      last_updated_at: update.after.last_updated_at,
    },
  };
}

function normalizeWorkflow(event: PostpartumAuditEvent): PostpartumAuditEvent {
  const normalizedOutcome = event.outcome
    ? {
        ...event.outcome,
        updated_by: event.outcome.updated_by ?? event.last_updated_by ?? "system",
      }
    : undefined;

  if (event.workflow) {
    return {
      ...event,
      outcome: normalizedOutcome,
      workflow: {
        ...event.workflow,
        updated_by: event.workflow.updated_by ?? event.last_updated_by ?? "system",
      },
    };
  }
  return {
    ...event,
    outcome: normalizedOutcome,
    workflow: {
      status: event.outcome?.resolved === true ? "CLOSED" : "NEW",
      updated_at: event.timestamp,
      updated_by: "system",
    },
  };
}
