import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

interface TestCase {
  id: string;
  description: string;
  run: (ctx: TestContext) => Promise<void>;
}

interface TestContext {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  restartServer: () => Promise<void>;
}

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

      const changeBefore = await fetchChanges(ctx, 200);

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

      const changeAfter = await fetchChanges(ctx, 200);
      assertEqual(changeAfter.length, changeBefore.length + 2, "expected two new change events");

      const latestTwo = changeAfter.slice(0, 2) as Array<Record<string, unknown>>;
      const first = latestTwo[0] ?? {};
      const second = latestTwo[1] ?? {};

      assertEqual(first.changeType, "WORKFLOW_UPDATE", "latest change should be WORKFLOW_UPDATE");
      assertEqual(second.changeType, "OUTCOME_UPDATE", "second latest should be OUTCOME_UPDATE");
      assertEqual(first.editor, "ops-b", "workflow editor mismatch");
      assertEqual(second.editor, "ops-b", "outcome editor mismatch");

      const firstAfter = (first.after ?? {}) as Record<string, unknown>;
      const secondAfter = (second.after ?? {}) as Record<string, unknown>;
      assertEqual(firstAfter.last_updated_by, "ops-b", "workflow last_updated_by mismatch");
      assertEqual(secondAfter.last_updated_by, "ops-b", "outcome last_updated_by mismatch");

      const recent = await fetchRecent(ctx, 200);
      const target = recent.find((item) => item.eventId === eventId);
      assertTruthy(target, "expected event in recent history after updates");
      assertEqual(target?.last_updated_by, "ops-b", "history event should reflect editor");
    },
  },
  {
    id: "WEB_T004",
    description: "Change-history endpoint is auth-protected and returns immutable edits after login.",
    run: async (ctx) => {
      await ctx.request("/api/postpartum/auth/logout", {
        method: "POST",
        body: jsonBody({}),
      });

      const withoutAuth = await ctx.request("/api/postpartum/audit/changes?limit=5");
      assertEqual(withoutAuth.status, 401, "expected 401 when requesting changes without auth");

      await loginAsCoordinator(ctx, "ops-c");
      const eventId = await createEvaluationEvent(ctx);
      const workflowResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId,
          workflow: { status: "WAITING", owner: "ops-c" },
        }),
      });
      assertEqual(workflowResp.status, 200, "expected 200 workflow update before reading changes");

      const withAuth = await ctx.request("/api/postpartum/audit/changes?limit=5");
      assertEqual(withAuth.status, 200, "expected 200 when requesting changes with auth");

      const body = (await safeJson(withAuth)) as {
        changes?: Array<Record<string, unknown>>;
        count?: number;
      };
      const changes = Array.isArray(body.changes) ? body.changes : [];
      assertTruthy(changes.length > 0, "expected at least one change event");
      assertEqual(typeof body.count, "number", "expected numeric count in change-history response");

      const latest = changes[0] ?? {};
      assertTruthy(latest.changeId, "expected changeId on change event");
      assertTruthy(latest.eventId, "expected eventId on change event");
      assertTruthy(latest.timestamp, "expected timestamp on change event");
    },
  },
  {
    id: "WEB_T005",
    description: "SQLite persistence survives server restart for cases and change history.",
    run: async (ctx) => {
      await loginAsCoordinator(ctx, "ops-r");
      const eventId = await createEvaluationEvent(ctx);

      const updateResp = await ctx.request("/api/postpartum/audit/workflow", {
        method: "POST",
        body: jsonBody({
          eventId,
          workflow: { status: "IN_PROGRESS", owner: "ops-r" },
        }),
      });
      assertEqual(updateResp.status, 200, "expected workflow update before restart");

      await ctx.restartServer();

      const recent = await fetchRecent(ctx, 200);
      assertTruthy(recent.some((item) => item.eventId === eventId), "event should persist after restart");

      await loginAsCoordinator(ctx, "ops-r");
      const changes = await fetchChanges(ctx, 200);
      assertTruthy(
        changes.some((item) => item.eventId === eventId),
        "change history should persist after restart"
      );
    },
  },
  {
    id: "WEB_T006",
    description: "Concurrent workflow updates keep data consistent and append both changes.",
    run: async (ctx) => {
      await loginAsCoordinator(ctx, "ops-q");
      const eventId = await createEvaluationEvent(ctx);

      const [first, second] = await Promise.all([
        ctx.request("/api/postpartum/audit/workflow", {
          method: "POST",
          body: jsonBody({
            eventId,
            workflow: { status: "IN_PROGRESS", owner: "ops-q" },
          }),
        }),
        ctx.request("/api/postpartum/audit/workflow", {
          method: "POST",
          body: jsonBody({
            eventId,
            workflow: { status: "WAITING", owner: "ops-q" },
          }),
        }),
      ]);

      assertEqual(first.status, 200, "first concurrent update should succeed");
      assertEqual(second.status, 200, "second concurrent update should succeed");

      const recent = await fetchRecent(ctx, 200);
      const target = recent.find((item) => item.eventId === eventId);
      assertTruthy(target, "event should exist after concurrent updates");
      const finalWorkflowStatus = (target?.workflow as { status?: string } | undefined)?.status;
      assertTruthy(
        finalWorkflowStatus === "IN_PROGRESS" || finalWorkflowStatus === "WAITING",
        "final workflow status should be one of concurrent updates"
      );

      const changes = await fetchChanges(ctx, 200);
      const matches = changes.filter((item) => item.eventId === eventId);
      assertTruthy(matches.length >= 2, "expected at least two change events for concurrent updates");
    },
  },
];

async function main() {
  const port = Number(process.env.POSTPARTUM_WEB_TEST_PORT ?? "4197");
  const dbPath = resolve(
    process.cwd(),
    `logs/postpartum-web-test-${process.pid}-${Date.now()}.sqlite`
  );
  cleanupSqliteFiles(dbPath);

  const harness = createHarness(port, dbPath);
  try {
    await harness.start();

    const ctx: TestContext = {
      request: harness.request,
      restartServer: harness.restart,
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
    await harness.stop();
    cleanupSqliteFiles(dbPath);
  }
}

function createHarness(port: number, dbPath: string) {
  let child: ReturnType<typeof spawn> | null = null;
  let cookieHeader = "";

  async function start() {
    if (child) return;
    child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "src/postpartum/web/server.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(port),
          COORDINATOR_PASSCODE: "qwazi-local",
          POSTPARTUM_DB_PATH: dbPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    await waitForServer(port, 10_000);
  }

  async function stop() {
    if (!child) return;
    child.kill("SIGTERM");
    await waitForExit(child, 2_000);
    child = null;
  }

  async function restart() {
    await stop();
    await start();
  }

  async function request(path: string, init: RequestInit = {}) {
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
      } else {
        cookieHeader = sessionCookie;
      }
    }

    return response;
  }

  return { start, stop, restart, request };
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

  const recent = await fetchRecent(ctx, 1);
  const eventId = recent[0]?.eventId;
  assertTruthy(eventId, "expected recent history event id");
  return eventId as string;
}

async function fetchRecent(ctx: TestContext, limit: number): Promise<Array<Record<string, unknown>>> {
  const response = await ctx.request(`/api/postpartum/audit/recent?limit=${limit}`);
  assertEqual(response.status, 200, "recent history endpoint should succeed");
  const body = (await safeJson(response)) as {
    events?: Array<Record<string, unknown>>;
  };
  return Array.isArray(body.events) ? body.events : [];
}

async function fetchChanges(ctx: TestContext, limit: number): Promise<Array<Record<string, unknown>>> {
  const response = await ctx.request(`/api/postpartum/audit/changes?limit=${limit}`);
  assertEqual(response.status, 200, "change history endpoint should succeed");
  const body = (await safeJson(response)) as {
    changes?: Array<Record<string, unknown>>;
  };
  return Array.isArray(body.changes) ? body.changes : [];
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

function cleanupSqliteFiles(pathToDb: string) {
  removeIfExists(pathToDb);
  removeIfExists(`${pathToDb}-wal`);
  removeIfExists(`${pathToDb}-shm`);
}

function removeIfExists(path: string) {
  if (!existsSync(path)) return;
  unlinkSync(path);
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

function sleep(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  await Promise.race([
    new Promise<void>((resolvePromise) => {
      child.once("exit", () => resolvePromise());
    }),
    sleep(timeoutMs),
  ]);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${formatError(error)}\n`);
  process.exit(1);
});
