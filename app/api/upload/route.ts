import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase'
import { parseTranscript } from '@/lib/parser'

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
    return NextResponse.json({ error: 'Missing file or projectId' }, { status: 400 })
  }

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

  // ── Insert meeting row ──────────────────────────────────────────────────────
  const { data: meeting, error: insertError } = await supabase
    .from('meetings')
    .insert({
      project_id: projectId,
      file_name: file.name,
      raw_text: parsed.rawText,
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
    body: JSON.stringify({ meetingId }),
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
