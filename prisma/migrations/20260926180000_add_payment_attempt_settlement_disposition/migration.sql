CREATE TYPE "PaymentAttemptSettlementDisposition" AS ENUM (
    'PRIMARY',
    'DUPLICATE_RECONCILIATION_REQUIRED'
);

CREATE TYPE "PaymentAttemptReconciliationStatus" AS ENUM (
    'REQUIRED',
    'RESOLVED'
);

ALTER TABLE "payment_attempts"
    ADD COLUMN "settlement_disposition" "PaymentAttemptSettlementDisposition",
    ADD COLUMN "reconciliation_status" "PaymentAttemptReconciliationStatus",
    ADD COLUMN "succeeded_at" TIMESTAMP(6);

CREATE UNIQUE INDEX "payment_attempts_one_primary_per_order_key"
    ON "payment_attempts"("order_id")
    WHERE "settlement_disposition" = 'PRIMARY';
