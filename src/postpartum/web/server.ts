import { readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { appendAuditEventJsonl, createPostpartumAuditEvent } from "../audit";
import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "../evaluator";
import { PostpartumStore, PostpartumUserRole } from "../store";
import { PostpartumInput } from "../types";

const PORT = Number(process.env.PORT ?? 4173);
const STATIC_DIR = resolve(__dirname, "static");
const RULES_PATH = resolve(process.cwd(), "src/config/rules.postpartum.de.v1.json");
const DEFAULT_AUDIT_LOG = resolve(process.cwd(), "logs/postpartum-web.jsonl");
const DEFAULT_DB_PATH = resolve(process.env.POSTPARTUM_DB_PATH ?? "logs/postpartum.sqlite");
const LEGACY_HISTORY_LOG_PATH = resolve(process.cwd(), "logs/postpartum-history.jsonl");
const LEGACY_CHANGE_LOG_PATH = resolve(process.cwd(), "logs/postpartum-change-history.jsonl");

const SESSION_COOKIE_NAME = "pp_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const LEGACY_PASSCODE = process.env.COORDINATOR_PASSCODE;
const DEFAULT_ADMIN_USERNAME = normalizeUsername(
  process.env.COORDINATOR_ADMIN_USERNAME ?? "admin"
);
const DEFAULT_ADMIN_PASSWORD =
  process.env.COORDINATOR_ADMIN_PASSWORD ?? LEGACY_PASSCODE ?? "qwazi-local";
const DEFAULT_ADMIN_DISPLAY_NAME =
  (process.env.COORDINATOR_ADMIN_DISPLAY_NAME ?? "Admin").trim() || "Admin";

const DEFAULT_COORDINATOR_USERNAME = normalizeOptionalUsername(
  process.env.COORDINATOR_DEFAULT_USERNAME
);
const DEFAULT_COORDINATOR_PASSWORD = process.env.COORDINATOR_DEFAULT_PASSWORD;
const DEFAULT_COORDINATOR_DISPLAY_NAME = normalizeOptionalString(
  process.env.COORDINATOR_DEFAULT_DISPLAY_NAME
);

const AUTH_MAX_FAILED_ATTEMPTS = parseEnvPositiveInt(
  process.env.AUTH_MAX_FAILED_ATTEMPTS,
  5,
  20
);
const AUTH_COOLDOWN_SECONDS = parseEnvPositiveInt(
  process.env.AUTH_COOLDOWN_SECONDS,
  600,
  86_400
);
const AUTH_COOLDOWN_MS = AUTH_COOLDOWN_SECONDS * 1000;

const rules = loadPostpartumRulesFromFile(RULES_PATH);
const store = new PostpartumStore(DEFAULT_DB_PATH);
const migrated = store.migrateFromJsonl(LEGACY_HISTORY_LOG_PATH, LEGACY_CHANGE_LOG_PATH);
if (migrated.importedEvents > 0 || migrated.importedChanges > 0) {
  process.stdout.write(
    `Migrated legacy JSONL data into SQLite: ${migrated.importedEvents} events, ${migrated.importedChanges} changes.\n`
  );
}

const adminBootstrap = store.ensureUser(
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,
  "ADMIN",
  DEFAULT_ADMIN_DISPLAY_NAME
);
if (adminBootstrap.created) {
  process.stdout.write(`Created bootstrap admin user '${DEFAULT_ADMIN_USERNAME}'.\n`);
}
if ((process.env.COORDINATOR_ADMIN_PASSWORD ?? LEGACY_PASSCODE) === undefined) {
  process.stdout.write(
    "Using default bootstrap admin password. Set COORDINATOR_ADMIN_PASSWORD for non-local environments.\n"
  );
}

if (DEFAULT_COORDINATOR_USERNAME && DEFAULT_COORDINATOR_PASSWORD) {
  const coordinatorBootstrap = store.ensureUser(
    DEFAULT_COORDINATOR_USERNAME,
    DEFAULT_COORDINATOR_PASSWORD,
    "COORDINATOR",
    DEFAULT_COORDINATOR_DISPLAY_NAME
  );
  if (coordinatorBootstrap.created) {
    process.stdout.write(
      `Created bootstrap coordinator user '${DEFAULT_COORDINATOR_USERNAME}'.\n`
    );
  }
}

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
        return handleAuthLogin(req, payload, res);
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/auth/logout") {
        return handleAuthLogout(req, res);
      }

      if (req.method === "GET" && url.pathname === "/api/postpartum/admin/users") {
        const auth = requireRole(req, res, ["ADMIN"]);
        if (!auth) return;
        return json(res, 200, { users: store.listUsers() });
      }

      if (req.method === "POST" && url.pathname === "/api/postpartum/admin/users") {
        const auth = requireRole(req, res, ["ADMIN"]);
        if (!auth) return;
        const payload = await readJson(req);
        return handleAdminCreateUser(payload, res);
      }

      if (req.method === "GET" && url.pathname === "/api/postpartum/audit/recent") {
        const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
        const events = store.readRecentAuditEvents(limit);
        return json(res, 200, {
          events,
          count: events.length,
          limit,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/postpartum/audit/changes") {
        const auth = requireRole(req, res, ["COORDINATOR", "ADMIN"]);
        if (!auth) return;

        const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 200);
        const changes = store.readRecentChangeEvents(limit);
        return json(res, 200, {
          changes,
          count: changes.length,
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
  store.insertAuditEvent(historyEvent);

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
  const auth = requireRole(req, res, ["COORDINATOR", "ADMIN"]);
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

  const updated = store.updateOutcome(eventId, outcomePatch, auth.username);
  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  return json(res, 200, { event: updated.after });
}

async function handleWorkflowUpdate(
  req: IncomingMessage,
  payload: unknown,
  res: ServerResponse
) {
  const auth = requireRole(req, res, ["COORDINATOR", "ADMIN"]);
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

  const updated = store.updateWorkflow(eventId, workflowPatch, auth.username);
  if (!updated) {
    return json(res, 404, { error: "Audit event not found." });
  }

  return json(res, 200, { event: updated.after });
}

function handleSessionStatus(req: IncomingMessage, res: ServerResponse) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return json(res, 200, { authenticated: false });
  }
  return json(res, 200, {
    authenticated: true,
    username: session.username,
    role: session.role,
    display_name: session.displayName,
    actor: session.displayName ?? session.username,
    expires_at: new Date(session.expiresAt).toISOString(),
  });
}

async function handleAuthLogin(req: IncomingMessage, payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const username = normalizeOptionalUsername(payload.username);
  if (!username) {
    return json(res, 400, { error: "username is required." });
  }

  const password = typeof payload.password === "string" ? payload.password : "";
  if (!password) {
    return json(res, 400, { error: "password is required." });
  }

  const now = Date.now();
  const attemptKey = buildLoginAttemptKey(req, username);
  const throttle = store.getLoginThrottle(attemptKey, now);
  if (throttle.blocked) {
    const retryAfterSeconds = Math.max(1, Math.ceil((throttle.blockedUntil - now) / 1000));
    return json(res, 429, {
      error: `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`,
      retry_after_seconds: retryAfterSeconds,
    });
  }

  const user = store.verifyCredentials(username, password);
  if (!user) {
    const updatedThrottle = store.recordFailedLoginAttempt(
      attemptKey,
      now,
      AUTH_MAX_FAILED_ATTEMPTS,
      AUTH_COOLDOWN_MS
    );

    if (updatedThrottle.blocked) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((updatedThrottle.blockedUntil - now) / 1000)
      );
      return json(res, 429, {
        error: `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`,
        retry_after_seconds: retryAfterSeconds,
      });
    }

    return json(res, 401, { error: "Invalid username or password." });
  }

  store.clearLoginThrottle(attemptKey);
  const { sessionId, session } = store.createSession(user, SESSION_TTL_SECONDS);

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax`
  );
  return json(res, 200, {
    authenticated: true,
    username: session.username,
    role: session.role,
    display_name: session.displayName,
    actor: session.displayName ?? session.username,
    expires_at: new Date(session.expiresAt).toISOString(),
  });
}

function handleAuthLogout(req: IncomingMessage, res: ServerResponse) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) store.deleteSession(sessionId);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
  return json(res, 200, { authenticated: false });
}

async function handleAdminCreateUser(payload: unknown, res: ServerResponse) {
  if (!isRecord(payload)) {
    return json(res, 400, { error: "Invalid payload; expected JSON object." });
  }

  const username = normalizeOptionalUsername(payload.username);
  if (!username) {
    return json(res, 400, { error: "username is required." });
  }

  const password = typeof payload.password === "string" ? payload.password : "";
  if (password.length < 8) {
    return json(res, 400, { error: "password must be at least 8 characters." });
  }

  const role = parseRole(payload.role);
  if (!role) {
    return json(res, 400, { error: "role must be COORDINATOR or ADMIN." });
  }

  const displayName = normalizeOptionalString(payload.display_name);
  const created = store.createUser(username, password, role, displayName);
  if (!created) {
    return json(res, 409, { error: "username already exists." });
  }

  return json(res, 201, { user: created });
}

function requireRole(
  req: IncomingMessage,
  res: ServerResponse,
  allowedRoles: PostpartumUserRole[]
) {
  const session = getSessionFromRequest(req);
  if (!session) {
    json(res, 401, { error: "Authentication required." });
    return null;
  }
  if (!allowedRoles.includes(session.role)) {
    json(res, 403, { error: "Insufficient role." });
    return null;
  }
  return session;
}

function getSessionFromRequest(req: IncomingMessage) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  return store.readSession(sessionId);
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

function parseEnvPositiveInt(raw: string | undefined, fallback: number, max: number): number {
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

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeOptionalUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeUsername(value);
  if (!normalized) return null;
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function parseRole(value: unknown): PostpartumUserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "COORDINATOR") return "COORDINATOR";
  if (normalized === "ADMIN") return "ADMIN";
  return null;
}

function getClientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim().length > 0) {
    return xff.split(",")[0]?.trim() ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

function buildLoginAttemptKey(req: IncomingMessage, username: string): string {
  return `${username}|${getClientIp(req)}`;
}

main();
