const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('='))
  .reduce((acc, [k, ...v]) => { acc[k] = v.join('=').trim(); return acc; }, {});

const SUPABASE_URL = env['SUPABASE_URL'] || env['NEXT_PUBLIC_SUPABASE_URL'];
const SUPABASE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

async function get(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function run() {
  const ext = await get('extractions');
  console.log("EXTRACTIONS:", JSON.stringify(ext, null, 2));

  const issues = await get('issues');
  console.log("ISSUES:", JSON.stringify(issues, null, 2));
}

run().catch(console.error);
