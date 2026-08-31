-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CASHIER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrderServiceStatus" AS ENUM (
    'WAITING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM (
    'UNPAID',
    'PAID',
    'REFUNDED',
    'FAILED'
);


-- =====================================================
-- USERS
-- =====================================================

ALTER TABLE "users"
ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
ALTER COLUMN "role" TYPE "UserRole"
USING (
    CASE "role"
        WHEN 'Admin' THEN 'ADMIN'
        WHEN 'Cashier' THEN 'CASHIER'
        WHEN 'Customer' THEN 'CUSTOMER'
    END
)::"UserRole";

ALTER TABLE "users"
ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';


-- =====================================================
-- STAFFS
-- =====================================================

ALTER TABLE "staffs"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "staffs"
ALTER COLUMN "status" TYPE "ActiveStatus"
USING (
    CASE "status"
        WHEN 'Active' THEN 'ACTIVE'
        WHEN 'Inactive' THEN 'INACTIVE'
        ELSE NULL
    END
)::"ActiveStatus";

ALTER TABLE "staffs"
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';


-- =====================================================
-- SERVICES
-- =====================================================

ALTER TABLE "services"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "services"
ALTER COLUMN "status" TYPE "ActiveStatus"
USING (
    CASE "status"
        WHEN 'Active' THEN 'ACTIVE'
        WHEN 'Inactive' THEN 'INACTIVE'
        ELSE NULL
    END
)::"ActiveStatus";

ALTER TABLE "services"
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';


-- =====================================================
-- ORDERS - SERVICE STATUS
-- =====================================================

ALTER TABLE "orders"
ALTER COLUMN "service_status" DROP DEFAULT;

ALTER TABLE "orders"
ALTER COLUMN "service_status" TYPE "OrderServiceStatus"
USING (
    CASE "service_status"
        WHEN 'Waiting' THEN 'WAITING'
        WHEN 'Completed' THEN 'COMPLETED'
        ELSE NULL
    END
)::"OrderServiceStatus";

ALTER TABLE "orders"
ALTER COLUMN "service_status" SET DEFAULT 'WAITING';


-- =====================================================
-- ORDERS - PAYMENT STATUS
-- =====================================================

ALTER TABLE "orders"
ALTER COLUMN "payment_status" DROP DEFAULT;

ALTER TABLE "orders"
ALTER COLUMN "payment_status" TYPE "PaymentStatus"
USING (
    CASE "payment_status"
        WHEN 'Unpaid' THEN 'UNPAID'
        WHEN 'Paid' THEN 'PAID'
        ELSE NULL
    END
)::"PaymentStatus";

ALTER TABLE "orders"
ALTER COLUMN "payment_status" SET DEFAULT 'UNPAID';