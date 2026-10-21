CREATE TABLE emergency_plans (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency VARCHAR(3) NOT NULL DEFAULT 'IDR', baseline_mode VARCHAR(16) NOT NULL,
  manual_baseline DECIMAL(20,2), coverage_months INTEGER NOT NULL, history_months INTEGER NOT NULL,
  account_ids JSONB NOT NULL, category_ids JSONB NOT NULL, goal_id UUID REFERENCES goals(id) ON DELETE RESTRICT,
  version BIGINT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL, deleted_at TIMESTAMPTZ(3),
  CONSTRAINT emergency_plans_valid CHECK (currency = 'IDR' AND version > 0
    AND coverage_months BETWEEN 1 AND 60 AND history_months IN (3,6,12)
    AND jsonb_typeof(account_ids) = 'array' AND jsonb_array_length(account_ids) <= 100
    AND jsonb_typeof(category_ids) = 'array' AND jsonb_array_length(category_ids) <= 200
    AND ((baseline_mode = 'HISTORY' AND manual_baseline IS NULL)
      OR (baseline_mode = 'MANUAL' AND manual_baseline IS NOT NULL AND manual_baseline > 0 AND manual_baseline <> 'NaN'::numeric
        AND manual_baseline * coverage_months <= 999999999999999999.99)))
);
CREATE INDEX emergency_plans_user_id_deleted_at_idx ON emergency_plans(user_id,deleted_at);
CREATE UNIQUE INDEX emergency_plans_live_owner_key ON emergency_plans(user_id) WHERE deleted_at IS NULL;
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_check;
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_check CHECK
  (entity_type IN ('account_types','accounts','categories','transactions','user_profiles',
    'investment_transactions','obligations','obligation_events','goals','goal_allocations','emergency_plans'));
