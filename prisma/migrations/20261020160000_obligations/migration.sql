-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "obligation_event_id" UUID;

-- CreateTable
CREATE TABLE "obligations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "counterparty" VARCHAR(255) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "principal" DECIMAL(20,2) NOT NULL,
    "outstanding" DECIMAL(20,2) NOT NULL,
    "due_date" DATE,
    "installments" JSONB NOT NULL,
    "linked_account_id" UUID,
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "obligation_id" UUID,
    "operation" VARCHAR(16) NOT NULL,
    "principal" DECIMAL(20,2) NOT NULL,
    "interest" DECIMAL(20,2) NOT NULL,
    "fee" DECIMAL(20,2) NOT NULL,
    "cash_account_id" UUID,
    "cash_principal_id" UUID,
    "mapped_principal_id" UUID,
    "interest_id" UUID,
    "fee_id" UUID,
    "target_event_id" UUID,
    "command" JSONB NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "transacted_at" TIMESTAMPTZ(3) NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "obligation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_command_ids" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,

    CONSTRAINT "obligation_command_ids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "obligations_user_id_deleted_at_created_at_id_idx" ON "obligations"("user_id", "deleted_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "obligations_linked_account_id_deleted_at_idx" ON "obligations"("linked_account_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_events_cash_principal_id_key" ON "obligation_events"("cash_principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_events_mapped_principal_id_key" ON "obligation_events"("mapped_principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_events_interest_id_key" ON "obligation_events"("interest_id");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_events_fee_id_key" ON "obligation_events"("fee_id");

-- CreateIndex
CREATE INDEX "obligation_events_user_id_created_at_id_idx" ON "obligation_events"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "obligation_events_obligation_id_transacted_at_id_idx" ON "obligation_events"("obligation_id", "transacted_at", "id");

-- CreateIndex
CREATE INDEX "obligation_events_cash_account_id_idx" ON "obligation_events"("cash_account_id");

-- CreateIndex
CREATE INDEX "obligation_events_target_event_id_idx" ON "obligation_events"("target_event_id");

-- CreateIndex
CREATE INDEX "obligation_command_ids_event_id_idx" ON "obligation_command_ids"("event_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_obligation_event_id_fkey" FOREIGN KEY ("obligation_event_id") REFERENCES "obligation_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_target_event_id_fkey" FOREIGN KEY ("target_event_id") REFERENCES "obligation_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_command_ids" ADD CONSTRAINT "obligation_command_ids_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "obligation_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive financial invariants. One live obligation owns a mapped legacy account.
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_check;
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_check CHECK
  (entity_type IN ('account_types','accounts','categories','transactions','user_profiles','investment_transactions','obligations','obligation_events'));
ALTER TABLE transactions DROP CONSTRAINT transactions_amount_signed_finite;
ALTER TABLE transactions ADD CONSTRAINT transactions_amount_signed_finite CHECK (
  amount <> 'NaN'::numeric AND abs(amount) <= 999999999999999999.99 AND
  ((type = 'TRANSFER' AND category_id IS NULL AND amount <> 0 AND
    ((transfer_id IS NOT NULL AND obligation_event_id IS NULL) OR (transfer_id IS NULL AND obligation_event_id IS NOT NULL)))
   OR (type <> 'TRANSFER' AND transfer_id IS NULL AND amount > 0))
);
CREATE UNIQUE INDEX obligations_active_mapped_account_key ON obligations(linked_account_id)
  WHERE deleted_at IS NULL AND linked_account_id IS NOT NULL;
CREATE INDEX transactions_obligation_event_idx ON transactions(obligation_event_id);
ALTER TABLE obligations ADD CONSTRAINT obligations_amounts_check
  CHECK (principal <> 'NaN'::numeric AND outstanding <> 'NaN'::numeric AND principal > 0 AND outstanding >= 0 AND outstanding <= principal AND version > 0 AND currency = 'IDR' AND kind IN ('PAYABLE','RECEIVABLE'));
ALTER TABLE obligation_events ADD CONSTRAINT obligation_events_amounts_check
  CHECK (principal <> 'NaN'::numeric AND interest <> 'NaN'::numeric AND fee <> 'NaN'::numeric AND principal >= 0 AND interest >= 0 AND fee >= 0 AND version > 0 AND operation IN ('OPEN','REPAY','REVERSE','DELETE','CANCEL'));

-- A cancelled UUID cannot later be used through another financial writer.
CREATE FUNCTION guard_obligation_command_id() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved_event uuid;
BEGIN
  IF TG_TABLE_NAME = 'obligation_command_ids' THEN
    IF EXISTS (SELECT 1 FROM transactions WHERE id = NEW.id AND obligation_event_id IS DISTINCT FROM NEW.event_id)
       OR EXISTS (SELECT 1 FROM transfers WHERE id = NEW.id)
       OR EXISTS (SELECT 1 FROM investment_transactions WHERE id = NEW.id)
       OR EXISTS (SELECT 1 FROM investment_cancellation_ids WHERE id = NEW.id) THEN
      RAISE EXCEPTION 'Financial UUID already used' USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT event_id INTO reserved_event FROM obligation_command_ids WHERE id = NEW.id;
    IF reserved_event IS NOT NULL THEN
      IF TG_TABLE_NAME <> 'transactions' THEN
        RAISE EXCEPTION 'Reserved financial UUID' USING ERRCODE = '23505';
      ELSIF NEW.obligation_event_id IS DISTINCT FROM reserved_event
        OR EXISTS (SELECT 1 FROM obligation_events WHERE id = reserved_event AND operation = 'CANCEL') THEN
        RAISE EXCEPTION 'Reserved financial UUID' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER obligation_reservation_guard BEFORE INSERT ON obligation_command_ids
  FOR EACH ROW EXECUTE FUNCTION guard_obligation_command_id();
CREATE TRIGGER transaction_obligation_guard BEFORE INSERT OR UPDATE OF id, obligation_event_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_obligation_command_id();
CREATE TRIGGER transfer_obligation_guard BEFORE INSERT OR UPDATE OF id ON transfers
  FOR EACH ROW EXECUTE FUNCTION guard_obligation_command_id();
CREATE TRIGGER investment_obligation_guard BEFORE INSERT OR UPDATE OF id ON investment_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_obligation_command_id();
