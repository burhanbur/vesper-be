CREATE TYPE "period_type" AS ENUM ('MONTHLY', 'WEEKLY', 'DAILY', 'ANNUAL');

CREATE TABLE "budgets" (
  "id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "icon" VARCHAR(120),
  "anchor_date" DATE NOT NULL,
  "period_type" "period_type" NOT NULL,
  "base_currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
  "description" TEXT,
  "sequence_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "budgets_base_currency_check" CHECK ("base_currency" = 'IDR')
);
CREATE TABLE "budget_amounts" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "budget_amounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budget_amounts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "budget_amounts_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "budget_amounts_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE INDEX "budgets_category_id_deleted_at_created_at_id_idx" ON "budgets"("category_id", "deleted_at", "created_at", "id");
CREATE INDEX "budgets_category_id_deleted_at_period_type_idx" ON "budgets"("category_id", "deleted_at", "period_type");
CREATE INDEX "budget_amounts_budget_id_effective_from_effective_to_idx" ON "budget_amounts"("budget_id", "effective_from", "effective_to");
CREATE UNIQUE INDEX "budget_amounts_one_open_row_idx" ON "budget_amounts"("budget_id") WHERE "effective_to" IS NULL;
-- Half-open intervals permit retained same-day zero-duration audit rows.
-- All application writers take the owner advisory lock before budget/category row locks.
