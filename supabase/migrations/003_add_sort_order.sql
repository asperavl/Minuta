-- ============================================================
-- Migration 003: Add sort_order column to meetings
-- Order-based chronology (replaces required meeting_date)
-- ============================================================

-- Add sort_order column (nullable initially for backfill)
ALTER TABLE meetings ADD COLUMN sort_order integer;

-- Backfill existing rows: assign sort_order based on meeting_date, then created_at
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY project_id 
    ORDER BY COALESCE(meeting_date, created_at::date), created_at
  ) AS rn
  FROM meetings
)
UPDATE meetings SET sort_order = ordered.rn FROM ordered WHERE meetings.id = ordered.id;
