import { Router } from "express";

import {
    getAllServices,
    getDeletedServices,
    getServiceById,
    createService,
    updateService,
    restoreService,
    deleteService,
} from "../controllers/service.controller";

import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get("/public", getAllServices);
router.get("/public/:id", getServiceById);

router.get("/",authenticateToken, authorizeRoles("Admin", "Cashier", "Customer"), getAllServices);
router.get("/trash/list", authenticateToken, authorizeRoles("Admin", "Cashier"), getDeletedServices);
router.get("/:id",authenticateToken, authorizeRoles("Admin", "Cashier", 'Customer'), getServiceById);
router.post("/",authenticateToken, authorizeRoles("Admin"), createService);
router.put("/:id",authenticateToken, authorizeRoles("Admin"), updateService);
router.patch("/:id/restore", authenticateToken, authorizeRoles("Admin", "Cashier"), restoreService);
router.delete("/:id",authenticateToken, authorizeRoles("Admin"), deleteService);

export default router;