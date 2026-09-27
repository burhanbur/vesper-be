CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "csrf_token_digest" CHAR(64) NOT NULL,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auth_sessions_expiry_order_check" CHECK ("absolute_expires_at" IS NULL OR "idle_expires_at" <= "absolute_expires_at")
);

CREATE TABLE "auth_refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "selector_digest" CHAR(64) NOT NULL,
    "secret_digest" CHAR(64) NOT NULL,
    "csrf_token_digest" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auth_refresh_tokens_generation_check" CHECK ("generation" >= 0)
);

CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions"("idle_expires_at", "absolute_expires_at");
CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions"("revoked_at");

CREATE UNIQUE INDEX "auth_refresh_tokens_selector_digest_key" ON "auth_refresh_tokens"("selector_digest");
CREATE UNIQUE INDEX "auth_refresh_tokens_family_generation_key" ON "auth_refresh_tokens"("family_id", "generation");
CREATE INDEX "auth_refresh_tokens_session_id_idx" ON "auth_refresh_tokens"("session_id");
CREATE INDEX "auth_refresh_tokens_family_id_idx" ON "auth_refresh_tokens"("family_id");
CREATE INDEX "auth_refresh_tokens_expires_at_idx" ON "auth_refresh_tokens"("expires_at");
