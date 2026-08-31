import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import {
  OrderServiceStatus,
  PaymentMethod,
  PaymentStatus,
} from "../../generated/prisma/enums";

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
      return total + Number(item.services.price) * (item.qty ?? 1);
    }, 0);

    if (totalAmount <= 0) {
      return errorResponse(res, "Order total must be greater than 0", 400);
    }

    if (amountReceived < totalAmount) {
      return errorResponse(res, "Jumlah pembayaran kurang", 400);
    }

    const changeAmount = amountReceived - totalAmount;

    const result = await prisma.$transaction(async (tx) => {
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

      const payment = await tx.payments.create({
        data: {
          order_id: orderId,
          amount_received: amountReceived,
          change_amount: changeAmount,
          payment_method,
        },
      });

      const updatedOrder = await tx.orders.update({
        where: {
          id: orderId,
        },
        data: {
          payment_status: PaymentStatus.PAID,
        },
      });

      const invoiceNumber = `INV-${String(orderId).padStart(6, "0")}`;

      const invoice = await tx.invoices.create({
        data: {
          invoice_no: invoiceNumber,
          order_id: orderId,
          total_amount: totalAmount,
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
              customers: { name: { contains: search, mode: "insensitive" } },
            },
          },
          {
            orders: {
              vehicles: {
                plate_number: { contains: search, mode: "insensitive" },
              },
            },
          },
          {
            orders: {
              invoices: {
                some: { invoice_no: { contains: search, mode: "insensitive" } },
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
              staffs: true,
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

      prisma.payments.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(
      res,
      {
        payments,
        data: payments,
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
            staffs: true,
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

    return successResponse(res, payments, "Payments retrieved successfully");
  } catch (err) {
    next(err);
  }
};
