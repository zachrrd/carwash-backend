import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { errorResponse } from "../utils/response";

export const createPayment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { order_id, amount_received, payment_method } = req.body;

    // =========================
    // 1. VALIDATION INPUT
    // =========================

    const orderId = Number(order_id);
    const amountReceived = Number(amount_received);

    if (isNaN(orderId)) {
      return errorResponse(res, "Order ID tidak valid", 400);
    }

    if (isNaN(amountReceived) || amountReceived <= 0) {
      return errorResponse(res, "Jumlah pembayaran tidak valid", 400);
    }

    if (!payment_method) {
      return errorResponse(res, "Payment method wajib diisi", 400);
    }

    // =========================
    // 2. FIND ORDER
    // =========================

    const order = await prisma.orders.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      return errorResponse(res, "Order tidak ditemukan", 404);
    }

    // =========================
    // 3. CHECK PAYMENT STATUS
    // =========================

    if (order.payment_status === "Paid") {
      return errorResponse(res, "Order ini sudah dibayar", 400);
    }

    // =========================
    // 4. CHECK EXISTING PAYMENT
    // =========================

    const existingPayment = await prisma.payments.findFirst({
      where: {
        order_id: orderId,
      },
    });

    if (existingPayment) {
      return errorResponse(res, "Payment untuk order ini sudah ada", 400);
    }

    // =========================
    // 5. CHECK EXISTING INVOICE
    // =========================

    const existingInvoice = await prisma.invoices.findFirst({
      where: {
        order_id: orderId,
      },
    });

    if (existingInvoice) {
      return errorResponse(res, "Invoice untuk order ini sudah ada", 400);
    }

    // =========================
    // 6. GET ORDER ITEMS
    // =========================

    const orderItems = await prisma.order_items.findMany({
      where: {
        order_id: orderId,
      },
      include: {
        services: true,
      },
    });

    if (orderItems.length === 0) {
      return errorResponse(res, "Order item tidak ditemukan", 404);
    }

    // =========================
    // 7. CALCULATE TOTAL
    // =========================

    const totalAmount = orderItems.reduce((total, item) => {
      return total + Number(item.services.price) * (item.qty ?? 1);
    }, 0);

    // =========================
    // 8. VALIDATE PAYMENT
    // =========================

    if (amountReceived < totalAmount) {
      return errorResponse(res, "Jumlah pembayaran kurang", 400);
    }

    const changeAmount = amountReceived - totalAmount;

    // =========================
    // 9. TRANSACTION
    // =========================

    const result = await prisma.$transaction(async (tx) => {
      // Re-check order inside transaction
      const currentOrder = await tx.orders.findUnique({
        where: {
          id: orderId,
        },
      });

      if (!currentOrder) {
        throw new Error("Order tidak ditemukan");
      }

      if (currentOrder.payment_status === "Paid") {
        throw new Error("Order ini sudah dibayar");
      }

      // =========================
      // CREATE PAYMENT
      // =========================

      const payment = await tx.payments.create({
        data: {
          order_id: orderId,
          amount_received: amountReceived,
          change_amount: changeAmount,
          payment_method,
        },
      });

      // =========================
      // UPDATE ORDER → PAID
      // =========================

      await tx.orders.update({
        where: {
          id: orderId,
        },
        data: {
          payment_status: "Paid",
        },
      });

      // =========================
      // CREATE INVOICE
      // =========================

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
      };
    });

    // =========================
    // RESPONSE
    // =========================

    return res.status(201).json({
      success: true,
      message: "Payment berhasil dibuat",
      data: result,
    });
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
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payments.findMany({
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

      prisma.payments.count(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: {
        data: payments,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });
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
    const orderId = Number(req.params.order_id);

    if (isNaN(orderId)) {
      return errorResponse(res, "Order ID tidak valid", 400);
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
    });

    if (payments.length === 0) {
      return errorResponse(res, "Payment untuk order tidak ditemukan", 404);
    }

    return res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (err) {
    next(err);
  }
};
