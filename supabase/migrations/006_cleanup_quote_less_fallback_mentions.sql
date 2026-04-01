-- ============================================================
-- Migration 006: Cleanup quote-less deterministic fallback mentions
-- ============================================================
--
-- Why:
-- Old reconciliation runs could persist fallback mentions with:
--   context = 'Deterministic fallback: unresolved issue-level topic.'
--   supporting_quote = null/empty
-- Those mentions could incorrectly keep issues open/reopened.
--
-- What this does:
-- 1) Deletes only those quote-less fallback mentions.
-- 2) Recomputes status fields for affected issues from remaining mention history:
--    - latest resolved    => status=resolved, resolved_in=latest meeting
--    - latest obsoleted   => status=obsolete, obsoleted_in=latest meeting
--    - latest raised/reopened/escalated => status=open, clears resolved/obsoleted pointers
--    - latest discussed/unknown/null => keep current lifecycle status as-is
--
-- Safe to run multiple times (idempotent).

WITH mentions_to_delete AS (
  SELECT im.id, im.issue_id
  FROM issue_mentions im
  WHERE im.context = 'Deterministic fallback: unresolved issue-level topic.'
    AND COALESCE(BTRIM(im.supporting_quote), '') = ''
),
deleted_mentions AS (
  DELETE FROM issue_mentions im
  USING mentions_to_delete td
  WHERE im.id = td.id
  RETURNING im.issue_id
),
affected_issues AS (
  SELECT DISTINCT issue_id
  FROM deleted_mentions
),
issue_windows AS (
  SELECT
    i.id AS issue_id,
    earliest.meeting_id AS earliest_meeting_id,
    latest.meeting_id AS latest_meeting_id,
    latest.mention_type AS latest_mention_type
  FROM issues i
  JOIN affected_issues a ON a.issue_id = i.id
  LEFT JOIN LATERAL (
    SELECT im.meeting_id
    FROM issue_mentions im
    JOIN meetings m ON m.id = im.meeting_id
    WHERE im.issue_id = i.id
    ORDER BY m.sort_order ASC, im.created_at ASC
    LIMIT 1
  ) earliest ON TRUE
  LEFT JOIN LATERAL (
    SELECT im.meeting_id, im.mention_type
    FROM issue_mentions im
    JOIN meetings m ON m.id = im.meeting_id
    WHERE im.issue_id = i.id
    ORDER BY m.sort_order DESC, im.created_at DESC
    LIMIT 1
  ) latest ON TRUE
)
UPDATE issues i
SET
  opened_in = COALESCE(w.earliest_meeting_id, i.opened_in),
  status = CASE
    WHEN w.latest_mention_type = 'resolved' THEN 'resolved'
    WHEN w.latest_mention_type = 'obsoleted' THEN 'obsolete'
    WHEN w.latest_mention_type IN ('raised', 'reopened', 'escalated') THEN 'open'
    ELSE i.status
  END,
  resolved_in = CASE
    WHEN w.latest_mention_type = 'resolved' THEN w.latest_meeting_id
    WHEN w.latest_mention_type IN ('raised', 'reopened', 'escalated', 'obsoleted') THEN NULL
    ELSE i.resolved_in
  END,
  obsoleted_in = CASE
    WHEN w.latest_mention_type = 'obsoleted' THEN w.latest_meeting_id
    WHEN w.latest_mention_type IN ('raised', 'reopened', 'escalated', 'resolved') THEN NULL
    ELSE i.obsoleted_in
  END
FROM issue_windows w
WHERE i.id = w.issue_id;
