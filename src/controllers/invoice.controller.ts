import { Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../../generated/prisma/enums";

const parseId = (value: string | string[] | undefined): number | null => {
  if (typeof value !== "string") {
    return null;
  }

  const id = Number(value);

  return Number.isInteger(id) && id > 0 ? id : null;
};

export const getInvoiceById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const invoiceId = parseId(req.params.id);

    if (!invoiceId) {
      return errorResponse(res, "Invalid invoice id", 400);
    }

    const invoice = await prisma.invoices.findUnique({
      where: {
        id: invoiceId,
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
            payments: true,
          },
        },
      },
    });

    if (!invoice) {
      return errorResponse(res, "Invoice not found", 404);
    }

    if (req.user?.role === UserRole.CUSTOMER) {
      const customer = await prisma.customers.findUnique({
        where: {
          user_id: req.user.id,
        },
      });

      if (!customer || invoice.orders.customer_id !== customer.id) {
        return errorResponse(
          res,
          "You are not allowed to view this invoice",
          403,
        );
      }
    }

    return successResponse(res, invoice, "Invoice retrieved successfully");
  } catch (err) {
    next(err);
  }
};
