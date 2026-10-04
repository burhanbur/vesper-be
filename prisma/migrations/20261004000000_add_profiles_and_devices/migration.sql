-- Additive phase 1 migration: existing users/authentication tables remain unchanged.
CREATE TYPE "profile_gender" AS ENUM ('Laki-laki', 'Perempuan');

CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(120),
    "phone_number" VARCHAR(32),
    "gender" "profile_gender",
    "photo" VARCHAR(255),
    "base_currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "theme" VARCHAR(16) NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_profiles_base_currency_check" CHECK ("base_currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "user_profiles_theme_check" CHECK ("theme" IN ('light', 'dark', 'system'))
);

CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "app_version" VARCHAR(64) NOT NULL,
    "last_sync_version" BIGINT NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "devices_platform_check" CHECK ("platform" IN ('Web', 'iOS', 'Android')),
    CONSTRAINT "devices_last_sync_version_check" CHECK ("last_sync_version" >= 0)
);

CREATE INDEX "user_profiles_deleted_at_idx" ON "user_profiles"("deleted_at");
CREATE INDEX "devices_user_id_created_at_id_idx" ON "devices"("user_id", "created_at", "id");
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
