CREATE TABLE investment_recoveries (
  trade_id uuid PRIMARY KEY,
  linked_transaction_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  cash_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  command_sha256 char(64) NOT NULL CHECK (command_sha256 ~ '^[a-f0-9]{64}$'),
  command jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CANCELLED','DENIED')),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  review_reason varchar(1000), reviewed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (trade_id <> linked_transaction_id),
  CHECK (account_id <> cash_account_id),
  CHECK ((status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(review_reason) > 0))
);
CREATE INDEX investment_recoveries_user_id_created_at_idx ON investment_recoveries(user_id,created_at);
CREATE TABLE investment_cancellation_ids (
  id uuid PRIMARY KEY,
  trade_id uuid NOT NULL REFERENCES investment_recoveries(trade_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX investment_cancellation_ids_trade_id_idx ON investment_cancellation_ids(trade_id);

-- All application sync writers take this same lock before domain locks. These
-- triggers also protect imports/direct creates and retain identities forever.
CREATE FUNCTION guard_investment_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(5786933010410::bigint);
  IF TG_TABLE_NAME = 'investment_cancellation_ids' THEN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Cancellation identities are immutable' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM transactions WHERE id=NEW.id)
      OR EXISTS (SELECT 1 FROM investment_transactions WHERE id=NEW.id OR linked_transaction_id=NEW.id)
      OR EXISTS (SELECT 1 FROM transfers WHERE id=NEW.id) THEN
      RAISE EXCEPTION 'Financial identity already exists' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM investment_recoveries r WHERE r.trade_id=NEW.trade_id
      AND NEW.id IN (r.trade_id,r.linked_transaction_id)) THEN
      RAISE EXCEPTION 'Invalid cancellation identity' USING ERRCODE='23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM investment_cancellation_ids WHERE id=NEW.id) THEN
      RAISE EXCEPTION 'Financial identity is cancelled' USING ERRCODE='23505', CONSTRAINT='investment_cancellation_ids_pkey';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER investment_cancellation_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON investment_cancellation_ids
  FOR EACH ROW EXECUTE FUNCTION guard_investment_cancellation();
CREATE TRIGGER transaction_cancellation_guard BEFORE INSERT OR UPDATE OF id ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_investment_cancellation();
CREATE TRIGGER investment_cancellation_guard BEFORE INSERT OR UPDATE OF id ON investment_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_investment_cancellation();
CREATE TRIGGER transfer_cancellation_guard BEFORE INSERT OR UPDATE OF id ON transfers
  FOR EACH ROW EXECUTE FUNCTION guard_investment_cancellation();

-- Register the permission but grant it to no role automatically.
INSERT INTO routes(id,name,method,module,description,updated_at)
VALUES ('019a0000-0016-7000-8000-000000000001','sync.investment-recoveries.review','POST','sync',
  'Review never-applied investment cancellation requests',CURRENT_TIMESTAMP)
ON CONFLICT(name) DO NOTHING;
