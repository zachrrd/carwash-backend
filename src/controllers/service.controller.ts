import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import {
  uploadImageToImageKit,
  deleteImageFromImageKit,
} from "../utils/imagekit";

import { ActiveStatus } from "../../generated/prisma/enums";

const isValidActiveStatus = (status: unknown): status is ActiveStatus => {
  return status === ActiveStatus.ACTIVE || status === ActiveStatus.INACTIVE;
};

export const getAllServices = async (
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
    const status = req.query.status as ActiveStatus | undefined;

    const where: any = {
      deleted_at: null,
      ...(status && isValidActiveStatus(status) && { status }),
      ...(search && {
        name: { contains: search, mode: "insensitive" },
      }),
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

    const parsedDuration = Number(duration);
    const parsedPrice = Number(price);

    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
      return errorResponse(res, "Duration must be a positive integer", 400);
    }

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return errorResponse(res, "Price must be a positive number", 400);
    }

    const serviceStatus = status || ActiveStatus.ACTIVE;

    if (!isValidActiveStatus(serviceStatus)) {
      return errorResponse(res, "Status must be ACTIVE or INACTIVE", 400);
    }

    let image_url: string | null = null;
    let image_id: string | null = null;

    if (req.file) {
      const uploadedImage = await uploadImageToImageKit(req.file);

      image_url = uploadedImage.image_url;
      image_id = uploadedImage.image_id;
    }

    const service = await prisma.services.create({
      data: {
        name: name.trim(),
        duration: parsedDuration,
        price: parsedPrice,
        status: serviceStatus,
        image_url,
        image_id,
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

    const parsedDuration =
      duration !== undefined ? Number(duration) : existingService.duration;

    const parsedPrice =
      price !== undefined ? Number(price) : Number(existingService.price);

    const serviceStatus =
      status !== undefined ? status : existingService.status;

    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
      return errorResponse(res, "Duration must be a positive integer", 400);
    }

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return errorResponse(res, "Price must be a positive number", 400);
    }

    if (serviceStatus !== null && !isValidActiveStatus(serviceStatus)) {
      return errorResponse(res, "Status must be ACTIVE or INACTIVE", 400);
    }

    let image_url = existingService.image_url;
    let image_id = existingService.image_id;

    if (req.file) {
      const uploadedImage = await uploadImageToImageKit(req.file);

      image_url = uploadedImage.image_url;
      image_id = uploadedImage.image_id;
    }

    const service = await prisma.services.update({
      where: {
        id,
      },
      data: {
        ...(name !== undefined && {
          name: name.trim(),
        }),
        duration: parsedDuration,
        price: parsedPrice,
        status: serviceStatus,
        image_url,
        image_id,
      },
    });

    if (req.file && existingService.image_id) {
      try {
        await deleteImageFromImageKit(existingService.image_id);
      } catch (imageDeleteError) {
        console.error(
          "Failed to delete old image from ImageKit:",
          imageDeleteError,
        );
      }
    }

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
