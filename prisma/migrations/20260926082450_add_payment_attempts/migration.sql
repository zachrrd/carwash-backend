-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_order_id" VARCHAR(255) NOT NULL,
    "provider_transaction_id" VARCHAR(255),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATING',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_order_id_key" ON "payment_attempts"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_transaction_id_key" ON "payment_attempts"("provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_attempts_order_id_idx" ON "payment_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_one_active_per_order_key"
ON "payment_attempts"("order_id")
WHERE "status" IN ('CREATING', 'PENDING');

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "fk_payment_attempt_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
