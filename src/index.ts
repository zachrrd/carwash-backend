import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import "dotenv/config";
import { Server } from "socket.io";

import serviceRoute from "./routes/service.route";
import customerRoute from "./routes/customer.route";
import vehicleRoute from "./routes/vehicle.route";
import staffRoute from "./routes/staff.route";
import orderRoute from "./routes/order.route";
import { errorHandler } from "./middlewares/error.middleware";
import {
  authenticateSocket,
  AuthenticatedSocket,
} from "./middlewares/socket.middleware";
import authRoute from "./routes/auth.route";
import paymentRoute from "./routes/payment.route";
import invoiceRoute from "./routes/invoice.route";
import { prisma } from "./config/prisma";
import { UserRole } from "../generated/prisma/enums";
import { setSocketIO } from "./config/socket";

const app = express();

app.use(cors());

app.use(express.json());

app.get(["/", "/health", "/api/health"], (_req, res) => {
  res.json({
    status: "ok",
    message: "Carwash Backend API is running",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoute);
app.use("/api/services", serviceRoute);
app.use("/api/customers", customerRoute);
app.use("/api/vehicles", vehicleRoute);
app.use("/api/staffs", staffRoute);
app.use("/api/orders", orderRoute);
app.use("/api/payments", paymentRoute);
app.use("/payments", paymentRoute);
app.use("/api/invoices", invoiceRoute);
app.use("/api/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

setSocketIO(io);

io.use(authenticateSocket);

io.on("connection", (socket) => {
  const authSocket = socket as AuthenticatedSocket;

  console.log("Socket connected:", socket.id);
  console.log("User:", authSocket.user);

  if (
    authSocket.user?.role === UserRole.ADMIN ||
    authSocket.user?.role === UserRole.CASHIER
  ) {
    void socket.join("orders");
    console.log(`Admin/Cashier ${authSocket.user.id} auto-joined orders room`);
  }

  socket.on("join-order", async (orderId: number) => {
    try {
      const parsedOrderId = Number(orderId);
      if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) {
        socket.emit("order-room-error", {
          message: "Invalid order id",
        });
        return;
      }

      // ADMIN & CASHIER can join any order room
      if (
        authSocket.user.role === UserRole.ADMIN ||
        authSocket.user.role === UserRole.CASHIER
      ) {
        const order = await prisma.orders.findUnique({
          where: {
            id: parsedOrderId,
          },
          select: {
            id: true,
          },
        });

        if (!order) {
          socket.emit("order-room-error", {
            message: "Order not found",
          });
          return;
        }

        const room = `order:${order.id}`;
        await socket.join(room);
        console.log(`Staff/Admin ${authSocket.user.id} joined room ${room}`);

        socket.emit("order-room-joined", {
          orderId: order.id,
          room,
        });
        return;
      }

      if (authSocket.user.role !== UserRole.CUSTOMER) {
        socket.emit("order-room-error", {
          message: "Only customers can join order rooms",
        });

        return;
      }

      const customer = await prisma.customers.findUnique({
        where: {
          user_id: authSocket.user.id,
        },
      });

      if (!customer) {
        socket.emit("order-room-error", {
          message: "Customer profile not found",
        });

        return;
      }

      const order = await prisma.orders.findUnique({
        where: {
          id: parsedOrderId,
        },
        select: {
          id: true,
          customer_id: true,
        },
      });

      if (!order) {
        socket.emit("order-room-error", {
          message: "Order not found",
        });

        return;
      }

      if (order.customer_id !== customer.id) {
        socket.emit("order-room-error", {
          message: "You are not allowed to join this order room",
        });

        return;
      }

      const room = `order:${order.id}`;

      await socket.join(room);

      console.log(`Customer ${customer.id} joined room ${room}`);

      socket.emit("order-room-joined", {
        orderId: order.id,
        room,
      });
    } catch (error) {
      console.error("Join order room error:", error);

      socket.emit("order-room-error", {
        message: "Failed to join order room",
      });
    }
  });

  socket.on("leave-order", async (orderId: number) => {
    try {
      const room = `order:${orderId}`;
      await socket.leave(room);
      console.log(`Socket ${socket.id} left room ${room}`);
    } catch (error) {
      console.error("Leave order room error:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server Running on port ${PORT}`);
  console.log("Socket.IO is ready");
});
