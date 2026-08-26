import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";

interface OrderItemInput {
  service_id: number;
  qty: number;
  subtotal: number;
}

// =========================
// GET ALL ORDERS
// =========================

export const getAllOrders = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.max(Number(req.query.limit) || 10, 1);

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.orders.findMany({
        skip,
        take: limit,

        orderBy: {
          id: "desc",
        },

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
      }),

      prisma.orders.count(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(
      res,
      {
        data: orders,

        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "Orders retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

// =========================
// GET ORDER BY ID
// =========================

export const getOrderById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid order id", 400);
    }

    const order = await prisma.orders.findUnique({
      where: {
        id,
      },
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
    });

    if (!order) {
      return errorResponse(res, "Order not found", 404);
    }

    return successResponse(res, order, "Order retrieved successfully");
  } catch (err) {
    next(err);
  }
};

// =========================
// CREATE ORDER
// =========================

export const createOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      customer_id,
      vehicle_id,
      staff_id,
      service_status,
      check_in_time,
      items,
    } = req.body;

    // =========================
    // BASIC VALIDATION
    // =========================

    if (
      !customer_id ||
      !vehicle_id ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return errorResponse(
        res,
        "Customer, vehicle, and services are required",
        400,
      );
    }

    // =========================
    // CUSTOMER VALIDATION
    // =========================

    const customer = await prisma.customers.findUnique({
      where: {
        id: Number(customer_id),
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer not found", 404);
    }

    // =========================
    // VEHICLE VALIDATION
    // =========================

    const vehicle = await prisma.vehicles.findUnique({
      where: {
        id: Number(vehicle_id),
      },
    });

    if (!vehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    // Pastikan vehicle memang milik customer
    if (vehicle.customer_id !== Number(customer_id)) {
      return errorResponse(
        res,
        "Vehicle does not belong to this customer",
        400,
      );
    }

    // =========================
    // STAFF VALIDATION
    // =========================

    if (staff_id !== undefined && staff_id !== null) {
      const staff = await prisma.staffs.findUnique({
        where: {
          id: Number(staff_id),
        },
      });

      if (!staff) {
        return errorResponse(res, "Staff not found", 404);
      }

      // Hanya staff Active yang boleh dipilih
      if (staff.status !== "Active") {
        return errorResponse(
          res,
          "Staff is inactive and cannot be assigned to an order",
          400,
        );
      }
    }

    // =========================
    // SERVICE VALIDATION
    // =========================

    const serviceIds = [
      ...new Set(
        items.map((item: { service_id: number }) => Number(item.service_id)),
      ),
    ];

    const services = await prisma.services.findMany({
      where: {
        id: {
          in: serviceIds,
        },
      },
    });

    // Pastikan semua service ditemukan
    if (services.length !== serviceIds.length) {
      return errorResponse(res, "One or more services not found", 404);
    }

    // Pastikan semua service Active
    const inactiveServices = services.filter(
      (service) => service.status !== "Active",
    );

    if (inactiveServices.length > 0) {
      return errorResponse(res, "One or more services are inactive", 400);
    }

    // =========================
    // VALIDATE QUANTITY
    // =========================

    for (const item of items) {
      const qty = Number(item.qty);

      if (!Number.isInteger(qty) || qty <= 0) {
        return errorResponse(
          res,
          "Service quantity must be greater than 0",
          400,
        );
      }
    }

    // =========================
    // CREATE ORDER ITEMS
    // =========================

    const orderItems: OrderItemInput[] = items.map(
      (item: { service_id: number; qty: number }) => {
        const service = services.find(
          (service) => service.id === Number(item.service_id),
        );

        const qty = Number(item.qty);

        return {
          service_id: Number(item.service_id),
          qty,
          subtotal: Number(service!.price) * qty,
        };
      },
    );

    // =========================
    // CREATE ORDER
    // =========================

    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.orders.create({
        data: {
          customer_id: Number(customer_id),

          vehicle_id: Number(vehicle_id),

          staff_id:
            staff_id === undefined || staff_id === null
              ? null
              : Number(staff_id),

          service_status: service_status ?? "Waiting",

          payment_status: "Unpaid",

          check_in_time: check_in_time ?? null,

          order_items: {
            create: orderItems,
          },
        },

        include: {
          customers: true,
          vehicles: true,
          staffs: true,

          order_items: {
            include: {
              services: true,
            },
          },
        },
      });

      return order;
    });

    return successResponse(res, order, "Order created successfully", 201);
  } catch (err) {
    next(err);
  }
};

// =========================
// UPDATE ORDER
// =========================

export const updateOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    // =========================
    // VALIDATE ID
    // =========================

    if (isNaN(id)) {
      return errorResponse(res, "Invalid order id", 400);
    }

    // =========================
    // FIND EXISTING ORDER
    // =========================

    const existingOrder = await prisma.orders.findUnique({
      where: {
        id,
      },
    });

    if (!existingOrder) {
      return errorResponse(res, "Order not found", 404);
    }

    // Order Paid tidak boleh diedit
    if (existingOrder.payment_status === "Paid") {
      return errorResponse(
        res,
        "Order yang sudah dibayar tidak dapat diubah",
        400,
      );
    }

    // =========================
    // REQUEST BODY
    // =========================

    const {
      customer_id,
      vehicle_id,
      staff_id,
      service_status,
      check_in_time,
      items,
    } = req.body;

    // =========================
    // UPDATE DATA
    // =========================

    const updateData: any = {};

    // =========================
    // CUSTOMER
    // =========================

    const finalCustomerId =
      customer_id !== undefined
        ? Number(customer_id)
        : existingOrder.customer_id;

    if (customer_id !== undefined) {
      const customer = await prisma.customers.findUnique({
        where: {
          id: finalCustomerId,
        },
      });

      if (!customer) {
        return errorResponse(res, "Customer not found", 404);
      }

      updateData.customer_id = finalCustomerId;
    }

    // =========================
    // VEHICLE
    // =========================

    const finalVehicleId =
      vehicle_id !== undefined ? Number(vehicle_id) : existingOrder.vehicle_id;

    if (vehicle_id !== undefined) {
      const vehicle = await prisma.vehicles.findUnique({
        where: {
          id: finalVehicleId,
        },
      });

      if (!vehicle) {
        return errorResponse(res, "Vehicle not found", 404);
      }

      // Pastikan vehicle milik customer
      if (vehicle.customer_id !== finalCustomerId) {
        return errorResponse(
          res,
          "Vehicle does not belong to this customer",
          400,
        );
      }

      updateData.vehicle_id = finalVehicleId;
    } else if (customer_id !== undefined) {
      // Customer berubah,
      // tapi vehicle tidak dikirim.
      // Pastikan vehicle lama masih milik customer baru.

      const vehicle = await prisma.vehicles.findUnique({
        where: {
          id: existingOrder.vehicle_id,
        },
      });

      if (vehicle && vehicle.customer_id !== finalCustomerId) {
        return errorResponse(
          res,
          "Vehicle does not belong to this customer",
          400,
        );
      }
    }

    // =========================
    // STAFF
    // =========================

    if (staff_id !== undefined) {
      if (staff_id !== null) {
        const staff = await prisma.staffs.findUnique({
          where: {
            id: Number(staff_id),
          },
        });

        if (!staff) {
          return errorResponse(res, "Staff not found", 404);
        }

        // Hanya staff Active
        if (staff.status !== "Active") {
          return errorResponse(
            res,
            "Staff is inactive and cannot be assigned to an order",
            400,
          );
        }

        updateData.staff_id = Number(staff_id);
      } else {
        updateData.staff_id = null;
      }
    }

    // =========================
    // SERVICE STATUS
    // =========================

    if (service_status !== undefined) {
      updateData.service_status = service_status;
    }

    // =========================
    // CHECK IN TIME
    // =========================

    if (check_in_time !== undefined) {
      updateData.check_in_time = check_in_time;
    }

    // =========================
    // ORDER ITEMS
    // =========================

    let orderItems: OrderItemInput[] | undefined;

    if (items !== undefined) {
      // Minimal harus ada 1 service
      if (!Array.isArray(items) || items.length === 0) {
        return errorResponse(res, "Order must have at least one service", 400);
      }

      // =========================
      // VALIDATE QTY
      // =========================

      for (const item of items) {
        const qty = Number(item.qty);

        if (!Number.isInteger(qty) || qty <= 0) {
          return errorResponse(
            res,
            "Service quantity must be greater than 0",
            400,
          );
        }
      }

      // =========================
      // GET SERVICES
      // =========================

      const serviceIds = [
        ...new Set(
          items.map((item: { service_id: number }) => Number(item.service_id)),
        ),
      ];

      const services = await prisma.services.findMany({
        where: {
          id: {
            in: serviceIds,
          },
        },
      });

      // Semua service harus ditemukan
      if (services.length !== serviceIds.length) {
        return errorResponse(res, "One or more services not found", 404);
      }

      // =========================
      // ACTIVE SERVICE CHECK
      // =========================

      const inactiveServices = services.filter(
        (service) => service.status !== "Active",
      );

      if (inactiveServices.length > 0) {
        return errorResponse(res, "One or more services are inactive", 400);
      }

      // =========================
      // CREATE ORDER ITEMS
      // =========================

      orderItems = items.map((item: { service_id: number; qty: number }) => {
        const service = services.find(
          (service) => service.id === Number(item.service_id),
        );

        const qty = Number(item.qty);

        return {
          service_id: Number(item.service_id),
          qty,
          subtotal: Number(service!.price) * qty,
        };
      });
    }

    // =========================
    // TRANSACTION
    // =========================

    const order = await prisma.$transaction(async (tx) => {
      // Update order
      await tx.orders.update({
        where: {
          id,
        },
        data: updateData,
      });

      // =========================
      // UPDATE ORDER ITEMS
      // =========================

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

      // =========================
      // GET UPDATED ORDER
      // =========================

      return tx.orders.findUnique({
        where: {
          id,
        },

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
      });
    });

    return successResponse(res, order, "Order updated successfully");
  } catch (err) {
    next(err);
  }
};

// =========================
// DELETE ORDER
// =========================

export const deleteOrder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    // =========================
    // VALIDATE ID
    // =========================

    if (isNaN(id)) {
      return errorResponse(res, "Invalid order id", 400);
    }

    // =========================
    // FIND ORDER
    // =========================

    const existingOrder = await prisma.orders.findUnique({
      where: {
        id,
      },
    });

    if (!existingOrder) {
      return errorResponse(res, "Order not found", 404);
    }

    // if (existingOrder.payment_status === "Paid") {
    //   return errorResponse(
    //     res,
    //     "Order yang sudah dibayar tidak dapat dihapus",
    //     400,
    //   );
    // }

    // =========================
    // DELETE ORDER
    // =========================

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
