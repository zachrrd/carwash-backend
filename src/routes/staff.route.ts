import { Router } from "express";

import {
  getAllStaffs,
  getDeletedStaffs,
  getStaffById,
  createStaff,
  updateStaff,
  restoreStaff,
  deleteStaff,
} from "../controllers/staff.controller";

import { authenticateToken } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getAllStaffs,
);
router.get(
  "/trash/list",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getDeletedStaffs,
);
router.get(
  "/:id",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  getStaffById,
);
router.post("/", authenticateToken, authorizeRoles("ADMIN"), createStaff);
router.put("/:id", authenticateToken, authorizeRoles("ADMIN"), updateStaff);
router.patch(
  "/:id/restore",
  authenticateToken,
  authorizeRoles("ADMIN", "CASHIER"),
  restoreStaff,
);
router.delete("/:id", authenticateToken, authorizeRoles("ADMIN"), deleteStaff);

export default router;
