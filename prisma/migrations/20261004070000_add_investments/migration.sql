CREATE TYPE "instrument_type" AS ENUM ('STOCK', 'MUTUAL_FUND', 'CRYPTO', 'BOND', 'GOLD', 'OTHER');
CREATE TYPE "investment_transaction_type" AS ENUM ('BUY', 'SELL', 'DIVIDEND');

CREATE TABLE "instruments" (
  "id" UUID PRIMARY KEY, "code" VARCHAR(120) NOT NULL, "name" VARCHAR(255) NOT NULL,
  "type" "instrument_type" NOT NULL, "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "instruments_currency_check" CHECK (currency = 'IDR'),
  CONSTRAINT "instruments_code_check" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$')
);
CREATE UNIQUE INDEX "instruments_code_key" ON "instruments"("code");
CREATE INDEX "instruments_deleted_at_code_id_idx" ON "instruments"("deleted_at", "code", "id");

CREATE TABLE "instrument_prices" (
  "id" UUID PRIMARY KEY, "instrument_id" UUID NOT NULL, "price_date" DATE NOT NULL,
  "close_price" DECIMAL(20,8) NOT NULL, "source" VARCHAR(120) NOT NULL DEFAULT 'MANUAL',
  "updated_by" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "instrument_prices_price_check" CHECK (close_price > 0 AND close_price <> 'NaN'::numeric),
  CONSTRAINT "instrument_prices_source_check" CHECK (source = 'MANUAL'),
  CONSTRAINT "instrument_prices_instrument_id_fkey" FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "instrument_prices_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "instrument_prices_instrument_id_price_date_key" ON "instrument_prices"("instrument_id", "price_date");
CREATE INDEX "instrument_prices_price_date_id_idx" ON "instrument_prices"("price_date", "id");
CREATE INDEX "instrument_prices_updated_by_idx" ON "instrument_prices"("updated_by");

CREATE TABLE "investment_transactions" (
  "id" UUID PRIMARY KEY, "instrument_id" UUID NOT NULL, "account_id" UUID NOT NULL,
  "cash_account_id" UUID, "linked_transaction_id" UUID, "type" "investment_transaction_type" NOT NULL,
  "quantity" DECIMAL(20,8) NOT NULL, "price_per_unit" DECIMAL(20,8) NOT NULL,
  "fee" DECIMAL(20,2) NOT NULL, "realized_pl" DECIMAL(20,2), "transacted_at" TIMESTAMPTZ(3) NOT NULL,
  "description" TEXT, "version" BIGINT NOT NULL DEFAULT 1, "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL, "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "investment_transactions_numeric_check" CHECK (quantity > 0 AND quantity <> 'NaN'::numeric AND price_per_unit > 0 AND price_per_unit <> 'NaN'::numeric AND fee >= 0 AND fee <> 'NaN'::numeric AND version > 0),
  CONSTRAINT "investment_transactions_realized_check" CHECK ((type = 'SELL' AND realized_pl IS NOT NULL AND realized_pl <> 'NaN'::numeric) OR (type <> 'SELL' AND realized_pl IS NULL)),
  CONSTRAINT "investment_transactions_cash_check" CHECK ((cash_account_id IS NULL) = (linked_transaction_id IS NULL) AND (cash_account_id IS NULL OR cash_account_id <> account_id)),
  CONSTRAINT "investment_transactions_instrument_id_fkey" FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investment_transactions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investment_transactions_cash_account_id_fkey" FOREIGN KEY (cash_account_id) REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investment_transactions_linked_transaction_id_fkey" FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investment_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "investment_transactions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "investment_transactions_linked_transaction_id_key" ON "investment_transactions"("linked_transaction_id");
CREATE UNIQUE INDEX "investment_transactions_account_instrument_time_key" ON "investment_transactions"("account_id", "instrument_id", "transacted_at");
CREATE INDEX "investment_transactions_instrument_account_history_idx" ON "investment_transactions"("instrument_id", "account_id", "deleted_at", "transacted_at", "id");
CREATE INDEX "investment_transactions_cash_account_id_idx" ON "investment_transactions"("cash_account_id");
CREATE INDEX "investment_transactions_created_by_idx" ON "investment_transactions"("created_by");
CREATE INDEX "investment_transactions_updated_by_idx" ON "investment_transactions"("updated_by");

CREATE TABLE "portfolio_daily_snapshots" (
  "id" UUID PRIMARY KEY, "account_id" UUID NOT NULL, "instrument_id" UUID NOT NULL,
  "snapshot_date" DATE NOT NULL, "quantity_held" DECIMAL(20,8) NOT NULL,
  "avg_cost_price" DECIMAL(20,8) NOT NULL, "market_price" DECIMAL(20,8) NOT NULL,
  "market_value" DECIMAL(20,2) NOT NULL, "unrealized_pl" DECIMAL(20,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "portfolio_daily_snapshots_numeric_check" CHECK (quantity_held >= 0 AND quantity_held <> 'NaN'::numeric AND avg_cost_price >= 0 AND avg_cost_price <> 'NaN'::numeric AND market_price > 0 AND market_price <> 'NaN'::numeric AND market_value >= 0 AND market_value <> 'NaN'::numeric AND unrealized_pl <> 'NaN'::numeric),
  CONSTRAINT "portfolio_daily_snapshots_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "portfolio_daily_snapshots_instrument_id_fkey" FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "portfolio_snapshots_account_instrument_date_key" ON "portfolio_daily_snapshots"("account_id", "instrument_id", "snapshot_date");
CREATE INDEX "portfolio_snapshots_instrument_date_account_idx" ON "portfolio_daily_snapshots"("instrument_id", "snapshot_date", "account_id");
