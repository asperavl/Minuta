import { createClient } from "@supabase/supabase-js";
import Groq from "groq-sdk";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function run() {
  const { data: meetings } = await supabase.from('meetings').select('id, sort_order, summary').order('sort_order');
  const meeting1 = meetings[0];
  
  console.log("MEETING 1 TOPICS:", meeting1.summary?.topics);

  const { data: extractions } = await supabase.from("extractions").select("*").eq("meeting_id", meeting1.id).in("type", ["action_item", "decision"]);
  
  const actionItems = extractions.map((e) => ({
    id: e.id,
    type: e.type,
    description: e.description,
    owner: e.owner,
    due_date: e.due_date,
    urgency: e.urgency,
    context: e.context,
  }));

  const topics = (meeting1.summary?.topics || []).map((t: any, idx: number) => ({
    id: `topic-${idx}`,
    type: "topic",
    title: t.title,
    description: t.summary,
    status_in_meeting: t.status,
  }));

  const itemsToReconcile = [...actionItems, ...topics];
  console.log("ITEMS TO RECONCILE:");
  console.log(itemsToReconcile);

  const prompt = `You are a project issue tracker. Cross-reference the action items from a meeting with the existing project issues below.

For each item (using its integer id as extraction_id):
- If it maps to an existing issue, provide the issue_id, mention_type, and new_status
- If it is a completely NEW and MAJOR project blocker or feature, set is_new_issue: true and provide title/description
- Otherwise ignore minor items that don't belong in project issue tracking

Return a JSON object with no markdown, no backticks, no preamble. Just raw JSON:

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

Rules:
- Only create new issues for MAJOR blockers or major tracking items (like APIs breaking, major bugs, or massive features) — not every minor task
- When a topic is marked as 'Resolved' in the text, you must match it to its issue and set mention_type to 'resolved' and new_status to 'resolved'
- mention_type must be one of: raised, discussed, escalated, resolved, obsoleted, reopened
- new_status must be one of: open, in_progress, resolved, obsolete

EXISTING ISSUES:
[]

EXTRACTED TOPICS, DECISIONS, AND TASKS FROM THIS MEETING:
${JSON.stringify(itemsToReconcile)}`;

  console.log("PROMPT:", prompt);
  
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 4096,
  });

  console.log("LLM RESPONSE:");
  console.log(res.choices[0].message.content);
}

run();
