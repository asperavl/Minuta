import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TRANSCRIPTS_DIR = path.resolve(REPO_ROOT, "..", "test_transcripts");
const DEFAULT_OUTPUT_DIR = path.resolve(REPO_ROOT, "artifacts", "analysis");
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_TRIGGER_WAIT_MS = 12000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getRuntimeEnv() {
  const envFile = parseDotEnv(path.resolve(REPO_ROOT, ".env.local"));
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    envFile.NEXT_PUBLIC_SUPABASE_URL ||
    envFile.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE URL in env (.env.local or process env).");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env.");
  }

  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

function extractDateFromFilename(filename) {
  const zoomMatch = filename.match(/GMT(\d{4})(\d{2})(\d{2})/);
  if (zoomMatch) return `${zoomMatch[1]}-${zoomMatch[2]}-${zoomMatch[3]}`;

  const isoMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const usMatch = filename.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  return null;
}

function normalizeText(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(raw) {
  return normalizeText(raw)
    .split(" ")
    .filter((w) => w.length > 2);
}

function overlapScore(aRaw, bRaw) {
  const a = new Set(tokenize(aRaw));
  const b = new Set(tokenize(bRaw));
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) {
    if (b.has(w)) common += 1;
  }
  return common / Math.max(a.size, b.size);
}

function topicLooksIssueLevel(topic) {
  const text = `${topic?.title ?? ""} ${topic?.summary ?? ""} ${topic?.supporting_quote ?? ""}`;
  return /\b(issue|bug|defect|incident|outage|error|blocked|blocker|performance|latency|security|vulnerability|crash|failure|api|integration|delay|onboarding|feature request)\b/i.test(
    text
  );
}

function findIssueByKeyword(issues, keyword) {
  const needle = normalizeText(keyword);
  return (
    issues.find((issue) => normalizeText(`${issue.title ?? ""} ${issue.description ?? ""}`).includes(needle)) ||
    null
  );
}

async function waitForMeetingCompletion(supabase, meetingId, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollMs = Number(options.pollMs ?? 1800);
  const statusLogEveryMs = Number(options.statusLogEveryMs ?? 12000);
  const stallNudgeMs = Number(options.stallNudgeMs ?? 45000);
  const startedAt = Date.now();
  let lastStatusSignature = "";
  let lastStatusLogAt = 0;
  let readyToReconcileSince = 0;
  let nudgeSent = false;
  let lastSeen = null;

  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await supabase
      .from("meetings")
      .select("id, file_name, processing_status, processing_stage, processing_error, summary, sort_order")
      .eq("id", meetingId)
      .single();
    if (error) throw error;
    lastSeen = data;

    const now = Date.now();
    const elapsedMs = now - startedAt;
    const signature = `${data.processing_status}|${data.processing_stage ?? "none"}|${data.processing_error ?? ""}`;
    const shouldLog =
      signature !== lastStatusSignature || now - lastStatusLogAt >= statusLogEveryMs;
    if (shouldLog && typeof options.onStatus === "function") {
      await options.onStatus(data, elapsedMs);
      lastStatusSignature = signature;
      lastStatusLogAt = now;
    }

    const stage = data.processing_stage ?? "";
    if (stage === "ready_to_reconcile") {
      if (!readyToReconcileSince) readyToReconcileSince = now;
      if (
        !nudgeSent &&
        now - readyToReconcileSince >= stallNudgeMs &&
        typeof options.onReadyToReconcileStall === "function"
      ) {
        await options.onReadyToReconcileStall(data, elapsedMs);
        nudgeSent = true;
      }
    } else {
      readyToReconcileSince = 0;
      nudgeSent = false;
    }

    if (data.processing_status === "complete" || data.processing_status === "failed") {
      return data;
    }
    await sleep(pollMs);
  }
  const timeoutInfo = lastSeen
    ? `Last state: status=${lastSeen.processing_status}, stage=${lastSeen.processing_stage ?? "none"}, error=${lastSeen.processing_error ?? "none"}`
    : "No last meeting state available.";
  throw new Error(
    `Timed out waiting for meeting ${meetingId} to complete. ${timeoutInfo}`
  );
}

async function getMeetingSnapshot(supabase, projectId, meeting) {
  const { data: issueEvents, error: issueEventsErr } = await supabase
    .from("extractions")
    .select("id, issue_event_type, issue_candidate_title, description, context, supporting_quote")
    .eq("meeting_id", meeting.id)
    .eq("type", "issue_event");
  if (issueEventsErr) throw issueEventsErr;

  const { data: diagnostics, error: diagErr } = await supabase
    .from("analysis_diagnostics")
    .select("stage, prompt_version, model, temperature, max_tokens, finish_reason, parse_success, item_counts, flags, payload, error, created_at, run_id")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: true });
  if (diagErr) throw diagErr;

  const { data: issues, error: issuesErr } = await supabase
    .from("issues")
    .select("id, title, description, status, opened_in, resolved_in, obsoleted_in")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (issuesErr) throw issuesErr;

  const { data: mentions, error: mentionsErr } = await supabase
    .from("issue_mentions")
    .select("id, issue_id, meeting_id, mention_type, context, supporting_quote, created_at")
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: true });
  if (mentionsErr) throw mentionsErr;

  return {
    meeting: {
      id: meeting.id,
      sort_order: meeting.sort_order,
      file_name: meeting.file_name,
      processing_status: meeting.processing_status,
      processing_error: meeting.processing_error,
    },
    topics: meeting.summary?.topics ?? [],
    issue_events: issueEvents ?? [],
    diagnostics: diagnostics ?? [],
    issues_after_meeting: issues ?? [],
    issue_mentions_in_meeting: mentions ?? [],
  };
}

async function createReplayProject(supabase, runLabel) {
  const { data: ownerProject, error: ownerErr } = await supabase
    .from("projects")
    .select("owner_id")
    .limit(1)
    .single();
  if (ownerErr || !ownerProject?.owner_id) {
    throw new Error(
      "Could not infer project owner_id. Pass an existing --project-id instead."
    );
  }
  const { data: newProject, error: projectErr } = await supabase
    .from("projects")
    .insert({
      name: `Replay ${runLabel}`,
      owner_id: ownerProject.owner_id,
    })
    .select("id, name")
    .single();
  if (projectErr || !newProject) {
    throw new Error(`Failed to create replay project: ${projectErr?.message ?? "unknown error"}`);
  }
  return newProject.id;
}

export function scoreReplay(replayResult) {
  const snapshots = replayResult?.meeting_snapshots ?? [];
  const allIssueTopics = [];

  let issueTopicsTotal = 0;
  let issueTopicsCovered = 0;
  let lifecycleChecks = 0;
  let lifecyclePasses = 0;
  let extractionFlagCount = 0;
  let reconciliationFlagCount = 0;

  for (const snap of snapshots) {
    const issues = snap.issues_after_meeting ?? [];
    const issueTopics = (snap.topics ?? []).filter(topicLooksIssueLevel);
    allIssueTopics.push(...issueTopics);
    issueTopicsTotal += issueTopics.length;

    for (const topic of issueTopics) {
      const topicText = `${topic?.title ?? ""} ${topic?.summary ?? ""}`;
      const matched = issues.some((issue) => {
        const issueText = `${issue?.title ?? ""} ${issue?.description ?? ""}`;
        return overlapScore(topicText, issueText) >= 0.23;
      });
      if (matched) issueTopicsCovered += 1;
    }

    for (const ev of snap.issue_events ?? []) {
      const expectedStatus =
        ev.issue_event_type === "resolved"
          ? "resolved"
          : ev.issue_event_type === "obsoleted"
            ? "obsolete"
            : ev.issue_event_type === "reopened" || ev.issue_event_type === "raised"
              ? "open"
              : null;
      if (!expectedStatus) continue;

      lifecycleChecks += 1;
      const title = ev.issue_candidate_title ?? ev.description ?? "";
      const matchingIssue = issues.find((issue) => {
        const text = `${issue?.title ?? ""} ${issue?.description ?? ""}`;
        return overlapScore(title, text) >= 0.2;
      });
      if (matchingIssue && matchingIssue.status === expectedStatus) lifecyclePasses += 1;
    }

    const diagnostics = snap.diagnostics ?? [];
    const extractDiag = diagnostics.find((d) => d.stage === "extract");
    const reconcileDiag = diagnostics.find((d) => d.stage === "reconcile");
    extractionFlagCount += Number(
      extractDiag?.flags?.topic_marked_resolved_without_resolution_quote ?? 0
    );
    reconciliationFlagCount += Number(
      reconcileDiag?.flags?.issue_level_topic_unmatched ?? 0
    );
  }

  const finalIssues = snapshots.length
    ? snapshots[snapshots.length - 1].issues_after_meeting ?? []
    : [];
  let falsePositiveCount = 0;
  for (const issue of finalIssues) {
    const issueText = `${issue?.title ?? ""} ${issue?.description ?? ""}`;
    const matchesTopic = allIssueTopics.some((topic) => {
      const topicText = `${topic?.title ?? ""} ${topic?.summary ?? ""}`;
      return overlapScore(topicText, issueText) >= 0.23;
    });
    if (!matchesTopic) falsePositiveCount += 1;
  }

  return {
    issue_recall: issueTopicsTotal ? issueTopicsCovered / issueTopicsTotal : 1,
    lifecycle_accuracy: lifecycleChecks ? lifecyclePasses / lifecycleChecks : 1,
    false_positive_count: falsePositiveCount,
    counts: {
      issue_topics_total: issueTopicsTotal,
      issue_topics_covered: issueTopicsCovered,
      lifecycle_checks: lifecycleChecks,
      lifecycle_passes: lifecyclePasses,
      final_issue_count: finalIssues.length,
    },
    stage_attribution: {
      extraction_flags: extractionFlagCount,
      reconciliation_flags: reconciliationFlagCount,
    },
  };
}

export function evaluateAgainstGolden(replayResult, goldenSpec) {
  const failures = [];
  const snapshots = replayResult?.meeting_snapshots ?? [];
  if (!goldenSpec || !Array.isArray(goldenSpec.meetings)) {
    return { pass: true, failures: [] };
  }

  for (let idx = 0; idx < goldenSpec.meetings.length; idx += 1) {
    const expected = goldenSpec.meetings[idx];
    const snap = snapshots[idx];
    if (!snap) {
      failures.push(`Missing snapshot for meeting index ${idx + 1}.`);
      continue;
    }
    const issues = snap.issues_after_meeting ?? [];

    for (const keyword of expected.must_include_issue_keywords ?? []) {
      if (!findIssueByKeyword(issues, keyword)) {
        failures.push(
          `Meeting ${idx + 1}: missing expected issue keyword "${keyword}".`
        );
      }
    }

    const statusByKeyword = expected.expected_status_by_keyword ?? {};
    for (const [keyword, wantedStatus] of Object.entries(statusByKeyword)) {
      const issue = findIssueByKeyword(issues, keyword);
      if (!issue) {
        failures.push(
          `Meeting ${idx + 1}: could not find issue for keyword "${keyword}" to validate status "${wantedStatus}".`
        );
        continue;
      }
      if (issue.status !== wantedStatus) {
        failures.push(
          `Meeting ${idx + 1}: keyword "${keyword}" expected status "${wantedStatus}" but found "${issue.status}".`
        );
      }
    }
  }

  if (snapshots.length > 0 && goldenSpec.final_expected_status_by_keyword) {
    const finalIssues = snapshots[snapshots.length - 1].issues_after_meeting ?? [];
    for (const [keyword, wantedStatus] of Object.entries(
      goldenSpec.final_expected_status_by_keyword
    )) {
      const issue = findIssueByKeyword(finalIssues, keyword);
      if (!issue) {
        failures.push(
          `Final state: missing issue for keyword "${keyword}" (expected ${wantedStatus}).`
        );
        continue;
      }
      if (issue.status !== wantedStatus) {
        failures.push(
          `Final state: keyword "${keyword}" expected "${wantedStatus}" but found "${issue.status}".`
        );
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

export async function runReplay(options = {}) {
  const runtimeEnv = getRuntimeEnv();
  const supabase = createClient(runtimeEnv.supabaseUrl, runtimeEnv.serviceRoleKey);

  const transcriptsDir = path.resolve(
    options.transcriptsDir || DEFAULT_TRANSCRIPTS_DIR
  );
  if (!fs.existsSync(transcriptsDir)) {
    throw new Error(`Transcript directory not found: ${transcriptsDir}`);
  }

  const files = fs
    .readdirSync(transcriptsDir)
    .filter((f) => f.endsWith(".txt") || f.endsWith(".vtt"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (files.length === 0) {
    throw new Error(`No transcript files found in ${transcriptsDir}`);
  }

  const runId = options.runId || randomUUID();
  const runLabel = options.runLabel || `replay-${runId.slice(0, 8)}`;

  let projectId = options.projectId || null;
  let createdProject = false;
  if (!projectId) {
    projectId = await createReplayProject(supabase, runLabel);
    createdProject = true;
  }

  const edgeFnUrl = `${runtimeEnv.supabaseUrl}/functions/v1/process-transcript`;
  const reconcileFnUrl = `${runtimeEnv.supabaseUrl}/functions/v1/reconcile-project`;

  const meetingSnapshots = [];
  for (let idx = 0; idx < files.length; idx += 1) {
    const fileName = files[idx];
    const fullPath = path.join(transcriptsDir, fileName);
    const rawText = fs.readFileSync(fullPath, "utf8");
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const meetingDate = extractDateFromFilename(fileName);

    const { data: insertedMeeting, error: meetingErr } = await supabase
      .from("meetings")
      .insert({
        project_id: projectId,
        file_name: fileName,
        raw_text: rawText,
        meeting_date: meetingDate,
        sort_order: idx + 1,
        word_count: wordCount,
        speaker_count: 0,
        processing_status: "processing",
      })
      .select("id")
      .single();
    if (meetingErr || !insertedMeeting?.id) {
      throw new Error(
        `Failed to insert meeting for ${fileName}: ${meetingErr?.message ?? "unknown error"}`
      );
    }

    const body = {
      meetingId: insertedMeeting.id,
      isHistoricalInsert: false,
      analysisRunId: runId,
      extractPromptVariant: options.extractPromptVariant ?? "A",
      extractMaxTokens: Number(options.extractMaxTokens ?? 4096),
      reconcilePromptVariant: options.reconcilePromptVariant ?? "A",
      reconcileModelOverride: options.reconcileModelOverride ?? null,
    };

    console.log(
      `[replay] [${idx + 1}/${files.length}] Triggering ${fileName} (meetingId=${insertedMeeting.id})`
    );

    const triggerReq = fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtimeEnv.serviceRoleKey}`,
      },
      body: JSON.stringify(body),
    });

    const triggerWaitMs = Number(
      options.triggerWaitMs ?? DEFAULT_TRIGGER_WAIT_MS
    );
    const firstTriggerOutcome = await Promise.race([
      triggerReq.then(() => "response"),
      sleep(triggerWaitMs).then(() => "timeout"),
    ]);

    if (firstTriggerOutcome === "response") {
      const triggerRes = await triggerReq;
      if (!triggerRes.ok) {
        const text = await triggerRes.text();
        throw new Error(
          `process-transcript failed for ${fileName}: ${triggerRes.status} ${text}`
        );
      }
      console.log(
        `[replay] [${idx + 1}/${files.length}] ${fileName}: trigger acknowledged (${triggerRes.status})`
      );
    } else {
      console.log(
        `[replay] [${idx + 1}/${files.length}] ${fileName}: trigger still running after ${Math.floor(
          triggerWaitMs / 1000
        )}s, switching to DB polling`
      );
      triggerReq
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.warn(
              `[replay] [${idx + 1}/${files.length}] ${fileName}: delayed trigger response ${res.status} ${text}`
            );
          }
        })
        .catch((err) => {
          console.warn(
            `[replay] [${idx + 1}/${files.length}] ${fileName}: delayed trigger error:`,
            err?.message ?? String(err)
          );
        });
    }

    const completeMeeting = await waitForMeetingCompletion(
      supabase,
      insertedMeeting.id,
      {
        timeoutMs: Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        onStatus: async (meeting, elapsedMs) => {
          const elapsedSec = Math.floor(elapsedMs / 1000);
          console.log(
            `[replay] [${idx + 1}/${files.length}] ${fileName}: status=${meeting.processing_status}, stage=${meeting.processing_stage ?? "none"}, elapsed=${elapsedSec}s`
          );
        },
        onReadyToReconcileStall: async (_meeting, elapsedMs) => {
          const elapsedSec = Math.floor(elapsedMs / 1000);
          console.log(
            `[replay] [${idx + 1}/${files.length}] ${fileName}: ready_to_reconcile stall detected at ${elapsedSec}s, nudging reconcile-project`
          );
          const nudgeBody = {
            projectId,
            mode: "incremental",
            meetingIds: [insertedMeeting.id],
            analysisRunId: runId,
            reconcilePromptVariant: options.reconcilePromptVariant ?? "A",
            reconcileModelOverride: options.reconcileModelOverride ?? null,
          };
          const nudgeRes = await fetch(reconcileFnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${runtimeEnv.serviceRoleKey}`,
            },
            body: JSON.stringify(nudgeBody),
          });
          if (!nudgeRes.ok) {
            const text = await nudgeRes.text().catch(() => "");
            console.warn(
              `[replay] reconcile nudge failed (${nudgeRes.status}): ${text}`
            );
          } else {
            console.log(
              `[replay] reconcile nudge accepted (${nudgeRes.status}).`
            );
          }
        },
      }
    );

    console.log(
      `[replay] [${idx + 1}/${files.length}] ${fileName}: completed with status=${completeMeeting.processing_status}`
    );
    const snapshot = await getMeetingSnapshot(supabase, projectId, completeMeeting);
    meetingSnapshots.push(snapshot);
  }

  const result = {
    run_id: runId,
    run_label: runLabel,
    project_id: projectId,
    created_project: createdProject,
    config: {
      extract_prompt_variant: options.extractPromptVariant ?? "A",
      extract_max_tokens: Number(options.extractMaxTokens ?? 4096),
      reconcile_prompt_variant: options.reconcilePromptVariant ?? "A",
      reconcile_model_override: options.reconcileModelOverride ?? null,
      transcripts_dir: transcriptsDir,
    },
    meeting_snapshots: meetingSnapshots,
  };

  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${runLabel}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

  return { ...result, output_path: outputPath };
}

if (import.meta.url === `file://${__filename}`) {
  const args = parseArgs();
  runReplay({
    runId: args["run-id"],
    runLabel: args["run-label"],
    projectId: args["project-id"],
    transcriptsDir: args["transcripts-dir"],
    outputDir: args["output-dir"],
    extractPromptVariant: args["extract-prompt-variant"] || "A",
    extractMaxTokens: args["extract-max-tokens"]
      ? Number(args["extract-max-tokens"])
      : 4096,
    reconcilePromptVariant: args["reconcile-prompt-variant"] || "A",
    reconcileModelOverride: args["reconcile-model-override"] || null,
    timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : DEFAULT_TIMEOUT_MS,
    triggerWaitMs: args["trigger-wait-ms"]
      ? Number(args["trigger-wait-ms"])
      : DEFAULT_TRIGGER_WAIT_MS,
  })
    .then((result) => {
      const metrics = scoreReplay(result);
      console.log(JSON.stringify({ output_path: result.output_path, metrics }, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
