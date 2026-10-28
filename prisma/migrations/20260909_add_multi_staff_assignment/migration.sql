-- Preserve existing single-staff assignments before replacing the column
-- with a many-to-many relation.
CREATE TABLE "order_staff" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_staff_pkey" PRIMARY KEY ("id")
);

INSERT INTO "order_staff" ("order_id", "staff_id")
SELECT "id", "staff_id"
FROM "orders"
WHERE "staff_id" IS NOT NULL;

CREATE UNIQUE INDEX "order_staff_order_id_staff_id_key"
ON "order_staff"("order_id", "staff_id");

CREATE INDEX "order_staff_order_id_idx" ON "order_staff"("order_id");
CREATE INDEX "order_staff_staff_id_idx" ON "order_staff"("staff_id");

ALTER TABLE "order_staff"
ADD CONSTRAINT "fk_order_staff_order"
FOREIGN KEY ("order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "order_staff"
ADD CONSTRAINT "fk_order_staff_staff"
FOREIGN KEY ("staff_id") REFERENCES "staffs"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "orders" DROP CONSTRAINT "fk_order_staff";
ALTER TABLE "orders" DROP COLUMN "staff_id";
