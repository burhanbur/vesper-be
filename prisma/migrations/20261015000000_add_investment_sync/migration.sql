-- Deploy with application writers stopped; existing data is preserved.
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_check;
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_check CHECK
  (entity_type IN ('account_types','accounts','categories','transactions','user_profiles','investment_transactions'));

-- Backfill new trade and formerly hidden cash events for existing cursors.
CREATE FUNCTION pg_temp.investment_sync_id() RETURNS uuid LANGUAGE SQL VOLATILE AS $$
  SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint),12,'0') || '7' || substr(replace(gen_random_uuid()::text,'-',''),14,3) || '8' || substr(replace(gen_random_uuid()::text,'-',''),18,15))::uuid
$$;
WITH audience AS (
  SELECT a.id AS account_id, a.user_id FROM accounts a
  UNION
  SELECT ga.account_id, ug.user_id FROM group_accounts ga
  JOIN groups g ON g.id = ga.group_id AND g.is_active AND g.deleted_at IS NULL
  JOIN user_groups ug ON ug.group_id = g.id
  JOIN users u ON u.id = ug.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
  JOIN accounts a ON a.id = ga.account_id AND a.deleted_at IS NULL
  JOIN account_types at ON at.id = a.account_type_id AND at.deleted_at IS NULL
), initial AS (
  SELECT r.user_id, 'investment_transactions'::text AS entity_type, it.id AS entity_id, it.deleted_at
  FROM investment_transactions it JOIN audience r ON r.account_id = it.account_id
  UNION
  SELECT r.user_id, 'transactions', t.id, t.deleted_at
  FROM transactions t JOIN audience r ON r.account_id = t.account_id
  WHERE EXISTS (SELECT 1 FROM investment_transactions it WHERE it.linked_transaction_id = t.id)
)
INSERT INTO sync_changes (id,user_id,entity_type,entity_id,operation)
SELECT pg_temp.investment_sync_id(),user_id,entity_type,entity_id,
  CASE WHEN deleted_at IS NULL THEN 'CREATE' ELSE 'DELETE' END
FROM initial ORDER BY entity_type,entity_id,user_id;
