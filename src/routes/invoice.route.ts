import { Router } from "express";
import { getInvoiceById } from "../controllers/invoice.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER", "CUSTOMER"),
  getInvoiceById,
);

export default router;
