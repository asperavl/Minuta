import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReplay, scoreReplay } from "./replay-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.resolve(REPO_ROOT, "artifacts", "analysis");

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
  const outputDir = path.resolve(args["output-dir"] || DEFAULT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });

  const promptVariants = ["A", "B"];
  const reconcileModels = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
  ];
  const extractionTokenCaps = [4096, 6144];

  const runs = [];
  let runCounter = 0;
  for (const promptVariant of promptVariants) {
    for (const reconcileModel of reconcileModels) {
      for (const extractTokens of extractionTokenCaps) {
        runCounter += 1;
        const runLabel = `matrix-${runCounter}-${promptVariant}-${extractTokens}-${reconcileModel
          .replace(/[^\w]+/g, "_")
          .slice(0, 24)}`;

        const replay = await runReplay({
          runLabel,
          projectId: args["project-id"],
          transcriptsDir: args["transcripts-dir"],
          outputDir,
          extractPromptVariant: promptVariant,
          extractMaxTokens: extractTokens,
          reconcilePromptVariant: promptVariant,
          reconcileModelOverride: reconcileModel,
          timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : undefined,
        });
        const metrics = scoreReplay(replay);

        runs.push({
          run_label: runLabel,
          replay_output: replay.output_path,
          project_id: replay.project_id,
          config: {
            prompt_variant: promptVariant,
            reconcile_model: reconcileModel,
            extract_max_tokens: extractTokens,
          },
          metrics,
        });
      }
    }
  }

  runs.sort((a, b) => {
    if (b.metrics.issue_recall !== a.metrics.issue_recall) {
      return b.metrics.issue_recall - a.metrics.issue_recall;
    }
    if (b.metrics.lifecycle_accuracy !== a.metrics.lifecycle_accuracy) {
      return b.metrics.lifecycle_accuracy - a.metrics.lifecycle_accuracy;
    }
    return a.metrics.false_positive_count - b.metrics.false_positive_count;
  });

  const report = {
    generated_at: new Date().toISOString(),
    ranking_basis:
      "issue_recall desc, lifecycle_accuracy desc, false_positive_count asc",
    runs,
  };

  const reportPath = path.join(
    outputDir,
    `matrix_report_${Date.now()}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ report_path: reportPath, top_run: runs[0] ?? null }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
