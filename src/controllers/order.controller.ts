import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";
import {
  ActiveStatus,
  OrderServiceStatus,
  PaymentStatus,
  UserRole,
} from "../../generated/prisma/enums";

import { getSocketIO } from "../config/socket";

const emitOrderStatusUpdate = (order: {
  id: number;
  service_status: OrderServiceStatus | null;
  [key: string]: any;
}) => {
  try {
    const io = getSocketIO();
    const payload = {
      orderId: order.id,
      serviceStatus: order.service_status,
      order: serializeOrder(order as any),
    };
    io.to(`order:${order.id}`).emit("order-status-updated", payload);
    io.to("orders").emit("order-status-updated", payload);
  } catch (err) {
    console.error("Socket emit error:", err);
  }
};

interface OrderItemInput {
  service_id: number;
  qty: number;
  subtotal: number;
}

const parseId = (value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }

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

const validateQuantity = (qty: unknown): number | null => {
  const value = Number(qty);

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
};

const validateCheckInTime = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const isValid = /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

  return isValid ? value : null;
};

const getValidMidtransAttemptCutoff = (): Date | null => {
  const cutoffValue = process.env.MIDTRANS_ATTEMPT_CUTOFF_AT;
  const parts = cutoffValue?.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/,
  );
  const cutoff = parts ? new Date(cutoffValue!) : null;
  if (!parts || !cutoff || Number.isNaN(cutoff.getTime())) {
    return null;
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const fraction = Number(parts[7] ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
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
  const isValid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    (hour <= 23 || validEndOfDay) &&
    minute <= 59 &&
    second <= 59;

  return isValid ? cutoff : null;
};

const orderInclude = {
  customers: true,
  vehicles: true,
  order_staff: {
    include: {
      staffs: true,
    },
  },
  order_items: {
    include: {
      services: true,
    },
  },
  invoices: true,
  payments: true,
};

// Keep the original `staffs` field for existing clients while exposing every
// assignment through `assigned_staffs`.
const serializeOrder = <T extends { order_staff?: Array<{ staffs: unknown }> }>(
  order: T,
) => ({
  ...order,
  assigned_staffs:
    order.order_staff?.map((assignment) => assignment.staffs) ?? [],
  staffs: order.order_staff?.[0]?.staffs ?? null,
  staff_id:
    (order.order_staff?.[0]?.staffs as { id?: number } | undefined)?.id ?? null,
});

type StaffAssignmentInput = {
  provided: boolean;
  staffIds: number[];
  error?: string;
};

const parseStaffAssignmentInput = (
  body: Record<string, unknown>,
): StaffAssignmentInput => {
  const hasStaffIds = Object.prototype.hasOwnProperty.call(body, "staff_ids");
  const hasStaffId = Object.prototype.hasOwnProperty.call(body, "staff_id");

  if (hasStaffIds && hasStaffId) {
    return {
      provided: true,
      staffIds: [],
      error: "Use either staff_ids or staff_id, not both",
    };
  }

  if (hasStaffIds) {
    const staffIds = body.staff_ids;
    if (
      !Array.isArray(staffIds) ||
      staffIds.some(
        (staffId) =>
          !Number.isInteger(staffId) || (staffId as number) <= 0,
      )
    ) {
      return { provided: true, staffIds: [], error: "Invalid staff_ids" };
    }

    if (new Set(staffIds).size !== staffIds.length) {
      return {
        provided: true,
        staffIds: [],
        error: "Duplicate staff ids are not allowed",
      };
    }

    return { provided: true, staffIds: staffIds as number[] };
  }

  if (hasStaffId) {
    const staffId = body.staff_id;
    if (staffId === null) {
      return { provided: true, staffIds: [] };
    }

    const parsedStaffId = Number(staffId);
    if (!Number.isInteger(parsedStaffId) || parsedStaffId <= 0) {
      return { provided: true, staffIds: [], error: "Invalid staff id" };
    }

    return { provided: true, staffIds: [parsedStaffId] };
  }

  return { provided: false, staffIds: [] };
};

const validateAssignableStaffIds = async (
  staffIds: number[],
): Promise<{ message: string; status: number } | null> => {
  if (staffIds.length === 0) {
    return null;
  }

  const staffs = await prisma.staffs.findMany({
    where: { id: { in: staffIds }, deleted_at: null },
  });

  if (staffs.length !== staffIds.length) {
    return { message: "One or more staff not found", status: 404 };
  }

  if (staffs.some((staff) => staff.status !== ActiveStatus.ACTIVE)) {
    return {
      message: "Staff is inactive and cannot be assigned to an order",
      status: 400,
    };
  }

  return null;
};

const getValidatedServices = async (
  items: unknown,
): Promise<OrderItemInput[] | null> => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const serviceIds = items.map((item: any) => Number(item.service_id));

  if (
    serviceIds.some(
      (serviceId) => !Number.isInteger(serviceId) || serviceId <= 0,
    )
  ) {
    throw new Error("INVALID_SERVICE_ID");
  }

  const uniqueServiceIds = new Set(serviceIds);
  if (uniqueServiceIds.size !== serviceIds.length) {
    throw new Error("DUPLICATE_SERVICE");
  }

  const services = await prisma.services.findMany({
    where: {
      id: {
        in: serviceIds,
      },
      deleted_at: null,
    },
  });

  if (services.length !== serviceIds.length) {
    throw new Error("SERVICE_NOT_FOUND");
  }

  const inactiveServices = services.filter(
    (service) => service.status !== ActiveStatus.ACTIVE,
  );

  if (inactiveServices.length > 0) {
    throw new Error("INACTIVE_SERVICE");
  }

  const orderItems: OrderItemInput[] = serviceIds.map((serviceId) => {
    const service = services.find((s) => s.id === serviceId)!;

    return {
      service_id: serviceId,
      qty: 1,
      subtotal: Number(service.price) * 1,
    };
  });

  return orderItems;
};

const handleServiceValidationError = (
  res: Response,
  err: unknown,
): Response | null => {
  if (!(err instanceof Error)) {
    return null;
  }

  switch (err.message) {
    case "INVALID_SERVICE_ID":
      return errorResponse(res, "Invalid service id", 400);

    case "SERVICE_NOT_FOUND":
      return errorResponse(res, "One or more services not found", 404);

    case "INACTIVE_SERVICE":
      return errorResponse(res, "One or more services are inactive", 400);

    case "INVALID_QUANTITY":
      return errorResponse(res, "Service quantity must be greater than 0", 400);

    case "DUPLICATE_SERVICE":
      return errorResponse(
        res,
        "Layanan yang sama tidak boleh dipilih lebih dari satu kali",
        400,
      );

    default:
      return null;
  }
};

export const getAllOrders = async (
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

    const serviceStatus =
      typeof req.query.service_status === "string"
        ? req.query.service_status
        : undefined;

    const paymentStatus =
      typeof req.query.payment_status === "string"
        ? req.query.payment_status
        : undefined;

    const customerId = req.query.customer_id
      ? Number(req.query.customer_id)
      : undefined;

    const staffId = req.query.staff_id ? Number(req.query.staff_id) : undefined;

    const where: any = {};

    if (serviceStatus && isValidEnumValue(OrderServiceStatus, serviceStatus)) {
      where.service_status = serviceStatus;
    }

    if (paymentStatus && isValidEnumValue(PaymentStatus, paymentStatus)) {
      where.payment_status = paymentStatus;
    }

    if (
      customerId !== undefined &&
      Number.isInteger(customerId) &&
      customerId > 0
    ) {
      where.customer_id = customerId;
    }

    if (staffId !== undefined && Number.isInteger(staffId) && staffId > 0) {
      where.order_staff = { some: { staff_id: staffId } };
    }

    if (search) {
      where.OR = [
        {
          customers: {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          customers: {
            phone: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          vehicles: {
            plate_number: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          vehicles: {
            brand: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          vehicles: {
            model: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          invoices: {
            some: {
              invoice_no: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          id: "desc",
        },
        include: orderInclude,
      }),

      prisma.orders.count({
        where,
      }),
    ]);

    return successResponse(
      res,
      {
        orders: orders.map(serializeOrder),
        data: orders.map(serializeOrder),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Orders retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getOrderById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const order = await prisma.orders.findUnique({
      where: {
        id,
      },
      include: orderInclude,
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
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

      if (order.customer_id !== customer.id) {
        return errorResponse(
          res,
          "You are not allowed to view this order",
          403,
        );
      }
    }

    return successResponse(
      res,
      serializeOrder(order),
      "Order retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const createOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { customer_id, vehicle_id, check_in_time, items } = req.body;
    const staffAssignment = parseStaffAssignmentInput(req.body);

    if (staffAssignment.error) {
      return errorResponse(res, staffAssignment.error, 400);
    }

    const customerId = Number(customer_id);
    const vehicleId = Number(vehicle_id);

    if (
      !Number.isInteger(customerId) ||
      customerId <= 0 ||
      !Number.isInteger(vehicleId) ||
      vehicleId <= 0
    ) {
      return errorResponse(res, "Valid customer and vehicle are required", 400);
    }

    const customer = await prisma.customers.findFirst({
      where: {
        id: customerId,
        deleted_at: null,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer not found", 404);
    }

    const vehicle = await prisma.vehicles.findFirst({
      where: {
        id: vehicleId,
        customer_id: customerId,
        deleted_at: null,
      },
    });

    if (!vehicle) {
      return errorResponse(
        res,
        "Vehicle not found or does not belong to this customer",
        404,
      );
    }

    const staffValidationError = await validateAssignableStaffIds(
      staffAssignment.staffIds,
    );
    if (staffValidationError) {
      return errorResponse(
        res,
        staffValidationError.message,
        staffValidationError.status,
      );
    }

    const finalCheckInTime = validateCheckInTime(check_in_time);

    if (check_in_time !== undefined && finalCheckInTime === null) {
      return errorResponse(res, "Check-in time must use HH:mm format", 400);
    }

    let orderItems: OrderItemInput[] | null;

    try {
      orderItems = await getValidatedServices(items);
    } catch (err) {
      const response = handleServiceValidationError(res, err);

      if (response) {
        return response;
      }

      throw err;
    }

    if (!orderItems || orderItems.length === 0) {
      return errorResponse(res, "At least one service is required", 400);
    }

    const order = await prisma.orders.create({
      data: {
        customer_id: customerId,
        vehicle_id: vehicleId,
        ...(staffAssignment.staffIds.length > 0 && {
          order_staff: {
            create: staffAssignment.staffIds.map((staff_id) => ({ staff_id })),
          },
        }),
        service_status: OrderServiceStatus.WAITING,
        payment_status: PaymentStatus.UNPAID,
        check_in_time: finalCheckInTime,
        order_items: {
          create: orderItems,
        },
      },
      include: orderInclude,
    });

    return successResponse(
      res,
      serializeOrder(order),
      "Order created successfully. Please complete payment before service starts.",
      201,
    );
  } catch (err) {
    next(err);
  }
};

export const updateOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const existingOrder = await prisma.orders.findUnique({
      where: {
        id,
      },
      include: { order_staff: true, order_items: true },
    });

    if (!existingOrder) {
      return errorResponse(res, "Order not found", 404);
    }

    if (
      existingOrder.service_status === OrderServiceStatus.COMPLETED ||
      existingOrder.service_status === OrderServiceStatus.CANCELLED
    ) {
      return errorResponse(
        res,
        `Order dengan status ${existingOrder.service_status} tidak dapat diubah`,
        400,
      );
    }

    const {
      customer_id,
      vehicle_id,
      service_status,
      check_in_time,
      items,
    } = req.body;
    const staffAssignment = parseStaffAssignmentInput(req.body);

    if (staffAssignment.error) {
      return errorResponse(res, staffAssignment.error, 400);
    }

    if (service_status !== undefined) {
      return errorResponse(
        res,
        "Service status must be updated through the status endpoint",
        400,
      );
    }

    if (existingOrder.payment_status === PaymentStatus.PAID) {
      const isCustomerChanged =
        customer_id !== undefined &&
        Number(customer_id) !== existingOrder.customer_id;
      const isVehicleChanged =
        vehicle_id !== undefined &&
        Number(vehicle_id) !== existingOrder.vehicle_id;
      const isCheckInChanged =
        check_in_time !== undefined &&
        check_in_time !== existingOrder.check_in_time;
      const isItemsChanged = items !== undefined;

      if (
        isCustomerChanged ||
        isVehicleChanged ||
        isCheckInChanged ||
        isItemsChanged
      ) {
        return errorResponse(
          res,
          "Paid order cannot modify customer, vehicle, check-in time, or services",
          400,
        );
      }
    }

    if (staffAssignment.provided) {
      const staffValidationError = await validateAssignableStaffIds(
        staffAssignment.staffIds,
      );
      if (staffValidationError) {
        return errorResponse(
          res,
          staffValidationError.message,
          staffValidationError.status,
        );
      }
    }

    let orderItems: OrderItemInput[] | undefined;

    if (
      existingOrder.payment_status !== PaymentStatus.PAID &&
      items !== undefined
    ) {
      try {
        const validatedItems = await getValidatedServices(items);

        if (validatedItems === null) {
          return errorResponse(res, "Invalid order items", 400);
        }

        orderItems = validatedItems;
      } catch (err) {
        const response = handleServiceValidationError(res, err);

        if (response) {
          return response;
        }

        throw err;
      }

      if (!orderItems || orderItems.length === 0) {
        return errorResponse(res, "Order must have at least one service", 400);
      }
    }

    const updateResult = await prisma.$transaction(async (tx) => {
      // Payment claims, order status transitions, and attempt FK inserts all
      // serialize on this parent row. Re-read every authoritative field only
      // after acquiring the lock and keep it until related edits commit.
      const lockedOrders = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${id} FOR UPDATE
      `;

      if (lockedOrders.length === 0) {
        return { result: "NOT_FOUND" as const };
      }

      const currentOrder = await tx.orders.findUnique({
        where: { id },
        include: { order_staff: true, order_items: true },
      });

      if (!currentOrder) {
        return { result: "NOT_FOUND" as const };
      }

      const initialStaffIds = existingOrder.order_staff
        .map((assignment) => assignment.staff_id)
        .sort((a, b) => a - b);
      const currentStaffIds = currentOrder.order_staff
        .map((assignment) => assignment.staff_id)
        .sort((a, b) => a - b);
      const initialItems = existingOrder.order_items
        .map((item) =>
          `${item.service_id}:${item.qty ?? 1}:${item.subtotal.toString()}`,
        )
        .sort();
      const currentItems = currentOrder.order_items
        .map((item) =>
          `${item.service_id}:${item.qty ?? 1}:${item.subtotal.toString()}`,
        )
        .sort();
      const staleUpdate =
        currentOrder.service_status !== existingOrder.service_status ||
        currentOrder.payment_status !== existingOrder.payment_status ||
        (customer_id !== undefined &&
          currentOrder.customer_id !== existingOrder.customer_id) ||
        (vehicle_id !== undefined &&
          currentOrder.vehicle_id !== existingOrder.vehicle_id) ||
        (check_in_time !== undefined &&
          currentOrder.check_in_time !== existingOrder.check_in_time) ||
        (staffAssignment.provided &&
          currentStaffIds.join(",") !== initialStaffIds.join(",")) ||
        (items !== undefined &&
          currentItems.join("|") !== initialItems.join("|"));

      if (staleUpdate) {
        return { result: "CONFLICT" as const };
      }

      if (
        currentOrder.service_status === OrderServiceStatus.COMPLETED ||
        currentOrder.service_status === OrderServiceStatus.CANCELLED
      ) {
        return { result: "NOT_EDITABLE" as const, status: currentOrder.service_status };
      }

      const finalCustomerId =
        customer_id !== undefined
          ? Number(customer_id)
          : currentOrder.customer_id;
      const finalVehicleId =
        vehicle_id !== undefined
          ? Number(vehicle_id)
          : currentOrder.vehicle_id;

      if (!Number.isInteger(finalCustomerId) || finalCustomerId <= 0) {
        return { result: "INVALID_CUSTOMER" as const };
      }
      if (!Number.isInteger(finalVehicleId) || finalVehicleId <= 0) {
        return { result: "INVALID_VEHICLE" as const };
      }

      const paymentSensitiveChange =
        (customer_id !== undefined && finalCustomerId !== currentOrder.customer_id) ||
        (vehicle_id !== undefined && finalVehicleId !== currentOrder.vehicle_id) ||
        (check_in_time !== undefined && check_in_time !== currentOrder.check_in_time) ||
        items !== undefined;

      if (currentOrder.payment_status === PaymentStatus.PAID && paymentSensitiveChange) {
        return { result: "PAID" as const };
      }

      if (paymentSensitiveChange) {
        // CREATING/PENDING are active attempts. Terminal attempts can still
        // receive a late SUCCESS in the locked webhook lifecycle, so their
        // amount-dependent order data must also remain stable.
        const paymentAttemptCount = await tx.payment_attempts.count({
          where: { order_id: id },
        });

        if (paymentAttemptCount > 0) {
          return { result: "PAYMENT_ATTEMPT" as const };
        }

        // An old order without a tracked attempt may still have an unrecorded
        // legacy Midtrans transaction. Keep its payment-dependent data stable
        // under the same fail-closed cutoff rule used by payment creation.
        const cutoffAt = getValidMidtransAttemptCutoff();
        if (!cutoffAt || currentOrder.created_at.getTime() <= cutoffAt.getTime()) {
          return { result: "LEGACY_AMBIGUOUS" as const };
        }
      }

      if (
        currentOrder.payment_status !== PaymentStatus.PAID &&
        (customer_id !== undefined || vehicle_id !== undefined)
      ) {
        const customer = await tx.customers.findFirst({
          where: { id: finalCustomerId, deleted_at: null },
          select: { id: true },
        });
        if (!customer) {
          return { result: "CUSTOMER_NOT_FOUND" as const };
        }

        const vehicle = await tx.vehicles.findFirst({
          where: {
            id: finalVehicleId,
            customer_id: finalCustomerId,
            deleted_at: null,
          },
          select: { id: true },
        });
        if (!vehicle) {
          return { result: "VEHICLE_NOT_FOUND" as const };
        }
      }

      let finalCheckInTime = currentOrder.check_in_time;
      if (
        currentOrder.payment_status !== PaymentStatus.PAID &&
        check_in_time !== undefined
      ) {
        finalCheckInTime = validateCheckInTime(check_in_time);
        if (check_in_time !== null && finalCheckInTime === null) {
          return { result: "INVALID_CHECK_IN" as const };
        }
      }

      const transition = await tx.orders.updateMany({
        where: {
          id,
          service_status: currentOrder.service_status,
          payment_status: currentOrder.payment_status,
        },
        data: {
          customer_id: finalCustomerId,
          vehicle_id: finalVehicleId,
          check_in_time: finalCheckInTime,
        },
      });

      if (transition.count !== 1) {
        return { result: "CONFLICT" as const };
      }

      if (staffAssignment.provided) {
        const desiredStaffIds = new Set(staffAssignment.staffIds);
        const existingStaffIds = currentOrder.order_staff.map(
          (assignment) => assignment.staff_id,
        );
        const existingStaffIdSet = new Set(existingStaffIds);
        const staffIdsToRemove = existingStaffIds.filter(
          (staffId) => !desiredStaffIds.has(staffId),
        );
        const staffIdsToAdd = staffAssignment.staffIds.filter(
          (staffId) => !existingStaffIdSet.has(staffId),
        );

        if (staffIdsToRemove.length > 0) {
          await tx.order_staff.deleteMany({
            where: { order_id: id, staff_id: { in: staffIdsToRemove } },
          });
        }

        if (staffIdsToAdd.length > 0) {
          await tx.order_staff.createMany({
            data: staffIdsToAdd.map((staff_id) => ({ order_id: id, staff_id })),
            skipDuplicates: true,
          });
        }
      }

      if (orderItems !== undefined) {
        await tx.order_items.deleteMany({
          where: {
            order_id: id,
          },
        });

        await tx.order_items.createMany({
          data: orderItems.map((item) => ({
            order_id: id,
            service_id: item.service_id,
            qty: item.qty,
            subtotal: item.subtotal,
          })),
        });
      }

      const updatedOrder = await tx.orders.findUnique({
        where: {
          id,
        },
        include: orderInclude,
      });

      return { result: "UPDATED" as const, order: updatedOrder };
    });

    if (updateResult.result === "NOT_FOUND") {
      return errorResponse(res, "Order not found", 404);
    }
    if (updateResult.result === "NOT_EDITABLE") {
      return errorResponse(
        res,
        `Order dengan status ${updateResult.status} tidak dapat diubah`,
        400,
      );
    }
    if (updateResult.result === "PAID") {
      return errorResponse(
        res,
        "Paid order cannot modify customer, vehicle, check-in time, or services",
        400,
      );
    }
    if (updateResult.result === "PAYMENT_ATTEMPT") {
      return errorResponse(
        res,
        "Order payment data cannot be changed while a payment attempt exists",
        409,
      );
    }
    if (updateResult.result === "LEGACY_AMBIGUOUS") {
      return errorResponse(
        res,
        "Order payment history is ambiguous and payment data cannot be changed",
        409,
      );
    }
    if (updateResult.result === "INVALID_CUSTOMER") {
      return errorResponse(res, "Invalid customer id", 400);
    }
    if (updateResult.result === "INVALID_VEHICLE") {
      return errorResponse(res, "Invalid vehicle id", 400);
    }
    if (updateResult.result === "CUSTOMER_NOT_FOUND") {
      return errorResponse(res, "Customer not found", 404);
    }
    if (updateResult.result === "VEHICLE_NOT_FOUND") {
      return errorResponse(
        res,
        "Vehicle not found or does not belong to this customer",
        404,
      );
    }
    if (updateResult.result === "INVALID_CHECK_IN") {
      return errorResponse(res, "Check-in time must use HH:mm format", 400);
    }
    if (updateResult.result === "CONFLICT") {
      return errorResponse(res, "Order state changed; reload and try again", 409);
    }

    return successResponse(
      res,
      updateResult.order ? serializeOrder(updateResult.order) : null,
      "Order updated successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const updateOrderStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    const orderId = parseId(req.params.id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const { service_status } = req.body;

    if (!isValidEnumValue(OrderServiceStatus, service_status)) {
      return errorResponse(res, "Invalid service status", 400);
    }

    if (service_status === OrderServiceStatus.WAITING) {
      return errorResponse(
        res,
        "Order status cannot be changed back to waiting",
        400,
      );
    }

    if (service_status === OrderServiceStatus.CANCELLED) {
      return errorResponse(
        res,
        "Use the cancel endpoint to cancel an order",
        400,
      );
    }

    const order = await prisma.orders.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    if (order.service_status === OrderServiceStatus.COMPLETED) {
      return errorResponse(res, "Completed order cannot be changed", 400);
    }

    if (order.service_status === OrderServiceStatus.CANCELLED) {
      return errorResponse(res, "Cancelled order cannot be changed", 400);
    }

    if (order.service_status === null) {
      return errorResponse(res, "Order has no service status", 400);
    }

    const currentStatus = order.service_status;

    if (currentStatus === service_status) {
      return errorResponse(res, `Order is already ${service_status}`, 400);
    }

    const transitionWithStaffRequirement = async (
      expectedStatus: OrderServiceStatus,
      nextStatus: OrderServiceStatus,
      requiresPaid: boolean,
    ) =>
      prisma.$transaction(async (tx) => {
        // updateOrder uses this same parent-row lock before synchronizing
        // order_staff. Check the relation only after acquiring the lock.
        const lockedOrders = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE
        `;

        if (lockedOrders.length === 0) {
          return { result: "NOT_FOUND" as const };
        }

        const currentOrder = await tx.orders.findUnique({
          where: { id: orderId },
          select: { id: true, service_status: true, payment_status: true },
        });

        if (!currentOrder) {
          return { result: "NOT_FOUND" as const };
        }

        if (
          currentOrder.service_status !== expectedStatus ||
          (requiresPaid && currentOrder.payment_status !== PaymentStatus.PAID)
        ) {
          return { result: "CONFLICT" as const };
        }

        const assignmentCount = await tx.order_staff.count({
          where: { order_id: orderId },
        });
        if (assignmentCount === 0) {
          return { result: "NO_STAFF" as const };
        }

        const transition = await tx.orders.updateMany({
          where: {
            id: orderId,
            service_status: expectedStatus,
            payment_status: currentOrder.payment_status,
          },
          data: { service_status: nextStatus },
        });

        if (transition.count !== 1) {
          return { result: "CONFLICT" as const };
        }

        const updatedOrder = await tx.orders.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });

        return { result: "UPDATED" as const, order: updatedOrder };
      });

    if (
      currentStatus === OrderServiceStatus.WAITING &&
      service_status === OrderServiceStatus.CONFIRMED
    ) {
      const result = await transitionWithStaffRequirement(
        OrderServiceStatus.WAITING,
        OrderServiceStatus.CONFIRMED,
        false,
      );
      if (result.result === "NOT_FOUND") {
        return errorResponse(res, "Order not found", 404);
      }
      if (result.result === "NO_STAFF") {
        return errorResponse(
          res,
          "Order must have a staff assigned before it can be confirmed",
          400,
        );
      }
      if (result.result === "CONFLICT") {
        return errorResponse(res, "Order state changed; reload and try again", 409);
      }

      emitOrderStatusUpdate(result.order);

      return successResponse(
        res,
        serializeOrder(result.order),
        "Order confirmed successfully",
      );
    }

    if (
      currentStatus === OrderServiceStatus.WAITING &&
      service_status === OrderServiceStatus.IN_PROGRESS
    ) {
      return errorResponse(
        res,
        "Order must be confirmed before service can start",
        400,
      );
    }

    if (
      currentStatus === OrderServiceStatus.CONFIRMED &&
      service_status === OrderServiceStatus.IN_PROGRESS
    ) {
      const result = await transitionWithStaffRequirement(
        OrderServiceStatus.CONFIRMED,
        OrderServiceStatus.IN_PROGRESS,
        true,
      );
      if (result.result === "NOT_FOUND") {
        return errorResponse(res, "Order not found", 404);
      }
      if (result.result === "NO_STAFF") {
        return errorResponse(
          res,
          "Order must have a staff assigned before service can start",
          400,
        );
      }
      if (result.result === "CONFLICT") {
        if (order.payment_status !== PaymentStatus.PAID) {
          return errorResponse(
            res,
            "Order must be paid before service can start",
            400,
          );
        }
        return errorResponse(res, "Order state changed; reload and try again", 409);
      }

      emitOrderStatusUpdate(result.order);

      return successResponse(
        res,
        serializeOrder(result.order),
        "Order service started successfully",
      );
    }

    if (
      currentStatus === OrderServiceStatus.CONFIRMED &&
      service_status === OrderServiceStatus.COMPLETED
    ) {
      return errorResponse(
        res,
        "Only in-progress orders can be completed",
        400,
      );
    }

    if (
      currentStatus === OrderServiceStatus.IN_PROGRESS &&
      service_status === OrderServiceStatus.COMPLETED
    ) {
      if (order.payment_status !== PaymentStatus.PAID) {
        return errorResponse(
          res,
          "Order must be paid before it can be completed",
          400,
        );
      }

      const transition = await prisma.orders.updateMany({
        where: {
          id: orderId,
          service_status: OrderServiceStatus.IN_PROGRESS,
          payment_status: PaymentStatus.PAID,
        },
        data: { service_status: OrderServiceStatus.COMPLETED },
      });

      if (transition.count === 0) {
        return errorResponse(res, "Order state changed; reload and try again", 409);
      }

      const updatedOrder = await prisma.orders.findUniqueOrThrow({
        where: { id: orderId },
        include: orderInclude,
      });

      emitOrderStatusUpdate(updatedOrder);

      return successResponse(
        res,
        serializeOrder(updatedOrder),
        "Order completed successfully",
      );
    }

    if (
      currentStatus === OrderServiceStatus.IN_PROGRESS &&
      service_status !== OrderServiceStatus.IN_PROGRESS
    ) {
      return errorResponse(
        res,
        "Order in progress cannot change to this status",
        400,
      );
    }

    return errorResponse(
      res,
      `Cannot change order status from ${currentStatus} to ${service_status}`,
      400,
    );
  } catch (err) {
    next(err);
  }
};

export const deleteOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const deletion = await prisma.$transaction(async (tx) => {
      // Lock the parent row. Payment claims UPDATE this row, and inserting a
      // payment_attempt must take a foreign-key key-share lock on it. This
      // serializes deletion against both operations.
      const lockedOrders = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${id} FOR UPDATE
      `;

      if (lockedOrders.length === 0) {
        return { result: "NOT_FOUND" as const };
      }

      const currentOrder = await tx.orders.findUniqueOrThrow({
        where: { id },
        select: {
          payment_status: true,
          service_status: true,
          created_at: true,
        },
      });

      if (currentOrder.payment_status === PaymentStatus.PAID) {
        return { result: "PAID" as const };
      }

      if (currentOrder.service_status === OrderServiceStatus.COMPLETED) {
        return { result: "COMPLETED" as const };
      }

      if (currentOrder.service_status === OrderServiceStatus.CANCELLED) {
        return { result: "CANCELLED" as const };
      }

      const [attemptCount, paymentCount, invoiceCount] = await Promise.all([
        tx.payment_attempts.count({ where: { order_id: id } }),
        tx.payments.count({ where: { order_id: id } }),
        tx.invoices.count({ where: { order_id: id } }),
      ]);

      if (attemptCount > 0) {
        return { result: "PAYMENT_ATTEMPT" as const };
      }

      if (paymentCount > 0 || invoiceCount > 0) {
        return { result: "FINANCIAL_RECORD" as const };
      }

      // Preserve Phase 4C.1's legacy ambiguity protection. If no attempt was
      // recorded, only orders created strictly after a valid configured cutoff
      // are known to be free of untracked legacy Midtrans transactions.
      const cutoffAt = getValidMidtransAttemptCutoff();

      if (
        !cutoffAt ||
        currentOrder.created_at.getTime() <= cutoffAt.getTime()
      ) {
        return { result: "LEGACY_AMBIGUOUS" as const };
      }

      // Repeat the business predicates in the destructive statement itself.
      // The row lock also prevents a concurrent payment claim/attempt insert
      // from passing this deletion before its own transaction completes.
      const deletedOrders = await tx.$queryRaw<Array<{ id: number }>>`
        DELETE FROM "orders"
        WHERE "id" = ${id}
          AND "payment_status" IS DISTINCT FROM 'PAID'::"PaymentStatus"
          AND "service_status" IS DISTINCT FROM 'COMPLETED'::"OrderServiceStatus"
          AND "service_status" IS DISTINCT FROM 'CANCELLED'::"OrderServiceStatus"
          AND NOT EXISTS (SELECT 1 FROM "payment_attempts" WHERE "order_id" = ${id})
          AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "order_id" = ${id})
          AND NOT EXISTS (SELECT 1 FROM "invoices" WHERE "order_id" = ${id})
        RETURNING "id"
      `;

      return deletedOrders.length === 1
        ? { result: "DELETED" as const }
        : { result: "CONFLICT" as const };
    });

    if (deletion.result === "NOT_FOUND") {
      return errorResponse(res, "Order not found", 404);
    }
    if (deletion.result === "PAID") {
      return errorResponse(res, "Order yang sudah dibayar tidak dapat dihapus", 400);
    }
    if (deletion.result === "COMPLETED") {
      return errorResponse(res, "Completed order cannot be deleted", 400);
    }
    if (deletion.result === "CANCELLED") {
      return errorResponse(res, "Cancelled order cannot be deleted", 400);
    }
    if (deletion.result === "PAYMENT_ATTEMPT") {
      return errorResponse(
        res,
        "Order with a payment attempt cannot be deleted; reconcile the attempt first",
        409,
      );
    }
    if (deletion.result === "FINANCIAL_RECORD") {
      return errorResponse(
        res,
        "Order with payment or invoice records cannot be deleted",
        409,
      );
    }
    if (deletion.result === "LEGACY_AMBIGUOUS") {
      return errorResponse(
        res,
        "Order payment history is ambiguous and the order cannot be deleted",
        409,
      );
    }
    if (deletion.result === "CONFLICT") {
      return errorResponse(res, "Order state changed; reload and try again", 409);
    }

    return successResponse(res, null, "Order deleted successfully");
  } catch (err) {
    next(err);
  }
};

export const cancelOrderByAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== UserRole.ADMIN) {
      return errorResponse(
        res,
        "Only admin can cancel orders through this endpoint",
        403,
      );
    }

    const orderId = parseId(req.params.id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const order = await prisma.orders.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    if (order.payment_status === PaymentStatus.PAID) {
      return errorResponse(
        res,
        "Paid order cannot be cancelled. Please use the refund process.",
        400,
      );
    }

    if (order.service_status === null) {
      return errorResponse(
        res,
        "Order cannot be cancelled because service status is null",
        400,
      );
    }

    const allowedStatuses: OrderServiceStatus[] = [
      OrderServiceStatus.WAITING,
      OrderServiceStatus.CONFIRMED,
    ];

    if (!allowedStatuses.includes(order.service_status)) {
      return errorResponse(
        res,
        `Order cannot be cancelled. Current status: ${order.service_status}`,
        400,
      );
    }

    const cancellation = await prisma.orders.updateMany({
      where: {
        id: orderId,
        service_status: { in: allowedStatuses },
        OR: [
          { payment_status: { not: PaymentStatus.PAID } },
          { payment_status: null },
        ],
      },
      data: { service_status: OrderServiceStatus.CANCELLED },
    });

    if (cancellation.count === 0) {
      const currentOrder = await prisma.orders.findUnique({ where: { id: orderId } });
      if (!currentOrder) {
        return errorResponse(res, "Order not found", 404);
      }
      if (currentOrder.payment_status === PaymentStatus.PAID) {
        return errorResponse(
          res,
          "Paid order cannot be cancelled. Please use the refund process.",
          400,
        );
      }
      return errorResponse(
        res,
        `Order cannot be cancelled. Current status: ${currentOrder.service_status}`,
        400,
      );
    }

    const updatedOrder = await prisma.orders.findUniqueOrThrow({
      where: { id: orderId },
      include: orderInclude,
    });

    emitOrderStatusUpdate(updatedOrder);

    return successResponse(
      res,
      serializeOrder(updatedOrder),
      "Order cancelled successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const completeOrder = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    const orderId = parseId(req.params.id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const order = await prisma.orders.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    if (order.payment_status !== PaymentStatus.PAID) {
      return errorResponse(
        res,
        "Order must be paid before it can be completed",
        400,
      );
    }

    if (order.service_status !== OrderServiceStatus.IN_PROGRESS) {
      return errorResponse(
        res,
        `Only in-progress orders can be completed. Current status: ${order.service_status}`,
        400,
      );
    }

    const updatedOrder = await prisma.orders.update({
      where: {
        id: orderId,
      },
      data: {
        service_status: OrderServiceStatus.COMPLETED,
      },
      include: orderInclude,
    });

    emitOrderStatusUpdate(updatedOrder);

    return successResponse(
      res,
      serializeOrder(updatedOrder),
      "Order completed successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const createOrderByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== UserRole.CUSTOMER) {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const { vehicle_id, items, check_in_time } = req.body;

    const vehicleId = Number(vehicle_id);

    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      return errorResponse(res, "Valid vehicle is required", 400);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    if (customer.deleted_at) {
      return errorResponse(res, "Customer profile is inactive", 400);
    }

    const activeOrder = await prisma.orders.findFirst({
      where: {
        customer_id: customer.id,
        service_status: {
          in: [
            OrderServiceStatus.WAITING,
            OrderServiceStatus.CONFIRMED,
            OrderServiceStatus.IN_PROGRESS,
          ],
        },
      },
      select: {
        id: true,
        service_status: true,
        vehicles: {
          select: {
            plate_number: true,
          },
        },
      },
    });

    if (activeOrder) {
      return errorResponse(
        res,
        `Anda masih memiliki pesanan aktif (#${activeOrder.id}) dengan status ${activeOrder.service_status}. Harap tunggu hingga pesanan selesai sebelum membuat pesanan baru.`,
        400,
      );
    }
    // =====================================================

    const vehicle = await prisma.vehicles.findFirst({
      where: {
        id: vehicleId,
        customer_id: customer.id,
        deleted_at: null,
      },
    });

    if (!vehicle) {
      return errorResponse(
        res,
        "Vehicle not found or does not belong to you",
        404,
      );
    }

    const finalCheckInTime = validateCheckInTime(check_in_time);

    if (check_in_time !== undefined && finalCheckInTime === null) {
      return errorResponse(res, "Check-in time must use HH:mm format", 400);
    }

    let orderItems: OrderItemInput[] | null;

    try {
      orderItems = await getValidatedServices(items);
    } catch (err) {
      const response = handleServiceValidationError(res, err);

      if (response) {
        return response;
      }

      throw err;
    }

    if (!orderItems || orderItems.length === 0) {
      return errorResponse(res, "At least one service is required", 400);
    }

    const creation = await prisma.$transaction(async (tx) => {
      // Serialize customer self-service bookings across backend instances.
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "customers" WHERE "id" = ${customer.id} FOR UPDATE
      `;

      const currentCustomer = await tx.customers.findUnique({
        where: { id: customer.id },
        select: { id: true, deleted_at: true },
      });

      if (!currentCustomer) {
        return { result: "CUSTOMER_NOT_FOUND" as const };
      }
      if (currentCustomer.deleted_at) {
        return { result: "CUSTOMER_INACTIVE" as const };
      }

      const currentActiveOrder = await tx.orders.findFirst({
        where: {
          customer_id: customer.id,
          service_status: {
            in: [
              OrderServiceStatus.WAITING,
              OrderServiceStatus.CONFIRMED,
              OrderServiceStatus.IN_PROGRESS,
            ],
          },
        },
        select: { id: true, service_status: true },
      });

      if (currentActiveOrder) {
        return { result: "ACTIVE_ORDER" as const, order: currentActiveOrder };
      }

      const currentVehicle = await tx.vehicles.findFirst({
        where: {
          id: vehicleId,
          customer_id: customer.id,
          deleted_at: null,
        },
      });

      if (!currentVehicle) {
        return { result: "VEHICLE_INVALID" as const };
      }

      const order = await tx.orders.create({
        data: {
          customer_id: customer.id,
          vehicle_id: currentVehicle.id,
          service_status: OrderServiceStatus.WAITING,
          payment_status: PaymentStatus.UNPAID,
          check_in_time: finalCheckInTime,
          order_items: { create: orderItems },
        },
        include: {
          customers: {
            select: { id: true, name: true, phone: true },
          },
          vehicles: true,
          order_staff: { include: { staffs: true } },
          order_items: {
            include: {
              services: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  duration: true,
                },
              },
            },
          },
          invoices: true,
          payments: true,
        },
      });

      return { result: "CREATED" as const, order };
    });

    if (creation.result === "CUSTOMER_NOT_FOUND") {
      return errorResponse(res, "Customer profile not found", 404);
    }
    if (creation.result === "CUSTOMER_INACTIVE") {
      return errorResponse(res, "Customer profile is inactive", 400);
    }
    if (creation.result === "ACTIVE_ORDER") {
      return errorResponse(
        res,
        `Anda masih memiliki pesanan aktif (#${creation.order.id}) dengan status ${creation.order.service_status}. Harap tunggu hingga pesanan selesai sebelum membuat pesanan baru.`,
        400,
      );
    }
    if (creation.result === "VEHICLE_INVALID") {
      return errorResponse(
        res,
        "Vehicle not found or does not belong to you",
        404,
      );
    }

    const order = creation.order;

    return successResponse(
      res,
      serializeOrder(order),
      "Order created successfully. Please complete payment before service starts.",
      201,
    );
  } catch (err) {
    next(err);
  }
};

export const getActiveOrderByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== UserRole.CUSTOMER) {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const activeOrder = await prisma.orders.findFirst({
      where: {
        customer_id: customer.id,
        service_status: {
          in: [
            OrderServiceStatus.WAITING,
            OrderServiceStatus.CONFIRMED,
            OrderServiceStatus.IN_PROGRESS,
          ],
        },
      },
      select: {
        id: true,
        service_status: true,
        payment_status: true,
        check_in_time: true,
        created_at: true,
        vehicles: {
          select: {
            id: true,
            plate_number: true,
            brand: true,
            model: true,
          },
        },
        order_staff: {
          select: {
            staffs: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
    });

    return successResponse(
      res,
      activeOrder ? serializeOrder(activeOrder) : null, // null jika tidak ada
      activeOrder ? "Active order found" : "No active order",
    );
  } catch (err) {
    next(err);
  }
};

export const getMyOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== UserRole.CUSTOMER) {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const orders = await prisma.orders.findMany({
      where: {
        customer_id: customer.id,
      },
      orderBy: {
        id: "desc",
      },
      include: {
        vehicles: true,
        order_staff: { include: { staffs: true } },
        order_items: {
          include: {
            services: {
              select: {
                id: true,
                name: true,
                price: true,
                duration: true,
              },
            },
          },
        },
        invoices: true,
        payments: true,
      },
    });

    return successResponse(
      res,
      orders.map(serializeOrder),
      "My orders retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const cancelOrderByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== UserRole.CUSTOMER) {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const orderId = parseId(req.params.id);

    if (!orderId) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const order = await prisma.orders.findFirst({
      where: {
        id: orderId,
        customer_id: customer.id,
      },
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    if (order.payment_status === PaymentStatus.PAID) {
      return errorResponse(res, "Paid order cannot be cancelled", 400);
    }

    if (order.service_status === null) {
      return errorResponse(
        res,
        "Order cannot be cancelled because service status is null",
        400,
      );
    }

    const allowedStatuses: OrderServiceStatus[] = [
      OrderServiceStatus.WAITING,
      OrderServiceStatus.CONFIRMED,
    ];

    if (!allowedStatuses.includes(order.service_status)) {
      return errorResponse(
        res,
        `Order cannot be cancelled. Current status: ${order.service_status}`,
        400,
      );
    }

    const cancellation = await prisma.orders.updateMany({
      where: {
        id: orderId,
        customer_id: customer.id,
        service_status: { in: allowedStatuses },
        OR: [
          { payment_status: { not: PaymentStatus.PAID } },
          { payment_status: null },
        ],
      },
      data: { service_status: OrderServiceStatus.CANCELLED },
    });

    if (cancellation.count === 0) {
      const currentOrder = await prisma.orders.findFirst({
        where: { id: orderId, customer_id: customer.id },
      });
      if (!currentOrder) {
        return errorResponse(res, "Order not found", 404);
      }
      if (currentOrder.payment_status === PaymentStatus.PAID) {
        return errorResponse(res, "Paid order cannot be cancelled", 400);
      }
      return errorResponse(
        res,
        `Order cannot be cancelled. Current status: ${currentOrder.service_status}`,
        400,
      );
    }

    const updatedOrder = await prisma.orders.findFirstOrThrow({
      where: { id: orderId, customer_id: customer.id },
      include: {
        customers: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        vehicles: {
          select: {
            id: true,
            plate_number: true,
            brand: true,
            model: true,
          },
        },
        order_staff: {
          include: {
            staffs: true,
          },
        },
        order_items: {
          include: {
            services: {
              select: {
                id: true,
                name: true,
                price: true,
                duration: true,
              },
            },
          },
        },
        invoices: true,
        payments: true,
      },
    });

    emitOrderStatusUpdate(updatedOrder);

    return successResponse(
      res,
      serializeOrder(updatedOrder),
      "Booking successfully cancelled",
    );
  } catch (err) {
    next(err);
  }
};
