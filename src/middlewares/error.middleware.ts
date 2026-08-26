import { NextFunction, Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client";

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  console.error(err);

  // Prisma Error
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return res.status(409).json({
          success: false,
          message: "Data already exists.",
        });

      case "P2025":
        return res.status(404).json({
          success: false,
          message: "Data not found.",
        });
    }
  }

  // Error biasa
  if (err instanceof Error) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
};
