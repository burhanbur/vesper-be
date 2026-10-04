-- Additive Groups 5.9 only. No existing data or sync tables are changed.
CREATE TYPE "group_role" AS ENUM ('OWNER', 'MEMBER');
CREATE TABLE "groups" (
    "id" UUID NOT NULL, "code" VARCHAR(16) NOT NULL, "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true, "created_by" UUID NOT NULL, "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3), CONSTRAINT "groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "groups_code_format_check" CHECK (code ~ '^[A-Z0-9]{12}$'),
    CONSTRAINT "groups_name_check" CHECK (length(btrim(name)) > 0)
);
CREATE TABLE "user_groups" (
    "id" UUID NOT NULL, "user_id" UUID NOT NULL, "group_id" UUID NOT NULL, "role" "group_role" NOT NULL,
    "created_by" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "group_accounts" (
    "id" UUID NOT NULL, "group_id" UUID NOT NULL, "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "group_accounts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "group_categories" (
    "id" UUID NOT NULL, "group_id" UUID NOT NULL, "name" VARCHAR(120) NOT NULL, "type" "category_type" NOT NULL,
    "created_by" UUID NOT NULL, "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "group_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "group_categories_name_check" CHECK (length(btrim(name)) > 0)
);
CREATE TABLE "mapping_group_categories" (
    "id" UUID NOT NULL, "group_id" UUID NOT NULL, "group_category_id" UUID NOT NULL, "user_category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "mapping_group_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "groups_code_key" ON "groups"("code");
CREATE INDEX "groups_is_active_deleted_at_created_at_id_idx" ON "groups"("is_active", "deleted_at", "created_at", "id");
CREATE INDEX "groups_created_by_idx" ON "groups"("created_by");
CREATE INDEX "groups_updated_by_idx" ON "groups"("updated_by");
CREATE UNIQUE INDEX "user_groups_user_id_group_id_key" ON "user_groups"("user_id", "group_id");
CREATE INDEX "user_groups_group_id_created_at_id_idx" ON "user_groups"("group_id", "created_at", "id");
CREATE INDEX "user_groups_created_by_idx" ON "user_groups"("created_by");
CREATE UNIQUE INDEX "group_accounts_group_id_account_id_key" ON "group_accounts"("group_id", "account_id");
CREATE INDEX "group_accounts_account_id_idx" ON "group_accounts"("account_id");
CREATE UNIQUE INDEX "group_categories_group_id_id_key" ON "group_categories"("group_id", "id");
CREATE INDEX "group_categories_group_id_type_idx" ON "group_categories"("group_id", "type");
CREATE INDEX "group_categories_created_by_idx" ON "group_categories"("created_by");
CREATE INDEX "group_categories_updated_by_idx" ON "group_categories"("updated_by");
CREATE UNIQUE INDEX "mapping_group_categories_group_id_user_category_id_key" ON "mapping_group_categories"("group_id", "user_category_id");
CREATE INDEX "mapping_group_categories_group_category_id_idx" ON "mapping_group_categories"("group_category_id");
CREATE INDEX "mapping_group_categories_user_category_id_idx" ON "mapping_group_categories"("user_category_id");
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_accounts" ADD CONSTRAINT "group_accounts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_accounts" ADD CONSTRAINT "group_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mapping_group_categories" ADD CONSTRAINT "mapping_group_categories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mapping_group_categories" ADD CONSTRAINT "mapping_group_categories_group_id_group_category_id_fkey" FOREIGN KEY ("group_id", "group_category_id") REFERENCES "group_categories"("group_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mapping_group_categories" ADD CONSTRAINT "mapping_group_categories_user_category_id_fkey" FOREIGN KEY ("user_category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
