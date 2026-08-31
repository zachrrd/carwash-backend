CREATE TYPE "PaymentMethod" AS ENUM (
    'CASH',
    'TRANSFER',
    'QRIS'
);

ALTER TABLE "payments"
ALTER COLUMN "payment_method" TYPE "PaymentMethod"
USING (
    CASE "payment_method"
        WHEN 'Cash' THEN 'CASH'
        WHEN 'Transfer' THEN 'TRANSFER'
        WHEN 'QRIS' THEN 'QRIS'
    END
)::"PaymentMethod";