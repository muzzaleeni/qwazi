import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createAuditChangeEvent,
  PostpartumAuditChangeEvent,
  PostpartumAuditEvent,
  PostpartumAuditOutcome,
  PostpartumAuditUpdateResult,
  PostpartumCaseWorkflow,
} from "./audit";

export type PostpartumUserRole = "COORDINATOR" | "ADMIN";

export interface PostpartumUser {
  userId: string;
  username: string;
  role: PostpartumUserRole;
  displayName?: string;
  createdAt: string;
  active: boolean;
}

interface PostpartumUserRecord extends PostpartumUser {
  passwordHash: string;
}

export interface PostpartumSession {
  userId: string;
  username: string;
  role: PostpartumUserRole;
  displayName?: string;
  createdAt: string;
  expiresAt: number;
}

export interface LoginThrottleState {
  blocked: boolean;
  blockedUntil: number;
  failedCount: number;
}

const PASSWORD_HASH_KEYLEN = 64;
const PASSWORD_SCRYPT_N = 16384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_HASH_VERSION = "scrypt-v1";

export class PostpartumStore {
  private readonly db: Database.Database;

  constructor(pathToDb: string) {
    const absolute = resolve(pathToDb);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new Database(absolute);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  migrateFromJsonl(historyPath: string, changePath: string): {
    importedEvents: number;
    importedChanges: number;
  } {
    let importedEvents = 0;
    let importedChanges = 0;

    const hasCases = this.tableCount("postpartum_cases") > 0;
    if (!hasCases && existsSync(historyPath)) {
      const events = parseJsonlFile<PostpartumAuditEvent>(historyPath).map((event) =>
        normalizeEvent(event)
      );
      const stmt = this.db.prepare(
        `
        INSERT OR IGNORE INTO postpartum_cases (event_id, created_at, updated_at, event_json)
        VALUES (?, ?, ?, ?)
      `
      );
      for (const event of events) {
        const result = stmt.run(
          event.eventId,
          event.timestamp,
          event.last_updated_at ?? event.timestamp,
          JSON.stringify(event)
        );
        if (result.changes > 0) importedEvents += 1;
      }
    }

    const hasChanges = this.tableCount("postpartum_changes") > 0;
    if (!hasChanges && existsSync(changePath)) {
      const changes = parseJsonlFile<PostpartumAuditChangeEvent>(changePath);
      const stmt = this.db.prepare(
        `
        INSERT OR IGNORE INTO postpartum_changes (change_id, event_id, timestamp, editor, change_type, change_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      );
      for (const change of changes) {
        const result = stmt.run(
          change.changeId,
          change.eventId,
          change.timestamp,
          change.editor,
          change.changeType,
          JSON.stringify(change)
        );
        if (result.changes > 0) importedChanges += 1;
      }
    }

    return { importedEvents, importedChanges };
  }

  ensureUser(
    usernameRaw: string,
    password: string,
    role: PostpartumUserRole,
    displayName?: string
  ): { created: boolean; user: PostpartumUser } {
    const username = normalizeUsername(usernameRaw);
    const existing = this.readUserRecordByUsername(username);
    if (existing) {
      return { created: false, user: toPublicUser(existing) };
    }

    const created = this.createUser(username, password, role, displayName);
    if (!created) {
      const fallback = this.readUserRecordByUsername(username);
      if (!fallback) {
        throw new Error(`Failed to ensure user for username ${username}`);
      }
      return { created: false, user: toPublicUser(fallback) };
    }

    return { created: true, user: created };
  }

  createUser(
    usernameRaw: string,
    password: string,
    role: PostpartumUserRole,
    displayName?: string
  ): PostpartumUser | null {
    const username = normalizeUsername(usernameRaw);
    if (!username) return null;

    const existing = this.readUserRecordByUsername(username);
    if (existing) return null;

    const now = new Date().toISOString();
    const userId = randomUUID();
    const passwordHash = hashPassword(password);
    const cleanedDisplayName = normalizeOptionalDisplayName(displayName);

    this.db
      .prepare(
        `
        INSERT INTO postpartum_users (
          user_id,
          username,
          password_hash,
          role,
          display_name,
          active,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
      `
      )
      .run(userId, username, passwordHash, role, cleanedDisplayName ?? null, now);

    return {
      userId,
      username,
      role,
      displayName: cleanedDisplayName,
      createdAt: now,
      active: true,
    };
  }

  listUsers(): PostpartumUser[] {
    const rows = this.db
      .prepare(
        `
        SELECT user_id, username, role, display_name, created_at, active
        FROM postpartum_users
        ORDER BY datetime(created_at) DESC, rowid DESC
      `
      )
      .all() as Array<{
      user_id: string;
      username: string;
      role: PostpartumUserRole;
      display_name: string | null;
      created_at: string;
      active: number;
    }>;

    return rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      role: row.role,
      displayName: row.display_name ?? undefined,
      createdAt: row.created_at,
      active: row.active === 1,
    }));
  }

  verifyCredentials(usernameRaw: string, password: string): PostpartumUser | null {
    const username = normalizeUsername(usernameRaw);
    const record = this.readUserRecordByUsername(username);
    if (!record || !record.active) return null;

    const valid = verifyPassword(password, record.passwordHash);
    if (!valid) return null;

    return toPublicUser(record);
  }

  createSession(user: PostpartumUser, ttlSeconds: number): { sessionId: string; session: PostpartumSession } {
    const sessionId = randomUUID();
    const nowMs = Date.now();
    const session: PostpartumSession = {
      userId: user.userId,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: nowMs + ttlSeconds * 1000,
    };

    this.db
      .prepare(
        `
        INSERT INTO postpartum_sessions (
          session_id,
          user_id,
          username,
          role,
          display_name,
          created_at,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        sessionId,
        session.userId,
        session.username,
        session.role,
        session.displayName ?? null,
        session.createdAt,
        session.expiresAt
      );

    return { sessionId, session };
  }

  readSession(sessionId: string): PostpartumSession | null {
    const row = this.db
      .prepare(
        `
        SELECT user_id, username, role, display_name, created_at, expires_at
        FROM postpartum_sessions
        WHERE session_id = ?
      `
      )
      .get(sessionId) as
      | {
          user_id: string;
          username: string;
          role: PostpartumUserRole;
          display_name: string | null;
          created_at: string;
          expires_at: number;
        }
      | undefined;

    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.deleteSession(sessionId);
      return null;
    }

    return {
      userId: row.user_id,
      username: row.username,
      role: row.role,
      displayName: row.display_name ?? undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM postpartum_sessions WHERE session_id = ?").run(sessionId);
  }

  getLoginThrottle(attemptKey: string, nowMs: number): LoginThrottleState {
    const row = this.db
      .prepare(
        `
        SELECT failed_count, blocked_until
        FROM postpartum_auth_attempts
        WHERE attempt_key = ?
      `
      )
      .get(attemptKey) as { failed_count: number; blocked_until: number } | undefined;

    if (!row) {
      return { blocked: false, blockedUntil: 0, failedCount: 0 };
    }

    if (row.blocked_until > nowMs) {
      return {
        blocked: true,
        blockedUntil: row.blocked_until,
        failedCount: row.failed_count,
      };
    }

    return {
      blocked: false,
      blockedUntil: 0,
      failedCount: row.failed_count,
    };
  }

  recordFailedLoginAttempt(
    attemptKey: string,
    nowMs: number,
    maxFailedAttempts: number,
    cooldownMs: number
  ): LoginThrottleState {
    const current = this.db
      .prepare(
        `
        SELECT failed_count, blocked_until
        FROM postpartum_auth_attempts
        WHERE attempt_key = ?
      `
      )
      .get(attemptKey) as { failed_count: number; blocked_until: number } | undefined;

    let failedCount = (current?.failed_count ?? 0) + 1;
    let blockedUntil = current?.blocked_until ?? 0;

    if (blockedUntil <= nowMs && failedCount >= maxFailedAttempts) {
      blockedUntil = nowMs + cooldownMs;
      failedCount = 0;
    }

    this.db
      .prepare(
        `
        INSERT INTO postpartum_auth_attempts (attempt_key, failed_count, blocked_until, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
          failed_count = excluded.failed_count,
          blocked_until = excluded.blocked_until,
          updated_at = excluded.updated_at
      `
      )
      .run(attemptKey, failedCount, blockedUntil, nowMs);

    return {
      blocked: blockedUntil > nowMs,
      blockedUntil,
      failedCount,
    };
  }

  clearLoginThrottle(attemptKey: string): void {
    this.db.prepare("DELETE FROM postpartum_auth_attempts WHERE attempt_key = ?").run(attemptKey);
  }

  insertAuditEvent(event: PostpartumAuditEvent): void {
    this.db
      .prepare(
        `
        INSERT INTO postpartum_cases (event_id, created_at, updated_at, event_json)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(event.eventId, event.timestamp, event.last_updated_at ?? event.timestamp, JSON.stringify(event));
  }

  readRecentAuditEvents(limit: number): PostpartumAuditEvent[] {
    const boundedLimit = normalizeLimit(limit);
    const rows = this.db
      .prepare(
        `
        SELECT event_json
        FROM postpartum_cases
        ORDER BY datetime(created_at) DESC, rowid DESC
        LIMIT ?
      `
      )
      .all(boundedLimit) as Array<{ event_json: string }>;

    return rows
      .map((row) => parseJson<PostpartumAuditEvent>(row.event_json))
      .filter((item): item is PostpartumAuditEvent => item !== null)
      .map((event) => normalizeEvent(event));
  }

  readRecentChangeEvents(limit: number): PostpartumAuditChangeEvent[] {
    const boundedLimit = normalizeLimit(limit);
    const rows = this.db
      .prepare(
        `
        SELECT change_json
        FROM postpartum_changes
        ORDER BY datetime(timestamp) DESC, rowid DESC
        LIMIT ?
      `
      )
      .all(boundedLimit) as Array<{ change_json: string }>;

    return rows
      .map((row) => parseJson<PostpartumAuditChangeEvent>(row.change_json))
      .filter((item): item is PostpartumAuditChangeEvent => item !== null);
  }

  updateOutcome(
    eventId: string,
    outcomePatch: Partial<Omit<PostpartumAuditOutcome, "updated_at" | "updated_by">>,
    editor: string
  ): PostpartumAuditUpdateResult | null {
    return this.updateEventWithChange(eventId, "OUTCOME_UPDATE", editor, outcomePatch, (before, now) => {
      const outcome: PostpartumAuditOutcome = {
        ...before.outcome,
        ...outcomePatch,
        updated_at: now,
        updated_by: editor,
      };
      return normalizeEvent({
        ...before,
        outcome,
        last_updated_by: editor,
        last_updated_at: now,
      });
    });
  }

  updateWorkflow(
    eventId: string,
    workflowPatch: Partial<Omit<PostpartumCaseWorkflow, "updated_at" | "updated_by">>,
    editor: string
  ): PostpartumAuditUpdateResult | null {
    return this.updateEventWithChange(eventId, "WORKFLOW_UPDATE", editor, workflowPatch, (before, now) => {
      const workflow: PostpartumCaseWorkflow = {
        ...before.workflow,
        ...workflowPatch,
        updated_at: now,
        updated_by: editor,
      };
      return normalizeEvent({
        ...before,
        workflow,
        last_updated_by: editor,
        last_updated_at: now,
      });
    });
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS postpartum_cases (
        event_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS postpartum_changes (
        change_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        editor TEXT NOT NULL,
        change_type TEXT NOT NULL,
        change_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_postpartum_cases_created_at
      ON postpartum_cases (created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_postpartum_changes_timestamp
      ON postpartum_changes (timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_postpartum_changes_event_id
      ON postpartum_changes (event_id);

      CREATE TABLE IF NOT EXISTS postpartum_users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_postpartum_users_username
      ON postpartum_users (username);

      CREATE TABLE IF NOT EXISTS postpartum_auth_attempts (
        attempt_key TEXT PRIMARY KEY,
        failed_count INTEGER NOT NULL,
        blocked_until INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.ensureSessionSchema();
  }

  private ensureSessionSchema() {
    const columns = this.tableColumns("postpartum_sessions");
    const required = [
      "session_id",
      "user_id",
      "username",
      "role",
      "display_name",
      "created_at",
      "expires_at",
    ];

    if (columns.length > 0 && !required.every((column) => columns.includes(column))) {
      this.db.exec("DROP TABLE IF EXISTS postpartum_sessions;");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS postpartum_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_postpartum_sessions_expires_at
      ON postpartum_sessions (expires_at);
    `);
  }

  private readUserRecordByUsername(username: string): PostpartumUserRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT user_id, username, password_hash, role, display_name, created_at, active
        FROM postpartum_users
        WHERE username = ?
      `
      )
      .get(username) as
      | {
          user_id: string;
          username: string;
          password_hash: string;
          role: PostpartumUserRole;
          display_name: string | null;
          created_at: string;
          active: number;
        }
      | undefined;

    if (!row) return null;

    return {
      userId: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      displayName: row.display_name ?? undefined,
      createdAt: row.created_at,
      active: row.active === 1,
    };
  }

  private updateEventWithChange(
    eventId: string,
    changeType: "OUTCOME_UPDATE" | "WORKFLOW_UPDATE",
    editor: string,
    patch: Record<string, unknown>,
    apply: (before: PostpartumAuditEvent, now: string) => PostpartumAuditEvent
  ): PostpartumAuditUpdateResult | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT event_json FROM postpartum_cases WHERE event_id = ?")
        .get(eventId) as { event_json: string } | undefined;

      if (!row) {
        this.db.exec("ROLLBACK");
        return null;
      }

      const parsed = parseJson<PostpartumAuditEvent>(row.event_json);
      if (!parsed) {
        this.db.exec("ROLLBACK");
        return null;
      }

      const before = normalizeEvent(parsed);
      const now = new Date().toISOString();
      const after = apply(before, now);

      this.db
        .prepare(
          `
          UPDATE postpartum_cases
          SET event_json = ?, updated_at = ?
          WHERE event_id = ?
        `
        )
        .run(JSON.stringify(after), after.last_updated_at ?? now, eventId);

      const update: PostpartumAuditUpdateResult = { before, after };
      const change = createAuditChangeEvent(changeType, editor, patch, update);
      this.db
        .prepare(
          `
          INSERT INTO postpartum_changes (change_id, event_id, timestamp, editor, change_type, change_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          change.changeId,
          change.eventId,
          change.timestamp,
          change.editor,
          change.changeType,
          JSON.stringify(change)
        );

      this.db.exec("COMMIT");
      return update;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private tableCount(tableName: "postpartum_cases" | "postpartum_changes"): number {
    const row = this.db
      .prepare(`SELECT COUNT(1) AS count FROM ${tableName}`)
      .get() as { count: number };
    return row.count;
  }

  private tableColumns(tableName: string): string[] {
    const rows = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_HASH_KEYLEN, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
  });

  return [
    PASSWORD_HASH_VERSION,
    String(PASSWORD_SCRYPT_N),
    String(PASSWORD_SCRYPT_R),
    String(PASSWORD_SCRYPT_P),
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split("$");
  if (parts.length !== 6) return false;
  if (parts[0] !== PASSWORD_HASH_VERSION) return false;

  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  const saltHex = parts[4] ?? "";
  const hashHex = parts[5] ?? "";

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = scryptSync(password, salt, expected.length, { N: n, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function toPublicUser(record: PostpartumUserRecord): PostpartumUser {
  return {
    userId: record.userId,
    username: record.username,
    role: record.role,
    displayName: record.displayName,
    createdAt: record.createdAt,
    active: record.active,
  };
}

function normalizeUsername(usernameRaw: string): string {
  return usernameRaw.trim().toLowerCase();
}

function normalizeOptionalDisplayName(displayName: string | undefined): string | undefined {
  if (typeof displayName !== "string") return undefined;
  const cleaned = displayName.trim();
  if (!cleaned) return undefined;
  return cleaned;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseJsonlFile<T>(pathToJsonl: string): T[] {
  const raw = readFileSync(pathToJsonl, "utf8");
  if (!raw.trim()) return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseJson<T>(line))
    .filter((item): item is T => item !== null);
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}

function normalizeEvent(event: PostpartumAuditEvent): PostpartumAuditEvent {
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
