CREATE TYPE "category_type" AS ENUM ('INCOME', 'EXPENSE');

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "category_type" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_version_positive" CHECK ("version" > 0)
);

CREATE INDEX "categories_user_id_deleted_at_created_at_id_idx"
    ON "categories"("user_id", "deleted_at", "created_at", "id");
CREATE INDEX "categories_user_id_deleted_at_type_idx"
    ON "categories"("user_id", "deleted_at", "type");

ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
