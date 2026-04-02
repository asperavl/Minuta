// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Groq from "https://esm.sh/groq-sdk@0.37.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;

const EXTRACTION_MODEL = "llama-3.3-70b-versatile";
const VERIFY_MODEL = "llama-3.1-8b-instant";
const DEFAULT_EXTRACTION_MAX_TOKENS = 4096;
const DEFAULT_VERIFY_MAX_TOKENS = 2048;
const EXTRACTION_PROMPT_VERSION_A = "extract_v1_baseline_2026_04_01";
const EXTRACTION_PROMPT_VERSION_B = "extract_v2_lifecycle_strict_2026_04_01";
const VERIFY_PROMPT_VERSION = "verify_v1_quote_match_2026_04_01";

type PromptVariant = "A" | "B";
type GroqCallResult = {
  content: string;
  finishReason: string | null;
  model: string;
};
type ReconcileRequestOptions = {
  analysisRunId?: string;
  reconcilePromptVariant?: PromptVariant;
  reconcileModelOverride?: string;
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

// ── Helpers ────────────────────────────────────────────────────────────────

function safeParseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    let cleaned = raw.trim();

    // 1. Strip the entire thought process block if it exists
    cleaned = cleaned.replace(/<thought_process>[\s\S]*?<\/thought_process>/i, "");

    // First try extracting exactly what's inside a markdown code block (if present)
    // The CoT block might contain stray braces { } which breaks indexOf("{")
    const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (mdMatch) {
      cleaned = mdMatch[1].trim();
    } else {
      // If no markdown block is found, try slicing from { or [ to the matching closing brace } or ]
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

function sanitizePromptVariant(raw: unknown): PromptVariant {
  if (typeof raw === "string" && raw.toUpperCase() === "B") return "B";
  return "A";
}

function sanitizeMaxTokens(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.floor(raw);
  if (rounded < 512) return 512;
  if (rounded > 8192) return 8192;
  return rounded;
}

function extractionPromptVersion(variant: PromptVariant): string {
  return variant === "B"
    ? EXTRACTION_PROMPT_VERSION_B
    : EXTRACTION_PROMPT_VERSION_A;
}

function supportingQuoteLooksResolved(quote: string | null | undefined): boolean {
  if (!quote) return false;
  return /\b(resolved|fixed|closed|shipped|complete|completed|done)\b/i.test(
    quote
  );
}

function countResolvedWithoutEvidence(topics: any[]): number {
  let count = 0;
  for (const topic of topics) {
    const status = String(topic?.status ?? "").toLowerCase();
    if (status !== "resolved") continue;
    if (!supportingQuoteLooksResolved(topic?.supporting_quote)) count += 1;
  }
  return count;
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
    console.warn("[process-transcript] Failed to insert diagnostic:", error.message);
  }
}

const VALID_URGENCIES = ['Immediate', 'This Week', 'Low Priority', 'No Action'] as const;
function sanitizeUrgency(raw: string | null | undefined): string {
  if (!raw) return 'Low Priority';
  if ((VALID_URGENCIES as readonly string[]).includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('immediate') || lower.includes('critical') || lower.includes('urgent') || lower.includes('asap')) return 'Immediate';
  if (lower.includes('this week') || lower.includes('high') || lower.includes('soon')) return 'This Week';
  if (lower.includes('low') || lower.includes('minor') || lower.includes('eventually')) return 'Low Priority';
  if (lower.includes('no action') || lower.includes('none') || lower.includes('fyi') || lower.includes('informational')) return 'No Action';
  return 'Low Priority';
}

const VALID_SENTIMENTS = ['positive', 'neutral', 'conflict', 'frustrated', 'uncertain', 'enthusiastic'] as const;
function sanitizeSentimentLabel(raw: string | null | undefined): string {
  if (!raw) return 'neutral';
  if ((VALID_SENTIMENTS as readonly string[]).includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('positive') || lower.includes('agreement')) return 'positive';
  if (lower.includes('conflict') || lower.includes('disagree') || lower.includes('tension')) return 'conflict';
  if (lower.includes('frustrat')) return 'frustrated';
  if (lower.includes('uncertain') || lower.includes('unsure') || lower.includes('hesitant')) return 'uncertain';
  if (lower.includes('enthus') || lower.includes('excited') || lower.includes('celebrat')) return 'enthusiastic';
  return 'neutral';
}

function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(raw: string): string[] {
  return normalizeSearchText(raw)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function tokenRecallScore(quoteTokens: string[], candidateTokens: string[]): number {
  if (quoteTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of quoteTokens) {
    if (candidateSet.has(token)) overlap += 1;
  }
  return overlap / quoteTokens.length;
}

function normalizeTimestamp(raw: string): string | null {
  const trimmed = raw.trim();
  const hhmmssMatch = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hhmmssMatch) {
    const hh = hhmmssMatch[1].padStart(2, "0");
    return `${hh}:${hhmmssMatch[2]}:${hhmmssMatch[3]}`;
  }
  const mmssMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (mmssMatch) {
    return `00:${mmssMatch[1].padStart(2, "0")}:${mmssMatch[2]}`;
  }
  return null;
}

function extractTimestampFromLine(line: string): string | null {
  const cueMatch = line.match(/(\d{1,2}:\d{2}:\d{2})(?:[.,]\d{1,3})?\s*-->/);
  if (cueMatch) return normalizeTimestamp(cueMatch[1]);

  const hhmmssMatch = line.match(/\b(\d{1,2}:\d{2}:\d{2})(?:[.,]\d{1,3})?\b/);
  if (hhmmssMatch) return normalizeTimestamp(hhmmssMatch[1]);

  const mmssMatch = line.match(/\b(\d{1,2}:\d{2})(?:[.,]\d{1,3})?\b/);
  if (mmssMatch) return normalizeTimestamp(mmssMatch[1]);

  return null;
}

function lineForCharIndex(rawText: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex; i += 1) {
    if (rawText[i] === "\n") line += 1;
  }
  return line;
}

function quoteLineNumber(rawText: string, supportingQuote: string): number | null {
  const quote = supportingQuote.trim();
  if (!quote) return null;

  const loweredRaw = rawText.toLowerCase();
  const loweredQuote = quote.toLowerCase();
  const exactIndex = loweredRaw.indexOf(loweredQuote);
  if (exactIndex >= 0) {
    return lineForCharIndex(rawText, exactIndex);
  }

  const lines = rawText.split(/\r?\n/);
  const normalizedQuote = normalizeSearchText(quote);
  if (!normalizedQuote) return null;

  const quoteTokens = tokenizeSearch(quote);
  let bestLine: number | null = null;
  let bestScore = 0;

  for (let windowSize = 1; windowSize <= 10; windowSize += 1) {
    for (let i = 0; i < lines.length; i += 1) {
      const windowText = lines.slice(i, i + windowSize).join(" ");
      const normalizedWindow = normalizeSearchText(windowText);
      if (!normalizedWindow) continue;

      if (
        normalizedWindow.includes(normalizedQuote) ||
        normalizedQuote.includes(normalizedWindow)
      ) {
        return i + 1;
      }

      if (quoteTokens.length > 0) {
        const score = tokenRecallScore(quoteTokens, tokenizeSearch(windowText));
        if (score > bestScore) {
          bestScore = score;
          bestLine = i + 1;
        }
      }
    }
  }

  const threshold = quoteTokens.length >= 6 ? 0.5 : 0.66;
  if (bestLine != null && bestScore >= threshold) return bestLine;
  return null;
}

function resolveQuoteLocation(
  rawText: string | null | undefined,
  supportingQuote: string | null | undefined
): string | null {
  if (!rawText || !supportingQuote) return null;
  const quote = supportingQuote.trim();
  if (!quote) return null;

  const lineNumber = quoteLineNumber(rawText, quote);
  if (!lineNumber) return null;

  const lines = rawText.split(/\r?\n/);
  const index = Math.min(Math.max(lineNumber - 1, 0), Math.max(lines.length - 1, 0));

  let timestamp: string | null = null;
  for (let offset = 0; offset <= 8; offset += 1) {
    const lineIndex = index - offset;
    if (lineIndex < 0) break;
    timestamp = extractTimestampFromLine(lines[lineIndex]);
    if (timestamp) break;
  }

  if (timestamp) {
    return `${timestamp} (line ${lineNumber})`;
  }
  return `Line ${lineNumber}`;
}

const VALID_ISSUE_EVENT_TYPES = new Set([
  "raised",
  "resolved",
  "reopened",
  "obsoleted",
]);

function sanitizeIssueEventType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lowered = raw.toLowerCase().trim();
  return VALID_ISSUE_EVENT_TYPES.has(lowered) ? lowered : null;
}

async function groqWithRetry(
  model: string,
  prompt: string,
  retries = 6,
  maxTokens = 4096
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
      const status =
        err?.status ?? err?.response?.status ?? err?.cause?.status ?? null;
      const message = String(err?.message ?? err ?? "");
      const isRateLimited =
        status === 429 ||
        message.toLowerCase().includes("rate limit") ||
        message.toLowerCase().includes("too many requests") ||
        message.includes("429");

      console.error(
        `Groq attempt ${i + 1}/${retries} failed (status=${status ?? "unknown"}):`,
        message
      );
      if (i === retries - 1) throw err;

      // Use heavier backoff for 429s to let token/RPM windows recover.
      const base = isRateLimited ? 6000 : 1000;
      const cap = isRateLimited ? 90000 : 15000;
      const jitter = Math.floor(Math.random() * 1200);
      const delay = Math.min(cap, base * Math.pow(2, i)) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

async function triggerReconcileProject(
  projectId: string,
  mode: "incremental" | "full",
  meetingIds: string[],
  options?: ReconcileRequestOptions
): Promise<void> {
  const edgeFnUrl = `${SUPABASE_URL}/functions/v1/reconcile-project`;
  const body: Record<string, unknown> = { projectId, mode };
  if (meetingIds.length > 0) body.meetingIds = meetingIds;
  if (options?.analysisRunId) body.analysisRunId = options.analysisRunId;
  if (options?.reconcilePromptVariant) {
    body.reconcilePromptVariant = options.reconcilePromptVariant;
  }
  if (options?.reconcileModelOverride) {
    body.reconcileModelOverride = options.reconcileModelOverride;
  }

  try {
    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[process-transcript] reconcile-project returned ${res.status}: ${text}`
      );
    }
  } catch (err) {
    console.warn("[process-transcript] Failed to queue reconciliation:", err);
  }
}

// ── Prompts ────────────────────────────────────────────────────────────────

function buildCombinedPrompt(transcript: string, variant: PromptVariant): string {
  const strictLifecycleRules =
    variant === "B"
      ? `
- Lifecycle strictness (must follow):
  - Mark topic.status = Resolved ONLY if transcript explicitly confirms fixed/shipped/closed/completed and supporting_quote contains that evidence.
  - If discussion says delayed, blocked, workaround, scope cut, deferred, or partial mitigation, status must be Unresolved or Deferred (never Resolved).
  - For each issue-level topic with status Unresolved or Deferred, emit an issue_events entry with event_type="raised" unless a clear reopen/resolution event is explicitly stated.
  - Never emit "resolved" issue_events without direct resolution evidence in supporting_quote.`
      : "";

  return `You are analyzing a meeting transcript. Return a single JSON object with no markdown, no backticks, no preamble. Just raw JSON.

The JSON must contain exactly these keys:

{
  "summary": {
    "tldr": "<2-3 sentence paragraph — specific, not generic>",
    "overall_sentiment": {
      "label": "positive | mixed | tense | negative",
      "score": <number -1.0 to 1.0>
    },
    "stats": {
      "decisions": <integer>,
      "action_items": <integer>,
      "dominant_speaker": "<name>",
      "speaker_breakdown": [{ "name": "<name>", "percentage": <integer 0-100> }]
    },
    "topics": [
      {
        "index": <0-based integer>,
        "title": "<short topic name>",
        "start_time": "<HH:MM:SS or estimated position>",
        "end_time": "<HH:MM:SS or estimated position>",
        "summary": "<full standalone paragraph — minimum 3 sentences — detailed enough that someone not in the meeting fully understands what was discussed, argued, agreed, and left open>",
        "status": "Resolved | Unresolved | Deferred | Uncertain",
        "supporting_quote": "<verbatim quote from transcript justifying status, or null if none found>",
        "urgency": "Immediate | This Week | Low Priority | No Action",
        "circled_back_from": <index of earlier topic this revisits, or null>,
        "circled_back_at": <index of later topic that revisits this, or null>
      }
    ]
  },
  "decisions": [
    {
      "id": <integer starting at 1>,
      "description": "<specific decision made>"
    }
  ],
  "action_items": [
    {
      "id": <integer starting at 1>,
      "description": "<specific task — detailed enough to act on without reading the transcript>",
      "owner": "<person responsible or 'Unassigned' — never guess>",
      "due_date": "<date mentioned or 'Not specified' — never infer>",
      "urgency": "Immediate | This Week | Low Priority | No Action",
      "context": "<1-2 sentences explaining why this item exists and what discussion produced it>",
      "related_topic": "<topic title from the meeting>"
    }
  ],
  "issue_events": [
    {
      "id": <integer starting at 1>,
      "event_type": "raised | resolved | reopened | obsoleted",
      "issue_title": "<short issue title>",
      "description": "<what changed about this issue in this meeting>",
      "context": "<1 sentence explaining where this event came from>",
      "supporting_quote": "<direct verbatim quote proving this lifecycle event>"
    }
  ],
  "sentiment": {
    "segments": [
      {
        "segment_index": <0-based integer>,
        "speaker": "<exact name of the speaker - NEVER use 'Multiple'>",
        "text_excerpt": "<verbatim 1-2 sentences of their exact utterance>",
        "sentiment_label": "positive | neutral | conflict | frustrated | uncertain | enthusiastic",
        "sentiment_score": <float -1.0 to 1.0>,
        "start_time": "<timestamp if available from VTT, otherwise null>"
      }
    ],
    "speaker_observations": [
      {
        "speaker": "<name>",
        "observation": "<specific observation about this speaker's emotional behavior (e.g. 'defensive when challenged', 'frequently uncertain')>",
        "average_score": <float>
      }
    ]
  }
}

Rules:
- Never invent content not present in the transcript
- supporting_quote must be verbatim from the transcript. If none exists, set status to Uncertain.
- owner: use Unassigned if no person was named — never guess
- due_date: use Not specified if no date was mentioned — never infer
- speaker_breakdown percentages must sum to 100
- SPEAKER-LEVEL SALIENCE EXTRACTION: Do NOT arbitrarily chunk the transcript into 15-20 lines. Scan the transcript chronologically to find 10-20 specific emotional moments.
- Extract individual utterances where a specific speaker exhibits a clear emotional shift (frustration, excitement, conflict, uncertainty, or notably positive sentiment).
- SENTIMENT CALIBRATION (CRITICAL):
  - Pin the sentiment to the EXACT speaker who said it. 
  - Do not average out emotions. Exclamations of distress MUST be labeled 'frustrated' or 'conflict' with a negative score.
  - 'neutral' (0.0) is strictly for purely informational statements. Extract neutral baseline points sparingly; focus heavily on the emotionally charged utterances.
  - 'uncertain' (-0.2 to -0.4) is for hesitation ("umm", "I don't know").
  - Few-Shot Examples:
    - Speaker A: "Oh no, the deployment failed again." -> Speaker: Speaker A, Label: frustrated, Score: -0.8
    - Speaker B: "I'll push the code up later today." -> Speaker: Speaker B, Label: neutral, Score: 0.0
    - Speaker C: "I'm not sure if that will work, maybe?" -> Speaker: Speaker C, Label: uncertain, Score: -0.3
- temperature is 0 — output must be precise and consistent
- The topics array must include every issue-level discussion (bugs, blockers, incidents, major risks, major feature requests, explicit closures/reopens)
- Do not collapse separate issue-level discussions into one topic
- If the transcript explicitly says an issue is fixed/closed/resolved, mark that topic status as Resolved and include the exact closing quote
- If an issue is still active or not confirmed fixed, do NOT mark it Resolved
- Emit issue_events for explicit lifecycle moments (raised/resolved/reopened/obsoleted)
- issue_events.supporting_quote must be verbatim; if no direct evidence exists, omit that event
${strictLifecycleRules}

Transcript:
${transcript}`;
}

function buildVerifyPrompt(transcript: string, pass1Json: string): string {
  return `You are a fact-checker. You will receive extracted decisions and action items from a meeting, plus the original transcript.

For each item (identified by its integer id), find a DIRECT VERBATIM quote from the transcript that supports it.

Return a JSON object with no markdown, no backticks, no preamble. Just raw JSON:

{
  "decisions": [
    { "id": <integer>, "verified": <boolean>, "supporting_quote": "<verbatim quote or null>" }
  ],
  "action_items": [
    { "id": <integer>, "verified": <boolean>, "supporting_quote": "<verbatim quote or null>" }
  ]
}

Rules:
- verified = true ONLY if you found a direct verbatim quote in the transcript
- If no quote exists, set verified = false and supporting_quote = null
- Do not paraphrase — quotes must be exact character sequences from the transcript

EXTRACTIONS:
${pass1Json}

TRANSCRIPT:
${transcript}`;
}

function buildReconciliationPrompt(
  topics: any[],
  actionItems: any[],
  existingIssues: any[]
): string {
  return `You are a Senior Technical Project Manager AI. Your job is to strictly match conversational items to existing tracker tickets. 
If a fundamental product defect or feature request is discussed, log it as a NEW ticket ONLY if it doesn't map to an existing one.

INSTRUCTIONS:
First, write a <thought_process> block evaluating the data.
Then, output the JSON. 

1. THOUGHT PROCESS: 
Analyze EXISTING ISSUES to understand their root problem context.
Evaluate each EXTRACTED TOPIC. If the topic is just a status update, a meeting ritual (e.g. "team retrospective"), or a routine design review without a core bug, you MUST NOT create an issue for it. Only create a NEW issue if the topic describes a concrete software bug, architectural blocker, or a completely new feature request.
Evaluate each EXTRACTED WORKFLOW TASK. Tasks (e.g., "Draft an email", "Update mockups", "Create a demo script") CANNOT be logged as NEW issues. They can ONLY be matched to EXISTING ISSUES if they represent work being done to resolve that existing issue.

2. JSON OUTPUT:
Return a JSON object with no markdown other than the JSON block itself.

{
  "matches": [
    {
      "extraction_id": "<string or integer ID from the input>",
      "issue_id": "<existing issue UUID or null>",
      "is_new_issue": <boolean>,
      "new_issue_title": "<title or null>",
      "new_issue_description": "<description or null>",
      "mention_type": "raised | discussed | escalated | resolved | obsoleted | reopened",
      "new_status": "open | in_progress | resolved | obsolete",
      "context": "<1 sentence explaining the connection>",
      "supporting_quote": "<verbatim quote or null>"
    }
  ]
}

STATE MANAGEMENT RULES:
- new_status must be 'open', 'in_progress', 'resolved', or 'obsolete'. 
- ONLY set new_status to 'resolved' if the actual underlying defect or feature was completely shipped, fixed, or permanently abandoned. If the team simply created a temporary workaround or deferred the deadline, it remains 'open'.

EXISTING ISSUES:
${JSON.stringify(existingIssues ?? [])}

EXTRACTED TOPICS (These indicate fundamental project discussions/bugs. They CAN spawn NEW tickets):
${JSON.stringify(topics)}

EXTRACTED WORKFLOW TASKS (These are action items. They cannot spawn NEW tickets, they can only map to EXISTING tickets):
${JSON.stringify(actionItems)}`;
}

// ── CORS ───────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: CORS_HEADERS });

  let meetingId: string;
  let isHistoricalInsert = false;
  let analysisRunId: string | null = null;
  let extractPromptVariant: PromptVariant = "B";
  let extractMaxTokens = DEFAULT_EXTRACTION_MAX_TOKENS;
  let reconcilePromptVariant: PromptVariant = "B";
  let reconcileModelOverride: string | null = null;
  try {
    const body = await req.json();
    meetingId = body.meetingId;
    isHistoricalInsert = body.isHistoricalInsert === true;
    const config =
      body && typeof body.analysisConfig === "object"
        ? body.analysisConfig
        : body;
    if (typeof config?.analysisRunId === "string" && config.analysisRunId.trim()) {
      analysisRunId = config.analysisRunId.trim();
    }
    extractPromptVariant = sanitizePromptVariant(
      config?.extractPromptVariant ?? "B"
    );
    extractMaxTokens = sanitizeMaxTokens(
      config?.extractMaxTokens,
      DEFAULT_EXTRACTION_MAX_TOKENS
    );
    reconcilePromptVariant = sanitizePromptVariant(
      config?.reconcilePromptVariant ?? "B"
    );
    if (
      typeof config?.reconcileModelOverride === "string" &&
      config.reconcileModelOverride.trim()
    ) {
      reconcileModelOverride = config.reconcileModelOverride.trim();
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch meeting
  const { data: meeting, error: meetingErr } = await supabase
    .from("meetings")
    .select(
      "id, project_id, raw_text, file_name, processing_status, meeting_date, sort_order"
    )
    .eq("id", meetingId)
    .single();

  if (meetingErr || !meeting) {
    return new Response(JSON.stringify({ error: "Meeting not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (meeting.processing_status === "failed") {
    await supabase
      .from("meetings")
      .update({ processing_status: "processing", processing_error: null })
      .eq("id", meetingId);
  }

  const transcript = meeting.raw_text;
  const projectId = meeting.project_id;

  console.log(
    `[process-transcript] Starting 3-Call Pipeline for ${meetingId} (extractVariant=${extractPromptVariant}, extractMaxTokens=${extractMaxTokens}, reconcileVariant=${reconcilePromptVariant}, reconcileModelOverride=${reconcileModelOverride ?? "none"})`
  );

  // ────────────────────────────────────────────────────────────────────────
  // CALL 1 — Combined Extraction (llama-3.3-70b-versatile)
  // Summary + Decisions + Action Items + Sentiment in one call
  // Fatal on parse failure
  // ────────────────────────────────────────────────────────────────────────
  await supabase
    .from("meetings")
    .update({ processing_stage: "extracting" })
    .eq("id", meetingId);

  let combined: any;
  let extractionCall: GroqCallResult | null = null;
  try {
    extractionCall = await groqWithRetry(
      EXTRACTION_MODEL,
      buildCombinedPrompt(transcript, extractPromptVariant),
      6,
      extractMaxTokens
    );
    combined = safeParseJSON(extractionCall.content);
    if (!combined) throw new Error("Combined call JSON parse failed");

    const topics = Array.isArray(combined?.summary?.topics)
      ? combined.summary.topics
      : [];
    const issueEvents = Array.isArray(combined?.issue_events)
      ? combined.issue_events
      : [];

    await insertDiagnostic(supabase, {
      project_id: projectId,
      meeting_id: meetingId,
      run_id: analysisRunId,
      stage: "extract",
      prompt_version: extractionPromptVersion(extractPromptVariant),
      model: extractionCall.model,
      temperature: 0,
      max_tokens: extractMaxTokens,
      finish_reason: extractionCall.finishReason,
      parse_success: true,
      item_counts: {
        topics: topics.length,
        issue_events: issueEvents.length,
        decisions: Array.isArray(combined?.decisions) ? combined.decisions.length : 0,
        action_items: Array.isArray(combined?.action_items)
          ? combined.action_items.length
          : 0,
      },
      flags: {
        topic_marked_resolved_without_resolution_quote:
          countResolvedWithoutEvidence(topics),
      },
      payload: {
        topics,
        issue_events: issueEvents,
      },
    });

    console.log("[Call 1] Combined Extraction Complete.");
    // Small pacing gap before next model call to avoid bursty RPM spikes.
    await new Promise((r) => setTimeout(r, 2200));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Call 1] FATAL:", msg);
    await insertDiagnostic(supabase, {
      project_id: projectId,
      meeting_id: meetingId,
      run_id: analysisRunId,
      stage: "extract",
      prompt_version: extractionPromptVersion(extractPromptVariant),
      model: extractionCall?.model ?? EXTRACTION_MODEL,
      temperature: 0,
      max_tokens: extractMaxTokens,
      finish_reason: extractionCall?.finishReason ?? null,
      parse_success: false,
      item_counts: {},
      flags: {},
      payload: extractionCall?.content
        ? { raw_output_preview: extractionCall.content.slice(0, 4000) }
        : undefined,
      error: msg,
    });
    await supabase
      .from("meetings")
      .update({ processing_status: "failed", processing_error: msg })
      .eq("id", meetingId);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // CALL 2 — Verification (llama-3.1-8b-instant)
  // Fact-checks decisions + action_items against transcript
  // Non-fatal on parse failure — marks all unverified
  // ────────────────────────────────────────────────────────────────────────
  await supabase
    .from("meetings")
    .update({ processing_stage: "verifying" })
    .eq("id", meetingId);

  let verified: any = null;
  let verifyCall: GroqCallResult | null = null;
  let verifyError: string | null = null;
  try {
    const pass1Json = JSON.stringify({
      decisions: combined.decisions,
      action_items: combined.action_items,
    });
    verifyCall = await groqWithRetry(
      VERIFY_MODEL,
      buildVerifyPrompt(transcript, pass1Json),
      6,
      DEFAULT_VERIFY_MAX_TOKENS
    );
    verified = safeParseJSON(verifyCall.content);
    console.log("[Call 2] Verification Complete.");
  } catch (err) {
    verifyError = err instanceof Error ? err.message : String(err);
    console.warn("[Call 2] Non-fatal failure:", err);
  }

  const decisionsVerifiedCount = Array.isArray(verified?.decisions)
    ? verified.decisions.filter((d: any) => d?.verified === true).length
    : 0;
  const actionItemsVerifiedCount = Array.isArray(verified?.action_items)
    ? verified.action_items.filter((a: any) => a?.verified === true).length
    : 0;

  await insertDiagnostic(supabase, {
    project_id: projectId,
    meeting_id: meetingId,
    run_id: analysisRunId,
    stage: "verify",
    prompt_version: VERIFY_PROMPT_VERSION,
    model: verifyCall?.model ?? VERIFY_MODEL,
    temperature: 0,
    max_tokens: DEFAULT_VERIFY_MAX_TOKENS,
    finish_reason: verifyCall?.finishReason ?? null,
    parse_success: Boolean(verified),
    item_counts: {
      decisions_input: Array.isArray(combined?.decisions) ? combined.decisions.length : 0,
      action_items_input: Array.isArray(combined?.action_items)
        ? combined.action_items.length
        : 0,
      decisions_verified: decisionsVerifiedCount,
      action_items_verified: actionItemsVerifiedCount,
    },
    flags: {},
    payload: verifyCall?.content
      ? { raw_output_preview: verifyCall.content.slice(0, 2500) }
      : undefined,
    error: verifyError,
  });

  // ────────────────────────────────────────────────────────────────────────
  // MERGE + INSERT — Apply Call 1 + Call 2 results to database
  // ────────────────────────────────────────────────────────────────────────
  await supabase
    .from("meetings")
    .update({ processing_stage: "merging" })
    .eq("id", meetingId);
  console.log("[Insert] Applying to Database...");

  try {
    // 1. Summary
    if (combined?.summary) {
      if (combined.summary.overall_sentiment?.label) {
        combined.summary.overall_sentiment.label =
          combined.summary.overall_sentiment.label.toLowerCase();
      }
      // Attach speaker observations into the summary JSON
      if (combined?.sentiment?.speaker_observations) {
        combined.summary.speaker_observations =
          combined.sentiment.speaker_observations;
      }
      await supabase
        .from("meetings")
        .update({ summary: combined.summary })
        .eq("id", meetingId);
    }

    // 2. Extractions — delete existing then insert fresh (idempotent on retry)
    await supabase
      .from("extractions")
      .delete()
      .eq("meeting_id", meetingId);

    const decisionRows = (combined.decisions ?? []).map((d: any) => {
      const v =
        verified?.decisions?.find((x: any) => x.id === d.id) ?? {};
      const supportingQuote =
        typeof v.supporting_quote === "string" && v.supporting_quote.trim().length > 0
          ? v.supporting_quote.trim()
          : null;
      return {
        _tempId: d.id,
        meeting_id: meetingId,
        type: "decision",
        description: d.description,
        owner: null,
        due_date: null,
        urgency: null,
        context: null,
        related_topic: null,
        verified: v.verified ?? false,
        supporting_quote: supportingQuote,
        quote_location: resolveQuoteLocation(transcript, supportingQuote),
      };
    });

    const actionRows = (combined.action_items ?? []).map((a: any) => {
      const v =
        verified?.action_items?.find((x: any) => x.id === a.id) ?? {};
      const supportingQuote =
        typeof v.supporting_quote === "string" && v.supporting_quote.trim().length > 0
          ? v.supporting_quote.trim()
          : null;
      return {
        _tempId: a.id,
        meeting_id: meetingId,
        type: "action_item",
        description: a.description,
        owner: a.owner ?? "Unassigned",
        due_date: a.due_date ?? "Not specified",
        urgency: sanitizeUrgency(a.urgency),
        context: a.context ?? null,
        related_topic: a.related_topic ?? null,
        status: "Pending",
        verified: v.verified ?? false,
        supporting_quote: supportingQuote,
        quote_location: resolveQuoteLocation(transcript, supportingQuote),
      };
    });

    const issueEventRows = (combined.issue_events ?? [])
      .map((ev: any) => {
        const eventType = sanitizeIssueEventType(ev.event_type);
        if (!eventType) return null;
        return {
          _tempId: `event-${ev.id ?? Math.random()}`,
          meeting_id: meetingId,
          type: "issue_event",
          description:
            typeof ev.description === "string" && ev.description.trim().length > 0
              ? ev.description.trim()
              : `${eventType.toUpperCase()}: ${ev.issue_title ?? "Untitled issue"}`,
          owner: null,
          due_date: null,
          urgency: null,
          context: typeof ev.context === "string" ? ev.context.trim() : null,
          related_topic: null,
          status: null,
          verified: true,
          supporting_quote:
            typeof ev.supporting_quote === "string"
              ? ev.supporting_quote.trim()
              : null,
          issue_event_type: eventType,
          issue_candidate_title:
            typeof ev.issue_title === "string" ? ev.issue_title.trim() : null,
        };
      })
      .filter(Boolean);

    const exRows = [...decisionRows, ...actionRows, ...issueEventRows];
    const newDbExtractionsByMappingId = new Map<number, string>();

    if (exRows.length > 0) {
      const { data: insertedEx } = await supabase
        .from("extractions")
        .insert(
          exRows.map((r) => {
            const { _tempId, ...rest } = r;
            return rest;
          })
        )
        .select("id, description, type");

      // Match inserted UUIDs back to integer IDs for reconciliation
      if (insertedEx) {
        for (const row of exRows) {
          const matchingDb = insertedEx.find(
            (db: any) =>
              db.description === row.description && db.type === row.type
          );
          if (matchingDb) {
            newDbExtractionsByMappingId.set(row._tempId, matchingDb.id);
          }
        }
      }
    }

    // 3. Sentiment segments — delete existing then insert fresh
    await supabase
      .from("sentiment_segments")
      .delete()
      .eq("meeting_id", meetingId);

    if (combined?.sentiment?.segments?.length > 0) {
      const segRows = combined.sentiment.segments.map((s: any) => ({
        meeting_id: meetingId,
        segment_index: s.segment_index,
        speaker: s.speaker ?? "Unknown",
        text_excerpt: s.text_excerpt ?? null,
        sentiment_label: sanitizeSentimentLabel(s.sentiment_label),
        sentiment_score: s.sentiment_score,
        start_time: s.start_time ?? null,
      }));
      await supabase.from("sentiment_segments").insert(segRows);
    }

  } catch (err) {
    console.error("[Insert Phase] DB Error:", err);
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE 1 COMPLETE
  // We decoupled Call 3 (Reconciliation). That is now handled sequentially
  // by reconcile-project. We just mark this meeting as extracted.
  // ──────────────────────────────────────────────────────────────────────
  await supabase
    .from("meetings")
    .update({ processing_status: "processing", processing_stage: "ready_to_reconcile" })
    .eq("id", meetingId);

  await triggerReconcileProject(
    projectId,
    isHistoricalInsert ? "full" : "incremental",
    [meetingId],
    {
      analysisRunId: analysisRunId ?? undefined,
      reconcilePromptVariant,
      reconcileModelOverride: reconcileModelOverride ?? undefined,
    }
  );
     
  console.log(
    `[process-transcript] ✅ Meeting ${meetingId} extraction complete. Ready to reconcile.`
  );

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
