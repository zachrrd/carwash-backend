import { Router } from "express";

import {
  getAllOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
  completeOrder,
  updateOrderStatus,
  cancelOrderByAdmin,
  createOrderByCustomer,
  getMyOrders,
  cancelOrderByCustomer,
} from "../controllers/order.controller";

import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

// ==================== CUSTOMER ====================

router.post(
  "/customer",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  createOrderByCustomer,
);

router.get(
  "/customer/my-orders",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  getMyOrders,
);

router.patch(
  "/customer/:id/cancel",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  cancelOrderByCustomer,
);

// ==================== ADMIN / CASHIER ====================

router.get(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getAllOrders,
);

router.post(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  createOrder,
);

router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  updateOrder,
);

router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  deleteOrder,
);

router.patch(
  "/:id/cancel",
  authenticateToken,
  authorizeRoles("ADMIN"),
  cancelOrderByAdmin,
);

router.patch(
  "/:id/complete",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  completeOrder,
);

router.patch(
  "/:id/status",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  updateOrderStatus,
);

// ==================== SHARED ====================

router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER", "CUSTOMER"),
  getOrderById,
);

export default router;