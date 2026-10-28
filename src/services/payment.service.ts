import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { snap } from "../config/midtrans";
import {
  PaymentStatus,
  PaymentMethod,
  OrderServiceStatus,
  PaymentAttemptStatus,
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

const activeAttemptStatuses: PaymentAttemptStatus[] = [
  PaymentAttemptStatus.CREATING,
  PaymentAttemptStatus.PENDING,
];

export class LegacyMidtransAmbiguityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMidtransAmbiguityError";
  }
}

const isDefiniteMidtransRejection = (error: unknown): boolean => {
  const httpStatusCode = (error as { httpStatusCode?: unknown } | null)
    ?.httpStatusCode;

  return (
    typeof httpStatusCode === "number" &&
    httpStatusCode >= 400 &&
    httpStatusCode < 500 &&
    ![408, 409, 425, 429].includes(httpStatusCode)
  );
};

const getActiveMidtransAttempt = (orderId: number) =>
  prisma.payment_attempts.findFirst({
    where: {
      order_id: orderId,
      provider: "MIDTRANS",
      status: { in: activeAttemptStatuses },
    },
    orderBy: { id: "desc" },
  });

const buildPaymentAttemptResponse = (
  attempt: {
    id: number;
    order_id: number;
    provider_order_id: string;
    amount: unknown;
    status: PaymentAttemptStatus;
    token: string | null;
    redirect_url: string | null;
  },
) => ({
  orderId: attempt.order_id,
  midtransOrderId: attempt.provider_order_id,
  grossAmount: Number(attempt.amount),
  token: attempt.token,
  redirectUrl: attempt.redirect_url,
  payment_attempt: {
    id: attempt.id,
    status: attempt.status,
    provider_order_id: attempt.provider_order_id,
  },
});

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

  const customerFrontendUrl =
    process.env.CUSTOMER_FE_URL ?? "http://localhost:5174";

  const finishUrl = `${customerFrontendUrl}/orders/${order.id}`;

  const reuseOrReconcileAttempt = async (
    attempt: NonNullable<Awaited<ReturnType<typeof getActiveMidtransAttempt>>>,
  ) => {
    let statusResponse: any;
    try {
      statusResponse = await snap.transaction.status(attempt.provider_order_id);
    } catch (error) {
      const statusCode = (error as { httpStatusCode?: unknown } | null)
        ?.httpStatusCode;
      if (statusCode === 407) {
        await prisma.payment_attempts.updateMany({
          where: {
            id: attempt.id,
            status: { in: activeAttemptStatuses },
          },
          data: { status: PaymentAttemptStatus.EXPIRED },
        });
        return null;
      }

      // Provider status could not be established: retain and reuse the
      // existing attempt instead of creating another provider transaction.
      return buildPaymentAttemptResponse(attempt);
    }

    if (statusResponse.status_code === 407) {
      await prisma.payment_attempts.updateMany({
        where: {
          id: attempt.id,
          status: { in: activeAttemptStatuses },
        },
        data: { status: PaymentAttemptStatus.EXPIRED },
      });
      return null;
    }

    if (statusResponse.order_id !== attempt.provider_order_id) {
      throw new Error("Order ID tidak cocok dengan respon Midtrans");
    }

    if (statusResponse.transaction_status === "pending") {
      await prisma.payment_attempts.updateMany({
        where: { id: attempt.id, status: PaymentAttemptStatus.CREATING },
        data: {
          status: PaymentAttemptStatus.PENDING,
          provider_transaction_id: statusResponse.transaction_id ?? undefined,
        },
      });
      const updatedAttempt = await prisma.payment_attempts.findUnique({
        where: { id: attempt.id },
      });
      if (!updatedAttempt || !activeAttemptStatuses.includes(updatedAttempt.status)) {
        return null;
      }
      return buildPaymentAttemptResponse(updatedAttempt);
    }

    const result = await handleMidtransNotification(
      {
        order_id: attempt.provider_order_id,
        transaction_status: "",
        gross_amount: "",
      },
      statusResponse,
    );

    const updatedAttempt = await prisma.payment_attempts.findUnique({
      where: { id: attempt.id },
    });

    if (result.paymentStatus === PaymentStatus.PAID) {
      if (!updatedAttempt) {
        throw new Error("Payment attempt tidak ditemukan");
      }
      return buildPaymentAttemptResponse(updatedAttempt);
    }

    if (
      updatedAttempt &&
      activeAttemptStatuses.includes(updatedAttempt.status)
    ) {
      return buildPaymentAttemptResponse(updatedAttempt);
    }

    return null;
  };

  const activeAttempt = await getActiveMidtransAttempt(order.id);
  if (activeAttempt) {
    // A CREATING reservation may belong to a request that has not reached
    // Midtrans yet. A "not found" status lookup must not release that lock.
    if (activeAttempt.status === PaymentAttemptStatus.CREATING) {
      return buildPaymentAttemptResponse(activeAttempt);
    }

    const reusedAttempt = await reuseOrReconcileAttempt(activeAttempt);
    if (reusedAttempt) {
      return reusedAttempt;
    }
  }

  // Before payment_attempts existed, Midtrans order IDs were generated with
  // a timestamp but were not persisted. Only allow a first tracked attempt
  // for orders created after the explicitly configured deployment cutover.
  const trackedMidtransAttempts = await prisma.payment_attempts.count({
    where: { order_id: order.id, provider: "MIDTRANS" },
  });
  if (trackedMidtransAttempts === 0) {
    const configuredCutoff = process.env.MIDTRANS_ATTEMPT_CUTOFF_AT;
    const cutoffParts = configuredCutoff?.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/,
    );
    const cutoffAt = cutoffParts ? new Date(configuredCutoff!) : null;
    let cutoffIsValid = Boolean(
      cutoffAt && !Number.isNaN(cutoffAt.getTime()),
    );

    if (cutoffParts && cutoffIsValid) {
      const year = Number(cutoffParts[1]);
      const month = Number(cutoffParts[2]);
      const day = Number(cutoffParts[3]);
      const hour = Number(cutoffParts[4]);
      const minute = Number(cutoffParts[5]);
      const second = Number(cutoffParts[6]);
      const fraction = Number(cutoffParts[7] ?? 0);
      const isLeapYear =
        year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const daysInMonth = [
        31,
        isLeapYear ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ][month - 1] ?? 0;
      const validEndOfDay =
        hour === 24 && minute === 0 && second === 0 && fraction === 0;

      cutoffIsValid =
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth &&
        (hour <= 23 || validEndOfDay) &&
        minute <= 59 &&
        second <= 59;
    }

    if (!cutoffAt || !cutoffIsValid) {
      throw new LegacyMidtransAmbiguityError(
        "Midtrans payments are temporarily unavailable because the deployment cutover is not configured. Please contact support.",
      );
    }

    if (order.created_at.getTime() <= cutoffAt.getTime()) {
      throw new LegacyMidtransAmbiguityError(
        "This order may have an earlier Midtrans transaction whose status cannot be confirmed. Do not retry payment; please contact support for manual reconciliation.",
      );
    }
  }

  const providerOrderId = `ORDER-${order.id}-${randomUUID()}`;
  const idempotencyKey = randomUUID();
  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      // Pair this order lock with updateOrder's lock so the amount and provider
      // attempt reservation describe the same committed order contents.
      const lockedOrders = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
      `;

      if (lockedOrders.length === 0) {
        throw new Error("Order tidak ditemukan");
      }

      const currentOrder = await tx.orders.findUnique({
        where: { id: order.id },
        include: {
          customers: { include: { user: true } },
          order_items: { include: { services: true } },
        },
      });

      if (!currentOrder) {
        throw new Error("Order tidak ditemukan");
      }
      if (currentOrder.payment_status === PaymentStatus.PAID) {
        throw new Error("Order sudah dibayar");
      }
      if (currentOrder.service_status === OrderServiceStatus.CANCELLED) {
        throw new Error("Pesanan yang dibatalkan tidak dapat dibayar");
      }
      if (
        currentOrder.service_status !== OrderServiceStatus.WAITING &&
        currentOrder.service_status !== OrderServiceStatus.CONFIRMED
      ) {
        throw new Error("Only waiting or confirmed orders can be paid");
      }

      const concurrentAttempt = await tx.payment_attempts.findFirst({
        where: {
          order_id: order.id,
          provider: "MIDTRANS",
          status: { in: activeAttemptStatuses },
        },
        orderBy: { id: "desc" },
      });

      if (concurrentAttempt) {
        return { result: "EXISTING" as const, attempt: concurrentAttempt };
      }

      const itemDetails = currentOrder.order_items.map((item) => ({
        id: String(item.service_id),
        // order_items.subtotal is the historical price snapshot for this order;
        // services.price may have changed since the order was created.
        price: Math.round(Number(item.subtotal)),
        quantity: 1,
        name: item.services.name.substring(0, 50),
      }));
      const grossAmount = itemDetails.reduce(
        (total, item) => total + item.price * item.quantity,
        0,
      );

      if (itemDetails.length === 0) {
        throw new Error("Order tidak memiliki item layanan");
      }
      if (grossAmount <= 0) {
        throw new Error("Total pembayaran tidak valid");
      }

      const attempt = await tx.payment_attempts.create({
        data: {
          order_id: currentOrder.id,
          provider: "MIDTRANS",
          provider_order_id: providerOrderId,
          amount: grossAmount,
          currency: "IDR",
          status: PaymentAttemptStatus.CREATING,
          idempotency_key: idempotencyKey,
        },
      });

      return {
        result: "CREATED" as const,
        attempt,
        order: currentOrder,
        itemDetails,
        grossAmount,
      };
    });
  } catch (error) {
    // A concurrent request may have reserved the active-attempt index first.
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (errorCode !== "P2002" && errorCode !== "23505") {
      throw error;
    }

    const winningAttempt = await getActiveMidtransAttempt(order.id);
    if (winningAttempt) {
      return buildPaymentAttemptResponse(winningAttempt);
    }

    throw error;
  }

  if (reservation.result === "EXISTING") {
    return buildPaymentAttemptResponse(reservation.attempt);
  }

  let { attempt } = reservation;
  const transactionOrder = reservation.order;
  const { itemDetails, grossAmount } = reservation;

  try {
    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: attempt.provider_order_id,
        gross_amount: grossAmount,
      },

      customer_details: {
        first_name: transactionOrder.customers.name,
        email: transactionOrder.customers.user?.email || undefined,
        phone: transactionOrder.customers.phone || undefined,
      },

      item_details: itemDetails,

      callbacks: {
        finish: finishUrl,
      },
    });

    if (!transaction.token || !transaction.redirect_url) {
      // The provider response is incomplete/ambiguous. Keep CREATING so a
      // repeated client request cannot create a second transaction.
      throw new Error("Midtrans response did not include checkout details");
    }

    attempt = await prisma.payment_attempts.update({
      where: { id: attempt.id },
      data: {
        status: PaymentAttemptStatus.PENDING,
        token: transaction.token,
        redirect_url: transaction.redirect_url,
        provider_transaction_id: transaction.transaction_id ?? null,
      },
    });

    return buildPaymentAttemptResponse(attempt);
  } catch (error) {
    if (isDefiniteMidtransRejection(error)) {
      await prisma.payment_attempts.updateMany({
        where: {
          id: attempt.id,
          status: PaymentAttemptStatus.CREATING,
        },
        data: { status: PaymentAttemptStatus.FAILED },
      });
    }

    // Network errors, timeouts, conflicts, server errors and incomplete
    // provider responses stay CREATING for later reconciliation.
    throw error;
  }
};

export const handleMidtransNotification = async (
  notification: MidtransNotification,
  verifiedStatusResponse?: any,
) => {
  const { order_id } = notification;

  if (!order_id) {
    throw new Error("Midtrans order_id tidak ditemukan");
  }

  const existingAttempt = await prisma.payment_attempts.findUnique({
    where: { provider_order_id: order_id },
  });
  const orderId = existingAttempt?.order_id ?? parseLocalOrderId(order_id);

  if (!orderId) {
    throw new Error("Payment attempt tidak ditemukan");
  }

  const statusResponse =
    verifiedStatusResponse ?? (await snap.transaction.status(order_id));

  if (statusResponse.order_id !== order_id) {
    throw new Error("Order ID tidak cocok dengan respon Midtrans");
  }

  const transactionStatus = statusResponse.transaction_status;
  const providerTransactionId = statusResponse.transaction_id ?? null;
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: {
      order_items: { include: { services: true } },
    },
  });

  if (!order) {
    throw new Error("Order tidak ditemukan di database");
  }

  const orderSnapshotAmount = order.order_items.reduce(
    (total, item) => total + Math.round(Number(item.subtotal)),
    0,
  );
  const expectedAmount = existingAttempt
    ? Math.round(Number(existingAttempt.amount))
    : orderSnapshotAmount;

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error("Total pembayaran tidak valid");
  }

  const reportedAmount = Number(statusResponse.gross_amount);
  if (
    !Number.isFinite(reportedAmount) ||
    Math.round(reportedAmount) !== expectedAmount
  ) {
    throw new Error("Jumlah transaksi Midtrans tidak sesuai dengan total pesanan");
  }

  const paymentSucceeded =
    transactionStatus === "settlement" ||
    (transactionStatus === "capture" &&
      statusResponse.fraud_status === "accept");
  const terminalAttemptStatus =
    transactionStatus === "expire"
      ? PaymentAttemptStatus.EXPIRED
      : transactionStatus === "cancel"
        ? PaymentAttemptStatus.CANCELLED
        : transactionStatus === "deny"
          ? PaymentAttemptStatus.FAILED
          : null;
  const providerPaymentStatus = paymentSucceeded
    ? PaymentStatus.PAID
    : terminalAttemptStatus
      ? PaymentStatus.FAILED
      : null;

  if (!paymentSucceeded && !terminalAttemptStatus) {
    const attempt = existingAttempt
      ? await prisma.payment_attempts.updateMany({
          where: {
            id: existingAttempt.id,
            status: { in: activeAttemptStatuses },
          },
          data: {
            status: PaymentAttemptStatus.PENDING,
            provider_transaction_id: providerTransactionId,
          },
        })
      : null;

    if (!existingAttempt) {
      await prisma.payment_attempts.create({
        data: {
          order_id: orderId,
          provider: "MIDTRANS",
          provider_order_id: order_id,
          provider_transaction_id: providerTransactionId,
          amount: expectedAmount,
          currency: "IDR",
          status: PaymentAttemptStatus.PENDING,
          idempotency_key: `legacy:${order_id}`,
        },
      });
    }

    return {
      orderId,
      transactionStatus,
      transactionId: providerTransactionId,
      paymentType: statusResponse.payment_type,
      paymentStatus: null,
      payment_attempt_status: PaymentAttemptStatus.PENDING,
      ...(attempt && { attemptUpdated: attempt.count > 0 }),
      message: "Status pembayaran belum final",
    };
  }

  if (paymentSucceeded) {
    const determinedMethod = mapPaymentMethod(statusResponse.payment_type);
    const result = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.orders.findUnique({
        where: { id: orderId },
      });

      if (!currentOrder) {
        throw new Error("Order tidak ditemukan");
      }

      const currentAttempt = await tx.payment_attempts.findUnique({
        where: { provider_order_id: order_id },
      }) ?? (await tx.payment_attempts.create({
          data: {
            order_id: orderId,
            provider: "MIDTRANS",
            provider_order_id: order_id,
            provider_transaction_id: providerTransactionId,
            amount: expectedAmount,
            currency: "IDR",
            status: PaymentAttemptStatus.CREATING,
            idempotency_key: `legacy:${order_id}`,
          },
        }));

      if (currentAttempt.status === PaymentAttemptStatus.SUCCEEDED) {
        return { alreadyProcessed: true, order: currentOrder };
      }

      const attemptClaimCount = await tx.$executeRaw`
        UPDATE "payment_attempts"
        SET "status" = 'SUCCEEDED',
            "provider_transaction_id" = ${providerTransactionId},
            "succeeded_at" = COALESCE("succeeded_at", CURRENT_TIMESTAMP),
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${currentAttempt.id}
          AND "status" <> 'SUCCEEDED'
      `;

      if (attemptClaimCount === 0) {
        return { alreadyProcessed: true, order: currentOrder };
      }

      if (currentOrder.payment_status === PaymentStatus.PAID) {
        await tx.$executeRaw`
          UPDATE "payment_attempts"
          SET "settlement_disposition" = 'DUPLICATE_RECONCILIATION_REQUIRED',
              "reconciliation_status" = 'REQUIRED',
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${currentAttempt.id}
        `;
        return { alreadyPaid: true, order: currentOrder };
      }

      const orderClaim = await tx.orders.updateMany({
        where: {
          id: orderId,
          service_status: {
            in: [OrderServiceStatus.WAITING, OrderServiceStatus.CONFIRMED],
          },
          payment_status: { in: [PaymentStatus.UNPAID, PaymentStatus.FAILED] },
        },
        data: { payment_status: PaymentStatus.PAID },
      });

      if (orderClaim.count === 0) {
        const latestOrder = await tx.orders.findUnique({ where: { id: orderId } });
        if (latestOrder?.payment_status === PaymentStatus.PAID) {
          await tx.$executeRaw`
            UPDATE "payment_attempts"
            SET "settlement_disposition" = 'DUPLICATE_RECONCILIATION_REQUIRED',
                "reconciliation_status" = 'REQUIRED',
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${currentAttempt.id}
          `;
          return { alreadyPaid: true, order: latestOrder };
        }

        if (latestOrder?.service_status === OrderServiceStatus.CANCELLED) {
          // The provider settled, but cancellation won the local order transition.
          // Preserve this as unresolved settlement without misclassifying it as
          // either the primary payment or a duplicate charge.
          await tx.$executeRaw`
            UPDATE "payment_attempts"
            SET "reconciliation_status" = 'REQUIRED',
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${currentAttempt.id}
          `;
          return {
            cancelledOrderReconciliationRequired: true,
            order: latestOrder,
          };
        }

        throw new Error("Order payment state changed unexpectedly");
      }

      await tx.$executeRaw`
        UPDATE "payment_attempts"
        SET "settlement_disposition" = 'PRIMARY',
            "reconciliation_status" = NULL,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${currentAttempt.id}
      `;

      const updatedOrder = await tx.orders.findUnique({ where: { id: orderId } });

      const existingPayment = await tx.payments.findFirst({
        where: { order_id: orderId },
      });
      const payment =
        existingPayment ??
        (await tx.payments.create({
          data: {
            order_id: orderId,
            amount_received: expectedAmount,
            change_amount: 0,
            payment_method: determinedMethod,
          },
        }));

      const existingInvoice = await tx.invoices.findFirst({
        where: { order_id: orderId },
      });
      const invoice =
        existingInvoice ??
        (await tx.invoices.create({
          data: {
            invoice_no: `INV-${String(orderId).padStart(6, "0")}`,
            order_id: orderId,
            total_amount: expectedAmount,
          },
        }));

      return { alreadyPaid: false, order: updatedOrder, payment, invoice };
    });

    return {
      orderId,
      transactionStatus,
      transactionId: providerTransactionId,
      paymentType: statusResponse.payment_type,
      paymentStatus: PaymentStatus.PAID,
      payment_attempt_status: PaymentAttemptStatus.SUCCEEDED,
      result,
      ...("cancelledOrderReconciliationRequired" in result &&
        result.cancelledOrderReconciliationRequired && {
          reconciliation_status: "REQUIRED",
          message: "Payment succeeded after order cancellation and requires reconciliation",
        }),
    };
  }

  if (!terminalAttemptStatus) {
    throw new Error("Status pembayaran Midtrans tidak dikenali");
  }

  const result = await prisma.$transaction(async (tx) => {
    let attemptTransitionApplied = false;

    if (existingAttempt) {
      const attemptTransition = await tx.payment_attempts.updateMany({
        where: {
          id: existingAttempt.id,
          status: { in: activeAttemptStatuses },
        },
        data: {
          status: terminalAttemptStatus,
          provider_transaction_id: providerTransactionId,
        },
      });
      attemptTransitionApplied = attemptTransition.count === 1;
    } else {
      await tx.payment_attempts.create({
        data: {
          order_id: orderId,
          provider: "MIDTRANS",
          provider_order_id: order_id,
          provider_transaction_id: providerTransactionId,
          amount: expectedAmount,
          currency: "IDR",
          status: terminalAttemptStatus,
          idempotency_key: `legacy:${order_id}`,
        },
      });
      attemptTransitionApplied = true;
    }

    if (attemptTransitionApplied) {
      await tx.orders.updateMany({
        where: {
          id: orderId,
          payment_status: { in: [PaymentStatus.UNPAID, PaymentStatus.FAILED] },
        },
        data: { payment_status: PaymentStatus.FAILED },
      });
    }

    return tx.orders.findUnique({ where: { id: orderId } });
  });

  return {
    orderId,
    transactionStatus,
    transactionId: providerTransactionId,
    paymentType: statusResponse.payment_type,
    paymentStatus: providerPaymentStatus,
    payment_attempt_status: terminalAttemptStatus,
    order: result,
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
   * Jika frontend memiliki Midtrans order ID,
   * lakukan verifikasi langsung.
   */
  if (customMidtransOrderId) {
    const attempt = await prisma.payment_attempts.findUnique({
      where: { provider_order_id: customMidtransOrderId },
    });
    const parsedOrderId = attempt?.order_id ?? parseLocalOrderId(customMidtransOrderId);

    if (!parsedOrderId || parsedOrderId !== orderId) {
      throw new Error("Midtrans order ID tidak sesuai dengan order");
    }

    return await handleMidtransNotification({
      order_id: customMidtransOrderId,
      transaction_status: "",
      gross_amount: "",
    });
  }

  /** Sudah PAID tidak perlu diverifikasi lagi jika tidak ada attempt spesifik. */
  if (order.payment_status === PaymentStatus.PAID) {
    return {
      orderId,
      paymentStatus: PaymentStatus.PAID,
      message: "Order sudah lunas",
    };
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
