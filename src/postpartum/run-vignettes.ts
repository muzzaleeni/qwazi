import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePostpartumTriage, loadPostpartumRulesFromFile } from "./evaluator";
import { PostpartumInput, PostpartumTriageLevel } from "./types";

interface Vignette {
  id: string;
  description: string;
  input: PostpartumInput;
  expected: {
    level: PostpartumTriageLevel;
    isEmergency?: boolean;
    requiredRedFlags?: string[];
    scoreTotalMin?: number;
    scoreTotalMax?: number;
    expectedEmergencyNumber?: string;
  };
}

interface RunnerOptions {
  dirPath: string;
  rulesPath: string;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rules = loadPostpartumRulesFromFile(options.rulesPath);
  const files = readdirSync(resolve(options.dirPath))
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    process.stderr.write(`No vignette .json files found in ${options.dirPath}\n`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const vignette = loadJson<Vignette>(`${options.dirPath}/${file}`);
    const result = evaluatePostpartumTriage(vignette.input, rules);
    const failures = validate(vignette, result);

    if (failures.length === 0) {
      passed += 1;
      process.stdout.write(`PASS ${vignette.id}: ${vignette.description}\n`);
    } else {
      failed += 1;
      process.stdout.write(`FAIL ${vignette.id}: ${vignette.description}\n`);
      for (const failure of failures) {
        process.stdout.write(`  - ${failure}\n`);
      }
      process.stdout.write(`  - actual level: ${result.level}\n`);
      process.stdout.write(`  - actual score: ${result.scoreBreakdown.total}\n`);
      const fired = result.redFlags.filter((rf) => rf.fired).map((rf) => rf.id);
      process.stdout.write(`  - fired red flags: ${fired.length > 0 ? fired.join(", ") : "none"}\n`);
    }
  }

  process.stdout.write(
    `\nPostpartum vignette summary: ${passed} passed, ${failed} failed, ${files.length} total.\n`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

function validate(
  vignette: Vignette,
  result: ReturnType<typeof evaluatePostpartumTriage>
): string[] {
  const errors: string[] = [];
  const expected = vignette.expected;
  const firedRedFlagIds = result.redFlags.filter((rf) => rf.fired).map((rf) => rf.id);

  if (result.level !== expected.level) {
    errors.push(`expected level ${expected.level}, got ${result.level}`);
  }

  if (expected.isEmergency !== undefined && result.isEmergency !== expected.isEmergency) {
    errors.push(`expected isEmergency=${expected.isEmergency}, got ${result.isEmergency}`);
  }

  if (
    expected.expectedEmergencyNumber !== undefined &&
    result.emergencyNumber !== expected.expectedEmergencyNumber
  ) {
    errors.push(
      `expected emergencyNumber=${expected.expectedEmergencyNumber}, got ${result.emergencyNumber}`
    );
  }

  if (expected.requiredRedFlags && expected.requiredRedFlags.length > 0) {
    for (const requiredId of expected.requiredRedFlags) {
      if (!firedRedFlagIds.includes(requiredId)) {
        errors.push(`expected red flag ${requiredId} to fire`);
      }
    }
  }

  if (
    expected.scoreTotalMin !== undefined &&
    result.scoreBreakdown.total < expected.scoreTotalMin
  ) {
    errors.push(
      `expected score >= ${expected.scoreTotalMin}, got ${result.scoreBreakdown.total}`
    );
  }

  if (
    expected.scoreTotalMax !== undefined &&
    result.scoreBreakdown.total > expected.scoreTotalMax
  ) {
    errors.push(
      `expected score <= ${expected.scoreTotalMax}, got ${result.scoreBreakdown.total}`
    );
  }

  return errors;
}

function parseArgs(args: string[]): RunnerOptions {
  const options: RunnerOptions = {
    dirPath: "test/postpartum-vignettes",
    rulesPath: "src/config/rules.postpartum.de.v1.json",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dir") {
      options.dirPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--rules") {
      options.rulesPath = args[i + 1];
      i += 1;
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
      "  npm run postpartum:test -- [--dir <vignettes-dir>] [--rules <path-to-rules-json>]",
      "",
      "Example:",
      "  npm run postpartum:test -- --dir test/postpartum-vignettes",
    ].join("\n")
  );
  process.stdout.write("\n");
}

function loadJson<T>(path: string): T {
  const absolutePath = resolve(path);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

main();
