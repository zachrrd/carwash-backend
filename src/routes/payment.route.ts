import { Router } from "express";

import {
  createPayment,
  getPayments,
  getPaymentByOrder,
  createMidtransPayment,
  verifyMidtransPayment,
  midtransNotification,
} from "../controllers/payment.controller";

import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();


router.post(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  createPayment,
);

router.post("/midtrans/:orderId", authenticateToken, createMidtransPayment);

router.post(
  "/midtrans/:orderId/verify",
  authenticateToken,
  verifyMidtransPayment,
);

router.post("/notification", midtransNotification);

router.post("/midtrans/notification", midtransNotification);


router.get(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getPayments,
);

router.get(
  "/order/:order_id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getPaymentByOrder,
);

export default router;
