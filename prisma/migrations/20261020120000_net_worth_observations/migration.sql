-- Forward-only observation storage. No historical backfill or financial writes.
CREATE TABLE "net_worth_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "net_worth_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "net_worth_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "net_worth_observations_utc_date_check" CHECK ("snapshot_date" = ("observed_at" AT TIME ZONE 'UTC')::date)
);
CREATE UNIQUE INDEX "net_worth_observations_user_id_currency_snapshot_date_key"
    ON "net_worth_observations"("user_id", "currency", "snapshot_date");
