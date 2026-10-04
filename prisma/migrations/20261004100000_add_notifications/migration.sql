CREATE TYPE "notification_type" AS ENUM ('info', 'error', 'warning');

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 255),
    CONSTRAINT "notifications_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 10000),
    CONSTRAINT "notifications_read_state_check" CHECK (
        ("is_read" = false AND "read_at" IS NULL) OR
        ("is_read" = true AND "read_at" IS NOT NULL)
    ),
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "notifications_user_id_created_at_id_idx"
    ON "notifications"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_user_id_is_read_created_at_id_idx"
    ON "notifications"("user_id", "is_read", "created_at" DESC, "id" DESC);
