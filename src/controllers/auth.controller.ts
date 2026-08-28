import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma";
import { errorResponse, successResponse } from "../utils/response";
import { AuthRequest } from "../middlewares/auth.middleware";

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, "Email and password are required", 400);
    }

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
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return errorResponse(res, "Name, email, and password are required", 400);
    }

    const existingUser = await prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      return errorResponse(res, "Email already registered", 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.users.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: "Customer",
        },
      });

      const newCustomer = await tx.customers.create({
        data: {
          user_id: newUser.id,
          name,
          phone: phone || null,
        },
      });

      return { newUser, newCustomer };
    });

    const token = jwt.sign(
      {
        id: result.newUser.id,
        email: result.newUser.email,
        role: result.newUser.role,
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
          id: result.newUser.id,
          name: result.newUser.name,
          email: result.newUser.email,
          role: result.newUser.role,
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
        staff: {
          select: {
            id: true,
            phone: true,
            status: true,
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