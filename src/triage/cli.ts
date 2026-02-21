import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTriage, loadRulesFromFile } from "./evaluator";
import { TriageInput } from "./types";

interface CliOptions {
  inputPath?: string;
  rulesPath: string;
  pretty: boolean;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const input = loadTriageInput(options.inputPath);
  const rules = loadRulesFromFile(options.rulesPath);
  const result = evaluateTriage(input, rules);

  const json = options.pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result);
  process.stdout.write(`${json}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    rulesPath: "src/config/rules.v1.json",
    pretty: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--input") {
      options.inputPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--rules") {
      options.rulesPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--compact") {
      options.pretty = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run triage -- --input <path-to-input-json> [--rules <path-to-rules-json>] [--compact]",
      "",
      "Example:",
      "  npm run triage -- --input test/vignettes/04_urgent_high_score_no_red_flags.json",
    ].join("\n")
  );
  process.stdout.write("\n");
}

function loadJson<T>(path: string): T {
  const absolutePath = resolve(path);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

function loadTriageInput(path: string): TriageInput {
  const parsed = loadJson<unknown>(path);
  if (isRecord(parsed) && isRecord(parsed.input)) {
    return parsed.input as unknown as TriageInput;
  }
  return parsed as unknown as TriageInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main();
