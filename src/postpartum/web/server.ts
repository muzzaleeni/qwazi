import { readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import {
  appendAuditEventJsonl,
  createPostpartumAuditEvent,
  readAuditEventsJsonl,
  updateAuditEventOutcome,
  updateAuditEventWorkflow,
} from "../audit";
import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "../evaluator";
import { PostpartumInput } from "../types";

const PORT = Number(process.env.PORT ?? 4173);
const STATIC_DIR = resolve(__dirname, "static");
const RULES_PATH = resolve(process.cwd(), "src/config/rules.postpartum.de.v1.json");
const DEFAULT_AUDIT_LOG = resolve(process.cwd(), "logs/postpartum-web.jsonl");
const DEFAULT_HISTORY_LOG = resolve(process.cwd(), "logs/postpartum-history.jsonl");

const rules = loadPostpartumRulesFromFile(RULES_PATH);

function main() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          service: "postpartum-web",
          rulesVersion: rules.version,
          market: "DE",
          locale: "en",
        });
      }

      if (req.method === "GET" && url.pathname === "/api/postpartum/rules") {
        return json(res, 200, {
          rulesVersion: rules.version,
          emergencyNumber: rules.metadata.emergencyNumber,
          market: "DE",
          locale: "en",
        });
      }

      if (req.method === "GET" && url.pathname === "/api/postpartum/audit/recent") {
        const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
        const events = readAuditEventsJsonl(DEFAULT_HISTORY_LOG, limit);
        return json(res, 200, {
          events,
          count: events.length,
          limit,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/audit/outcome") {
        const payload = await readJson(req);
        return handleOutcomeUpdate(payload, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/audit/workflow") {
        const payload = await readJson(req);
        return handleWorkflowUpdate(payload, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/evaluate") {
        const payload = await readJson(req);
        return handleEvaluate(payload, res);
      }

      if (req.method === "GET") {
        return serveStatic(url.pathname, res);
      }

      return json(res, 404, { error: "Not found" });
    } catch (error) {
      return json(res, 500, {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  server.listen(PORT, () => {
    process.stdout.write(
      `Postpartum web UI running at http://localhost:${PORT} (DE workflow, EN locale)\n`
    );
  });
}

async function handleEvaluate(payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const input = extractInput(payload);
  const result = evaluatePostpartumTriage(input, rules);

  const historyEvent = createPostpartumAuditEvent(input, result, {
    source: "postpartum-web-ui",
  });
  appendAuditEventJsonl(DEFAULT_HISTORY_LOG, historyEvent);

  const audit = isRecord(payload.audit) ? payload.audit : undefined;
  const auditEnabled = Boolean(audit?.enabled);
  if (auditEnabled) {
    const includeInput = Boolean(audit?.includeInput);
    const source = typeof audit?.source === "string" ? audit.source : "postpartum-web-ui";
    const runId = typeof audit?.runId === "string" ? audit.runId : undefined;
    const logPath =
      typeof audit?.logPath === "string" && audit.logPath.length > 0
        ? resolve(audit.logPath)
        : DEFAULT_AUDIT_LOG;

    const event = createPostpartumAuditEvent(input, result, {
      includeInput,
      source,
      runId,
    });
    appendAuditEventJsonl(logPath, event);
  }

  return json(res, 200, { result });
}

async function handleOutcomeUpdate(payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  if (eventId.length === 0) {
    return json(res, 400, { error: "eventId is required." });
  }

  const outcomeRaw = isRecord(payload.outcome) ? payload.outcome : {};
  const outcomePatch = normalizeOutcomePatch(outcomeRaw);
  const updated = updateAuditEventOutcome(DEFAULT_HISTORY_LOG, eventId, outcomePatch);

  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  return json(res, 200, { event: updated });
}

async function handleWorkflowUpdate(payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  if (eventId.length === 0) {
    return json(res, 400, { error: "eventId is required." });
  }

  const workflowRaw = isRecord(payload.workflow) ? payload.workflow : {};
  const workflowPatch = normalizeWorkflowPatch(workflowRaw);
  const updated = updateAuditEventWorkflow(DEFAULT_HISTORY_LOG, eventId, workflowPatch);

  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  return json(res, 200, { event: updated });
}

function extractInput(payload: Record<string, unknown>): PostpartumInput {
  if (isRecord(payload.input)) return payload.input as unknown as PostpartumInput;
  return payload as unknown as PostpartumInput;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function serveStatic(pathname: string, res: ServerResponse) {
  const safePath = normalizeStaticPath(pathname);
  const filePath = join(STATIC_DIR, safePath);
  const contentType = contentTypeForExt(extname(filePath));

  try {
    const file = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

function normalizeStaticPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return "index.html";
  const stripped = pathname.replace(/^\/+/, "");
  if (stripped.includes("..")) return "index.html";
  return stripped;
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function json(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeOutcomePatch(outcome: Record<string, unknown>): {
  care_sought?: boolean;
  care_time?: number;
  care_type?: string;
  resolved?: boolean;
  notes?: string;
} {
  const careSought = parseOptionalBoolean(outcome.care_sought);
  const resolved = parseOptionalBoolean(outcome.resolved);
  const careTime = parseOptionalNumber(outcome.care_time);
  const careType =
    typeof outcome.care_type === "string" ? outcome.care_type.trim() : undefined;
  const notes = typeof outcome.notes === "string" ? outcome.notes.trim() : undefined;
  const patch: {
    care_sought?: boolean;
    care_time?: number;
    care_type?: string;
    resolved?: boolean;
    notes?: string;
  } = {};
  if (careSought !== undefined) patch.care_sought = careSought;
  if (careTime !== undefined) patch.care_time = careTime;
  if (careType && careType.length > 0) patch.care_type = careType;
  if (resolved !== undefined) patch.resolved = resolved;
  if (notes && notes.length > 0) patch.notes = notes;
  return patch;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeWorkflowPatch(workflow: Record<string, unknown>): {
  status?: "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";
  owner?: string;
  follow_up_due_at?: string;
  last_contact_at?: string;
} {
  const status = parseStatus(workflow.status);
  const owner = parseOptionalString(workflow.owner);
  const followUpDueAt = parseOptionalIsoDate(workflow.follow_up_due_at);
  const lastContactAt = parseOptionalIsoDate(workflow.last_contact_at);

  const patch: {
    status?: "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";
    owner?: string;
    follow_up_due_at?: string;
    last_contact_at?: string;
  } = {};
  if (status) patch.status = status;
  if (Object.prototype.hasOwnProperty.call(workflow, "owner")) patch.owner = owner;
  if (Object.prototype.hasOwnProperty.call(workflow, "follow_up_due_at")) {
    patch.follow_up_due_at = followUpDueAt;
  }
  if (Object.prototype.hasOwnProperty.call(workflow, "last_contact_at")) {
    patch.last_contact_at = lastContactAt;
  }
  return patch;
}

function parseStatus(value: unknown):
  | "NEW"
  | "IN_PROGRESS"
  | "WAITING"
  | "CLOSED"
  | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toUpperCase();
  if (raw === "NEW") return "NEW";
  if (raw === "IN_PROGRESS") return "IN_PROGRESS";
  if (raw === "WAITING") return "WAITING";
  if (raw === "CLOSED") return "CLOSED";
  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalIsoDate(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

main();
