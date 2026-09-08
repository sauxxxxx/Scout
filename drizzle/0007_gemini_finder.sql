ALTER TABLE finder_results ADD COLUMN website_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE finder_results ADD COLUMN rule_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_results ADD COLUMN rule_score_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE finder_results ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE finder_results ADD COLUMN ai_model TEXT;
ALTER TABLE finder_results ADD COLUMN ai_classification TEXT;
ALTER TABLE finder_results ADD COLUMN ai_icp_match TEXT;
ALTER TABLE finder_results ADD COLUMN ai_score INTEGER;
ALTER TABLE finder_results ADD COLUMN ai_confidence TEXT;
ALTER TABLE finder_results ADD COLUMN ai_explanation TEXT;
ALTER TABLE finder_results ADD COLUMN ai_opportunity_signals_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE finder_results ADD COLUMN ai_concerns_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE finder_results ADD COLUMN ai_recommended_action TEXT;
ALTER TABLE finder_results ADD COLUMN ai_evidence_refs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE finder_results ADD COLUMN ai_input_hash TEXT;
ALTER TABLE finder_results ADD COLUMN ai_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_results ADD COLUMN ai_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_results ADD COLUMN ai_estimated_cost_microusd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finder_results ADD COLUMN ai_error TEXT;
ALTER TABLE finder_results ADD COLUMN ai_analyzed_at TEXT;
ALTER TABLE finder_results ADD COLUMN ai_attempts INTEGER NOT NULL DEFAULT 0;

UPDATE finder_results SET rule_score=score, rule_score_reason=score_reason WHERE rule_score=0;

CREATE TABLE IF NOT EXISTS finder_ai_cache (
  workspace_id TEXT NOT NULL, input_hash TEXT NOT NULL, model TEXT NOT NULL,
  assessment_json TEXT NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, input_hash, model)
);

CREATE TABLE IF NOT EXISTS finder_ai_usage (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, month TEXT NOT NULL, search_id TEXT NOT NULL,
  result_id TEXT NOT NULL, input_hash TEXT NOT NULL, model TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, reserved_microusd INTEGER NOT NULL DEFAULT 0, actual_microusd INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_finder_assessments (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  finder_result_id TEXT NOT NULL UNIQUE, assessment_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (finder_result_id) REFERENCES finder_results(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_finder_ai_usage_workspace_month ON finder_ai_usage(workspace_id, month, status);
CREATE INDEX IF NOT EXISTS idx_opportunity_finder_assessments_opportunity ON opportunity_finder_assessments(workspace_id, opportunity_id);
PRAGMA optimize;
