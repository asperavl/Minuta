-- ============================================================
-- Migration 004: Reconcile state + issue event extractions
-- ============================================================

-- 1) Extend extractions so the pipeline can emit explicit issue lifecycle events.
ALTER TABLE extractions DROP CONSTRAINT IF EXISTS extractions_type_check;
ALTER TABLE extractions
  ADD CONSTRAINT extractions_type_check
  CHECK (type IN ('decision', 'action_item', 'issue_event'));

ALTER TABLE extractions
  ADD COLUMN IF NOT EXISTS issue_event_type text,
  ADD COLUMN IF NOT EXISTS issue_candidate_title text;

ALTER TABLE extractions DROP CONSTRAINT IF EXISTS extractions_issue_event_type_check;
ALTER TABLE extractions
  ADD CONSTRAINT extractions_issue_event_type_check
  CHECK (
    issue_event_type IS NULL
    OR issue_event_type IN ('raised', 'resolved', 'reopened', 'obsoleted')
  );

ALTER TABLE extractions DROP CONSTRAINT IF EXISTS extractions_issue_event_fields_check;
ALTER TABLE extractions
  ADD CONSTRAINT extractions_issue_event_fields_check
  CHECK (
    (type <> 'issue_event')
    OR (issue_event_type IS NOT NULL)
  );

-- 2) Project-level reconcile state for async status + single-flight queuing.
CREATE TABLE IF NOT EXISTS project_reconcile_state (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'queued', 'running', 'failed', 'complete')),
  running boolean NOT NULL DEFAULT false,
  queued boolean NOT NULL DEFAULT false,
  active_mode text CHECK (active_mode IN ('incremental', 'full')),
  queued_mode text CHECK (queued_mode IN ('incremental', 'full')),
  queued_meeting_ids uuid[] NOT NULL DEFAULT '{}',
  last_job_id uuid,
  last_error text,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_reconcile_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users see own reconcile state" ON project_reconcile_state;
CREATE POLICY "users see own reconcile state"
ON project_reconcile_state
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM projects
    WHERE projects.id = project_reconcile_state.project_id
      AND projects.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_project_reconcile_state_status
  ON project_reconcile_state (status);
