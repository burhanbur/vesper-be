CREATE TABLE goals (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  group_id UUID REFERENCES groups(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL, currency VARCHAR(3) NOT NULL,
  target_amount DECIMAL(20,2) NOT NULL, start_date DATE NOT NULL, target_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE', version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL, deleted_at TIMESTAMPTZ(3),
  CONSTRAINT goals_valid CHECK (target_amount > 0 AND target_amount <> 'NaN'::numeric
    AND target_amount <= 999999999999999999.99 AND target_date >= start_date
    AND currency ~ '^[A-Z]{3}$' AND status IN ('ACTIVE','COMPLETED') AND version > 0)
);
CREATE INDEX goals_user_id_deleted_at_idx ON goals(user_id,deleted_at);
CREATE INDEX goals_group_id_deleted_at_idx ON goals(group_id,deleted_at);
CREATE TABLE goal_allocations (
  id UUID PRIMARY KEY, goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount DECIMAL(20,2) NOT NULL, version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL, deleted_at TIMESTAMPTZ(3),
  CONSTRAINT goal_allocations_valid CHECK (amount >= 0 AND amount <> 'NaN'::numeric
    AND amount <= 999999999999999999.99 AND version > 0)
);
CREATE UNIQUE INDEX goal_allocations_goal_id_account_id_key ON goal_allocations(goal_id,account_id);
CREATE INDEX goal_allocations_account_id_deleted_at_created_at_id_idx ON goal_allocations(account_id,deleted_at,created_at,id);
CREATE INDEX goal_allocations_user_id_deleted_at_idx ON goal_allocations(user_id,deleted_at);
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_check;
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_check CHECK
  (entity_type IN ('account_types','accounts','categories','transactions','user_profiles',
    'investment_transactions','obligations','obligation_events','goals','goal_allocations'));
