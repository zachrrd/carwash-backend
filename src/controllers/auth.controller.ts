import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma";
import { errorResponse, successResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";
import { registerSchema, loginSchema } from "../validations/auth.validation";

import { UserRole } from "../../generated/prisma/enums";

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 1. Validasi dengan Zod
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return errorResponse(res, "Validation failed", 400, errors);
    }

    const { email, password } = parsed.data;

    const user = await prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      {
        expiresIn: "1d",
      },
    );

    return successResponse(
      res,
      {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
      "Login successful",
    );
  } catch (err) {
    next(err);
  }
};

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 1. Validasi dengan Zod
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return errorResponse(res, "Validation failed", 400, errors);
    }

    const { name, email, password, phone } = parsed.data;

    // 2. Cek email sudah terdaftar
    const existingUser = await prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      return errorResponse(res, "Email already registered", 409);
    }

    // 3. Cek nomor telepon sudah terdaftar
    const existingPhone = await prisma.customers.findFirst({
      where: { phone },
    });

    if (existingPhone) {
      return errorResponse(res, "Phone number already registered", 409);
    }

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Transaction
    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.users.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: UserRole.CUSTOMER,
        },
      });

      const newCustomer = await tx.customers.create({
        data: {
          user_id: newUser.id,
          name,
          phone,
        },
      });

      return { newUser, newCustomer };
    });

    // 6. Generate JWT
    const token = jwt.sign(
      {
        id: result.newUser.id,
        email: result.newUser.email,
        role: result.newUser.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" },
    );

    return successResponse(
      res,
      {
        token,
        user: {
          id: result.newUser.id,
          name: result.newUser.name,
          email: result.newUser.email,
          role: result.newUser.role,
          customer: {
            id: result.newCustomer.id,
            phone: result.newCustomer.phone,
          },
        },
        customer: {
          id: result.newCustomer.id,
          phone: result.newCustomer.phone,
        },
      },
      "Register successful",
      201,
    );
  } catch (err) {
    next(err);
  }
};

export const me = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      return errorResponse(res, "Unauthorized", 401);
    }

    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            phone: true,
          },
        },
      },
    });

    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    return successResponse(res, user, "Get profile successful");
  } catch (err) {
    next(err);
  }
};

export const customerLogin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return errorResponse(res, "Validation failed", 400, errors);
    }

    const { email, password } = parsed.data;

    const user = await prisma.users.findUnique({
      where: { email },
      include: {
        customer: {
          select: {
            id: true,
            phone: true,
          },
        },
      },
    });

    if (!user) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    if (user.role !== UserRole.CUSTOMER) {
      return errorResponse(
        res,
        "This account is not registered as a customer",
        403,
      );
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      {
        expiresIn: "1d",
      },
    );

    return successResponse(
      res,
      {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customer: user.customer
            ? {
                id: user.customer.id,
                phone: user.customer.phone,
              }
            : null,
        },
      },
      "Customer login successful",
    );
  } catch (err) {
    next(err);
  }
};
