const { createClient } = require("@supabase/supabase-js");
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('='))
  .reduce((acc, [k, ...v]) => { acc[k] = v.join('=').trim(); return acc; }, {});

const supabase = createClient(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function run() {
  const { data: meetings } = await supabase.from('meetings').select('id, sort_order, summary').order('sort_order');
  const meeting1 = meetings[0];
  
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

  const topics = (meeting1.summary?.topics || []).map((t, idx) => ({
    id: `topic-${idx}`,
    type: "topic",
    title: t.title,
    description: t.summary,
    status_in_meeting: t.status,
  }));

  const itemsToReconcile = [...actionItems, ...topics];

  const prompt = `You are a project issue tracker. Cross-reference the items from a meeting with the existing project issues below.

For each item (using its integer or string id as extraction_id):
- If it maps to an existing issue, provide the issue_id, mention_type, and new_status
- If it is a completely NEW and MAJOR project blocker or feature, set is_new_issue: true and provide title/description
- Otherwise ignore minor items that don't belong in project issue tracking

Return a JSON object with no markdown, no backticks, no preamble. Just raw JSON:

{
  "matches": [
    {
      "extraction_id": "<string or integer ID from the input>",
      "issue_id": "<existing issue UUID or null>",
      "is_new_issue": true,
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
  console.log("LLM RESPONSE:");
  console.log(j.choices[0].message.content);
}

run().catch(console.error);
