import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase'

export async function PATCH(request: NextRequest) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const supabaseAuth = await createSupabaseServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { projectId: string; orderedMeetingIds: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { projectId, orderedMeetingIds } = body
  if (!projectId || !Array.isArray(orderedMeetingIds) || orderedMeetingIds.length === 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createSupabaseServiceClient()

  // ── Verify project belongs to this user ─────────────────────────────────────
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // ── Update sort_order for each meeting ──────────────────────────────────────
  // Run updates sequentially — each meeting gets its index+1 as sort_order
  const updates = orderedMeetingIds.map((meetingId, index) =>
    supabase
      .from('meetings')
      .update({ sort_order: index + 1 })
      .eq('id', meetingId)
      .eq('project_id', projectId) // safety: only update meetings in this project
  )

  const results = await Promise.all(updates)
  const failed = results.filter(r => r.error)
  if (failed.length > 0) {
    console.error('[reorder] Some updates failed:', failed.map(r => r.error))
    return NextResponse.json({ error: 'Partial update failure' }, { status: 500 })
  }

  // ── Fire Re-Reconciler Edge Function (reliable fire-and-forget) ──────────
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reconcile-project`
  fetch(edgeFnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ projectId, mode: 'full' }),
  }).catch((err) => {
    console.error('[reorder] Re-Reconciler Edge Function trigger failed:', err)
  })

  return NextResponse.json({ success: true })
}
