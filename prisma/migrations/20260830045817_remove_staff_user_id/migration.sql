/*
  Warnings:

  - You are about to drop the column `user_id` on the `staffs` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "staffs" DROP CONSTRAINT "staffs_user_id_fkey";

-- DropIndex
DROP INDEX "staffs_user_id_key";

-- AlterTable
ALTER TABLE "staffs" DROP COLUMN "user_id";
