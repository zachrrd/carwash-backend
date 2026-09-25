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
import { uploadServiceImage } from "../middlewares/upload.middleware";

const router = Router();

router.get("/public", getAllServices);
router.get("/public/:id", getServiceById);

router.get("/",authenticateToken, authorizeRoles("ADMIN", "CASHIER", "CUSTOMER"), getAllServices);
router.get("/trash/list", authenticateToken, authorizeRoles("ADMIN", "CASHIER"), getDeletedServices);
router.get("/:id",authenticateToken, authorizeRoles("ADMIN", "CASHIER", 'CUSTOMER'), getServiceById);
router.post("/",authenticateToken, authorizeRoles("ADMIN"), uploadServiceImage.single("image"), createService);
router.put("/:id",authenticateToken, authorizeRoles("ADMIN"),uploadServiceImage.single("image"), updateService);
router.patch("/:id/restore", authenticateToken, authorizeRoles("ADMIN", "CASHIER"), restoreService);
router.delete("/:id",authenticateToken, authorizeRoles("ADMIN"), deleteService);

export default router;