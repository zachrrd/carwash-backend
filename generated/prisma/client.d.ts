import * as runtime from "@prisma/client/runtime/client";
import * as $Class from "./internal/class.js";
import * as Prisma from "./internal/prismaNamespace.js";
export * as $Enums from './enums.js';
export * from "./enums.js";
/**
 * ## Prisma Client
 *
 * Type-safe database client for TypeScript
 * @example
 * ```
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 * // Fetch zero or more Users
 * const users = await prisma.users.findMany()
 * ```
 *
 * Read more in our [docs](https://pris.ly/d/client).
 */
export declare const PrismaClient: $Class.PrismaClientConstructor;
export type PrismaClient<LogOpts extends Prisma.LogLevel = never, OmitOpts extends Prisma.PrismaClientOptions["omit"] = Prisma.PrismaClientOptions["omit"], ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = $Class.PrismaClient<LogOpts, OmitOpts, ExtArgs>;
export { Prisma };
/**
 * Model users
 *
 */
export type users = Prisma.usersModel;
/**
 * Model customers
 *
 */
export type customers = Prisma.customersModel;
/**
 * Model staffs
 *
 */
export type staffs = Prisma.staffsModel;
/**
 * Model vehicles
 *
 */
export type vehicles = Prisma.vehiclesModel;
/**
 * Model services
 *
 */
export type services = Prisma.servicesModel;
/**
 * Model orders
 *
 */
export type orders = Prisma.ordersModel;
/**
 * Model order_staff
 *
 */
export type order_staff = Prisma.order_staffModel;
/**
 * Model order_items
 *
 */
export type order_items = Prisma.order_itemsModel;
/**
 * Model payments
 *
 */
export type payments = Prisma.paymentsModel;
/**
 * Model invoices
 *
 */
export type invoices = Prisma.invoicesModel;
/**
 * Model payment_attempts
 *
 */
export type payment_attempts = Prisma.payment_attemptsModel;
//# sourceMappingURL=client.d.ts.map