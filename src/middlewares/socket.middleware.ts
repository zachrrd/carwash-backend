import { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { UserRole } from "../../generated/prisma/enums";

interface JwtPayload {
  id: number;
  email: string;
  role: UserRole;
}

export interface AuthenticatedSocket extends Socket {
  user: JwtPayload;
}

export const authenticateSocket = (
  socket: Socket,
  next: (err?: Error) => void,
) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Access token is required"));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string,
    ) as JwtPayload;

    (socket as AuthenticatedSocket).user = decoded;

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
};
