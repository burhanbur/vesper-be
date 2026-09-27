-- Authentication sessions and token revocation now live in Redis.
-- This migration intentionally removes obsolete PostgreSQL session data.
DROP TABLE IF EXISTS "auth_refresh_tokens";
DROP TABLE IF EXISTS "auth_sessions";

ALTER TABLE "users" ADD COLUMN "username" VARCHAR(64);
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
