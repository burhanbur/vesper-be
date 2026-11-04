-- Purpose labels and full-account allocations only; no ledger or grant backfill.
CREATE TABLE "group_pockets" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "group_pockets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_pockets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "group_pockets_group_id_id_key" ON "group_pockets"("group_id", "id");
CREATE INDEX "group_pockets_group_id_created_at_id_idx" ON "group_pockets"("group_id", "created_at", "id");
CREATE TABLE "group_pocket_accounts" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "pocket_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_pocket_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_pocket_accounts_group_id_pocket_id_fkey" FOREIGN KEY ("group_id", "pocket_id") REFERENCES "group_pockets"("group_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "group_pocket_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "group_pocket_accounts_group_id_account_id_key" ON "group_pocket_accounts"("group_id", "account_id");
CREATE INDEX "group_pocket_accounts_group_id_pocket_id_idx" ON "group_pocket_accounts"("group_id", "pocket_id");
CREATE INDEX "group_pocket_accounts_account_id_idx" ON "group_pocket_accounts"("account_id");
