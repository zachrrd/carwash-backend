import { Router } from "express";

import {
    getAllCustomers,
    getDeletedCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    restoreCustomer,
    deleteCustomer,
} from "../controllers/customer.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get("/",authenticateToken, authorizeRoles("Admin", "Cashier"), getAllCustomers);
router.get("/trash/list", authenticateToken, authorizeRoles("Admin", "Cashier"), getDeletedCustomers);
router.get("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), getCustomerById);
router.post("/",authenticateToken, authorizeRoles("Admin", "Cashier"), createCustomer);
router.put("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), updateCustomer);
router.patch("/:id/restore", authenticateToken, authorizeRoles("Admin", "Cashier"), restoreCustomer);
router.delete("/:id",authenticateToken, authorizeRoles("Admin", "Cashier"), deleteCustomer);

export default router;