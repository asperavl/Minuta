# Analysis Replay Scripts

## Baseline Replay

Runs transcript -> extraction -> reconciliation sequentially, stores per-stage snapshots, scores recall/lifecycle, and evaluates the golden acceptance file.

```bash
npm run replay:baseline
```

Optional flags:

- `--project-id <uuid>`: reuse an existing project instead of creating a replay project
- `--transcripts-dir <path>`: override transcript directory
- `--extract-prompt-variant A|B`
- `--reconcile-prompt-variant A|B`
- `--reconcile-model-override <model>`
- `--extract-max-tokens <int>`
- `--golden-path <path>`
- `--timeout-ms <int>`: per-meeting wait timeout (default 480000)
- `--trigger-wait-ms <int>`: max time to wait for immediate edge-function HTTP response before switching to DB polling (default 12000)

Runtime behavior:

- The runner now logs live stage/status updates while each meeting is processing.
- If a meeting sits in `ready_to_reconcile` for ~45s, the runner automatically nudges `reconcile-project`.

## Matrix Evaluation

Runs fixed matrix:

- prompt variant: `A`, `B`
- reconcile model: Scout vs 70B
- extraction token caps: 4096 vs 6144

```bash
npm run replay:matrix
```

Writes a ranked JSON report in `artifacts/analysis/`.
