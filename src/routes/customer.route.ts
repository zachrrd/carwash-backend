import { Router } from "express";

import {
    getAllCustomers,
    getDeletedCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    restoreCustomer,
    deleteCustomer,
    createCustomerAccount,
} from "../controllers/customer.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get("/",authenticateToken, authorizeRoles("ADMIN", "CASHIER"), getAllCustomers);
router.get("/trash/list", authenticateToken, authorizeRoles("ADMIN", "CASHIER"), getDeletedCustomers);
router.get("/:id",authenticateToken, authorizeRoles("ADMIN", "CASHIER"), getCustomerById);
router.post("/",authenticateToken, authorizeRoles("ADMIN", "CASHIER"), createCustomer);
router.put("/:id",authenticateToken, authorizeRoles("ADMIN", "CASHIER"), updateCustomer);
router.patch("/:id/restore", authenticateToken, authorizeRoles("ADMIN", "CASHIER"), restoreCustomer);
router.delete("/:id",authenticateToken, authorizeRoles("ADMIN", "CASHIER"), deleteCustomer);
router.post( "/:id/account", authenticateToken, authorizeRoles("ADMIN"), createCustomerAccount);
export default router;