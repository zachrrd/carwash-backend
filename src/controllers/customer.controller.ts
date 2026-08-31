import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { successResponse, errorResponse } from "../utils/response";
import bcrypt from "bcrypt";
import { UserRole } from "../../generated/prisma/enums";

export const getAllCustomers = async (
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

    const where: any = {
      deleted_at: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          {
            user: {
              email: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customers.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          vehicles: {
            where: {
              deleted_at: null,
            },
          },
        },
        orderBy: {
          id: "asc",
        },
      }),
      prisma.customers.count({ where }),
    ]);

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
        user: { select: { name: true, email: true } },
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

export const createCustomerAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return errorResponse(res, "Invalid customer id", 400);
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, "Email and password are required", 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (password.length < 6) {
      return errorResponse(res, "Password must be at least 6 characters", 400);
    }

    const customer = await prisma.customers.findFirst({
      where: {
        id,
        deleted_at: null,
      },
      include: {
        user: true,
      },
    });

    if (!customer) {
      return errorResponse(res, "Customer not found", 404);
    }

    if (customer.user_id || customer.user) {
      return errorResponse(res, "Customer already has an account", 409);
    }

    const existingUser = await prisma.users.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      return errorResponse(res, "Email already registered", 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          name: customer.name,
          email: normalizedEmail,
          password: hashedPassword,
          role: UserRole.CUSTOMER,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      const updatedCustomer = await tx.customers.update({
        where: {
          id: customer.id,
        },
        data: {
          user_id: user.id,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          user_id: true,
        },
      });

      return {
        user,
        customer: updatedCustomer,
      };
    });

    return successResponse(
      res,
      result,
      "Customer account created successfully",
      201,
    );
  } catch (err) {
    next(err);
  }
};
