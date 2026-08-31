ALTER TABLE tasks ADD COLUMN due_at TEXT;

UPDATE tasks
SET due_at = CASE
  WHEN due = 'Today' THEN date('now')
  WHEN due = 'Tomorrow' THEN date('now', '+1 day')
  WHEN due = 'Overdue' THEN date('now', '-1 day')
  ELSE due_at
END
WHERE due_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due_at
ON tasks(workspace_id, due_at, status);
