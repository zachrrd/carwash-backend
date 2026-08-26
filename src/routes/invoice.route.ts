import { Router } from "express";
import { getInvoiceById } from "../controllers/invoice.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/:id", authenticateToken, getInvoiceById);

export default router;