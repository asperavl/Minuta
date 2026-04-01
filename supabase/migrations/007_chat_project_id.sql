-- Add project_id column
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

-- Make meeting_id optional (project chat doesn't tie to a specific meeting)
ALTER TABLE chat_messages
  ALTER COLUMN meeting_id DROP NOT NULL;

-- Index for fetching project chat history
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created
  ON chat_messages (project_id, created_at ASC);

-- RLS policy for project-level access
DROP POLICY IF EXISTS "users see own chat" ON chat_messages;
DROP POLICY IF EXISTS "users insert own chat" ON chat_messages;
DROP POLICY IF EXISTS "users see own project chat" ON chat_messages;
DROP POLICY IF EXISTS "users insert own project chat" ON chat_messages;

CREATE POLICY "users see own project chat"
ON chat_messages
FOR SELECT
USING (
  (project_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = chat_messages.project_id
      AND projects.owner_id = auth.uid()
  ))
  OR
  (meeting_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM meetings
    JOIN projects ON projects.id = meetings.project_id
    WHERE meetings.id = chat_messages.meeting_id
      AND projects.owner_id = auth.uid()
  ))
);

CREATE POLICY "users insert own project chat"
ON chat_messages
FOR INSERT
WITH CHECK (
  (project_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = chat_messages.project_id
      AND projects.owner_id = auth.uid()
  ))
  OR
  (meeting_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM meetings
    JOIN projects ON projects.id = meetings.project_id
    WHERE meetings.id = chat_messages.meeting_id
      AND projects.owner_id = auth.uid()
  ))
);
