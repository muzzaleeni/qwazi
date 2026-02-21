import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface TestCase {
  id: string;
  description: string;
  run: (ctx: TestContext) => Promise<void>;
}

interface TestContext {
  port: number;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  readHistoryEvents: () => unknown[];
  readChangeEvents: () => unknown[];
}

interface BackupFile {
  path: string;
  existed: boolean;
  content: string;
}

const HISTORY_PATH = resolve(process.cwd(), "logs/postpartum-history.jsonl");
const CHANGE_PATH = resolve(process.cwd(), "logs/postpartum-change-history.jsonl");
const VIGNETTE_PATH = resolve(
  process.cwd(),
  "test/postpartum-vignettes/04_urgent_mental_health_high_score.json"
);

const tests: TestCase[] = [
  {
    id: "WEB_T001",
    description: "Auth gate blocks edits before login and allows after login.",
    run: async (ctx) => {
      const beforeLoginResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId: "missing",
          workflow: { status: "IN_PROGRESS" },
        }),
      });
      assertEqual(beforeLoginResp.status, 401, "expected 401 before login");

      const loginBadResp = await ctx.request("/api/postpartum/auth/login", {
        method: "POST",
        body: jsonBody({ actor: "ops-a", passcode: "wrong-passcode" }),
      });
      assertEqual(loginBadResp.status, 401, "expected 401 for invalid passcode");

      const loginResp = await ctx.request("/api/postpartum/auth/login", {
        method: "POST",
        body: jsonBody({ actor: "ops-a", passcode: "qwazi-local" }),
      });
      assertEqual(loginResp.status, 200, "expected 200 for valid login");

      const sessionResp = await ctx.request("/api/postpartum/auth/session");
      assertEqual(sessionResp.status, 200, "expected 200 for session check");
      const sessionBody = (await safeJson(sessionResp)) as { authenticated?: boolean; actor?: string };
      assertEqual(sessionBody.authenticated, true, "expected authenticated session after login");
      assertEqual(sessionBody.actor, "ops-a", "expected actor to match login");

      const afterLoginResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId: "missing",
          workflow: { status: "IN_PROGRESS" },
        }),
      });
      assertEqual(afterLoginResp.status, 404, "expected 404 for missing event after auth");

      const logoutResp = await ctx.request("/api/postpartum/auth/logout", {
        method: "POST",
        body: jsonBody({}),
      });
      assertEqual(logoutResp.status, 200, "expected 200 for logout");

      const afterLogoutResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId: "missing",
          workflow: { status: "IN_PROGRESS" },
        }),
      });
      assertEqual(afterLogoutResp.status, 401, "expected 401 after logout");
    },
  },
  {
    id: "WEB_T002",
    description: "Validation rejects malformed/unsafe outcome and workflow payloads.",
    run: async (ctx) => {
      await loginAsCoordinator(ctx);

      const eventId = await createEvaluationEvent(ctx);

      const badCareTime = await ctx.request("/api/postpartum/audit/outcome", {
        method: "POST",
        body: jsonBody({
          eventId,
          outcome: { care_time: -1 },
        }),
      });
      assertEqual(badCareTime.status, 400, "expected 400 for negative care_time");

      const badCareType = await ctx.request("/api/postpartum/audit/outcome", {
        method: "POST",
        body: jsonBody({
          eventId,
          outcome: { care_type: "UNKNOWN_CLINIC" },
        }),
      });
      assertEqual(badCareType.status, 400, "expected 400 for invalid care_type");

      const badStatus = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId,
          workflow: { status: "INVALID" },
        }),
      });
      assertEqual(badStatus.status, 400, "expected 400 for invalid status");

      const badDate = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId,
          workflow: { follow_up_due_at: "not-a-date" },
        }),
      });
      assertEqual(badDate.status, 400, "expected 400 for invalid follow_up_due_at");

      const emptyPatch = await ctx.request("/api/postpartum/audit/outcome", {
        method: "POST",
        body: jsonBody({
          eventId,
          outcome: {},
        }),
      });
      assertEqual(emptyPatch.status, 400, "expected 400 for empty outcome patch");
    },
  },
  {
    id: "WEB_T003",
    description: "Each successful edit appends immutable change events with editor and before/after state.",
    run: async (ctx) => {
      await loginAsCoordinator(ctx, "ops-b");
      const eventId = await createEvaluationEvent(ctx);

      const changeBefore = ctx.readChangeEvents().length;

      const outcomeResp = await ctx.request("/api/postpartum/audit/outcome", {
        method: "POST",
        body: jsonBody({
          eventId,
          outcome: {
            care_sought: true,
            care_time: 2,
            care_type: "OBGYN",
            notes: "Reached care quickly",
          },
        }),
      });
      assertEqual(outcomeResp.status, 200, "expected 200 for valid outcome update");

      const workflowResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId,
          workflow: {
            status: "IN_PROGRESS",
            owner: "ops-b",
          },
        }),
      });
      assertEqual(workflowResp.status, 200, "expected 200 for valid workflow update");

      const changeAfter = ctx.readChangeEvents();
      assertEqual(changeAfter.length, changeBefore + 2, "expected two new change events");

      const latestTwo = changeAfter.slice(-2) as Array<Record<string, unknown>>;
      const first = latestTwo[0] ?? {};
      const second = latestTwo[1] ?? {};

      assertEqual(first.changeType, "OUTCOME_UPDATE", "first change should be OUTCOME_UPDATE");
      assertEqual(second.changeType, "WORKFLOW_UPDATE", "second change should be WORKFLOW_UPDATE");
      assertEqual(first.editor, "ops-b", "outcome editor mismatch");
      assertEqual(second.editor, "ops-b", "workflow editor mismatch");

      const firstAfter = (first.after ?? {}) as Record<string, unknown>;
      const secondAfter = (second.after ?? {}) as Record<string, unknown>;
      assertEqual(firstAfter.last_updated_by, "ops-b", "outcome last_updated_by mismatch");
      assertEqual(secondAfter.last_updated_by, "ops-b", "workflow last_updated_by mismatch");

      const workflowAfter = (secondAfter.workflow ?? {}) as Record<string, unknown>;
      assertEqual(workflowAfter.status, "IN_PROGRESS", "workflow status should be IN_PROGRESS");

      const history = ctx.readHistoryEvents() as Array<Record<string, unknown>>;
      const target = history.find((item) => item.eventId === eventId);
      assertTruthy(target, "expected event in history after updates");
      assertEqual(target?.last_updated_by, "ops-b", "history event should reflect editor");
    },
  },
];

async function main() {
  const port = Number(process.env.POSTPARTUM_WEB_TEST_PORT ?? "4197");
  const backups = backupAndResetLogs([HISTORY_PATH, CHANGE_PATH]);

  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = startServer(port);
    await waitForServer(port, 10_000);

    const request = createCookieClient(port);
    const ctx: TestContext = {
      port,
      request,
      readHistoryEvents: () => readJsonl(HISTORY_PATH),
      readChangeEvents: () => readJsonl(CHANGE_PATH),
    };

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        await test.run(ctx);
        passed += 1;
        process.stdout.write(`PASS ${test.id}: ${test.description}\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`FAIL ${test.id}: ${test.description}\n`);
        process.stdout.write(`  - ${formatError(error)}\n`);
      }
    }

    process.stdout.write(
      `\nPostpartum web integration summary: ${passed} passed, ${failed} failed, ${tests.length} total.\n`
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await waitForExit(child, 2_000);
    }
    restoreLogs(backups);
  }
}

function startServer(port: number) {
  return spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "src/postpartum/web/server.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        COORDINATOR_PASSCODE: "qwazi-local",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

async function waitForServer(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // retry until timeout
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for server on port ${port}.`);
}

function createCookieClient(port: number) {
  let cookieHeader = "";

  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers,
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const sessionCookie = parseCookieForHeader(setCookie, "pp_session");
      if (sessionCookie === null) {
        cookieHeader = "";
      } else if (sessionCookie.length > 0) {
        cookieHeader = sessionCookie;
      }
    }

    return response;
  };
}

function parseCookieForHeader(setCookie: string, key: string): string | null {
  const segments = setCookie.split(",");
  for (const segment of segments) {
    const start = segment.trim();
    if (!start.startsWith(`${key}=`)) continue;
    const firstPart = start.split(";")[0] ?? "";
    const value = firstPart.slice(key.length + 1);
    if (!value) return null;
    return `${key}=${value}`;
  }
  return null;
}

async function loginAsCoordinator(ctx: TestContext, actor = "ops-a") {
  await ctx.request("/api/postpartum/auth/logout", {
    method: "POST",
    body: jsonBody({}),
  });

  const response = await ctx.request("/api/postpartum/auth/login", {
    method: "POST",
    body: jsonBody({ actor, passcode: "qwazi-local" }),
  });
  assertEqual(response.status, 200, "coordinator login should succeed");
}

async function createEvaluationEvent(ctx: TestContext): Promise<string> {
  const vignette = JSON.parse(readFileSync(VIGNETTE_PATH, "utf8")) as {
    input: Record<string, unknown>;
  };

  const evaluateResp = await ctx.request("/api/postpartum/evaluate", {
    method: "POST",
    body: jsonBody({ input: vignette.input }),
  });
  assertEqual(evaluateResp.status, 200, "evaluate call should succeed");

  const recentResp = await ctx.request("/api/postpartum/audit/recent?limit=1");
  assertEqual(recentResp.status, 200, "recent history endpoint should succeed");
  const body = (await safeJson(recentResp)) as {
    events?: Array<{ eventId?: string }>;
  };

  const eventId = body.events?.[0]?.eventId;
  assertTruthy(eventId, "expected recent history event id");
  return eventId as string;
}

function readJsonl(pathToJsonl: string): unknown[] {
  if (!existsSync(pathToJsonl)) return [];
  const raw = readFileSync(pathToJsonl, "utf8").trim();
  if (!raw) return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((item): item is unknown => item !== null);
}

function backupAndResetLogs(paths: string[]): BackupFile[] {
  const backups: BackupFile[] = [];

  for (const path of paths) {
    const existed = existsSync(path);
    const content = existed ? readFileSync(path, "utf8") : "";
    backups.push({ path, existed, content });
    if (existed) {
      writeFileSync(path, "", "utf8");
    }
  }

  return backups;
}

function restoreLogs(backups: BackupFile[]) {
  for (const backup of backups) {
    if (!backup.existed) {
      if (existsSync(backup.path)) {
        unlinkSync(backup.path);
      }
      continue;
    }
    writeFileSync(backup.path, backup.content, "utf8");
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}; expected=${String(expected)}, actual=${String(actual)}`);
  }
}

function assertTruthy(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  await Promise.race([
    new Promise<void>((resolvePromise) => {
      child.once("exit", () => resolvePromise());
    }),
    sleep(timeoutMs),
  ]);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${formatError(error)}\n`);
  process.exit(1);
});
