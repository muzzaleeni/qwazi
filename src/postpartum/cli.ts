import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "./evaluator";
import { PostpartumInput } from "./types";

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

  const input = loadPostpartumInput(options.inputPath);
  const rules = loadPostpartumRulesFromFile(options.rulesPath);
  const result = evaluatePostpartumTriage(input, rules);
  const output = options.pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result);
  process.stdout.write(`${output}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    rulesPath: "src/config/rules.postpartum.de.v1.json",
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
      "  npm run postpartum -- --input <path-to-input-json> [--rules <path-to-rules-json>] [--compact]",
      "",
      "Example:",
      "  npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json",
    ].join("\n")
  );
  process.stdout.write("\n");
}

function loadJson<T>(path: string): T {
  const absolutePath = resolve(path);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

function loadPostpartumInput(path: string): PostpartumInput {
  const parsed = loadJson<unknown>(path);
  if (isRecord(parsed) && isRecord(parsed.input)) {
    return parsed.input as unknown as PostpartumInput;
  }
  return parsed as unknown as PostpartumInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main();
