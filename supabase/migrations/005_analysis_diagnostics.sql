-- ============================================================
-- Migration 005: Analysis diagnostics for root-cause tracing
-- ============================================================

CREATE TABLE IF NOT EXISTS analysis_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  run_id text NOT NULL DEFAULT 'default',
  stage text NOT NULL CHECK (stage IN ('extract', 'verify', 'reconcile')),
  prompt_version text,
  model text,
  temperature numeric,
  max_tokens integer,
  finish_reason text,
  parse_success boolean NOT NULL DEFAULT false,
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users see own analysis diagnostics" ON analysis_diagnostics;
CREATE POLICY "users see own analysis diagnostics"
ON analysis_diagnostics
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM projects
    WHERE projects.id = analysis_diagnostics.project_id
      AND projects.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_analysis_diagnostics_project_created
  ON analysis_diagnostics (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_diagnostics_meeting_stage
  ON analysis_diagnostics (meeting_id, stage, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_diagnostics_meeting_stage_run
  ON analysis_diagnostics (meeting_id, stage, run_id);
