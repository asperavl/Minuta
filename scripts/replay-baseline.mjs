import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runReplay,
  scoreReplay,
  evaluateAgainstGolden,
} from "./replay-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_GOLDEN = path.resolve(REPO_ROOT, "specs", "golden_issue_timeline.json");

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const maybeValue = argv[i + 1];
    if (!maybeValue || maybeValue.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = maybeValue;
    i += 1;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log("[replay] Starting baseline run...");
  const replay = await runReplay({
    runLabel: args["run-label"] || `baseline-${Date.now()}`,
    projectId: args["project-id"],
    transcriptsDir: args["transcripts-dir"],
    outputDir: args["output-dir"],
    extractPromptVariant: args["extract-prompt-variant"] || "B",
    extractMaxTokens: args["extract-max-tokens"]
      ? Number(args["extract-max-tokens"])
      : 4096,
    reconcilePromptVariant: args["reconcile-prompt-variant"] || "B",
    reconcileModelOverride: args["reconcile-model-override"] || null,
    timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : undefined,
  });

  const metrics = scoreReplay(replay);
  let golden = null;
  const goldenPath = args["golden-path"] || DEFAULT_GOLDEN;
  if (fs.existsSync(goldenPath)) {
    golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  }
  const goldenResult = golden
    ? evaluateAgainstGolden(replay, golden)
    : { pass: true, failures: ["No golden file found; skipped."] };

  const report = {
    replay_output: replay.output_path,
    run_id: replay.run_id,
    project_id: replay.project_id,
    metrics,
    golden: goldenResult,
  };

  console.log("[replay] Baseline run finished.");
  console.log(JSON.stringify(report, null, 2));
  if (!goldenResult.pass) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
