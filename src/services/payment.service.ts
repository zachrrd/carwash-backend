import { prisma } from "../config/prisma";
import { snap } from "../config/midtrans";
import {
  PaymentStatus,
  PaymentMethod,
  OrderServiceStatus,
} from "../../generated/prisma/enums";

interface MidtransNotification {
  order_id: string;
  transaction_status: string;
  gross_amount: string;
  transaction_id?: string;
  payment_type?: string;
  fraud_status?: string;
}

const mapPaymentMethod = (paymentType?: string): PaymentMethod => {
  if (!paymentType) {
    return PaymentMethod.TRANSFER;
  }

  const lower = paymentType.toLowerCase();

  if (
    lower.includes("qris") ||
    lower.includes("gopay") ||
    lower.includes("shopeepay")
  ) {
    return PaymentMethod.QRIS;
  }

  return PaymentMethod.TRANSFER;
};

const parseLocalOrderId = (midtransOrderId: string): number | null => {
  const match = String(midtransOrderId).match(/^ORDER-(\d+)(?:-\d+)?$/);

  if (!match) {
    return null;
  }

  const orderId = Number(match[1]);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return null;
  }

  return orderId;
};

export const createPaymentTransaction = async (orderId: number) => {
  const order = await prisma.orders.findUnique({
    where: {
      id: orderId,
    },
    include: {
      customers: {
        include: {
          user: true,
        },
      },
      order_items: {
        include: {
          services: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error("Order tidak ditemukan");
  }

  if (order.payment_status === PaymentStatus.PAID) {
    throw new Error("Order sudah dibayar");
  }

  if (order.service_status === OrderServiceStatus.CANCELLED) {
    throw new Error("Pesanan yang dibatalkan tidak dapat dibayar");
  }

  if (
    order.service_status !== OrderServiceStatus.WAITING &&
    order.service_status !== OrderServiceStatus.CONFIRMED
  ) {
    throw new Error("Only waiting or confirmed orders can be paid");
  }

  if (order.order_items.length === 0) {
    throw new Error("Order tidak memiliki item layanan");
  }

  const itemDetails = order.order_items.map((item) => ({
    id: String(item.service_id),
    price: Math.round(Number(item.services.price)),
    quantity: item.qty ?? 1,
    name: item.services.name.substring(0, 50),
  }));

  const grossAmount = itemDetails.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );

  if (grossAmount <= 0) {
    throw new Error("Total pembayaran tidak valid");
  }

  const midtransOrderId = `ORDER-${order.id}-${Date.now()}`;

  const customerFrontendUrl =
    process.env.CUSTOMER_FE_URL ?? "http://localhost:5174";

  const finishUrl = `${customerFrontendUrl}/orders/${order.id}`;

  const transaction = await snap.createTransaction({
    transaction_details: {
      order_id: midtransOrderId,
      gross_amount: grossAmount,
    },

    customer_details: {
      first_name: order.customers.name,
      email: order.customers.user?.email || undefined,
      phone: order.customers.phone || undefined,
    },

    item_details: itemDetails,

    callbacks: {
      finish: finishUrl,
    },
  });

  return {
    orderId: order.id,
    midtransOrderId,
    grossAmount,
    token: transaction.token,
    redirectUrl: transaction.redirect_url,
  };
};

export const handleMidtransNotification = async (
  notification: MidtransNotification,
) => {
  const { order_id, transaction_status, transaction_id, payment_type } =
    notification;

  if (!order_id) {
    throw new Error("Midtrans order_id tidak ditemukan");
  }

  const orderId = parseLocalOrderId(order_id);

  if (!orderId) {
    throw new Error("Format Midtrans order_id tidak valid");
  }

  const statusResponse = await snap.transaction.status(order_id);

  if (statusResponse.order_id !== order_id) {
    throw new Error("Order ID tidak cocok dengan respon Midtrans");
  }

  const transactionStatus = statusResponse.transaction_status;

  const fraudStatus = statusResponse.fraud_status;

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
    throw new Error("Order tidak ditemukan di database");
  }

  const totalAmount = order.order_items.reduce(
    (total, item) =>
      total + Math.round(Number(item.services.price)) * (item.qty ?? 1),
    0,
  );

  if (totalAmount <= 0) {
    throw new Error("Total pembayaran tidak valid");
  }

  let paymentStatus: PaymentStatus | null = null;

  if (transactionStatus === "settlement") {
    paymentStatus = PaymentStatus.PAID;
  }

  if (transactionStatus === "capture" && fraudStatus === "accept") {
    paymentStatus = PaymentStatus.PAID;
  }

  if (
    transactionStatus === "cancel" ||
    transactionStatus === "deny" ||
    transactionStatus === "expire"
  ) {
    paymentStatus = PaymentStatus.FAILED;
  }

  if (!paymentStatus) {
    return {
      orderId,
      transactionStatus,
      transactionId: transaction_id || statusResponse.transaction_id,
      paymentType: payment_type || statusResponse.payment_type,
      message: "Status pembayaran belum final",
    };
  }

  if (order.payment_status === PaymentStatus.PAID) {
    return {
      orderId,
      transactionStatus,
      transactionId: transaction_id || statusResponse.transaction_id,
      paymentType: payment_type || statusResponse.payment_type,
      paymentStatus: PaymentStatus.PAID,
      message: "Order sudah tercatat lunas sebelumnya",
    };
  }

  if (paymentStatus === PaymentStatus.PAID) {
    const determinedMethod = mapPaymentMethod(
      statusResponse.payment_type || payment_type,
    );

    const result = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.orders.findUnique({
        where: {
          id: orderId,
        },
      });

      if (!currentOrder) {
        throw new Error("Order tidak ditemukan");
      }

      if (currentOrder.payment_status === PaymentStatus.PAID) {
        return {
          alreadyPaid: true,
          order: currentOrder,
        };
      }

      if (currentOrder.service_status === OrderServiceStatus.CANCELLED) {
        throw new Error("Cancelled order cannot be paid");
      }

      const updatedOrder = await tx.orders.update({
        where: {
          id: orderId,
        },
        data: {
          payment_status: PaymentStatus.PAID,
        },
      });

      const existingPayment = await tx.payments.findFirst({
        where: {
          order_id: orderId,
        },
      });

      const payment =
        existingPayment ??
        (await tx.payments.create({
          data: {
            order_id: orderId,
            amount_received: totalAmount,
            change_amount: 0,
            payment_method: determinedMethod,
          },
        }));

      const existingInvoice = await tx.invoices.findFirst({
        where: {
          order_id: orderId,
        },
      });

      const invoice =
        existingInvoice ??
        (await tx.invoices.create({
          data: {
            invoice_no: `INV-${String(orderId).padStart(6, "0")}`,
            order_id: orderId,
            total_amount: totalAmount,
          },
        }));

      return {
        alreadyPaid: false,
        order: updatedOrder,
        payment,
        invoice,
      };
    });

    return {
      orderId,
      transactionStatus,
      transactionId: transaction_id || statusResponse.transaction_id,
      paymentType: statusResponse.payment_type || payment_type,
      paymentStatus,
      result,
    };
  }
  const updatedOrder = await prisma.orders.update({
    where: {
      id: orderId,
    },
    data: {
      payment_status: PaymentStatus.FAILED,
    },
  });

  return {
    orderId,
    transactionStatus,
    transactionId: transaction_id || statusResponse.transaction_id,
    paymentType: payment_type || statusResponse.payment_type,
    paymentStatus,
    order: updatedOrder,
    message: "Pembayaran gagal atau kadaluarsa",
  };
};

export const verifyPaymentByOrderId = async (
  orderId: number,
  customMidtransOrderId?: string,
) => {
  const order = await prisma.orders.findUnique({
    where: {
      id: orderId,
    },
  });

  if (!order) {
    throw new Error("Order tidak ditemukan");
  }

  /**
   * Sudah PAID tidak perlu diverifikasi lagi.
   */
  if (order.payment_status === PaymentStatus.PAID) {
    return {
      orderId,
      paymentStatus: PaymentStatus.PAID,
      message: "Order sudah lunas",
    };
  }

  /**
   * Jika frontend memiliki Midtrans order ID,
   * lakukan verifikasi langsung.
   */
  if (customMidtransOrderId) {
    const parsedOrderId = parseLocalOrderId(customMidtransOrderId);

    if (!parsedOrderId || parsedOrderId !== orderId) {
      throw new Error("Midtrans order ID tidak sesuai dengan order");
    }

    return await handleMidtransNotification({
      order_id: customMidtransOrderId,
      transaction_status: "",
      gross_amount: "",
    });
  }

  /**
   * Tidak ada Midtrans order ID.
   */
  return {
    orderId,
    paymentStatus: order.payment_status,
    message: "Status order saat ini",
  };
};
