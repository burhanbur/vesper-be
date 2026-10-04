CREATE TYPE "account_type_category" AS ENUM ('CASH', 'INVESTMENT');

CREATE TABLE "account_types" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "account_type_category" NOT NULL DEFAULT 'CASH',
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "account_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_types_version_positive" CHECK ("version" > 0)
);

CREATE INDEX "account_types_user_id_deleted_at_created_at_id_idx"
    ON "account_types"("user_id", "deleted_at", "created_at", "id");
CREATE INDEX "account_types_user_id_deleted_at_category_idx"
    ON "account_types"("user_id", "deleted_at", "category");

ALTER TABLE "account_types" ADD CONSTRAINT "account_types_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
