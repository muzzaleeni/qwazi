import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createAuditChangeEvent,
  PostpartumAuditChangeEvent,
  PostpartumAuditEvent,
  PostpartumAuditOutcome,
  PostpartumAuditUpdateResult,
  PostpartumCaseWorkflow,
} from "./audit";

export interface PostpartumSession {
  actor: string;
  createdAt: string;
  expiresAt: number;
}

export class PostpartumStore {
  private readonly db: DatabaseSync;

  constructor(pathToDb: string) {
    const absolute = resolve(pathToDb);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
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

  createSession(actor: string, ttlSeconds: number): { sessionId: string; session: PostpartumSession } {
    const sessionId = randomUUID();
    const now = Date.now();
    const session: PostpartumSession = {
      actor,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + ttlSeconds * 1000,
    };

    this.db
      .prepare(
        `
        INSERT INTO postpartum_sessions (session_id, actor, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(sessionId, session.actor, session.createdAt, session.expiresAt);

    return { sessionId, session };
  }

  readSession(sessionId: string): PostpartumSession | null {
    const row = this.db
      .prepare(
        `
        SELECT actor, created_at, expires_at
        FROM postpartum_sessions
        WHERE session_id = ?
      `
      )
      .get(sessionId) as { actor: string; created_at: string; expires_at: number } | undefined;

    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.deleteSession(sessionId);
      return null;
    }

    return {
      actor: row.actor,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM postpartum_sessions WHERE session_id = ?").run(sessionId);
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

      CREATE TABLE IF NOT EXISTS postpartum_sessions (
        session_id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_postpartum_cases_created_at
      ON postpartum_cases (created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_postpartum_changes_timestamp
      ON postpartum_changes (timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_postpartum_changes_event_id
      ON postpartum_changes (event_id);

      CREATE INDEX IF NOT EXISTS idx_postpartum_sessions_expires_at
      ON postpartum_sessions (expires_at);
    `);
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
