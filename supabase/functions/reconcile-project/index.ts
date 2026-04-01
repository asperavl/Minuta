// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Groq from "https://esm.sh/groq-sdk@0.37.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
const DEFAULT_RECONCILE_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const FALLBACK_RECONCILE_MODEL = "llama-3.3-70b-versatile";
const RECONCILE_PROMPT_VERSION_A = "reconcile_v1_baseline_2026_04_01";
const RECONCILE_PROMPT_VERSION_B = "reconcile_v2_coverage_strict_2026_04_01";

type PromptVariant = "A" | "B";
type ReconcileRunConfig = {
  analysisRunId?: string | null;
  reconcilePromptVariant: PromptVariant;
  reconcileModelOverride?: string | null;
};
type GroqCallResult = {
  content: string;
  finishReason: string | null;
  model: string;
};
type DiagnosticInsert = {
  project_id: string;
  meeting_id: string;
  run_id?: string | null;
  stage: "extract" | "verify" | "reconcile";
  prompt_version?: string | null;
  model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  finish_reason?: string | null;
  parse_success: boolean;
  item_counts?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error?: string | null;
};

type ReconcileMode = "incremental" | "full";

type ReconItem = {
  id: string;
  source_type: "topic" | "decision" | "action_item" | "issue_event";
  title?: string | null;
  description?: string | null;
  status_in_meeting?: string | null;
  supporting_quote?: string | null;
  context?: string | null;
  issue_event_type?: string | null;
};

type IssueRow = {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
};

const VALID_MENTION_TYPES = new Set([
  "raised",
  "discussed",
  "escalated",
  "resolved",
  "obsoleted",
  "reopened",
]);
const VALID_STATUSES = new Set(["open", "in_progress", "resolved", "obsolete"]);
const VALID_EVENT_TYPES = new Set(["raised", "resolved", "reopened", "obsoleted"]);
const RESOLUTION_HINT_RE =
  /\b(resolved|closed|fixed|complete|completed|done|behind us)\b/i;
const ISSUE_SIGNAL_RE =
  /\b(issue|bug|defect|incident|outage|error|blocked|blocker|performance|latency|security|vulnerability|crash|failure|feature request|regression|risk|dependency|delay|integration|cors|auth)\b/i;
const MATCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "been",
  "being",
  "into",
  "onto",
  "over",
  "under",
  "after",
  "before",
  "team",
  "meeting",
  "discussed",
  "discussion",
  "update",
  "updated",
  "action",
  "item",
  "items",
  "decision",
  "decisions",
  "issue",
  "issues",
  "feature",
  "request",
  "requests",
  "open",
  "opened",
  "closed",
  "resolved",
  "reopened",
  "status",
]);

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePromptVariant(raw: unknown): PromptVariant {
  if (typeof raw === "string" && raw.toUpperCase() === "B") return "B";
  return "A";
}

function reconcilePromptVersion(variant: PromptVariant): string {
  return variant === "B"
    ? RECONCILE_PROMPT_VERSION_B
    : RECONCILE_PROMPT_VERSION_A;
}

async function insertDiagnostic(supabase: any, entry: DiagnosticInsert): Promise<void> {
  const payload = {
    project_id: entry.project_id,
    meeting_id: entry.meeting_id,
    run_id: entry.run_id ?? "default",
    stage: entry.stage,
    prompt_version: entry.prompt_version ?? null,
    model: entry.model ?? null,
    temperature: entry.temperature ?? null,
    max_tokens: entry.max_tokens ?? null,
    finish_reason: entry.finish_reason ?? null,
    parse_success: entry.parse_success,
    item_counts: entry.item_counts ?? {},
    flags: entry.flags ?? {},
    payload: entry.payload ?? null,
    error: entry.error ?? null,
  };

  const { error } = await supabase
    .from("analysis_diagnostics")
    .upsert(payload, { onConflict: "meeting_id,stage,run_id" });
  if (error) {
    console.warn("[reconcile-project] Failed to insert diagnostic:", error.message);
  }
}

function safeParseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/<thought_process>[\s\S]*?<\/thought_process>/i, "");

    const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (mdMatch) {
      cleaned = mdMatch[1].trim();
    } else {
      const firstBrace = cleaned.indexOf("{");
      const firstBracket = cleaned.indexOf("[");
      const lastBrace = cleaned.lastIndexOf("}");
      const lastBracket = cleaned.lastIndexOf("]");

      let start = -1;
      let end = -1;

      if (firstBrace !== -1 && firstBracket !== -1) start = Math.min(firstBrace, firstBracket);
      else if (firstBrace !== -1) start = firstBrace;
      else if (firstBracket !== -1) start = firstBracket;

      if (lastBrace !== -1 && lastBracket !== -1) end = Math.max(lastBrace, lastBracket) + 1;
      else if (lastBrace !== -1) end = lastBrace + 1;
      else if (lastBracket !== -1) end = lastBracket + 1;

      if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.substring(start, end);
      }
    }

    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.warn("safeParseJSON Error:", err);
    return null;
  }
}

function sanitizeReconcileMode(raw: unknown): ReconcileMode {
  if (typeof raw === "string" && raw.toLowerCase() === "full") return "full";
  return "incremental";
}

function sanitizeMeetingIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    )
  );
}

function mergeMeetingIds(existing: string[] = [], incoming: string[] = []): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

function normalizeText(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(raw: string | null | undefined): string[] {
  return normalizeText(raw)
    .split(" ")
    .filter((w) => w.length > 2);
}

function overlapScore(aRaw: string, bRaw: string): number {
  const a = new Set(tokenize(aRaw));
  const b = new Set(tokenize(bRaw));
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.max(a.size, b.size);
}

function discriminativeTokens(raw: string | null | undefined): string[] {
  return tokenize(raw).filter((tok) => tok.length >= 4 && !MATCH_STOPWORDS.has(tok));
}

function sharesDiscriminativeToken(aRaw: string, bRaw: string): boolean {
  const a = new Set(discriminativeTokens(aRaw));
  const b = new Set(discriminativeTokens(bRaw));
  if (a.size === 0 || b.size === 0) return false;
  for (const tok of a) if (b.has(tok)) return true;
  return false;
}

function findBestIssueMatch(text: string, issues: IssueRow[]): IssueRow | null {
  let best: IssueRow | null = null;
  let bestScore = 0;
  for (const issue of issues) {
    const basis = `${issue.title ?? ""} ${issue.description ?? ""}`;
    const score = overlapScore(text, basis);
    if (score > bestScore) {
      bestScore = score;
      best = issue;
    }
  }
  return bestScore >= 0.28 ? best : null;
}

function findBestIssueMatchWithAnchor(text: string, issues: IssueRow[]): IssueRow | null {
  let best: IssueRow | null = null;
  let bestScore = 0;
  for (const issue of issues) {
    const basis = `${issue.title ?? ""} ${issue.description ?? ""}`;
    if (!sharesDiscriminativeToken(text, basis)) continue;
    const score = overlapScore(text, basis);
    if (score > bestScore) {
      bestScore = score;
      best = issue;
    }
  }
  return bestScore >= 0.14 ? best : null;
}

function sanitizeMentionType(raw: string | null | undefined): string {
  if (raw && VALID_MENTION_TYPES.has(raw)) return raw;
  return "discussed";
}

function sanitizeIssueStatus(raw: string | null | undefined): string {
  if (raw && VALID_STATUSES.has(raw)) return raw;
  return "open";
}

function sanitizeIssueEventType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  return VALID_EVENT_TYPES.has(normalized) ? normalized : null;
}

function supportingQuoteLooksResolved(quote: string | null | undefined): boolean {
  if (!quote) return false;
  return RESOLUTION_HINT_RE.test(quote);
}

function topicLooksResolved(item: ReconItem | null | undefined): boolean {
  if (!item || item.source_type !== "topic") return false;
  const status = (item.status_in_meeting ?? "").toLowerCase();
  if (status === "resolved") {
    return supportingQuoteLooksResolved(item.supporting_quote);
  }
  if (status === "unresolved" || status === "deferred" || status === "uncertain") {
    return false;
  }
  // Only trust direct quote evidence for implicit resolution, not descriptive summary text.
  return supportingQuoteLooksResolved(item.supporting_quote);
}

function topicLooksIssueSignal(item: ReconItem | null | undefined): boolean {
  if (!item || item.source_type !== "topic") return false;
  const text = `${item.title ?? ""} ${item.description ?? ""} ${item.supporting_quote ?? ""}`;
  return ISSUE_SIGNAL_RE.test(text);
}

function issueEventLooksTrackable(item: ReconItem | null | undefined): boolean {
  if (!item || item.source_type !== "issue_event") return false;
  const text = `${item.title ?? ""} ${item.description ?? ""} ${item.context ?? ""} ${item.supporting_quote ?? ""}`;
  return ISSUE_SIGNAL_RE.test(text);
}

function canCreateIssueFromItem(item: ReconItem): boolean {
  if (item.source_type === "topic") return topicLooksIssueSignal(item);
  if (item.source_type === "decision") {
    return ISSUE_SIGNAL_RE.test(
      `${item.title ?? ""} ${item.description ?? ""} ${item.context ?? ""}`
    );
  }
  if (item.source_type === "issue_event") {
    return item.issue_event_type === "raised";
  }
  return false;
}

function buildReconciliationPrompt(
  topics: ReconItem[],
  decisions: ReconItem[],
  actionItems: ReconItem[],
  issueEvents: ReconItem[],
  existingIssues: IssueRow[],
  promptVariant: PromptVariant
): string {
  const issueIds = (existingIssues ?? []).map((i) => i.id);
  const strictCoverageRules =
    promptVariant === "B"
      ? `
- Coverage strictness:
  - Every ISSUE_EVENT must appear exactly once in matches.
  - Every issue-level TOPIC (bug/blocker/incident/risk/feature request) must appear exactly once in matches.
  - If you intentionally ignore an item, still return a match entry with issue_id=null, is_new_issue=false, and context prefixed with "IGNORED:" explaining why.
  - Never silently drop items.`
      : "";

  return `You are a strict issue reconciler for engineering meetings.

Return ONLY raw JSON (no markdown, no prose, no thought process).

Goal:
1. Map meeting items to existing issues whenever possible.
2. Create new issues only for genuinely new product defects, blockers, incidents, or significant feature requests.
3. Capture lifecycle updates accurately (especially resolved/reopened/escalated).

Hard constraints:
- issue_id must be either null or EXACTLY one of these existing IDs: ${JSON.stringify(issueIds)}
- Never invent placeholder IDs like "performance_issue_id".
- TOPIC items (ids like "topic-...") can create new issues.
- DECISION items can create new issues only when they clearly describe a defect/blocker/incident/performance problem/new feature request.
- ACTION_ITEM items must never set is_new_issue=true.
- ISSUE_EVENT items should usually map to existing issues when possible.
- If a topic clearly indicates an existing issue is resolved/fixed/closed, set mention_type="resolved" and new_status="resolved".
- mention_type must be one of: raised, discussed, escalated, resolved, obsoleted, reopened
- new_status must be one of: open, in_progress, resolved, obsolete
- Return at most one match per extraction_id.
${strictCoverageRules}

Output schema:
{
  "matches": [
    {
      "extraction_id": "<string id from input>",
      "issue_id": "<existing issue UUID or null>",
      "is_new_issue": <boolean>,
      "new_issue_title": "<title or null>",
      "new_issue_description": "<description or null>",
      "mention_type": "raised | discussed | escalated | resolved | obsoleted | reopened",
      "new_status": "open | in_progress | resolved | obsolete",
      "context": "<1 sentence>",
      "supporting_quote": "<verbatim quote or null>"
    }
  ]
}

EXISTING ISSUES:
${JSON.stringify(existingIssues ?? [])}

EXTRACTED ISSUE EVENTS:
${JSON.stringify(issueEvents)}

EXTRACTED TOPICS:
${JSON.stringify(topics)}

EXTRACTED DECISIONS:
${JSON.stringify(decisions)}

EXTRACTED ACTION ITEMS:
${JSON.stringify(actionItems)}`;
}

async function groqWithRetry(
  model: string,
  prompt: string,
  retries = 5,
  maxTokens = 2048
): Promise<GroqCallResult> {
  const groq = new Groq({ apiKey: GROQ_API_KEY });
  for (let i = 0; i < retries; i++) {
    try {
      const res = await groq.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: maxTokens,
      });
      return {
        content: res.choices[0].message.content ?? "",
        finishReason: res.choices[0].finish_reason ?? null,
        model,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status ?? err?.cause?.status ?? null;
      const message = String(err?.message ?? err ?? "");
      const isRateLimited =
        status === 429 ||
        message.toLowerCase().includes("rate limit") ||
        message.toLowerCase().includes("too many requests") ||
        message.includes("429");

      console.warn(
        `Groq attempt ${i + 1}/${retries} failed for ${model} (status=${status ?? "unknown"}):`,
        message
      );
      if (i === retries - 1) throw err;

      const base = isRateLimited ? 3500 : 800;
      const cap = isRateLimited ? 30000 : 10000;
      const jitter = Math.floor(Math.random() * 700);
      const delay = Math.min(cap, base * Math.pow(2, i)) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

async function groqReconcileCall(
  prompt: string,
  modelOverride?: string | null
): Promise<GroqCallResult> {
  const models = modelOverride?.trim()
    ? [modelOverride.trim(), DEFAULT_RECONCILE_MODEL, FALLBACK_RECONCILE_MODEL]
    : [DEFAULT_RECONCILE_MODEL, FALLBACK_RECONCILE_MODEL];

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      return await groqWithRetry(model, prompt, 4, 2048);
    } catch (err) {
      lastErr = err;
      console.warn(`[reconcile-project] Model ${model} failed; trying fallback.`);
    }
  }

  throw lastErr ?? new Error("All reconciliation model attempts failed");
}

async function ensureReconcileStateRow(supabase: any, projectId: string): Promise<void> {
  await supabase
    .from("project_reconcile_state")
    .upsert(
      {
        project_id: projectId,
        status: "idle",
        running: false,
        queued: false,
        queued_meeting_ids: [],
        updated_at: nowIso(),
      },
      { onConflict: "project_id" }
    );
}

async function queueReconcileRequest(
  supabase: any,
  projectId: string,
  requestedMode: ReconcileMode,
  requestedMeetingIds: string[]
): Promise<void> {
  await ensureReconcileStateRow(supabase, projectId);

  const { data: current } = await supabase
    .from("project_reconcile_state")
    .select("running, queued_mode, queued_meeting_ids")
    .eq("project_id", projectId)
    .single();

  const currentQueuedMode = sanitizeReconcileMode(current?.queued_mode);
  const nextMode: ReconcileMode =
    currentQueuedMode === "full" || requestedMode === "full"
      ? "full"
      : "incremental";

  const nextMeetingIds =
    nextMode === "full"
      ? []
      : mergeMeetingIds(current?.queued_meeting_ids ?? [], requestedMeetingIds);

  await supabase
    .from("project_reconcile_state")
    .update({
      queued: true,
      queued_mode: nextMode,
      queued_meeting_ids: nextMeetingIds,
      status: current?.running ? "running" : "queued",
      updated_at: nowIso(),
    })
    .eq("project_id", projectId);
}

async function acquireReconcileLock(
  supabase: any,
  projectId: string,
  mode: ReconcileMode
): Promise<"acquired" | "queued"> {
  await ensureReconcileStateRow(supabase, projectId);

  const { data: state } = await supabase
    .from("project_reconcile_state")
    .select("running")
    .eq("project_id", projectId)
    .single();

  if (state?.running) return "queued";

  const { data: updatedRows } = await supabase
    .from("project_reconcile_state")
    .update({
      running: true,
      status: "running",
      active_mode: mode,
      last_job_id: crypto.randomUUID(),
      last_started_at: nowIso(),
      last_finished_at: null,
      last_error: null,
      updated_at: nowIso(),
    })
    .eq("project_id", projectId)
    .eq("running", false)
    .select("project_id");

  return updatedRows && updatedRows.length > 0 ? "acquired" : "queued";
}

async function runGarbageCollectionAndRepair(
  supabase: any,
  projectId: string,
  allMeetingIds: string[]
): Promise<void> {
  if (allMeetingIds.length === 0) return;

  const { data: allProjectIssues } = await supabase
    .from("issues")
    .select("id, title, created_at")
    .eq("project_id", projectId);

  const { data: allMentions } = await supabase
    .from("issue_mentions")
    .select("issue_id")
    .in("meeting_id", allMeetingIds);

  const activeIssueIds = Array.from(new Set((allMentions ?? []).map((m: any) => m.issue_id)));
  const orphanedIssueIds =
    (allProjectIssues ?? [])
      .map((i: any) => i.id)
      .filter((id: string) => !activeIssueIds.includes(id)) ?? [];

  if (orphanedIssueIds.length > 0) {
    await supabase.from("issues").delete().in("id", orphanedIssueIds);
  }

  // Merge duplicate issues by normalized title to keep one canonical tracker row.
  const { data: dedupeCandidates } = await supabase
    .from("issues")
    .select("id, title, created_at")
    .eq("project_id", projectId);

  const groups = new Map<string, any[]>();
  for (const issue of dedupeCandidates ?? []) {
    const key = normalizeText(issue.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }

  for (const sameTitleIssues of groups.values()) {
    if (sameTitleIssues.length <= 1) continue;
    sameTitleIssues.sort((a: any, b: any) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    );
    const canonical = sameTitleIssues[0];
    const duplicateIds = sameTitleIssues.slice(1).map((x: any) => x.id);
    if (duplicateIds.length === 0) continue;

    const { error: mentionMoveErr } = await supabase
      .from("issue_mentions")
      .update({ issue_id: canonical.id })
      .in("issue_id", duplicateIds);
    if (mentionMoveErr) {
      console.warn("[reconcile-project] Failed to merge duplicate mentions:", mentionMoveErr);
      continue;
    }

    const { error: deleteDupErr } = await supabase
      .from("issues")
      .delete()
      .in("id", duplicateIds);
    if (deleteDupErr) {
      console.warn("[reconcile-project] Failed to delete duplicate issues:", deleteDupErr);
    }
  }

  const { data: activeMentionsAfterMerge } = await supabase
    .from("issue_mentions")
    .select("issue_id")
    .in("meeting_id", allMeetingIds);
  const repairedIssueIds = Array.from(
    new Set((activeMentionsAfterMerge ?? []).map((m: any) => m.issue_id))
  );
  if (repairedIssueIds.length === 0) return;

  const { data: freshMentions } = await supabase
    .from("issue_mentions")
    .select("issue_id, mention_type, meeting_id, created_at, meetings(sort_order)")
    .in("issue_id", repairedIssueIds);

  if (!freshMentions) return;

  const earliestMeetings = new Map<string, string>();
  const earliestSorts = new Map<string, number>();
  const latestMentions = new Map<
    string,
    { meetingId: string; mentionType: string; sortOrder: number; createdAt: string }
  >();

  for (const m of freshMentions) {
    const order = m.meetings?.sort_order ?? 999999;
    const currentEarliest = earliestSorts.get(m.issue_id) ?? 999999;
    if (order < currentEarliest) {
      earliestSorts.set(m.issue_id, order);
      earliestMeetings.set(m.issue_id, m.meeting_id);
    }

    const existingLatest = latestMentions.get(m.issue_id);
    const createdAt = String(m.created_at ?? "");
    if (
      !existingLatest ||
      order > existingLatest.sortOrder ||
      (order === existingLatest.sortOrder && createdAt > existingLatest.createdAt)
    ) {
      latestMentions.set(m.issue_id, {
        meetingId: m.meeting_id,
        mentionType: String(m.mention_type ?? "discussed"),
        sortOrder: order,
        createdAt,
      });
    }
  }

  for (const [issueId, meetingId] of earliestMeetings.entries()) {
    const latest = latestMentions.get(issueId);
    const statusPatch: any = {
      opened_in: meetingId,
    };

    if (latest?.mentionType === "resolved") {
      statusPatch.status = "resolved";
      statusPatch.resolved_in = latest.meetingId;
      statusPatch.obsoleted_in = null;
    } else if (latest?.mentionType === "obsoleted") {
      statusPatch.status = "obsolete";
      statusPatch.obsoleted_in = latest.meetingId;
      statusPatch.resolved_in = null;
    } else {
      statusPatch.status = "open";
      statusPatch.resolved_in = null;
      statusPatch.obsoleted_in = null;
    }

    await supabase.from("issues").update(statusPatch).eq("id", issueId);
  }
}

async function runReconciliationMode(
  supabase: any,
  projectId: string,
  mode: ReconcileMode,
  requestedMeetingIds: string[],
  runConfig: ReconcileRunConfig
): Promise<{ processedMeetingIds: string[]; deferredFull: boolean }> {
  const { data: meetings, error: meetingsErr } = await supabase
    .from("meetings")
    .select("id, sort_order, summary, processing_status, processing_stage")
    .eq("project_id", projectId)
    .neq("processing_status", "failed")
    .order("sort_order", { ascending: true });

  if (meetingsErr || !meetings || meetings.length === 0) {
    return { processedMeetingIds: [], deferredFull: false };
  }

  const allMeetingIds = meetings.map((m: any) => m.id);
  const extracting = meetings.filter(
    (m: any) =>
      m.processing_status === "processing" &&
      m.processing_stage !== "ready_to_reconcile" &&
      m.processing_stage !== "reconciling"
  );

  if (mode === "full" && extracting.length > 0) {
    console.warn(
      `[reconcile-project] Deferring full reconcile; ${extracting.length} meetings still extracting.`
    );
    return { processedMeetingIds: [], deferredFull: true };
  }

  const explicitTargets = new Set(requestedMeetingIds);
  const targetMeetings =
    mode === "full"
      ? meetings
      : meetings.filter((m: any) => {
          if (explicitTargets.size > 0) return explicitTargets.has(m.id);
          return m.processing_stage === "ready_to_reconcile";
        });

  if (targetMeetings.length === 0) {
    return { processedMeetingIds: [], deferredFull: false };
  }

  const targetMeetingIds = targetMeetings.map((m: any) => m.id);
  const reconcilingMeetingIds = targetMeetings
    .filter(
      (m: any) =>
        m.processing_status === "processing" ||
        m.processing_stage === "ready_to_reconcile" ||
        m.processing_stage === "reconciling"
    )
    .map((m: any) => m.id);

  if (reconcilingMeetingIds.length > 0) {
    await supabase
      .from("meetings")
      .update({ processing_stage: "reconciling" })
      .in("id", reconcilingMeetingIds);
  }

  if (mode === "full") {
    await supabase.from("issue_mentions").delete().in("meeting_id", allMeetingIds);
  } else {
    await supabase.from("issue_mentions").delete().in("meeting_id", targetMeetingIds);
  }

  for (const meeting of targetMeetings) {
    const meetingId = meeting.id;

    const { data: extractions } = await supabase
      .from("extractions")
      .select("*")
      .eq("meeting_id", meetingId)
      .in("type", ["action_item", "decision", "issue_event"]);

    const actionItems: ReconItem[] = (extractions ?? [])
      .filter((e: any) => e.type === "action_item")
      .map((e: any) => ({
        id: e.id,
        source_type: "action_item",
        description: e.description ?? "",
        context: e.context ?? null,
        supporting_quote: e.supporting_quote ?? null,
      }));

    const decisions: ReconItem[] = (extractions ?? [])
      .filter((e: any) => e.type === "decision")
      .map((e: any) => ({
        id: e.id,
        source_type: "decision",
        description: e.description ?? "",
        context: e.context ?? null,
        supporting_quote: e.supporting_quote ?? null,
      }));

    const issueEvents: ReconItem[] = (extractions ?? [])
      .filter((e: any) => e.type === "issue_event")
      .map((e: any) => ({
        id: e.id,
        source_type: "issue_event",
        title: e.issue_candidate_title ?? null,
        description: e.description ?? "",
        context: e.context ?? null,
        supporting_quote: e.supporting_quote ?? null,
        issue_event_type: e.issue_event_type ?? null,
      }));

    const topics: ReconItem[] = (meeting.summary?.topics || []).map((t: any, idx: number) => ({
      id: `topic-${idx}`,
      source_type: "topic",
      title: t.title ?? null,
      description: t.summary ?? null,
      status_in_meeting: t.status ?? null,
      supporting_quote: t.supporting_quote ?? null,
    }));

    const itemById = new Map<string, ReconItem>(
      [...issueEvents, ...topics, ...decisions, ...actionItems].map((it) => [String(it.id), it])
    );

    const { data: currentIssuesRaw } = await supabase
      .from("issues")
      .select("id, title, description, status")
      .eq("project_id", projectId);
    const currentIssues: IssueRow[] = (currentIssuesRaw ?? []) as IssueRow[];
    const currentIssueIdSet = new Set(currentIssues.map((i) => i.id));

    const normalizedTitleToIssueId = new Map<string, string>();
    for (const issue of currentIssues) {
      const key = normalizeText(issue.title);
      if (key) normalizedTitleToIssueId.set(key, issue.id);
    }

    const handledExtractionIds = new Set<string>();
    let createdIssueCount = 0;
    let mentionInsertedCount = 0;

    for (const ev of issueEvents) {
      const eventType = sanitizeIssueEventType(ev.issue_event_type);
      if (!eventType) continue;
      if (eventType === "resolved" && !supportingQuoteLooksResolved(ev.supporting_quote)) {
        continue;
      }

      const extractionId = String(ev.id);
      const titleKey = normalizeText(ev.title);

      let issueId = titleKey ? normalizedTitleToIssueId.get(titleKey) ?? null : null;
      if (!issueId) {
        const basis = `${ev.title ?? ""} ${ev.description ?? ""} ${ev.context ?? ""} ${ev.supporting_quote ?? ""}`;
        const fallbackIssue =
          findBestIssueMatch(basis, currentIssues) ??
          findBestIssueMatchWithAnchor(basis, currentIssues);
        if (fallbackIssue) issueId = fallbackIssue.id;
      }

      if (eventType === "raised" && !issueId) {
        if (!issueEventLooksTrackable(ev)) {
          continue;
        }
        const newIssueTitle =
          ev.title?.trim() ||
          ev.description?.slice(0, 120).trim() ||
          "New Issue";

        const { data: newIssue, error: newIssueErr } = await supabase
          .from("issues")
          .insert({
            project_id: projectId,
            title: newIssueTitle,
            description: ev.description ?? null,
            status: "open",
            opened_in: meetingId,
          })
          .select("id, title, description, status")
          .single();

        if (!newIssueErr && newIssue) {
          issueId = newIssue.id;
          currentIssueIdSet.add(newIssue.id);
          currentIssues.push(newIssue);
          const normalized = normalizeText(newIssue.title);
          if (normalized) normalizedTitleToIssueId.set(normalized, newIssue.id);
          createdIssueCount += 1;
        }
      }

      if (!issueId || !currentIssueIdSet.has(issueId)) continue;

      const statusUpdates: any = {};
      if (eventType === "raised") {
        statusUpdates.status = "open";
        statusUpdates.resolved_in = null;
      } else if (eventType === "resolved") {
        statusUpdates.status = "resolved";
        statusUpdates.resolved_in = meetingId;
      } else if (eventType === "reopened") {
        statusUpdates.status = "open";
        statusUpdates.resolved_in = null;
      } else if (eventType === "obsoleted") {
        statusUpdates.status = "obsolete";
        statusUpdates.obsoleted_in = meetingId;
      }

      if (Object.keys(statusUpdates).length > 0) {
        await supabase.from("issues").update(statusUpdates).eq("id", issueId);
      }

      const { error: evMentionErr } = await supabase.from("issue_mentions").insert({
        issue_id: issueId,
        meeting_id: meetingId,
        mention_type: eventType,
        context: ev.context ?? null,
        supporting_quote: ev.supporting_quote ?? null,
      });
      if (evMentionErr) {
        console.warn(
          `[reconcile-project] Failed to insert deterministic mention for issue ${issueId}:`,
          evMentionErr
        );
      } else {
        mentionInsertedCount += 1;
      }

      handledExtractionIds.add(extractionId);
    }

    let reconData: any = null;
    let reconcileCall: GroqCallResult | null = null;
    let reconcileError: string | null = null;
    if (topics.length > 0 || actionItems.length > 0 || decisions.length > 0 || issueEvents.length > 0) {
      try {
        await new Promise((r) => setTimeout(r, 1200));
        const prompt = buildReconciliationPrompt(
          topics,
          decisions,
          actionItems,
          issueEvents,
          currentIssues,
          runConfig.reconcilePromptVariant
        );
        reconcileCall = await groqReconcileCall(
          prompt,
          runConfig.reconcileModelOverride
        );
        reconData = safeParseJSON(reconcileCall.content);
      } catch (err) {
        reconcileError = err instanceof Error ? err.message : String(err);
        console.warn(`[reconcile-project] Failed to parse meeting ${meeting.sort_order}:`, err);
      }
    }

    const usedExtractionIds = new Set<string>(handledExtractionIds);
    const rawMatches = Array.isArray(reconData?.matches) ? reconData.matches : [];

    for (const match of rawMatches) {
      const extractionId = String(match?.extraction_id ?? "").trim();
      if (!extractionId || usedExtractionIds.has(extractionId)) continue;

      const sourceItem = itemById.get(extractionId);
      if (!sourceItem) continue;

      let mentionType = sanitizeMentionType(match?.mention_type);
      let newStatus = sanitizeIssueStatus(match?.new_status);
      let issueId =
        typeof match?.issue_id === "string" && currentIssueIdSet.has(match.issue_id)
          ? match.issue_id
          : null;
      let isNewIssue =
        match?.is_new_issue === true && canCreateIssueFromItem(sourceItem);
      let newIssueTitle =
        typeof match?.new_issue_title === "string" ? match.new_issue_title.trim() : "";
      const newIssueDescription =
        typeof match?.new_issue_description === "string"
          ? match.new_issue_description.trim()
          : null;
      const context =
        typeof match?.context === "string" ? match.context.trim() : null;
      const supportingQuote =
        typeof match?.supporting_quote === "string"
          ? match.supporting_quote.trim()
          : null;

      if (!issueId) {
        const basis = `${sourceItem.title ?? ""} ${sourceItem.description ?? ""} ${context ?? ""} ${supportingQuote ?? ""} ${newIssueTitle}`;
        const fallbackIssue =
          findBestIssueMatch(basis, currentIssues) ??
          findBestIssueMatchWithAnchor(basis, currentIssues);
        if (fallbackIssue) issueId = fallbackIssue.id;
      }

      if (issueId) isNewIssue = false;

      if (isNewIssue && !newIssueTitle) {
        newIssueTitle =
          sourceItem.title?.trim() ||
          sourceItem.description?.slice(0, 120).trim() ||
          "New Issue";
      }

      if (isNewIssue) {
        mentionType = "raised";
        newStatus = "open";
      }

      if (issueId && topicLooksResolved(sourceItem)) {
        mentionType = "resolved";
        newStatus = "resolved";
      } else if (mentionType === "resolved") {
        const topicResolvedEvidence =
          sourceItem.source_type === "topic" && topicLooksResolved(sourceItem);
        if (supportingQuoteLooksResolved(supportingQuote) || topicResolvedEvidence) {
          newStatus = "resolved";
        } else {
          mentionType = "discussed";
          newStatus = "open";
        }
      } else if (mentionType === "obsoleted") {
        newStatus = "obsolete";
      } else if (mentionType === "reopened") {
        newStatus = "open";
      }

      if (isNewIssue && newIssueTitle) {
        const normalized = normalizeText(newIssueTitle);
        if (normalized && normalizedTitleToIssueId.has(normalized)) {
          issueId = normalizedTitleToIssueId.get(normalized)!;
          isNewIssue = false;
        }
      }

      if (isNewIssue && newIssueTitle) {
        const { data: newIssue, error: newIssueErr } = await supabase
          .from("issues")
          .insert({
            project_id: projectId,
            title: newIssueTitle,
            description: newIssueDescription ?? null,
            status: newStatus,
            opened_in: meetingId,
          })
          .select("id, title, description, status")
          .single();

        if (newIssueErr || !newIssue) {
          console.warn("[reconcile-project] Failed to create new issue:", newIssueErr);
          continue;
        }
        issueId = newIssue.id;
        currentIssueIdSet.add(newIssue.id);
        currentIssues.push(newIssue);
        const key = normalizeText(newIssue.title);
        if (key) normalizedTitleToIssueId.set(key, newIssue.id);
        createdIssueCount += 1;
      } else if (issueId) {
        const statusUpdates: any = { status: newStatus };
        if (mentionType === "resolved") statusUpdates.resolved_in = meetingId;
        else if (mentionType === "obsoleted") statusUpdates.obsoleted_in = meetingId;
        else if (mentionType === "reopened") statusUpdates.resolved_in = null;

        const { error: updateErr } = await supabase
          .from("issues")
          .update(statusUpdates)
          .eq("id", issueId);
        if (updateErr) {
          console.warn(
            `[reconcile-project] Failed status update for issue ${issueId}:`,
            updateErr
          );
        }
      }

      if (issueId) {
        const { error: mentionErr } = await supabase.from("issue_mentions").insert({
          issue_id: issueId,
          meeting_id: meetingId,
          mention_type: mentionType,
          context,
          supporting_quote: supportingQuote,
        });
        if (mentionErr) {
          console.warn(
            `[reconcile-project] Failed to insert mention for issue ${issueId}:`,
            mentionErr
          );
        } else {
          usedExtractionIds.add(extractionId);
          mentionInsertedCount += 1;
        }
      }
    }

    for (const topic of topics) {
      if (!topicLooksResolved(topic)) continue;
      if (usedExtractionIds.has(topic.id)) continue;

      const basis = `${topic.title ?? ""} ${topic.description ?? ""} ${topic.supporting_quote ?? ""}`;
      const matchedIssue =
        findBestIssueMatch(basis, currentIssues) ??
        findBestIssueMatchWithAnchor(basis, currentIssues);
      if (!matchedIssue) continue;

      const { error: updateErr } = await supabase
        .from("issues")
        .update({ status: "resolved", resolved_in: meetingId })
        .eq("id", matchedIssue.id);
      if (updateErr) {
        console.warn(
          `[reconcile-project] Failed fallback resolve update for issue ${matchedIssue.id}:`,
          updateErr
        );
        continue;
      }

      const { error: mentionErr } = await supabase.from("issue_mentions").insert({
        issue_id: matchedIssue.id,
        meeting_id: meetingId,
        mention_type: "resolved",
        context: "Auto-mapped resolved topic to existing issue.",
        supporting_quote: topic.supporting_quote ?? null,
      });
      if (!mentionErr) {
        usedExtractionIds.add(topic.id);
        mentionInsertedCount += 1;
      }
    }

    let unmatchedIssueLevelTopics = 0;
    for (const topic of topics) {
      if (usedExtractionIds.has(topic.id)) continue;
      if (topicLooksResolved(topic)) continue;
      if (!topicLooksIssueSignal(topic)) continue;

      unmatchedIssueLevelTopics += 1;
      const basis = `${topic.title ?? ""} ${topic.description ?? ""} ${topic.supporting_quote ?? ""}`;
      let issueId: string | null = null;
      let mentionType: "raised" | "discussed" | "reopened" = "raised";

      const matchedIssue =
        findBestIssueMatch(basis, currentIssues) ??
        findBestIssueMatchWithAnchor(basis, currentIssues);
      if (matchedIssue) {
        issueId = matchedIssue.id;
        mentionType =
          matchedIssue.status === "resolved" || matchedIssue.status === "obsolete"
            ? "reopened"
            : "discussed";

        const statusPatch: any = {};
        if (mentionType === "reopened") {
          statusPatch.status = "open";
          statusPatch.resolved_in = null;
        } else if (matchedIssue.status == null) {
          statusPatch.status = "open";
        }

        if (Object.keys(statusPatch).length > 0) {
          const { error: patchErr } = await supabase
            .from("issues")
            .update(statusPatch)
            .eq("id", issueId);
          if (patchErr) {
            console.warn(
              `[reconcile-project] Failed unmatched topic status patch for ${issueId}:`,
              patchErr
            );
          }
        }
      } else {
        const newIssueTitle =
          topic.title?.trim() || topic.description?.slice(0, 120).trim() || "New Issue";
        const { data: createdIssue, error: createErr } = await supabase
          .from("issues")
          .insert({
            project_id: projectId,
            title: newIssueTitle,
            description: topic.description ?? null,
            status: "open",
            opened_in: meetingId,
          })
          .select("id, title, description, status")
          .single();

        if (createErr || !createdIssue) {
          console.warn("[reconcile-project] Failed unmatched-topic issue creation:", createErr);
          continue;
        }

        issueId = createdIssue.id;
        currentIssueIdSet.add(createdIssue.id);
        currentIssues.push(createdIssue);
        const titleKey = normalizeText(createdIssue.title);
        if (titleKey) normalizedTitleToIssueId.set(titleKey, createdIssue.id);
        createdIssueCount += 1;
        mentionType = "raised";
      }

      if (!issueId) continue;
      const { error: mentionErr } = await supabase.from("issue_mentions").insert({
        issue_id: issueId,
        meeting_id: meetingId,
        mention_type: mentionType,
        context: "Deterministic fallback: unresolved issue-level topic.",
        supporting_quote: topic.supporting_quote ?? null,
      });
      if (!mentionErr) {
        usedExtractionIds.add(topic.id);
        mentionInsertedCount += 1;
      }
    }

    const resolvedWithoutEvidenceCount = topics.filter((t) => {
      const status = (t.status_in_meeting ?? "").toLowerCase();
      if (status !== "resolved") return false;
      return !supportingQuoteLooksResolved(t.supporting_quote);
    }).length;

    await insertDiagnostic(supabase, {
      project_id: projectId,
      meeting_id: meetingId,
      run_id: runConfig.analysisRunId ?? null,
      stage: "reconcile",
      prompt_version: reconcilePromptVersion(runConfig.reconcilePromptVariant),
      model: reconcileCall?.model ?? runConfig.reconcileModelOverride ?? DEFAULT_RECONCILE_MODEL,
      temperature: 0,
      max_tokens: 2048,
      finish_reason: reconcileCall?.finishReason ?? null,
      parse_success:
        Boolean(reconData) ||
        (topics.length === 0 &&
          decisions.length === 0 &&
          actionItems.length === 0 &&
          issueEvents.length === 0),
      item_counts: {
        topics: topics.length,
        decisions: decisions.length,
        action_items: actionItems.length,
        issue_events: issueEvents.length,
        matches_returned: rawMatches.length,
        mentions_inserted: mentionInsertedCount,
        issues_created: createdIssueCount,
      },
      flags: {
        topic_marked_resolved_without_resolution_quote: resolvedWithoutEvidenceCount,
        issue_level_topic_unmatched: unmatchedIssueLevelTopics,
      },
      payload: {
        matches: Array.isArray(reconData?.matches) ? reconData.matches : [],
        raw_output_preview: reconcileCall?.content
          ? reconcileCall.content.slice(0, 3500)
          : null,
      },
      error: reconcileError,
    });
  }

  await runGarbageCollectionAndRepair(supabase, projectId, allMeetingIds);

  const meetingsToMarkComplete = targetMeetings
    .filter(
      (m: any) =>
        m.processing_stage === "ready_to_reconcile" ||
        m.processing_stage === "reconciling" ||
        m.processing_status === "processing"
    )
    .map((m: any) => m.id);

  if (meetingsToMarkComplete.length > 0) {
    await supabase
      .from("meetings")
      .update({ processing_status: "complete", processing_stage: null, processing_error: null })
      .in("id", meetingsToMarkComplete);
  }

  return { processedMeetingIds: targetMeetingIds, deferredFull: false };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  let projectId = "";
  let mode: ReconcileMode = "incremental";
  let meetingIds: string[] = [];
  let analysisRunId: string | null = null;
  let reconcilePromptVariant: PromptVariant = "B";
  let reconcileModelOverride: string | null = null;
  try {
    const body = await req.json();
    projectId = typeof body?.projectId === "string" ? body.projectId : "";
    mode = sanitizeReconcileMode(body?.mode);
    meetingIds = sanitizeMeetingIds(body?.meetingIds);
    if (typeof body?.analysisRunId === "string" && body.analysisRunId.trim()) {
      analysisRunId = body.analysisRunId.trim();
    }
    reconcilePromptVariant = sanitizePromptVariant(
      body?.reconcilePromptVariant ?? "B"
    );
    if (
      typeof body?.reconcileModelOverride === "string" &&
      body.reconcileModelOverride.trim()
    ) {
      reconcileModelOverride = body.reconcileModelOverride.trim();
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (!projectId) {
    return new Response(JSON.stringify({ error: "Missing projectId" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const runConfig: ReconcileRunConfig = {
    analysisRunId,
    reconcilePromptVariant,
    reconcileModelOverride,
  };

  console.log(
    `[reconcile-project] Request for project ${projectId} (mode=${mode}, promptVariant=${reconcilePromptVariant}, modelOverride=${reconcileModelOverride ?? "none"})`
  );

  const lockStatus = await acquireReconcileLock(supabase, projectId, mode);
  if (lockStatus === "queued") {
    await queueReconcileRequest(supabase, projectId, mode, meetingIds);
    return new Response(
      JSON.stringify({ success: true, queued: true, message: "Reconcile already running; request queued." }),
      {
        status: 202,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  let activeMode: ReconcileMode = mode;
  let activeMeetingIds: string[] = meetingIds;

  try {
    while (true) {
      const runResult = await runReconciliationMode(
        supabase,
        projectId,
        activeMode,
        activeMeetingIds,
        runConfig
      );

      if (runResult.deferredFull) {
        await queueReconcileRequest(supabase, projectId, "full", []);
        await supabase
          .from("project_reconcile_state")
          .update({
            running: false,
            active_mode: null,
            status: "queued",
            last_finished_at: nowIso(),
            updated_at: nowIso(),
          })
          .eq("project_id", projectId);

        return new Response(
          JSON.stringify({
            success: true,
            queued: true,
            message: "Full reconciliation deferred until extraction completes.",
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }

      const { data: state } = await supabase
        .from("project_reconcile_state")
        .select("queued, queued_mode, queued_meeting_ids")
        .eq("project_id", projectId)
        .single();

      if (!state?.queued) break;

      const nextMode = sanitizeReconcileMode(state.queued_mode);
      const nextMeetingIds =
        nextMode === "full" ? [] : sanitizeMeetingIds(state.queued_meeting_ids);

      await supabase
        .from("project_reconcile_state")
        .update({
          queued: false,
          queued_mode: null,
          queued_meeting_ids: [],
          running: true,
          status: "running",
          active_mode: nextMode,
          last_started_at: nowIso(),
          last_error: null,
          updated_at: nowIso(),
        })
        .eq("project_id", projectId)
        .eq("running", true);

      activeMode = nextMode;
      activeMeetingIds = nextMeetingIds;
    }

    await supabase
      .from("project_reconcile_state")
      .update({
        running: false,
        queued: false,
        active_mode: null,
        status: "complete",
        last_finished_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("project_id", projectId);

    console.log(`[reconcile-project] Project ${projectId} reconciled successfully.`);

    return new Response(JSON.stringify({ success: true, queued: false }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reconcile-project] FATAL:", message);

    await supabase
      .from("meetings")
      .update({
        processing_status: "failed",
        processing_stage: null,
        processing_error: message,
      })
      .eq("project_id", projectId)
      .eq("processing_status", "processing")
      .in("processing_stage", ["ready_to_reconcile", "reconciling"]);

    await supabase
      .from("project_reconcile_state")
      .update({
        running: false,
        active_mode: null,
        status: "failed",
        last_error: message,
        last_finished_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("project_id", projectId);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});
