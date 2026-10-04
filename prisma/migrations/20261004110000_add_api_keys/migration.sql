-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "application" VARCHAR(120),
    "ip_whitelist" JSONB,
    "permissions" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "idx_api_keys_is_active" ON "api_keys"("is_active");

-- CreateIndex
CREATE INDEX "idx_api_keys_expires_at" ON "api_keys"("expires_at");
