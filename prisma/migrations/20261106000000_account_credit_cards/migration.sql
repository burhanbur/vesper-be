-- Additive metadata only: no historical account conversion or balance writes.
ALTER TABLE "accounts"
  ADD COLUMN "is_credit_card" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "credit_limit" DECIMAL(20,2);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_credit_limit_positive" CHECK ("credit_limit" IS NULL OR "credit_limit" > 0),
  ADD CONSTRAINT "accounts_credit_limit_card" CHECK ("is_credit_card" OR "credit_limit" IS NULL),
  ADD CONSTRAINT "accounts_credit_card_idr" CHECK (NOT "is_credit_card" OR "currency" = 'IDR');
