import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters")
    .max(255, "Name is too long"),

  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email format")
    .max(255),

  password: z
    .string()
    .min(1, "Password is required")
    .min(6, "Password must be at least 6 characters")
    .max(100),

  phone: z
    .string()
    .min(1, "Phone is required")
    .min(10, "Phone must be at least 10 characters")
    .max(20, "Phone is too long")
    .regex(/^[0-9+\-\s]+$/, "Phone number contains invalid characters"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email format"),

  password: z
    .string()
    .min(1, "Password is required")
    .min(6, "Password must be at least 6 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;