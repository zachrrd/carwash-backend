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

interface OrderItemInput {
  service_id: number;
  qty: number;
  subtotal: number;
}

const parseId = (value: string | string[] | undefined): number | null => {
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

const orderInclude = {
  customers: true,
  vehicles: true,
  staffs: true,
  order_items: {
    include: {
      services: true,
    },
  },
  invoices: true,
  payments: true,
};

const getValidatedServices = async (
  items: unknown,
): Promise<OrderItemInput[] | null> => {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const serviceIds = [
    ...new Set(
      items.map((item: { service_id: number }) => Number(item.service_id)),
    ),
  ];

  if (
    serviceIds.some(
      (serviceId) => !Number.isInteger(serviceId) || serviceId <= 0,
    )
  ) {
    throw new Error("INVALID_SERVICE_ID");
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

  const orderItems: OrderItemInput[] = [];

  for (const item of items) {
    const serviceId = Number(item.service_id);
    const qty = validateQuantity(item.qty);

    if (!qty) {
      throw new Error("INVALID_QUANTITY");
    }

    const service = services.find((service) => service.id === serviceId);

    if (!service) {
      throw new Error("SERVICE_NOT_FOUND");
    }

    orderItems.push({
      service_id: serviceId,
      qty,
      subtotal: Number(service.price) * qty,
    });
  }

  return orderItems;
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
    const serviceStatus = req.query.service_status as
      | OrderServiceStatus
      | undefined;
    const paymentStatus = req.query.payment_status as PaymentStatus | undefined;
    const customerId = req.query.customer_id
      ? Number(req.query.customer_id)
      : undefined;
    const staffId = req.query.staff_id ? Number(req.query.staff_id) : undefined;

    const where: any = {
      ...(serviceStatus &&
        isValidEnumValue(OrderServiceStatus, serviceStatus) && {
          service_status: serviceStatus,
        }),
      ...(paymentStatus &&
        isValidEnumValue(PaymentStatus, paymentStatus) && {
          payment_status: paymentStatus,
        }),
      ...(customerId && { customer_id: customerId }),
      ...(staffId && { staff_id: staffId }),
      ...(search && {
        OR: [
          { customers: { name: { contains: search, mode: "insensitive" } } },
          { customers: { phone: { contains: search, mode: "insensitive" } } },
          {
            vehicles: {
              plate_number: { contains: search, mode: "insensitive" },
            },
          },
          { vehicles: { brand: { contains: search, mode: "insensitive" } } },
          { vehicles: { model: { contains: search, mode: "insensitive" } } },
          {
            invoices: {
              some: { invoice_no: { contains: search, mode: "insensitive" } },
            },
          },
        ],
      }),
    };

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
      prisma.orders.count({ where }),
    ]);

    return successResponse(
      res,
      {
        orders,
        data: orders,
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

    return successResponse(res, order, "Order retrieved successfully");
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
    const { customer_id, vehicle_id, staff_id, check_in_time, items } =
      req.body;

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

    let finalStaffId: number | null = null;

    if (staff_id !== undefined && staff_id !== null) {
      const staffId = Number(staff_id);

      if (!Number.isInteger(staffId) || staffId <= 0) {
        return errorResponse(res, "Invalid staff id", 400);
      }

      const staff = await prisma.staffs.findFirst({
        where: {
          id: staffId,
          deleted_at: null,
        },
      });

      if (!staff) {
        return errorResponse(res, "Staff not found", 404);
      }

      if (staff.status !== ActiveStatus.ACTIVE) {
        return errorResponse(
          res,
          "Staff is inactive and cannot be assigned to an order",
          400,
        );
      }

      finalStaffId = staffId;
    }

    const finalCheckInTime = validateCheckInTime(check_in_time);

    if (check_in_time !== undefined && finalCheckInTime === null) {
      return errorResponse(res, "Check-in time must use HH:mm format", 400);
    }

    let orderItems: OrderItemInput[] | null;

    try {
      orderItems = await getValidatedServices(items);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "INVALID_SERVICE_ID") {
          return errorResponse(res, "Invalid service id", 400);
        }

        if (err.message === "SERVICE_NOT_FOUND") {
          return errorResponse(res, "One or more services not found", 404);
        }

        if (err.message === "INACTIVE_SERVICE") {
          return errorResponse(res, "One or more services are inactive", 400);
        }

        if (err.message === "INVALID_QUANTITY") {
          return errorResponse(
            res,
            "Service quantity must be greater than 0",
            400,
          );
        }
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
        staff_id: finalStaffId,
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
      order,
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
      staff_id,
      service_status,
      check_in_time,
      items,
    } = req.body;

    if (service_status !== undefined) {
      return errorResponse(
        res,
        "Service status must be updated through the status endpoint",
        400,
      );
    }

    if (existingOrder.payment_status === PaymentStatus.PAID) {
      const tryingToChangeOrderData =
        customer_id !== undefined ||
        vehicle_id !== undefined ||
        staff_id !== undefined ||
        check_in_time !== undefined ||
        items !== undefined;

      if (tryingToChangeOrderData) {
        return errorResponse(
          res,
          "Paid order cannot modify customer, vehicle, staff, check-in time, or services",
          400,
        );
      }
    }

    const finalCustomerId =
      customer_id !== undefined
        ? Number(customer_id)
        : existingOrder.customer_id;

    if (!Number.isInteger(finalCustomerId) || finalCustomerId <= 0) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const finalVehicleId =
      vehicle_id !== undefined ? Number(vehicle_id) : existingOrder.vehicle_id;

    if (!Number.isInteger(finalVehicleId) || finalVehicleId <= 0) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    if (
      existingOrder.payment_status !== PaymentStatus.PAID &&
      (customer_id !== undefined || vehicle_id !== undefined)
    ) {
      const customer = await prisma.customers.findFirst({
        where: {
          id: finalCustomerId,
          deleted_at: null,
        },
      });

      if (!customer) {
        return errorResponse(res, "Customer not found", 404);
      }

      const vehicle = await prisma.vehicles.findFirst({
        where: {
          id: finalVehicleId,
          customer_id: finalCustomerId,
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
    }

    let finalStaffId = existingOrder.staff_id;

    if (
      existingOrder.payment_status !== PaymentStatus.PAID &&
      staff_id !== undefined
    ) {
      if (staff_id === null) {
        finalStaffId = null;
      } else {
        const staffId = Number(staff_id);

        if (!Number.isInteger(staffId) || staffId <= 0) {
          return errorResponse(res, "Invalid staff id", 400);
        }

        const staff = await prisma.staffs.findFirst({
          where: {
            id: staffId,
            deleted_at: null,
          },
        });

        if (!staff) {
          return errorResponse(res, "Staff not found", 404);
        }

        if (staff.status !== ActiveStatus.ACTIVE) {
          return errorResponse(
            res,
            "Staff is inactive and cannot be assigned to an order",
            400,
          );
        }

        finalStaffId = staffId;
      }
    }

    let finalCheckInTime = existingOrder.check_in_time;

    if (
      existingOrder.payment_status !== PaymentStatus.PAID &&
      check_in_time !== undefined
    ) {
      finalCheckInTime = validateCheckInTime(check_in_time);

      if (check_in_time !== null && finalCheckInTime === null) {
        return errorResponse(res, "Check-in time must use HH:mm format", 400);
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
        if (err instanceof Error) {
          if (err.message === "INVALID_SERVICE_ID") {
            return errorResponse(res, "Invalid service id", 400);
          }

          if (err.message === "SERVICE_NOT_FOUND") {
            return errorResponse(res, "One or more services not found", 404);
          }

          if (err.message === "INACTIVE_SERVICE") {
            return errorResponse(res, "One or more services are inactive", 400);
          }

          if (err.message === "INVALID_QUANTITY") {
            return errorResponse(
              res,
              "Service quantity must be greater than 0",
              400,
            );
          }
        }

        throw err;
      }

      if (!orderItems || orderItems.length === 0) {
        return errorResponse(res, "Order must have at least one service", 400);
      }
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.orders.update({
        where: {
          id,
        },
        data: {
          customer_id: finalCustomerId,
          vehicle_id: finalVehicleId,
          staff_id: finalStaffId,
          check_in_time: finalCheckInTime,
        },
      });

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

      return tx.orders.findUnique({
        where: {
          id,
        },
        include: orderInclude,
      });
    });

    return successResponse(res, updatedOrder, "Order updated successfully");
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

    if (
      currentStatus === OrderServiceStatus.WAITING &&
      service_status === OrderServiceStatus.CONFIRMED
    ) {
      const updatedOrder = await prisma.orders.update({
        where: {
          id: orderId,
        },
        data: {
          service_status: OrderServiceStatus.CONFIRMED,
        },
        include: orderInclude,
      });

      return successResponse(res, updatedOrder, "Order confirmed successfully");
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
      if (order.payment_status !== PaymentStatus.PAID) {
        return errorResponse(
          res,
          "Order must be paid before service can start",
          400,
        );
      }

      const updatedOrder = await prisma.orders.update({
        where: {
          id: orderId,
        },
        data: {
          service_status: OrderServiceStatus.IN_PROGRESS,
        },
        include: orderInclude,
      });

      return successResponse(
        res,
        updatedOrder,
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

      const updatedOrder = await prisma.orders.update({
        where: {
          id: orderId,
        },
        data: {
          service_status: OrderServiceStatus.COMPLETED,
        },
        include: orderInclude,
      });

      return successResponse(res, updatedOrder, "Order completed successfully");
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

    const existingOrder = await prisma.orders.findUnique({
      where: {
        id,
      },
    });

    if (!existingOrder) {
      return errorResponse(res, "Order not found", 404);
    }

    if (existingOrder.payment_status === PaymentStatus.PAID) {
      return errorResponse(
        res,
        "Order yang sudah dibayar tidak dapat dihapus",
        400,
      );
    }

    if (existingOrder.service_status === OrderServiceStatus.COMPLETED) {
      return errorResponse(res, "Completed order cannot be deleted", 400);
    }

    if (existingOrder.service_status === OrderServiceStatus.CANCELLED) {
      return errorResponse(res, "Cancelled order cannot be deleted", 400);
    }

    await prisma.orders.delete({
      where: {
        id,
      },
    });

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

    const updatedOrder = await prisma.orders.update({
      where: {
        id: orderId,
      },
      data: {
        service_status: OrderServiceStatus.CANCELLED,
      },
      include: orderInclude,
    });

    return successResponse(res, updatedOrder, "Order cancelled successfully");
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

    return successResponse(res, updatedOrder, "Order completed successfully");
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
      if (err instanceof Error) {
        if (err.message === "INVALID_SERVICE_ID") {
          return errorResponse(res, "Invalid service id", 400);
        }

        if (err.message === "SERVICE_NOT_FOUND") {
          return errorResponse(
            res,
            "One or more services not found or inactive",
            404,
          );
        }

        if (err.message === "INACTIVE_SERVICE") {
          return errorResponse(res, "One or more services are inactive", 400);
        }

        if (err.message === "INVALID_QUANTITY") {
          return errorResponse(
            res,
            "Service quantity must be greater than 0",
            400,
          );
        }
      }

      throw err;
    }

    if (!orderItems || orderItems.length === 0) {
      return errorResponse(res, "At least one service is required", 400);
    }

    const order = await prisma.orders.create({
      data: {
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        staff_id: null,
        service_status: OrderServiceStatus.WAITING,
        payment_status: PaymentStatus.UNPAID,
        check_in_time: finalCheckInTime,
        order_items: {
          create: orderItems,
        },
      },
      include: {
        customers: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        vehicles: true,
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
      order,
      "Order created successfully. Please complete payment before service starts.",
      201,
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

    return successResponse(res, orders, "My orders retrieved successfully");
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

    const updatedOrder = await prisma.orders.update({
      where: {
        id: orderId,
      },
      data: {
        service_status: OrderServiceStatus.CANCELLED,
      },
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

    return successResponse(res, updatedOrder, "Booking successfully cancelled");
  } catch (err) {
    next(err);
  }
};
