import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import {
  appendAuditChangeEventJsonl,
  appendAuditEventJsonl,
  createAuditChangeEvent,
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
const DEFAULT_CHANGE_LOG = resolve(process.cwd(), "logs/postpartum-change-history.jsonl");

const SESSION_COOKIE_NAME = "pp_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const COORDINATOR_PASSCODE = process.env.COORDINATOR_PASSCODE ?? "qwazi-local";

const rules = loadPostpartumRulesFromFile(RULES_PATH);
const sessions = new Map<string, { actor: string; createdAt: string; expiresAt: number }>();

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

      if (req.method === "GET" && url.pathname === "/api/postpartum/auth/session") {
        return handleSessionStatus(req, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/auth/login") {
        const payload = await readJson(req);
        return handleAuthLogin(payload, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/auth/logout") {
        return handleAuthLogout(req, res);
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
        return handleOutcomeUpdate(req, payload, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/audit/workflow") {
        const payload = await readJson(req);
        return handleWorkflowUpdate(req, payload, res);
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

async function handleOutcomeUpdate(
  req: IncomingMessage,
  payload: unknown,
  res: ServerResponse
) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  if (eventId.length === 0) {
    return json(res, 400, { error: "eventId is required." });
  }

  const outcomeRaw = isRecord(payload.outcome) ? payload.outcome : {};
  const normalized = normalizeOutcomePatch(outcomeRaw);
  if (normalized.error) {
    return json(res, 400, { error: normalized.error });
  }
  const outcomePatch = normalized.patch;
  if (Object.keys(outcomePatch).length === 0) {
    return json(res, 400, { error: "No valid outcome fields provided." });
  }

  const updated = updateAuditEventOutcome(
    DEFAULT_HISTORY_LOG,
    eventId,
    outcomePatch,
    auth.actor
  );
  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  const change = createAuditChangeEvent(
    "OUTCOME_UPDATE",
    auth.actor,
    outcomePatch,
    updated
  );
  appendAuditChangeEventJsonl(DEFAULT_CHANGE_LOG, change);

  return json(res, 200, { event: updated.after });
}

async function handleWorkflowUpdate(
  req: IncomingMessage,
  payload: unknown,
  res: ServerResponse
) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const eventId = typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  if (eventId.length === 0) {
    return json(res, 400, { error: "eventId is required." });
  }

  const workflowRaw = isRecord(payload.workflow) ? payload.workflow : {};
  const normalized = normalizeWorkflowPatch(workflowRaw);
  if (normalized.error) {
    return json(res, 400, { error: normalized.error });
  }
  const workflowPatch = normalized.patch;
  if (Object.keys(workflowPatch).length === 0) {
    return json(res, 400, { error: "No valid workflow fields provided." });
  }

  const updated = updateAuditEventWorkflow(
    DEFAULT_HISTORY_LOG,
    eventId,
    workflowPatch,
    auth.actor
  );
  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  const change = createAuditChangeEvent(
    "WORKFLOW_UPDATE",
    auth.actor,
    workflowPatch,
    updated
  );
  appendAuditChangeEventJsonl(DEFAULT_CHANGE_LOG, change);

  return json(res, 200, { event: updated.after });
}

function handleSessionStatus(req: IncomingMessage, res: ServerResponse) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return json(res, 200, { authenticated: false });
  }
  return json(res, 200, {
    authenticated: true,
    actor: session.actor,
    expires_at: new Date(session.expiresAt).toISOString(),
  });
}

async function handleAuthLogin(payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const passcode = typeof payload.passcode === "string" ? payload.passcode : "";
  if (passcode !== COORDINATOR_PASSCODE) {
    return json(res, 401, { error: "Invalid passcode." });
  }

  const actorRaw = typeof payload.actor === "string" ? payload.actor.trim() : "";
  const actor = actorRaw.length > 0 ? actorRaw : "coordinator";
  const sessionId = randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;

  sessions.set(sessionId, {
    actor,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  });

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax`
  );
  return json(res, 200, {
    authenticated: true,
    actor,
    expires_at: new Date(expiresAt).toISOString(),
  });
}

function handleAuthLogout(req: IncomingMessage, res: ServerResponse) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) sessions.delete(sessionId);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
  return json(res, 200, { authenticated: false });
}

function requireAuth(req: IncomingMessage, res: ServerResponse): { actor: string } | null {
  const session = getSessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: "Authentication required." });
    return null;
  }
  return { actor: session.actor };
}

function getSessionFromRequest(req: IncomingMessage):
  | { actor: string; createdAt: string; expiresAt: number }
  | null {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
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

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header.trim()) return out;
  for (const segment of header.split(";")) {
    const [rawKey, ...rawValParts] = segment.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    out[key] = rawValParts.join("=").trim();
  }
  return out;
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeOutcomePatch(outcome: Record<string, unknown>): {
  patch: {
    care_sought?: boolean;
    care_time?: number;
    care_type?: string;
    resolved?: boolean;
    notes?: string;
  };
  error?: string;
} {
  const patch: {
    care_sought?: boolean;
    care_time?: number;
    care_type?: string;
    resolved?: boolean;
    notes?: string;
  } = {};

  if (hasOwn(outcome, "care_sought")) {
    const parsed = parseNullableBooleanField(outcome.care_sought, "care_sought");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.care_sought = parsed.value;
  }

  if (hasOwn(outcome, "care_time")) {
    const parsed = parseNullableNumberField(outcome.care_time, "care_time");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.care_time = parsed.value;
  }

  if (hasOwn(outcome, "care_type")) {
    const parsed = parseCareTypeField(outcome.care_type);
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.care_type = parsed.value;
  }

  if (hasOwn(outcome, "resolved")) {
    const parsed = parseNullableBooleanField(outcome.resolved, "resolved");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.resolved = parsed.value;
  }

  if (hasOwn(outcome, "notes")) {
    const parsed = parseNullableStringField(outcome.notes, "notes");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.notes = parsed.value;
  }

  return { patch };
}

function normalizeWorkflowPatch(workflow: Record<string, unknown>): {
  patch: {
    status?: "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";
    owner?: string;
    follow_up_due_at?: string;
    last_contact_at?: string;
  };
  error?: string;
} {
  const patch: {
    status?: "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED";
    owner?: string;
    follow_up_due_at?: string;
    last_contact_at?: string;
  } = {};

  if (hasOwn(workflow, "status")) {
    const parsed = parseStatusField(workflow.status);
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.status = parsed.value;
  }

  if (hasOwn(workflow, "owner")) {
    const parsed = parseNullableStringField(workflow.owner, "owner");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.owner = parsed.value;
  }

  if (hasOwn(workflow, "follow_up_due_at")) {
    const parsed = parseNullableIsoDateField(workflow.follow_up_due_at, "follow_up_due_at");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.follow_up_due_at = parsed.value;
  }

  if (hasOwn(workflow, "last_contact_at")) {
    const parsed = parseNullableIsoDateField(workflow.last_contact_at, "last_contact_at");
    if (!parsed.ok) return { patch, error: parsed.error };
    patch.last_contact_at = parsed.value;
  }

  return { patch };
}

function parseStatusField(value: unknown):
  | { ok: true; value: "NEW" | "IN_PROGRESS" | "WAITING" | "CLOSED" }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "status must be one of NEW, IN_PROGRESS, WAITING, CLOSED." };
  }
  const raw = value.trim().toUpperCase();
  if (raw === "NEW") return { ok: true, value: "NEW" };
  if (raw === "IN_PROGRESS") return { ok: true, value: "IN_PROGRESS" };
  if (raw === "WAITING") return { ok: true, value: "WAITING" };
  if (raw === "CLOSED") return { ok: true, value: "CLOSED" };
  return { ok: false, error: "status must be one of NEW, IN_PROGRESS, WAITING, CLOSED." };
}

function parseCareTypeField(value: unknown):
  | { ok: true; value: string | undefined }
  | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return {
      ok: false,
      error: "care_type must be one of EMERGENCY, PSYCHIATRY, OBGYN, HAUSARZT, MIDWIFE, OTHER.",
    };
  }
  const raw = value.trim().toUpperCase();
  if (!raw) return { ok: true, value: undefined };
  const allowed = new Set(["EMERGENCY", "PSYCHIATRY", "OBGYN", "HAUSARZT", "MIDWIFE", "OTHER"]);
  if (allowed.has(raw)) return { ok: true, value: raw };
  return {
    ok: false,
    error: "care_type must be one of EMERGENCY, PSYCHIATRY, OBGYN, HAUSARZT, MIDWIFE, OTHER.",
  };
}

function parseNullableBooleanField(value: unknown, field: string):
  | { ok: true; value: boolean | undefined }
  | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (typeof value === "boolean") return { ok: true, value };
  return { ok: false, error: `${field} must be boolean or null.` };
}

function parseNullableNumberField(value: unknown, field: string):
  | { ok: true; value: number | undefined }
  | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0) return { ok: true, value };
    return { ok: false, error: `${field} must be a non-negative number or null.` };
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) return { ok: true, value: undefined };
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0) return { ok: true, value: parsed };
  }
  return { ok: false, error: `${field} must be a non-negative number or null.` };
}

function parseNullableStringField(value: unknown, field: string):
  | { ok: true; value: string | undefined }
  | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string or null.` };
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

function parseNullableIsoDateField(value: unknown, field: string):
  | { ok: true; value: string | undefined }
  | { ok: false; error: string } {
  if (value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `${field} must be ISO datetime or null.` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return { ok: false, error: `${field} must be ISO datetime or null.` };
  return { ok: true, value: date.toISOString() };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

main();
