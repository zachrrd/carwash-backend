import { Router } from "express";
import {
  getAllVehicles,
  getDeletedVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  restoreVehicle,
  deleteVehicle,
  getMyVehicles,
  createVehicleByCustomer,
  updateVehicleByCustomer,
  deleteVehicleByCustomer,
} from "../controllers/vehicle.controller";
import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get("/my", authenticateToken, authorizeRoles("CUSTOMER"), getMyVehicles);
router.post(
  "/my",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  createVehicleByCustomer,
);

router.put(
  "/my/:id",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  updateVehicleByCustomer,
);

router.delete(
  "/my/:id",
  authenticateToken,
  authorizeRoles("CUSTOMER"),
  deleteVehicleByCustomer,
);

router.get(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getAllVehicles,
);
router.get(
  "/trash/list",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getDeletedVehicles,
);
router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getVehicleById,
);
router.post(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  createVehicle,
);
router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  updateVehicle,
);
router.patch(
  "/:id/restore",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  restoreVehicle,
);
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  deleteVehicle,
);

export default router;
