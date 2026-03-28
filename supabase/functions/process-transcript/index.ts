// @ts-nocheck — Deno runtime: no tsconfig, no Node types
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type, Schema } from "https://esm.sh/@google/genai@1.45.0";

// ————————————————————————————————————————————————————————————————————————————————
// ENV — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// auto-injected by Supabase Edge Function runtime.
// Only GEMINI_API_KEY must be set via:
//   supabase secrets set GEMINI_API_KEY=...
// ————————————————————————————————————————————————————————————————————————————————
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ————————————————————————————————————————————————————————————————————————————————
// Helpers — must be inlined (cannot import from /lib in Deno)
// ————————————————————————————————————————————————————————————————————————————————

/** Strip markdown fences and extract the first JSON object/array */
function safeParseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    // Strip ```json ... ``` or ``` ... ``` wrappers
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    // Find first { or [
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    let start = -1;
    if (firstBrace === -1 && firstBracket === -1) return null;
    if (firstBrace === -1) start = firstBracket;
    else if (firstBracket === -1) start = firstBrace;
    else start = Math.min(firstBrace, firstBracket);
    cleaned = cleaned.slice(start);
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/** Gemini with retry, exponential backoff, schemas, and jitter (6 attempts) */
async function geminiWithRetry(
  ai: GoogleGenAI,
  prompt: string,
  schema: Schema | null = null,
  maxRetries = 6
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const config: any = { temperature: 0.0 };
      if (schema) {
        config.responseMimeType = "application/json";
        config.responseSchema = schema;
      }
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: config,
      });
      
      // Option 3 throttle: sleep 4s after every successful Gemini call to protect the RPM limit
      await new Promise((r) => setTimeout(r, 4000));
      
      return response.text ?? "";
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Gemini attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s + max 2s jitter
        const baseDelay = 2000 * Math.pow(2, attempt);
        const jitter = Math.random() * 2000;
        const totalDelay = baseDelay + jitter;
        console.log(`Rate limit hit (or error). Retrying in ${Math.round(totalDelay/1000)}s...`);
        await new Promise((r) => setTimeout(r, totalDelay));
      }
    }
  }
  throw lastError ?? new Error(`Gemini call failed after ${maxRetries} retries`);
}

// ————————————————————————————————————————————————————————————————————————————————
// Main handler
// ————————————————————————————————————————————————————————————————————————————————

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  let meetingId: string;
  try {
    const body = await req.json();
    meetingId = body.meetingId;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  if (!meetingId) {
    return new Response(JSON.stringify({ error: "meetingId is required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  console.log(`[process-transcript] Starting for meeting ${meetingId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // ————————————————————————————————————————————————————————————————————————————————
  // Fetch meeting raw_text and project_id
  // ————————————————————————————————————————————————————————————————————————————————
  const { data: meeting, error: meetingErr } = await supabase
    .from("meetings")
    .select("id, project_id, raw_text, file_name, processing_status")
    .eq("id", meetingId)
    .single();

  if (meetingErr || !meeting) {
    console.error("Meeting not found:", meetingErr?.message);
    return new Response(JSON.stringify({ error: "Meeting not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // Reset to processing if retrying from failed state
  if (meeting.processing_status === "failed") {
    await supabase
      .from("meetings")
      .update({ processing_status: "processing", processing_error: null })
      .eq("id", meetingId);
  }

  const transcript = meeting.raw_text;
  const projectId = meeting.project_id;

  // ————————————————————————————————————————————————————————————————————————————————
  // STAGE 1 — Summary
  // Skip if summary already exists
  // ————————————————————————————————————————————————————————————————————————————————
  const { data: existingMeeting } = await supabase
    .from("meetings")
    .select("summary")
    .eq("id", meetingId)
    .single();

  if (!existingMeeting?.summary) {
    await supabase.from("meetings").update({ processing_stage: "summarizing" }).eq("id", meetingId);
    console.log("[Stage 1] Running summary generation…");
    try {
      const summarySchema: Schema = {
        type: Type.OBJECT,
        properties: {
          tldr: { type: Type.STRING },
          overall_sentiment: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              score: { type: Type.NUMBER }
            }
          },
          stats: {
            type: Type.OBJECT,
            properties: {
              decisions: { type: Type.INTEGER },
              action_items: { type: Type.INTEGER },
              dominant_speaker: { type: Type.STRING },
              speaker_breakdown: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { name: { type: Type.STRING }, percentage: { type: Type.INTEGER } }
                }
              }
            }
          },
          topics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                title: { type: Type.STRING },
                start_time: { type: Type.STRING },
                end_time: { type: Type.STRING },
                summary: { type: Type.STRING },
                status: { type: Type.STRING },
                supporting_quote: { type: Type.STRING, nullable: true },
                urgency: { type: Type.STRING },
                circled_back_from: { type: Type.INTEGER, nullable: true },
                circled_back_at: { type: Type.INTEGER, nullable: true }
              }
            }
          }
        }
      };

      const summaryPrompt = `You are analyzing a meeting transcript to produce a structured summary.

Rules:
- Never invent topics not present in the transcript.
- If you cannot determine a field, use null — never guess.
- supporting_quote must be a verbatim excerpt from the transcript. If none exists, set status to Uncertain.
- speaker_breakdown percentages must sum to 100.
- Detect circled-back topics: if a topic is explicitly revisited later, set circled_back_at on the original and circled_back_from on the revisit.
- Topics: Do NOT split single cohesive discussions into multiple micro-topics. Group related talk tracks together.
- Stats: Only count a 'decision' if the transcript shows explicit agreement, not just a proposal.

Transcript:
${transcript}`;

      const summaryRaw = await geminiWithRetry(ai, summaryPrompt, summarySchema);
      const summaryData = safeParseJSON<Record<string, unknown>>(summaryRaw);

      if (summaryData) {
        await supabase
          .from("meetings")
          .update({ summary: summaryData })
          .eq("id", meetingId);
        console.log("[Stage 1] Summary stored.");
      } else {
        console.warn("[Stage 1] Failed to parse summary JSON — skipping, continuing pipeline.");
      }
    } catch (err) {
      console.error("[Stage 1] Summary failed (non-fatal):", err);
      // Non-fatal: continue pipeline
    }
  } else {
    console.log("[Stage 1] Summary already exists — skipping.");
  }

  // ————————————————————————————————————————————————————————————————————————————————
  // STAGE 2 + 3 — Pass 1 Extraction + Pass 2 Verification
  // Skip entirely if extractions already exist
  // ————————————————————————————————————————————————————————————————————————————————
  const { data: existingExtractions } = await supabase
    .from("extractions")
    .select("id")
    .eq("meeting_id", meetingId)
    .limit(1);

  if (!existingExtractions || existingExtractions.length === 0) {
    await supabase.from("meetings").update({ processing_stage: "extracting" }).eq("id", meetingId);
    console.log("[Stage 2] Running Pass 1 extraction…");

    const pass1Schema: Schema = {
      type: Type.OBJECT,
      properties: {
        decisions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              description: { type: Type.STRING }
            }
          }
        },
        action_items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              description: { type: Type.STRING },
              owner: { type: Type.STRING },
              due_date: { type: Type.STRING },
              urgency: { type: Type.STRING },
              context: { type: Type.STRING },
              related_topic: { type: Type.STRING }
            }
          }
        }
      }
    };

    const pass1Prompt = `You are extracting structured data from a meeting transcript.

Extract ONLY decisions and action items that are explicitly stated in the transcript.
Do NOT infer, assume, or add anything not directly said.
Do NOT hallucinate owners, dates, or tasks.

Rules:
- If no due date was mentioned: set due_date to "Not specified" — never infer a date
- If no owner was named: set owner to "Unassigned" — never guess a person
- description must be specific enough that the owner knows exactly what to do without reading the transcript
- context must explain WHY this item exists — what discussion led to it
- Decisions: A decision MUST be a final, agreed-upon outcome. Do NOT extract proposals, ideas, or unresolved debates as decisions. If it's just 'let's look into it', it's an action, not a decision.
- Actions: An action item MUST be a concrete task assigned to a specific person or team. Do NOT extract vague next steps like 'we need to think about X'. If there is no clear owner or task, skip it.

Transcript:
${transcript}`;

    let pass1: any = null;
    try {
      const pass1Raw = await geminiWithRetry(ai, pass1Prompt, pass1Schema);
      pass1 = safeParseJSON<any>(pass1Raw);

      if (!pass1) {
        throw new Error("Pass 1 extraction returned unparseable JSON");
      }

      console.log(
        `[Stage 2] Extracted ${pass1.decisions?.length ?? 0} decisions, ${pass1.action_items?.length ?? 0} action items.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Stage 2] FATAL:", msg);
      await supabase
        .from("meetings")
        .update({ processing_status: "failed", processing_error: msg })
        .eq("id", meetingId);
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }

    // ——— Stage 3: Pass 2 Verification —————————————————————————————————————————————
    await supabase.from("meetings").update({ processing_stage: "verifying" }).eq("id", meetingId);
    console.log("[Stage 3] Running Pass 2 verification…");
    
    const pass2Schema: Schema = {
      type: Type.OBJECT,
      properties: {
        decisions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              verified: { type: Type.BOOLEAN },
              supporting_quote: { type: Type.STRING, nullable: true },
              quote_location: { type: Type.STRING, nullable: true }
            }
          }
        },
        action_items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              verified: { type: Type.BOOLEAN },
              supporting_quote: { type: Type.STRING, nullable: true },
              quote_location: { type: Type.STRING, nullable: true }
            }
          }
        }
      }
    };

    const pass2Prompt = `You are a strict fact-checker. You have a meeting transcript and a set of extracted items.

For each item, you must find a direct verbatim quote from the transcript that supports the extraction.

Rules:
- Only mark verified: true if there is CLEAR, DIRECT evidence — a specific statement in the transcript
- Do NOT mark verified based on implication, inference, or general context
- supporting_quote must be verbatim text from the transcript — not a paraphrase
- If you cannot find a direct supporting quote, set verified: false and leave supporting_quote as null
- Be strict. A false positive (marking something verified when it is not) is worse than a false negative.

Extracted items:
${JSON.stringify(pass1)}

Transcript:
${transcript}`;

    let pass2: any = null;
    try {
      const pass2Raw = await geminiWithRetry(ai, pass2Prompt, pass2Schema);
      pass2 = safeParseJSON<any>(pass2Raw);
      console.log("[Stage 3] Pass 2 verification complete.");
    } catch (err) {
      console.warn("[Stage 3] Pass 2 failed (non-fatal) — all items will be unverified:", err);
    }

    // Build lookup maps for verification data
    const decisionVerification = new Map<number, any>();
    const actionVerification = new Map<number, any>();
    if (pass2?.decisions) {
      for (const v of pass2.decisions) decisionVerification.set(v.id, v);
    }
    if (pass2?.action_items) {
      for (const v of pass2.action_items) actionVerification.set(v.id, v);
    }

    // ——— Stage 4: Merge + Insert extractions ——————————————————————————————————————
    await supabase.from("meetings").update({ processing_stage: "merging" }).eq("id", meetingId);
    console.log("[Stage 4] Inserting extractions…");

    const extractionRows: Record<string, unknown>[] = [];

    for (const d of pass1.decisions ?? []) {
      const v = decisionVerification.get(d.id);
      extractionRows.push({
        meeting_id: meetingId,
        type: "decision",
        description: d.description,
        verified: v?.verified ?? false,
        supporting_quote: v?.supporting_quote ?? null,
        quote_location: v?.quote_location ?? null,
      });
    }

    for (const a of pass1.action_items ?? []) {
      const v = actionVerification.get(a.id);
      extractionRows.push({
        meeting_id: meetingId,
        type: "action_item",
        description: a.description,
        owner: a.owner ?? "Unassigned",
        due_date: a.due_date ?? "Not specified",
        urgency: a.urgency ?? "Low Priority",
        context: a.context ?? null,
        related_topic: a.related_topic ?? null,
        verified: v?.verified ?? false,
        supporting_quote: v?.supporting_quote ?? null,
        quote_location: v?.quote_location ?? null,
      });
    }

    if (extractionRows.length > 0) {
      const { error: insertErr } = await supabase.from("extractions").insert(extractionRows);
      if (insertErr) {
        console.error("[Stage 4] Extraction insert failed:", insertErr.message);
        await supabase
          .from("meetings")
          .update({ processing_status: "failed", processing_error: insertErr.message })
          .eq("id", meetingId);
        return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
      }
      console.log(`[Stage 4] Inserted ${extractionRows.length} extractions.`);
    }
  } else {
    console.log("[Stage 2-4] Extractions already exist — skipping extraction stages.");
  }

  // ————————————————————————————————————————————————————————————————————————————————
  // STAGE 5 — Sentiment Analysis
  // Skip if segments already exist
  // ————————————————————————————————————————————————————————————————————————————————
  const { data: existingSegments } = await supabase
    .from("sentiment_segments")
    .select("id")
    .eq("meeting_id", meetingId)
    .limit(1);

  if (!existingSegments || existingSegments.length === 0) {
    await supabase.from("meetings").update({ processing_stage: "analyzing_sentiment" }).eq("id", meetingId);
    console.log("[Stage 5] Running sentiment analysis…");
    try {
      const sentimentSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                segment_index: { type: Type.INTEGER },
                speaker: { type: Type.STRING },
                text_excerpt: { type: Type.STRING },
                sentiment_label: { type: Type.STRING },
                sentiment_score: { type: Type.NUMBER },
                start_time: { type: Type.STRING, nullable: true }
              }
            }
          },
          speaker_observations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                observation: { type: Type.STRING },
                average_score: { type: Type.NUMBER }
              }
            }
          }
        }
      };

      const sentimentPrompt = `You are analyzing the sentiment of a meeting transcript segment by segment.

Divide the transcript into natural segments of approximately 15-20 dialogue lines each. For each segment, determine the overall sentiment.

Sentiment labels:
- positive: agreement, enthusiasm, constructive progress, solutions being found
- neutral: informational, factual, transitional, procedural
- conflict: direct disagreement, pushback, opposition, confrontation
- frustrated: repeated concerns, expressed exasperation, feeling unheard
- uncertain: hedging, unresolved questions, indecision, 'I'm not sure'
- enthusiastic: strong positive energy, excitement, strong buy-in

Rules:
- sentiment_score ranges from -1.0 (very negative) to 1.0 (very positive)
- text_excerpt must be the first 150 characters of the segment
- speaker should be the dominant speaker in the segment, or 'Multiple' if mixed
- Do NOT show decimal sentiment scores to the user — the UI shows only labels
- Generate a one-line speaker_observation for the overall meeting per speaker, not per segment
- Be heavily biased towards 'neutral'. Most business meetings are neutral. Only assign 'conflict' or 'frustrated' if there is explicit verbal evidence of tension, anger, or strong exasperation. Professional disagreement should be marked as 'neutral'.
- Only assign 'enthusiastic' for explicit celebration or exceptional buy-in.

Transcript:
${transcript}`;

      const sentimentRaw = await geminiWithRetry(ai, sentimentPrompt, sentimentSchema);
      const sentimentData = safeParseJSON<any>(sentimentRaw);

      if (sentimentData?.segments && sentimentData.segments.length > 0) {
        const segmentRows = sentimentData.segments.map((s: any) => ({
          meeting_id: meetingId,
          segment_index: s.segment_index,
          speaker: s.speaker ?? "Unknown",
          text_excerpt: s.text_excerpt ?? null,
          sentiment_label: s.sentiment_label,
          sentiment_score: s.sentiment_score,
          start_time: s.start_time ?? null,
        }));

        const { error: segErr } = await supabase
          .from("sentiment_segments")
          .insert(segmentRows);
        if (segErr) {
          console.error("[Stage 5] Segment insert error:", segErr.message);
        } else {
          console.log(`[Stage 5] Inserted ${segmentRows.length} sentiment segments.`);
        }

        // Store speaker observations in the summary JSONB
        if (sentimentData.speaker_observations?.length > 0) {
          const { data: curr } = await supabase
            .from("meetings")
            .select("summary")
            .eq("id", meetingId)
            .single();
          const updated = {
            ...(curr?.summary ?? {}),
            speaker_observations: sentimentData.speaker_observations,
          };
          await supabase.from("meetings").update({ summary: updated }).eq("id", meetingId);
        }
      } else {
        console.warn("[Stage 5] Sentiment parse returned no segments — skipping.");
      }
    } catch (err) {
      console.error("[Stage 5] Sentiment failed (non-fatal):", err);
    }
  } else {
    await supabase.from("meetings").update({ processing_stage: "analyzing_sentiment" }).eq("id", meetingId);
    console.log("[Stage 5] Sentiment segments already exist — skipping.");
  }

  // ————————————————————————————————————————————————————————————————————————————————
  // STAGE 6 — Issue Reconciliation
  // Always runs (may update existing issues)
  // ————————————————————————————————————————————————————————————————————————————————
  await supabase.from("meetings").update({ processing_stage: "reconciling" }).eq("id", meetingId);
  console.log("[Stage 6] Running issue reconciliation…");
  try {
    // Fetch existing issues for this project
    const { data: existingIssues } = await supabase
      .from("issues")
      .select("id, title, description, status")
      .eq("project_id", projectId);

    // Fetch newly inserted extractions for this meeting
    const { data: newExtractions } = await supabase
      .from("extractions")
      .select("id, type, description, owner, due_date, urgency, context")
      .eq("meeting_id", meetingId);

    if (!newExtractions || newExtractions.length === 0) {
      console.log("[Stage 6] No extractions to reconcile — skipping.");
    } else {
      const reconciliationSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          matches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                extraction_id: { type: Type.STRING },
                issue_id: { type: Type.STRING, nullable: true },
                is_new_issue: { type: Type.BOOLEAN },
                new_issue_title: { type: Type.STRING, nullable: true },
                new_issue_description: { type: Type.STRING, nullable: true },
                mention_type: { type: Type.STRING },
                new_status: { type: Type.STRING },
                context: { type: Type.STRING, nullable: true },
                supporting_quote: { type: Type.STRING, nullable: true }
              }
            }
          },
          superseded_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                old_extraction_id: { type: Type.STRING },
                new_extraction_id: { type: Type.STRING },
                reason: { type: Type.STRING }
              }
            }
          }
        }
      };

      const reconciliationPrompt = `You are analyzing a new meeting transcript against a list of existing project issues.

For each item extracted from the new meeting, determine:
1. Does it match an existing issue? Match by topic and context — not exact wording.
2. If yes: what happened to that issue in this meeting?
3. If no: is this a genuinely new issue worth tracking at the project level?
4. Does any new action item supersede (replace) an existing action item from a previous meeting?

Mention types:
- raised: issue appears for the first time
- discussed: mentioned but no status change
- escalated: situation worsened or became more urgent
- resolved: explicitly closed or completed
- obsoleted: no longer relevant due to changed circumstances
- reopened: was previously resolved but has resurfaced

Issue status transitions:
- raised → open
- escalated → open (urgency increases)
- resolved → resolved
- obsoleted → obsolete
- reopened → open

Rules:
- Only create a new issue if it is genuinely significant at the project level — not every action item becomes an issue
- Only create a completely NEW issue if you are absolutely certain it is a major project blocker or epic. Otherwise, attempt to match it to an existing issue, or ignore it.
- Only mark resolved or obsoleted if there is a direct quote supporting it
- For superseded action items: only flag superseding if the new item clearly replaces the old one (different owner, different scope, explicitly mentioned as replacing previous task)
- If you are uncertain about a match, do not match — leave as a new issue or skip

Existing issues:
${JSON.stringify(existingIssues ?? [])}

New extractions from this meeting:
${JSON.stringify(newExtractions)}

Transcript:
${transcript}`;

      const reconcileRaw = await geminiWithRetry(ai, reconciliationPrompt, reconciliationSchema);
      const reconcileData = safeParseJSON<any>(reconcileRaw);

      if (reconcileData?.matches) {
        for (const match of reconcileData.matches) {
          let issueId = match.issue_id;

          // Create new issue if needed
          if (match.is_new_issue && match.new_issue_title) {
            const { data: newIssue, error: issueErr } = await supabase
              .from("issues")
              .insert({
                project_id: projectId,
                title: match.new_issue_title,
                description: match.new_issue_description ?? null,
                status: match.new_status ?? "open",
                opened_in: meetingId,
              })
              .select("id")
              .single();

            if (issueErr || !newIssue) {
              console.error("[Stage 6] Failed to insert new issue:", issueErr?.message);
              continue;
            }
            issueId = newIssue.id;
          } else if (issueId) {
            // Update existing issue status
            const statusUpdates: Record<string, unknown> = { status: match.new_status };
            if (match.mention_type === "resolved") {
              statusUpdates.resolved_in = meetingId;
            } else if (match.mention_type === "obsoleted") {
              statusUpdates.obsoleted_in = meetingId;
            }
            await supabase.from("issues").update(statusUpdates).eq("id", issueId);
          }

          // Insert mention
          if (issueId) {
            await supabase.from("issue_mentions").insert({
              issue_id: issueId,
              meeting_id: meetingId,
              mention_type: match.mention_type,
              context: match.context ?? null,
              supporting_quote: match.supporting_quote ?? null,
            });
          }
        }

        // Handle superseded action items
        if (reconcileData.superseded_items) {
          for (const sup of reconcileData.superseded_items) {
            if (sup.old_extraction_id && sup.new_extraction_id) {
              await supabase
                .from("extractions")
                .update({ superseded_by: sup.new_extraction_id })
                .eq("id", sup.old_extraction_id);
            }
          }
        }

        console.log(
          `[Stage 6] Processed ${reconcileData.matches.length} matches, ` +
            `${reconcileData.superseded_items?.length ?? 0} superseded items.`
        );
      } else {
        console.warn("[Stage 6] Reconciliation parse returned null — skipping.");
      }
    }
  } catch (err) {
    console.error("[Stage 6] Reconciliation failed (non-fatal):", err);
  }

  // ————————————————————————————————————————————————————————————————————————————————
  // COMPLETE
  // ————————————————————————————————————————————————————————————————————————————————
  await supabase
    .from("meetings")
    .update({ processing_status: "complete", processing_stage: "reconciling" })
    .eq("id", meetingId);

  console.log(`[process-transcript] ✅ Meeting ${meetingId} processing complete.`);

  return new Response(JSON.stringify({ success: true, meetingId }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
});
