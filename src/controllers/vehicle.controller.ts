import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";

export const getAllVehicles = async (
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

    const customerId = req.query.customer_id
      ? Number(req.query.customer_id)
      : undefined;

    const where = {
      deleted_at: null,

      ...(customerId &&
        !Number.isNaN(customerId) && {
          customer_id: customerId,
        }),

      ...(search && {
        OR: [
          {
            plate_number: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
          {
            brand: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
          {
            model: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
          {
            customers: {
              name: {
                contains: search,
                mode: "insensitive" as const,
              },
            },
          },
        ],
      }),
    };

    const [vehicles, total] = await Promise.all([
      prisma.vehicles.findMany({
        where,
        skip,
        take: limit,
        include: {
          customers: true,
        },
        orderBy: {
          id: "asc",
        },
      }),

      prisma.vehicles.count({
        where,
      }),
    ]);

    return successResponse(
      res,
      {
        vehicles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Vehicles retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getVehicleById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const vehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        deleted_at: null,
      },
      include: {
        customers: true,
      },
    });

    if (!vehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    return successResponse(res, vehicle, "Vehicle retrieved successfully");
  } catch (err) {
    next(err);
  }
};

export const createVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { plate_number, brand, model, customer_id } = req.body;

    if (!plate_number || !brand || !model || !customer_id) {
      return errorResponse(res, "All fields are required", 400);
    }

    const customerId = Number(customer_id);

    if (Number.isNaN(customerId)) {
      return errorResponse(res, "Invalid customer id", 400);
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

    const vehicle = await prisma.vehicles.create({
      data: {
        plate_number: plate_number.trim().toUpperCase(),
        brand: brand.trim(),
        model: model.trim(),
        customer_id: customerId,
      },
      include: {
        customers: true,
      },
    });

    return successResponse(res, vehicle, "Vehicle created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const updateVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const existingVehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!existingVehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    const { plate_number, brand, model, customer_id } = req.body;

    if (!plate_number || !brand || !model || !customer_id) {
      return errorResponse(res, "All fields are required", 400);
    }

    const customerId = Number(customer_id);

    if (Number.isNaN(customerId)) {
      return errorResponse(res, "Invalid customer id", 400);
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

    const vehicle = await prisma.vehicles.update({
      where: {
        id,
      },
      data: {
        plate_number: plate_number.trim().toUpperCase(),
        brand: brand.trim(),
        model: model.trim(),
        customer_id: customerId,
      },
      include: {
        customers: true,
      },
    });

    return successResponse(res, vehicle, "Vehicle updated successfully");
  } catch (err) {
    next(err);
  }
};

export const deleteVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const vehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!vehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    await prisma.vehicles.update({
      where: {
        id,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return successResponse(res, null, "Vehicle deleted successfully");
  } catch (err) {
    next(err);
  }
};
export const restoreVehicle = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const existingVehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        deleted_at: { not: null },
      },
    });

    if (!existingVehicle) {
      return errorResponse(res, "Deleted vehicle not found", 404);
    }

    const vehicle = await prisma.vehicles.update({
      where: { id },
      data: {
        deleted_at: null,
      },
      include: {
        customers: true,
      },
    });

    return successResponse(res, vehicle, "Vehicle restored successfully");
  } catch (err) {
    next(err);
  }
};

export const getDeletedVehicles = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const vehicles = await prisma.vehicles.findMany({
      where: {
        deleted_at: { not: null },
      },
      include: {
        customers: true,
      },
      orderBy: {
        deleted_at: "desc",
      },
    });

    return successResponse(res, vehicles, "Deleted vehicles retrieved");
  } catch (err) {
    next(err);
  }
};

export const getMyVehicles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }
    if (req.user.role !== "CUSTOMER") {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }
    const customer = await prisma.customers.findUnique({
      where: { user_id: req.user.id },
    });
    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const vehicles = await prisma.vehicles.findMany({
      where: {
        customer_id: customer.id,
        deleted_at: null,
      },
      orderBy: {
        id: "asc",
      },
    });
    return successResponse(res, vehicles, "My vehicles retrieved successfully");
  } catch (err) {
    next(err);
  }
};

export const createVehicleByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== "CUSTOMER") {
      return errorResponse(res, "Only customer can access his endpoint", 403);
    }

    const customer = await prisma.customers.findUnique({
      where: { user_id: req.user.id },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const { plate_number, brand, model } = req.body;

    if (!plate_number || !brand || !model) {
      return errorResponse(res, "All fields are required", 400);
    }

    const vehicle = await prisma.vehicles.create({
      data: {
        plate_number,
        brand,
        model,
        customer_id: customer.id,
      },
    });

    return successResponse(res, vehicle, "Vehicle created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const updateVehicleByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== "CUSTOMER") {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const existingVehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        customer_id: customer.id,
        deleted_at: null,
      },
    });

    if (!existingVehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    const { plate_number, brand, model } = req.body;

    if (!plate_number || !brand || !model) {
      return errorResponse(res, "All fields are required", 400);
    }

    const vehicle = await prisma.vehicles.update({
      where: {
        id,
      },
      data: {
        plate_number,
        brand,
        model,
      },
    });

    return successResponse(res, vehicle, "Vehicle updated successfully");
  } catch (err) {
    next(err);
  }
};

export const deleteVehicleByCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    if (req.user.role !== "CUSTOMER") {
      return errorResponse(res, "Only customer can access this endpoint", 403);
    }

    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return errorResponse(res, "Invalid vehicle id", 400);
    }

    const customer = await prisma.customers.findUnique({
      where: {
        user_id: req.user.id,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer profile not found", 404);
    }

    const existingVehicle = await prisma.vehicles.findFirst({
      where: {
        id,
        customer_id: customer.id,
        deleted_at: null,
      },
    });

    if (!existingVehicle) {
      return errorResponse(res, "Vehicle not found", 404);
    }

    await prisma.vehicles.update({
      where: {
        id,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return successResponse(res, null, "Vehicle deleted successfully");
  } catch (err) {
    next(err);
  }
};
