CREATE TABLE "accounts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "account_type_id" UUID NOT NULL,
  "parent_account_id" UUID,
  "icon" VARCHAR(120),
  "name" VARCHAR(120) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
  "balance" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "description" TEXT,
  "is_visible" BOOLEAN NOT NULL DEFAULT true,
  "is_include_total" BOOLEAN NOT NULL DEFAULT true,
  "sequence_order" BIGINT NOT NULL DEFAULT 0,
  "version" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounts_version_positive" CHECK ("version" > 0),
  CONSTRAINT "accounts_sequence_order_nonnegative" CHECK ("sequence_order" >= 0),
  CONSTRAINT "accounts_currency_idr" CHECK ("currency" = 'IDR'),
  CONSTRAINT "accounts_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "accounts_no_self_parent" CHECK ("parent_account_id" IS NULL OR "parent_account_id" <> "id"),
  CONSTRAINT "accounts_balance_finite" CHECK ("balance" <> 'NaN'::numeric AND "balance" > '-Infinity'::numeric AND "balance" < 'Infinity'::numeric),
  CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounts_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "account_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "accounts_user_id_deleted_at_created_at_id_idx" ON "accounts"("user_id", "deleted_at", "created_at", "id");
CREATE INDEX "accounts_user_id_deleted_at_account_type_id_idx" ON "accounts"("user_id", "deleted_at", "account_type_id");
CREATE INDEX "accounts_user_id_deleted_at_is_visible_idx" ON "accounts"("user_id", "deleted_at", "is_visible");
CREATE INDEX "accounts_parent_account_id_deleted_at_idx" ON "accounts"("parent_account_id", "deleted_at");
CREATE INDEX "accounts_account_type_id_idx" ON "accounts"("account_type_id");
