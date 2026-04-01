import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: extractions, error: extErr } = await supabase.from('extractions').select('id, type, description, meeting_id').order('type');
  if (extErr) console.error(extErr);
  console.log("EXTRACTIONS:", JSON.stringify(extractions, null, 2));

  const { data: issues, error: issErr } = await supabase.from('issues').select('id, title, description, status');
  if (issErr) console.error(issErr);
  console.log("ISSUES:", JSON.stringify(issues, null, 2));
  
  const { data: mentions } = await supabase.from('issue_mentions').select('*');
  console.log("MENTIONS:", JSON.stringify(mentions, null, 2));
}

run();
