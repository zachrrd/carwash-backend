import { Router } from "express";
import {
  getAllVehicles,
  getDeletedVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  restoreVehicle,
  deleteVehicle,
} from "../controllers/vehicle.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  getAllVehicles,
);
router.get(
  "/trash/list",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  getDeletedVehicles,
);
router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  getVehicleById,
);
router.post(
  "/",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  createVehicle,
);
router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  updateVehicle,
);
router.patch(
  "/:id/restore",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  restoreVehicle,
);
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("Admin", "Cashier"),
  deleteVehicle,
);

export default router;
