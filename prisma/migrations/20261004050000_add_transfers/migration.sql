-- Additive PRD 5.6 transfers and signed linked ledger legs. No data reset.
CREATE TABLE "transfers" (
  "id" UUID NOT NULL,
  "from_account_id" UUID NOT NULL,
  "to_account_id" UUID NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "transacted_at" TIMESTAMPTZ(3) NOT NULL,
  "description" TEXT,
  "version" BIGINT NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "deleted_by" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfers_accounts_distinct" CHECK ("from_account_id" <> "to_account_id"),
  CONSTRAINT "transfers_amount_positive_finite" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric AND "amount" <= 999999999999999999.99),
  CONSTRAINT "transfers_version_positive" CHECK ("version" > 0),
  CONSTRAINT "transfers_description_valid" CHECK ("description" IS NULL OR (length(btrim("description")) BETWEEN 1 AND 5000)),
  CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfers_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "transfers_from_account_id_deleted_at_transacted_at_id_idx" ON "transfers"("from_account_id", "deleted_at", "transacted_at", "id");
CREATE INDEX "transfers_to_account_id_deleted_at_transacted_at_id_idx" ON "transfers"("to_account_id", "deleted_at", "transacted_at", "id");
CREATE INDEX "transfers_created_by_idx" ON "transfers"("created_by");
CREATE INDEX "transfers_updated_by_idx" ON "transfers"("updated_by");
CREATE INDEX "transfers_deleted_by_idx" ON "transfers"("deleted_by");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_id_fkey"
  FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Manual amounts stay positive. Only linked TRANSFER legs may be negative.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_positive_finite";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_signed_finite" CHECK (
  "amount" <> 'NaN'::numeric AND abs("amount") <= 999999999999999999.99 AND
  (("type" = 'TRANSFER' AND "transfer_id" IS NOT NULL AND "category_id" IS NULL AND "amount" <> 0)
   OR ("type" <> 'TRANSFER' AND "transfer_id" IS NULL AND "amount" > 0))
);
-- One leg per account per transfer; paired signs/dates are verified by the ledger writer.
CREATE UNIQUE INDEX "transactions_transfer_account_unique" ON "transactions"("transfer_id", "account_id") WHERE "transfer_id" IS NOT NULL;
