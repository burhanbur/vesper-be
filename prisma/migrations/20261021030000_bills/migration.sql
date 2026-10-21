-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "bill_command_id" UUID;

-- CreateTable
CREATE TABLE "bill_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "transaction_type" VARCHAR(16) NOT NULL,
    "amount_type" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "account_id" UUID NOT NULL,
    "category_id" UUID,
    "obligation_id" UUID,
    "frequency" VARCHAR(16) NOT NULL,
    "anchor_date" DATE NOT NULL,
    "end_date" DATE,
    "utc_offset_minutes" INTEGER NOT NULL,
    "installments" JSONB NOT NULL,
    "reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_days" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "bill_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_occurrences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "transaction_id" UUID,
    "obligation_event_id" UUID,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_commands" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "occurrence_id" UUID,
    "ledger_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_schedules_user_id_deleted_at_idx" ON "bill_schedules"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "bill_occurrences_transaction_id_key" ON "bill_occurrences"("transaction_id");

-- CreateIndex
CREATE INDEX "bill_occurrences_user_id_due_date_idx" ON "bill_occurrences"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "bill_occurrences_obligation_event_id_idx" ON "bill_occurrences"("obligation_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_occurrences_bill_id_due_date_key" ON "bill_occurrences"("bill_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "bill_commands_ledger_id_key" ON "bill_commands"("ledger_id");

-- CreateIndex
CREATE INDEX "bill_commands_user_id_created_at_idx" ON "bill_commands"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_bill_command_id_key" ON "transactions"("bill_command_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_command_id_fkey" FOREIGN KEY ("bill_command_id") REFERENCES "bill_commands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill_schedules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_obligation_event_id_fkey" FOREIGN KEY ("obligation_event_id") REFERENCES "obligation_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_commands" ADD CONSTRAINT "bill_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_commands" ADD CONSTRAINT "bill_commands_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill_schedules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_commands" ADD CONSTRAINT "bill_commands_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "bill_occurrences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE bill_schedules ADD CONSTRAINT bill_schedules_valid CHECK (
  amount > 0 AND amount <> 'NaN'::numeric AND amount <= 999999999999999999.99 AND version > 0
  AND transaction_type IN ('INCOME','EXPENSE') AND amount_type IN ('FIXED','ESTIMATED')
  AND frequency IN ('ONCE','WEEKLY','MONTHLY','YEARLY','INSTALLMENTS')
  AND utc_offset_minutes IN (0,420,480,540) AND reminder_days BETWEEN 0 AND 30
  AND (end_date IS NULL OR end_date >= anchor_date)
  AND ((obligation_id IS NULL AND category_id IS NOT NULL AND frequency <> 'INSTALLMENTS')
    OR (obligation_id IS NOT NULL AND category_id IS NULL AND frequency = 'INSTALLMENTS' AND amount_type = 'FIXED')));
ALTER TABLE bill_occurrences ADD CONSTRAINT bill_occurrences_valid CHECK (
  amount >= 0 AND amount <> 'NaN'::numeric AND amount <= 999999999999999999.99 AND version > 0
  AND ((status = 'PAID' AND amount > 0 AND ((transaction_id IS NULL) <> (obligation_event_id IS NULL)))
    OR (status IN ('PENDING','SKIPPED') AND amount = 0 AND transaction_id IS NULL AND obligation_event_id IS NULL)));
ALTER TABLE bill_commands ADD CONSTRAINT bill_commands_valid CHECK (
  outcome IN ('RESERVED','APPLIED','CANCELLED') AND id <> ledger_id
  AND (outcome <> 'APPLIED' OR occurrence_id IS NOT NULL));
ALTER TABLE sync_changes DROP CONSTRAINT sync_changes_entity_check;
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_entity_check CHECK
  (entity_type IN ('account_types','accounts','categories','transactions','user_profiles','investment_transactions',
    'obligations','obligation_events','goals','goal_allocations','emergency_plans','bill_schedules','bill_occurrences'));
CREATE FUNCTION guard_bill_transaction_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM bill_commands WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'financial identity reserved' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM bill_commands WHERE ledger_id = NEW.id AND
    (NEW.bill_command_id IS DISTINCT FROM id OR outcome = 'CANCELLED')) THEN
    RAISE EXCEPTION 'financial identity reserved' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transactions_bill_identity BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_bill_transaction_id();

