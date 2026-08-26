import { Router } from "express";
import {
    getAllOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
} from "../controllers/order.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();



router.get("/", authenticateToken, authorizeRoles("Admin", "Cashier"), getAllOrders);
router.get("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), getOrderById);
router.post("/",authenticateToken, authorizeRoles("Admin", "Cashier"), createOrder);
router.put("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), updateOrder);
router.delete("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), deleteOrder);

export default router;