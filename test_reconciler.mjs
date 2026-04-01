import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync('.env.local', 'utf8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('='))
  .reduce((acc, [k, ...v]) => { acc[k] = v.join('=').trim(); return acc; }, {});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'] || env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function run() {
  const { data: meetings } = await supabase.from('meetings').select('id, sort_order, summary').order('sort_order', { ascending: true });
  const meeting2 = meetings[1]; // sort_order 2
  
  const currentIssues = [
    {
      "id": "eccdf9a0-ec3e-4717-a376-30eb3998c5a3",
      "project_id": "bdb5f895-7aaa-4e42-9c41-782c58a487d3",
      "title": "API Delay Issue",
      "description": "The team discussed the API delay issue from last week and decided to reduce the scope of the project by deferring the reporting module to v1.1.",
      "status": "open",
    },
    {
      "id": "dbdc5c12-f379-42c2-889f-e0c233c76366",
      "project_id": "bdb5f895-7aaa-4e42-9c41-782c58a487d3",
      "title": "Onboarding Flow Issue",
      "description": "The team discussed the onboarding flow and the feedback that it's confusing. They identified the third step as the source of confusion and decided to add a clearer prompt and an email reminder if users haven't verified their email within 24 hours.",
      "status": "open",
    }
  ];
  
  const { data: extractions, error: extErr } = await supabase.from("extractions").select("*").eq("meeting_id", meeting2.id).in("type", ["action_item", "decision"]);
  if (extErr) console.error("EXT ERR:", extErr);
  const actionItems = (extractions || []).map((e) => ({
    id: e.id,
    type: e.type,
    description: e.description,
    owner: e.owner,
    due_date: e.due_date,
    urgency: e.urgency,
    context: e.context,
  }));

  const topics = (meeting2.summary?.topics || []).map((t, idx) => ({
    id: `topic-${idx}`,
    type: "topic",
    title: t.title,
    description: t.summary,
    status_in_meeting: t.status,
  }));

  const itemsToReconcile = [...actionItems, ...topics];

  const prompt = `You are a Senior Technical Project Manager AI. Your job is to strictly match conversational items to existing tracker tickets. 
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
${JSON.stringify(currentIssues)}

EXTRACTED TOPICS (These indicate fundamental project discussions/bugs. They CAN spawn NEW tickets):
${JSON.stringify(topics)}

EXTRACTED WORKFLOW TASKS (These are action items. They cannot spawn NEW tickets, they can only map to EXISTING tickets):
${JSON.stringify(actionItems)}`;

  console.log("PROMPT HAS ITEM COUNT:", itemsToReconcile.length);
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env['GROQ_API_KEY']}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    })
  });

  const j = await res.json();
  fs.writeFileSync('llm_out_fixed.json', j.choices[0].message.content, 'utf8');
  console.log("Wrote llm_out_fixed.json");
}

run().catch(console.error);
