const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://ikozcykhfdnrhcbofket.supabase.co', 'sb_secret_Ir8lD8NvyBkGAC7i0aBu4g_K1Zyz8Ks');

async function run() {
  const { data, error } = await supabase
    .from('meetings')
    .select('file_name, processing_stage, processing_status, processing_error')
    .eq('processing_status', 'failed')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
