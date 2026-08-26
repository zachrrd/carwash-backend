import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";

export const getAllCustomers = async (
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

    const customers = await prisma.customers.findMany({
      where,
      skip,
      take: limit,
      include: {
        vehicles: {
          where: {
            deleted_at: null,
          },
        },
      },
      orderBy: {
        id: "asc",
      },
    });

    const total = await prisma.customers.count({ where });
    const totalPages = Math.ceil(total / limit);

    return successResponse(
      res,
      {
        customers,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "Customers retrieved successfully",
    );
  } catch (err) {
    next(err);
  }
};

export const getCustomerById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const customer = await prisma.customers.findFirst({
      where: {
        id,
        deleted_at: null,
      },
      include: {
        vehicles: {
          where: {
            deleted_at: null,
          },
        },
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer not found", 404);
    }

    return successResponse(res, customer, "Customer retrieved successfully");
  } catch (err) {
    next(err);
  }
};

export const createCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return errorResponse(res, "Name and phone are required", 400);
    }

    const customer = await prisma.customers.create({
      data: {
        name,
        phone,
      },
    });

    return successResponse(res, customer, "Customer created successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const updateCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const { name, phone } = req.body;

    const existingCustomer = await prisma.customers.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!existingCustomer) {
      return errorResponse(res, "Customer not found", 404);
    }

    const customer = await prisma.customers.update({
      where: { id },
      data: {
        name,
        phone,
      },
    });

    return successResponse(res, customer, "Customer updated successfully");
  } catch (err) {
    next(err);
  }
};

export const deleteCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const existingCustomer = await prisma.customers.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!existingCustomer) {
      return errorResponse(res, "Customer not found", 404);
    }

    await prisma.customers.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });

    return successResponse(res, null, "Customer deleted successfully");
  } catch (err) {
    next(err);
  }
};

export const restoreCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const existingCustomer = await prisma.customers.findFirst({
      where: {
        id,
        deleted_at: { not: null },
      },
    });

    if (!existingCustomer) {
      return errorResponse(res, "Deleted customer not found", 404);
    }

    const customer = await prisma.customers.update({
      where: { id },
      data: {
        deleted_at: null,
      },
    });

    return successResponse(res, customer, "Customer restored successfully");
  } catch (err) {
    next(err);
  }
};

export const getDeletedCustomers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const customers = await prisma.customers.findMany({
      where: {
        deleted_at: { not: null },
      },
      orderBy: {
        deleted_at: "desc",
      },
    });

    return successResponse(res, customers, "Deleted customers retrieved");
  } catch (err) {
    next(err);
  }
};