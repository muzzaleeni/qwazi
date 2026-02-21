import { readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { appendAuditEventJsonl, createPostpartumAuditEvent } from "../audit";
import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "../evaluator";
import { PostpartumInput } from "../types";

const PORT = Number(process.env.PORT ?? 4173);
const STATIC_DIR = resolve(__dirname, "static");
const RULES_PATH = resolve(process.cwd(), "src/config/rules.postpartum.de.v1.json");
const DEFAULT_AUDIT_LOG = resolve(process.cwd(), "logs/postpartum-web.jsonl");

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

main();
