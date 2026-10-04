-- Additive PRD 5.5 ledger; transfer_id has no FK until Transfers (5.6) exists.
CREATE TYPE "transaction_type" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');
CREATE TABLE "transactions" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "category_id" UUID,
  "transfer_id" UUID,
  "type" "transaction_type" NOT NULL,
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
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactions_amount_positive_finite" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric AND "amount" <= 999999999999999999.99),
  CONSTRAINT "transactions_version_positive" CHECK ("version" > 0),
  CONSTRAINT "transactions_description_valid" CHECK ("description" IS NULL OR (length(btrim("description")) BETWEEN 1 AND 5000)),
  CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "transactions_account_id_deleted_at_transacted_at_id_idx" ON "transactions"("account_id", "deleted_at", "transacted_at", "id");
CREATE INDEX "transactions_account_id_deleted_at_created_at_id_idx" ON "transactions"("account_id", "deleted_at", "created_at", "id");
CREATE INDEX "transactions_category_id_deleted_at_transacted_at_id_idx" ON "transactions"("category_id", "deleted_at", "transacted_at", "id");
CREATE INDEX "transactions_account_id_deleted_at_type_transacted_at_id_idx" ON "transactions"("account_id", "deleted_at", "type", "transacted_at", "id");
CREATE INDEX "transactions_transfer_id_idx" ON "transactions"("transfer_id");
CREATE INDEX "transactions_created_by_idx" ON "transactions"("created_by");
CREATE INDEX "transactions_updated_by_idx" ON "transactions"("updated_by");
CREATE INDEX "transactions_deleted_by_idx" ON "transactions"("deleted_by");
