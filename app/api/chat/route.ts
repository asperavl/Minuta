import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { groq, estimateTokens } from "@/lib/groq";
import { normalizeSummary, ExtractionModel, SentimentSegmentModel, IssueModel } from "@/lib/phase3";

const CROSS_MEETING_SYSTEM_PROMPT = `
You are a meeting analyst assistant with access to multiple meeting transcripts from the same project.

Rules:
- Answer ONLY from the transcripts provided. Never use general knowledge.
- If the answer is not in any transcript, respond exactly: "I couldn't find a clear answer to this across the meetings provided."
- Always cite which meeting your answer comes from, and the approximate location within that meeting.
- Never speculate, infer, or answer beyond what is explicitly stated.
- Never make up quotes.
- RECENCY RULE: When the same topic appears in multiple meetings and the conclusions differ, prioritize the most recent meeting's conclusion as the current state. Always explicitly note when a position has changed between meetings — cite both the original decision and the updated one with their respective meeting sources.
- When answering questions about current status, always check all meetings chronologically and report the most recent known state.

Citation format: (Source: <meeting name>, <topic or description>, ~<timestamp>)

Current project issues for context:
{{ISSUES_JSON}}

Meetings (in chronological order):
{{MEETINGS_CONCATENATED}}
`;

const SINGLE_MEETING_SYSTEM_PROMPT = `
You are a meeting analyst assistant focusing on a specific meeting transcript.

Rules:
- Answer ONLY from the transcript provided. Never use general knowledge.
- If the answer is not in the transcript, respond exactly: "I couldn't find a clear answer to this in the meeting transcript."
- Never speculate, infer, or answer beyond what is explicitly stated.
- Never make up quotes.

Citation format: (Source: <meeting name>, ~<timestamp>)

Current project issues for context:
{{ISSUES_JSON}}

Meeting Transcript:
{{MEETINGS_CONCATENATED}}
`;

function buildFullMeetingBlock(meeting: any): string {
  return `=== MEETING: ${meeting.file_name} (${meeting.meeting_date || meeting.created_at}) ===\n[FULL TRANSCRIPT]\n${meeting.raw_text}`;
}

function buildSummaryMeetingBlock(meeting: any, summary: any): string {
  const topicsStr = Array.isArray(summary.topics)
    ? summary.topics.map((t: any) => `- ${t.title || "Topic"} (${t.status}): ${t.summary}`).join("\n")
    : "No topics recorded.";
    
  return `=== MEETING: ${meeting.file_name} (${meeting.meeting_date || meeting.created_at}) [SUMMARY ONLY] ===
TL;DR: ${summary.tldr || "No TL;DR available."}
Topics discussed:
${topicsStr}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    const { projectId, meetingId, question, history } = body;

    if (!projectId || !question || !Array.isArray(history)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
    }

    // 1. Fetch project to ensure access
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("owner_id", user.id)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found or unauthorized" }), { status: 404 });
    }

    // 2. Fetch all required context
    const [meetingsResp, issuesResp] = await Promise.all([
      supabase
        .from("meetings")
        .select("id, file_name, created_at, meeting_date, sort_order, raw_text, summary, processing_status")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("issues")
        .select("id, title, description, status")
        .eq("project_id", projectId)
    ]);

    const meetings = meetingsResp.data || [];
    const issues = issuesResp.data || [];
    
    // Filter to only processed meetings
    let completedMeetings = meetings.filter(m => m.processing_status === "complete");

    if (meetingId) {
      completedMeetings = completedMeetings.filter(m => m.id === meetingId);
    }

    if (completedMeetings.length === 0) {
      return new Response(
        JSON.stringify({ error: "No completed meetings available for chat context." }),
        { status: 400 }
      );
    }

    // 3. Assemble Context (Smart Budgeting)
    const MAX_INPUT_TOKENS = 110000;
    
    const issuesJson = JSON.stringify(issues.map(i => ({
      title: i.title, status: i.status, description: i.description
    })));

    // Pre-calculate base prompt tokens
    const basePromptPlaceholderSize = estimateTokens(CROSS_MEETING_SYSTEM_PROMPT) + estimateTokens(issuesJson);
    
    let currentTokens = basePromptPlaceholderSize;
    const meetingBlocks: string[] = [];
    let fullTextCount = 0;

    // Process from newest to oldest
    const reversedMeetings = [...completedMeetings].reverse();

    for (const meeting of reversedMeetings) {
      // Create candidate blocks
      const fullBlock = buildFullMeetingBlock(meeting);
      const summaryBlock = buildSummaryMeetingBlock(meeting, normalizeSummary(meeting.summary));

      const fullTokens = estimateTokens(fullBlock);
      const summaryTokens = estimateTokens(summaryBlock);

      // Keep full transcripts for the most recent 2 meetings if there is enough budget
      if (currentTokens + fullTokens <= MAX_INPUT_TOKENS && fullTextCount < 2) {
        meetingBlocks.unshift(fullBlock);
        currentTokens += fullTokens;
        fullTextCount++;
      } else if (currentTokens + summaryTokens <= MAX_INPUT_TOKENS) {
        // Fall back to summaries for older meetings or if budget is tight
        meetingBlocks.unshift(summaryBlock);
        currentTokens += summaryTokens;
      } else {
        // Stop adding meetings if we hit the limit
        break;
      }
    }
    
    const systemPrompt = (meetingId ? SINGLE_MEETING_SYSTEM_PROMPT : CROSS_MEETING_SYSTEM_PROMPT)
      .replace("{{ISSUES_JSON}}", issuesJson)
      .replace("{{MEETINGS_CONCATENATED}}", meetingBlocks.join("\n\n"));

    // Check sliding window across whole history to ensure total request string isn't too huge
    // Only keeping last few messages if we are close to boundary.
    const finalHistory = [...history];
    let maxHistoricalTokens = 5000; // Cap history context length
    let currentHistoryTokens = estimateTokens(JSON.stringify(finalHistory));

    while (finalHistory.length > 2 && currentHistoryTokens > maxHistoricalTokens) {
      finalHistory.shift(); // Remove oldest message pair (ideally both user and assistant to keep flow)
      finalHistory.shift();
      currentHistoryTokens = estimateTokens(JSON.stringify(finalHistory));
    }

    // Prepare readable stream for direct pass-through
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          // Add history + new question to groq
          const messages = [
            { role: "system", content: systemPrompt },
            ...finalHistory.map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: question }
          ];

          // Since Groq API expects specific roles
          const formattedMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = messages.filter(m => m.role === 'system' || m.role === 'user' || m.role === 'assistant') as any;

          const aiStream = await groq.chat.completions.create({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: formattedMessages,
            max_tokens: 2048,
            temperature: 0.3,
            stream: true,
          });

          let fullResponse = "";
          for await (const chunk of aiStream) {
            const token = chunk.choices[0]?.delta?.content ?? "";
            if (token) {
              fullResponse += token;
              // Encoded as JSON string to safely pass newlines
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          supabase.from("chat_messages").insert([
            { project_id: projectId, meeting_id: meetingId || null, role: "user", content: question },
            { project_id: projectId, meeting_id: meetingId || null, role: "assistant", content: fullResponse }
          ]).then(({ error }) => {
            if (error) console.error("Could not persist messages:", error);
          });

        } catch (streamingErr: any) {
          console.error("Streaming error:", streamingErr);
          const errorMsg = streamingErr?.status === 429 
            ? "Rate limit exceeded. Please wait a moment and try again." 
            : "I'm having trouble connecting right now. Please try again.";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorMsg)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } catch (err: any) {
    console.error("Chat API error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500
    });
  }
}
