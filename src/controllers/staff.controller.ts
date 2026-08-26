import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";

export const getAllStaffs = async (
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

    const [staffs, total] = await Promise.all([
      prisma.staffs.findMany({
        skip,
        take: limit,
        where,
        orderBy: {
          id: "asc",
        },
      }),

      prisma.staffs.count({where}),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(
      res,
      {
        staffs,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "Staffs retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getStaffById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid staff id", 400);
    }

    const staff = await prisma.staffs.findFirst({
      where: { 
        id,
        deleted_at: null,
       },
    });

    if (!staff) {
      return errorResponse(res, "Staff not found", 404);
    }

    return successResponse(res, staff);
  } catch (err) {
    next(err);
  }
};

export const createStaff = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, phone, status } = req.body;

    if (!name) {
      return errorResponse(res, "Name is required", 400);
    }

    const staff = await prisma.staffs.create({
      data: {
        name,
        phone,
        status,
      },
    });

    return successResponse(res, staff, "Staff created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const updateStaff = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid staff id", 400);
    }

    const { name, phone, status } = req.body;

    const existingStaff = await prisma.staffs.findFirst({
      where: { 
        id,
        deleted_at: null,
       },
    });

    if (!existingStaff) {
      return errorResponse(res, "Staff not found", 404);
    }

    const staff = await prisma.staffs.update({
      where: { id },
      data: {
        name,
        phone,
        status,
      },
    });

    return successResponse(res, staff, "Staff updated successfully");
  } catch (err) {
    next(err);
  }
};

export const deleteStaff = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid staff id", 400);
    }

    const existingStaff = await prisma.staffs.findFirst({
      where: { 
        id,
        deleted_at: null,
      },
    });

    if (!existingStaff) {
      return errorResponse(res, "Staff not found", 404);
    }

    await prisma.staffs.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      }
    });

    return successResponse(res, null, "Staff deleted successfully");
  } catch (err) {
    next(err);
  }
};
export const restoreStaff = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid staff id", 400);
    }

    const existingStaff = await prisma.staffs.findFirst({
      where: {
        id,
        deleted_at: { not: null },
      },
    });

    if (!existingStaff) {
      return errorResponse(res, "Deleted staff not found", 404);
    }

    const staff = await prisma.staffs.update({
      where: { id },
      data: {
        deleted_at: null,
      },
    });

    return successResponse(res, staff, "Staff restored successfully");
  } catch (err) {
    next(err);
  }
};

export const getDeletedStaffs = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const staffs = await prisma.staffs.findMany({
      where: {
        deleted_at: { not: null },
      },
      orderBy: {
        deleted_at: "desc",
      },
    });

    return successResponse(res, staffs, "Deleted staffs retrieved");
  } catch (err) {
    next(err);
  }
};