import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";

export const getAllServices = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const where = {
      deleted_at: null,
    };

    const [services, total] = await Promise.all([
      prisma.services.findMany({
        skip,
        take: limit,
        where,
        orderBy: {
          id: "asc",
        },
      }),

      prisma.services.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(
      res,
      {
        services,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "Services retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getServiceById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid service id", 400);
    }

    const service = await prisma.services.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!service) {
      return errorResponse(res, "Service not found", 404);
    }

    return successResponse(res, service, "Service retrieved successfully");
  } catch (err) {
    next(err);
  }
};

export const createService = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, duration, price, status } = req.body;

    if (!name || !duration || !price) {
      return errorResponse(res, "Name, duration and price are required", 400);
    }

    const service = await prisma.services.create({
      data: {
        name,
        duration,
        price,
        status,
      },
    });

    return successResponse(res, service, "Service created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const updateService = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid service id", 400);
    }

    const existingService = await prisma.services.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!existingService) {
      return errorResponse(res, "Service not found", 404);
    }

    const { name, duration, price, status } = req.body;

    const service = await prisma.services.update({
      where: {
        id,
      },
      data: {
        name,
        duration,
        price,
        status,
      },
    });

    return successResponse(res, service, "Service updated successfully");
  } catch (err) {
    next(err);
  }
};

export const deleteService = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid service id", 400);
    }

    const existingService = await prisma.services.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!existingService) {
      return errorResponse(res, "Service not found", 404);
    }

    await prisma.services.update({
      where: {
        id,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return successResponse(res, null, "Service deleted successfully");
  } catch (err) {
    next(err);
  }
};
export const restoreService = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid service id", 400);
    }

    const existingService = await prisma.services.findFirst({
      where: {
        id,
        deleted_at: { not: null },
      },
    });

    if (!existingService) {
      return errorResponse(res, "Deleted service not found", 404);
    }

    const service = await prisma.services.update({
      where: { id },
      data: {
        deleted_at: null,
      },
    });

    return successResponse(res, service, "Service restored successfully");
  } catch (err) {
    next(err);
  }
};

export const getDeletedServices = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const services = await prisma.services.findMany({
      where: {
        deleted_at: { not: null },
      },
      orderBy: {
        deleted_at: "desc",
      },
    });

    return successResponse(res, services, "Deleted services retrieved");
  } catch (err) {
    next(err);
  }
};
