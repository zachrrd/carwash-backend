import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";

const serializePayment = <T extends { orders: { order_staff?: Array<{ staffs: unknown }> } }>(payment: T) => ({
  ...payment,
  orders: {
    ...payment.orders,
    assigned_staffs: payment.orders.order_staff?.map((assignment) => assignment.staffs) ?? [],
    staffs: payment.orders.order_staff?.[0]?.staffs ?? null,
  },
});
import {
  OrderServiceStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from "../../generated/prisma/enums";
import {
  createPaymentTransaction,
  handleMidtransNotification,
  LegacyMidtransAmbiguityError,
  verifyPaymentByOrderId,
} from "../services/payment.service";

const parseId = (value: unknown): number | null => {
  const id = Number(value);

  return Number.isInteger(id) && id > 0 ? id : null;
};

const isValidEnumValue = <T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
): value is T[keyof T] => {
  return (
    typeof value === "string" &&
    Object.values(enumObject).includes(value as T[keyof T])
  );
};

const parsePositiveAmount = (value: unknown): number | null => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount;
};

const allowedPaymentOrderStatuses: OrderServiceStatus[] = [
  OrderServiceStatus.WAITING,
  OrderServiceStatus.CONFIRMED,
];

export const createPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { order_id, amount_received, payment_method } = req.body;

    const orderId = parseId(order_id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const amountReceived = parsePositiveAmount(amount_received);

    if (amountReceived === null) {
      return errorResponse(res, "Payment amount must be greater than 0", 400);
    }

    if (!isValidEnumValue(PaymentMethod, payment_method)) {
      return errorResponse(res, "Invalid payment method", 400);
    }

    const order = await prisma.orders.findUnique({
      where: {
        id: orderId,
      },
      include: {
        order_items: {
          include: {
            services: true,
          },
        },
      },
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    if (
      order.service_status === null ||
      !allowedPaymentOrderStatuses.includes(order.service_status)
    ) {
      return errorResponse(
        res,
        "Only waiting or confirmed orders can be paid",
        400,
      );
    }

    if (order.payment_status === PaymentStatus.PAID) {
      return errorResponse(res, "Order ini sudah dibayar", 400);
    }

    const existingPayment = await prisma.payments.findFirst({
      where: {
        order_id: orderId,
      },
    });

    if (existingPayment) {
      return errorResponse(res, "Payment untuk order ini sudah ada", 400);
    }

    const existingInvoice = await prisma.invoices.findFirst({
      where: {
        order_id: orderId,
      },
    });

    if (existingInvoice) {
      return errorResponse(res, "Invoice untuk order ini sudah ada", 400);
    }

    if (order.order_items.length === 0) {
      return errorResponse(res, "Order has no service items", 400);
    }

    const totalAmount = order.order_items.reduce((total, item) => {
      return total + Math.round(Number(item.subtotal));
    }, 0);

    if (totalAmount <= 0) {
      return errorResponse(res, "Order total must be greater than 0", 400);
    }

    if (amountReceived < totalAmount) {
      return errorResponse(res, "Jumlah pembayaran kurang", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Serialize the amount read with concurrent order edits. The row lock
      // is shared with updateOrder and the payment claim below.
      const lockedOrders = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE
      `;

      if (lockedOrders.length === 0) {
        throw new Error("Order not found");
      }

      const currentOrder = await tx.orders.findUnique({
        where: {
          id: orderId,
        },
        include: {
          order_items: {
            include: {
              services: true,
            },
          },
        },
      });

      if (!currentOrder) {
        throw new Error("Order not found");
      }

      if (
        currentOrder.service_status === null ||
        !allowedPaymentOrderStatuses.includes(currentOrder.service_status)
      ) {
        throw new Error("Only waiting or confirmed orders can be paid");
      }

      if (currentOrder.payment_status === PaymentStatus.PAID) {
        throw new Error("Order ini sudah dibayar");
      }

      if (currentOrder.order_items.length === 0) {
        throw new Error("Order has no service items");
      }

      const currentTotalAmount = currentOrder.order_items.reduce(
        (total, item) => total + Math.round(Number(item.subtotal)),
        0,
      );

      if (currentTotalAmount <= 0) {
        throw new Error("Order total must be greater than 0");
      }

      if (amountReceived < currentTotalAmount) {
        throw new Error("Jumlah pembayaran kurang");
      }

      const currentChangeAmount = amountReceived - currentTotalAmount;

      const currentPayment = await tx.payments.findFirst({
        where: {
          order_id: orderId,
        },
      });

      if (currentPayment) {
        throw new Error("Payment untuk order ini sudah ada");
      }

      const currentInvoice = await tx.invoices.findFirst({
        where: {
          order_id: orderId,
        },
      });

      if (currentInvoice) {
        throw new Error("Invoice untuk order ini sudah ada");
      }

      const paymentClaim = await tx.orders.updateMany({
        where: {
          id: orderId,
          service_status: { in: allowedPaymentOrderStatuses },
          OR: [
            { payment_status: { in: [PaymentStatus.UNPAID, PaymentStatus.FAILED] } },
            { payment_status: null },
          ],
        },
        data: { payment_status: PaymentStatus.PAID },
      });

      if (paymentClaim.count === 0) {
        throw new Error("Order state changed before payment could be recorded");
      }

      const payment = await tx.payments.create({
        data: {
          order_id: orderId,
          amount_received: amountReceived,
          change_amount: currentChangeAmount,
          payment_method,
        },
      });

      const updatedOrder = await tx.orders.findUniqueOrThrow({
        where: { id: orderId },
      });

      const invoiceNumber = `INV-${String(orderId).padStart(6, "0")}`;

      const invoice = await tx.invoices.create({
        data: {
          invoice_no: invoiceNumber,
          order_id: orderId,
          total_amount: currentTotalAmount,
        },
      });

      return {
        payment,
        invoice,
        order: updatedOrder,
      };
    });

    return successResponse(res, result, "Payment created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const createMidtransPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = parseId(req.params.orderId);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    if (req.user?.role === UserRole.CUSTOMER) {
      const customer = await prisma.customers.findUnique({
        where: {
          user_id: req.user.id,
        },
      });

      if (!customer) {
        return errorResponse(res, "Customer profile not found", 404);
      }

      const order = await prisma.orders.findUnique({
        where: {
          id: orderId,
        },
      });

      if (!order) {
        return errorResponse(res, "Order not found", 404);
      }

      if (order.customer_id !== customer.id) {
        return errorResponse(
          res,
          "You are not allowed to pay for this order",
          403,
        );
      }
    }

    const payment = await createPaymentTransaction(orderId);
    const checkoutIsNotReady = !payment.token;

    return successResponse(
      res,
      payment,
      checkoutIsNotReady
        ? "Payment attempt is being reconciled; retry this request shortly"
        : "Midtrans payment created successfully",
      checkoutIsNotReady ? 202 : 200,
    );
  } catch (err) {
    if (err instanceof LegacyMidtransAmbiguityError) {
      return errorResponse(res, err.message, 409);
    }
    next(err);
  }
};

export const verifyMidtransPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = parseId(req.params.orderId);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    if (req.user?.role === UserRole.CUSTOMER) {
      const customer = await prisma.customers.findUnique({
        where: { user_id: req.user.id },
      });
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { customer_id: true },
      });

      if (!customer || !order) {
        return errorResponse(res, "Order not found", 404);
      }
      if (order.customer_id !== customer.id) {
        return errorResponse(res, "You are not allowed to verify this order", 403);
      }
    }

    const midtransOrderId =
      typeof req.body?.midtrans_order_id === "string"
        ? req.body.midtrans_order_id
        : undefined;

    const result = await verifyPaymentByOrderId(orderId, midtransOrderId);

    return successResponse(res, result, "Payment verified successfully", 200);
  } catch (err) {
    next(err);
  }
};

export const midtransNotification = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.info("Midtrans notification received", {
      orderId: req.body?.order_id,
      transactionStatus: req.body?.transaction_status,
    });

    const result = await handleMidtransNotification(req.body);

    return successResponse(
      res,
      result,
      "Midtrans notification processed successfully",
    );
  } catch (err: any) {
    console.error("Midtrans notification processing failed:", err);
    next(err);
  }
};

export const getPayments = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    const skip = (page - 1) * limit;

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : typeof req.query.q === "string"
          ? req.query.q.trim()
          : "";

    const paymentMethod = req.query.payment_method as PaymentMethod | undefined;

    const where: any = {
      ...(paymentMethod &&
        isValidEnumValue(PaymentMethod, paymentMethod) && {
          payment_method: paymentMethod,
        }),

      ...(search && {
        OR: [
          {
            orders: {
              customers: {
                name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            orders: {
              vehicles: {
                plate_number: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
          {
            orders: {
              invoices: {
                some: {
                  invoice_no: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            },
          },
        ],
      }),
    };

    const [payments, total] = await Promise.all([
      prisma.payments.findMany({
        where,
        skip,
        take: limit,
        include: {
          orders: {
            include: {
              customers: true,
              vehicles: true,
              order_staff: { include: { staffs: true } },
              order_items: {
                include: {
                  services: true,
                },
              },
              invoices: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      }),

      prisma.payments.count({
        where,
      }),
    ]);

    const reconciliationRequiredAttempts = await prisma.$queryRaw<Array<{
      id: number;
      order_id: number;
      provider_order_id: string;
      provider_transaction_id: string | null;
      amount: string;
      succeeded_at: Date | null;
      service_status: string | null;
      payment_status: string | null;
    }>>`
      SELECT "payment_attempts"."id", "order_id", "provider_order_id", "provider_transaction_id",
             "amount"::text AS "amount", "succeeded_at",
             "orders"."service_status"::text AS "service_status",
             "orders"."payment_status"::text AS "payment_status"
      FROM "payment_attempts"
      INNER JOIN "orders" ON "orders"."id" = "payment_attempts"."order_id"
      WHERE "payment_attempts"."reconciliation_status" = 'REQUIRED'
      ORDER BY "payment_attempts"."succeeded_at" DESC NULLS LAST,
               "payment_attempts"."id" DESC
      LIMIT 100
    `;

    const totalPages = Math.ceil(total / limit);
    const serializedPayments = payments.map(serializePayment);

    return successResponse(
      res,
      {
        payments: serializedPayments,
        data: serializedPayments,
        reconciliation_required_attempts: reconciliationRequiredAttempts,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "Payments retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getPaymentByOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const orderId = parseId(req.params.order_id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const payments = await prisma.payments.findMany({
      where: {
        order_id: orderId,
      },
      include: {
        orders: {
          include: {
            customers: true,
            vehicles: true,
            order_staff: { include: { staffs: true } },
            order_items: {
              include: {
                services: true,
              },
            },
            invoices: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    });

    if (payments.length === 0) {
      return errorResponse(res, "Payment untuk order tidak ditemukan", 404);
    }

    return successResponse(res, payments.map(serializePayment), "Payments retrieved successfully");
  } catch (err) {
    next(err);
  }
};

export const getRevenueSummary = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const now = new Date();

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    const allPayments = await prisma.payments.findMany({
      select: {
        id: true,
        amount_received: true,
        change_amount: true,
        payment_date: true,
        payment_method: true,
      },
      orderBy: {
        payment_date: "asc",
      },
    });

    const calcNet = (items: typeof allPayments) => {
      return items.reduce((acc, curr) => {
        const received = Number(curr.amount_received) || 0;
        const change = Number(curr.change_amount) || 0;
        return acc + Math.max(0, received - change);
      }, 0);
    };

    const todayPayments = allPayments.filter((p) => {
      if (!p.payment_date) return false;
      const d = new Date(p.payment_date);
      return d >= startOfToday && d <= endOfToday;
    });

    const monthPayments = allPayments.filter((p) => {
      if (!p.payment_date) return false;
      const d = new Date(p.payment_date);
      return d >= startOfMonth && d <= endOfMonth;
    });

    const yearPayments = allPayments.filter((p) => {
      if (!p.payment_date) return false;
      const d = new Date(p.payment_date);
      return d >= startOfYear && d <= endOfYear;
    });

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];

    const monthlyBreakdown = monthNames.map((name, index) => {
      const inMonth = yearPayments.filter((p) => {
        if (!p.payment_date) return false;
        return new Date(p.payment_date).getMonth() === index;
      });

      return {
        month: name,
        monthIndex: index + 1,
        revenue: calcNet(inMonth),
        count: inMonth.length,
      };
    });

    const paymentMethodBreakdown = Object.values(PaymentMethod).map(
      (method) => {
        const byMethod = allPayments.filter((p) => p.payment_method === method);
        return {
          method,
          revenue: calcNet(byMethod),
          count: byMethod.length,
        };
      },
    );

    return successResponse(
      res,
      {
        today: {
          revenue: calcNet(todayPayments),
          count: todayPayments.length,
        },
        month: {
          revenue: calcNet(monthPayments),
          count: monthPayments.length,
          monthName: now.toLocaleString("id-ID", { month: "long" }),
        },
        year: {
          revenue: calcNet(yearPayments),
          count: yearPayments.length,
          year: now.getFullYear(),
        },
        allTime: {
          revenue: calcNet(allPayments),
          count: allPayments.length,
        },
        monthlyBreakdown,
        paymentMethodBreakdown,
      },
      "Revenue summary retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};
