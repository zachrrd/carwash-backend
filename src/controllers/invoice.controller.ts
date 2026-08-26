import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { errorResponse } from "../utils/response";

export const getInvoiceById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const invoiceId = Number(req.params.id);

    if (isNaN(invoiceId)) {
      return errorResponse(res, "Invoice Id is not valid", 400);
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
      return errorResponse(res, "Invoice is not found", 404);
    }

    return res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (err) {
    next(err);
  }
};
