-- Add processing_stage to track which pipeline stage is currently running.
-- Values: summarizing | extracting | verifying | merging | analyzing_sentiment | reconciling
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS processing_stage TEXT;
