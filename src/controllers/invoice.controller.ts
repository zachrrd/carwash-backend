import { Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../../generated/prisma/enums";
import PDFDocument from "pdfkit";

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

export const downloadInvoicePdf = async (
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
          "You are not allowed to download this invoice",
          403,
        );
      }
    }

    const order = invoice.orders;

    const payment = order.payments[0];

    const formatRupiah = (value: number) => {
      return `Rp ${value.toLocaleString("id-ID")}`;
    };

    const formatDate = (date: Date | null) => {
      if (!date) return "-";

      return new Intl.DateTimeFormat("id-ID", {
        dateStyle: "long",
        timeZone: "Asia/Jakarta",
      }).format(date);
    };

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${invoice.invoice_no}.pdf"`,
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
    });

    doc.pipe(res);

    doc.fontSize(20).font("Helvetica-Bold").text("CARWASH NEO", {
      align: "center",
    });

    doc.fontSize(12).font("Helvetica").text("INVOICE", {
      align: "center",
    });

    doc.moveDown(2);

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(`Invoice No: ${invoice.invoice_no}`);

    doc.font("Helvetica").text(`Tanggal: ${formatDate(invoice.issued_at)}`);

    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text("Customer");

    doc.fontSize(10).font("Helvetica").text(`Nama: ${order.customers.name}`);

    doc.text(`Kendaraan: ${order.vehicles.plate_number}`);

    doc.text(`Staff: ${order.staffs?.name ?? "Belum ditentukan"}`);

    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text("Service");

    doc.moveDown(0.5);

    order.order_items.forEach((item) => {
      const serviceName = item.services.name;
      const qty = item.qty ?? 1;
      const subtotal = Number(item.subtotal);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`${serviceName} x${qty}`, 50, doc.y, {
          width: 300,
        });

      doc.text(formatRupiah(subtotal), 350, doc.y - 12, {
        width: 200,
        align: "right",
      });

      doc.moveDown(0.5);
    });

    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();

    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text("TOTAL", 50, doc.y);

    doc.text(formatRupiah(Number(invoice.total_amount)), 350, doc.y - 12, {
      width: 200,
      align: "right",
    });

    doc.moveDown(2);

    doc.fontSize(11).font("Helvetica-Bold").text("Payment Information");

    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Method: ${payment?.payment_method ?? "-"}`);

    doc.text(`Status: ${order.payment_status ?? "-"}`);

    doc.text(`Payment Date: ${formatDate(payment?.payment_date ?? null)}`);

    doc.moveDown(3);

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("Thank you for using Carwash App.", {
        align: "center",
      });

    doc.fontSize(8).text("This invoice was generated automatically.", {
      align: "center",
    });

    doc.end();
  } catch (err) {
    next(err);
  }
};
