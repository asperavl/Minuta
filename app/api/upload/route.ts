import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase'
import { parseTranscript } from '@/lib/parser'

// ── Filename date auto-detection ──────────────────────────────────────────────
function extractDateFromFilename(filename: string): string | null {
  // Zoom: GMT20240315-140000_Recording.transcript.vtt
  const zoomMatch = filename.match(/GMT(\d{4})(\d{2})(\d{2})/);
  if (zoomMatch) return `${zoomMatch[1]}-${zoomMatch[2]}-${zoomMatch[3]}`;

  // Google Meet: Meeting transcript - 2024-03-15
  const isoMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Common: 03-15-2024 or 03_15_2024
  const usMatch = filename.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  return null;
}

export async function POST(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const supabaseAuth = await createSupabaseServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse FormData ──────────────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null

  if (!file || !projectId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ── Auto-detect date from filename, fall back to optional FormData value ────
  const autoDate = extractDateFromFilename(file.name);
  const meetingDate = formData.get('meetingDate') as string | null || autoDate || null;

  // ── Validate file extension ─────────────────────────────────────────────────
  const fileName = file.name.toLowerCase()
  if (!fileName.endsWith('.txt') && !fileName.endsWith('.vtt')) {
    return NextResponse.json(
      { error: 'Unsupported format. Please upload .txt or .vtt files only.' },
      { status: 400 }
    )
  }

  // ── Read file content ───────────────────────────────────────────────────────
  const content = await file.text()

  // ── Parse transcript ────────────────────────────────────────────────────────
  const parsed = parseTranscript(content, file.name)

  // ── Validate word count ─────────────────────────────────────────────────────
  if (parsed.wordCount < 300) {
    return NextResponse.json(
      { error: 'This transcript is too short for analysis. Minimum 300 words required.' },
      { status: 400 }
    )
  }

  // ── Verify project belongs to this user ─────────────────────────────────────
  const supabase = createSupabaseServiceClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // ── Get next sort_order for this project ────────────────────────────────────
  const { data: maxRow } = await supabase
    .from('meetings')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  let finalSortOrder = (maxRow?.sort_order ?? 0) + 1;
  let isHistoricalInsert = false;
  
  const intendedSortOrderRaw = formData.get('intendedSortOrder') as string | null;
  if (intendedSortOrderRaw) {
    const intended = parseInt(intendedSortOrderRaw, 10);
    if (!isNaN(intended) && intended < finalSortOrder) {
      finalSortOrder = intended;
      isHistoricalInsert = true;
      
      // We must shift all physical subsequent meetings down by 1 to make physical space.
      // Since Supabase REST doesn't natively support bulk relative updates (sort_order = sort_order + 1),
      // we fetch the downstream elements and update them explicitly.
      const { data: downstream } = await supabase
        .from('meetings')
        .select('id, sort_order')
        .eq('project_id', projectId)
        .gte('sort_order', finalSortOrder);
      
      if (downstream && downstream.length > 0) {
        const updates = downstream.map((m: { id: string; sort_order: number | null }) =>
          supabase.from('meetings').update({ sort_order: m.sort_order! + 1 }).eq('id', m.id)
        );
        await Promise.all(updates);
      }
    }
  }

  // ── Insert meeting row ──────────────────────────────────────────────────────
  const { data: meeting, error: insertError } = await supabase
    .from('meetings')
    .insert({
      project_id: projectId,
      file_name: file.name,
      raw_text: parsed.rawText,
      meeting_date: meetingDate,
      sort_order: finalSortOrder,
      word_count: parsed.wordCount,
      speaker_count: parsed.speakers.length,
      processing_status: 'processing',
    })
    .select('id')
    .single()

  if (insertError || !meeting) {
    console.error('Meeting insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to create meeting record' }, { status: 500 })
  }

  const meetingId = meeting.id

  // ── Fire Edge Function via raw fetch (reliable fire-and-forget) ─────────────
  // Using raw fetch instead of supabase.functions.invoke() because in Vercel's
  // Node.js serverless runtime the process may terminate before the SDK
  // initiates the HTTP connection. Raw fetch kicks off the TCP handshake
  // synchronously, making it reliably fire-and-forget.
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-transcript`
  fetch(edgeFnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ meetingId, isHistoricalInsert }),
  }).catch((err) => {
    console.error('[upload] Edge Function trigger failed:', err)
  })

  // ── Return immediately ──────────────────────────────────────────────────────
  return NextResponse.json({
    meetingId,
    wordCount: parsed.wordCount,
    speakers: parsed.speakers,
  })
}
