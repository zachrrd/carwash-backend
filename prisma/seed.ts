import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma";
import { UserRole } from "../generated/prisma/enums";

async function main() {
  const adminPassword = await bcrypt.hash("admin123", 10);
  const cashierPassword = await bcrypt.hash("cashier123", 10);

  await prisma.users.upsert({
    where: {
      email: "admin@carwash.com",
    },
    update: {},
    create: {
      name: "Administrator",
      email: "admin@carwash.com",
      password: adminPassword,
      role: UserRole.ADMIN,
    },
  });

  await prisma.users.upsert({
    where: {
      email: "cashier@carwash.com",
    },
    update: {},
    create: {
      name: "Cashier",
      email: "cashier@carwash.com",
      password: cashierPassword,
      role: UserRole.CASHIER,
    },
  });

  console.log("Users seeded successfully");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
