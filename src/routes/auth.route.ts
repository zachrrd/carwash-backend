import { Router } from "express";

import { login, register, me, customerLogin } from "../controllers/auth.controller";
import { authenticateToken } from "../middlewares/auth.middleware";

const router = Router();

router.post("/login", login);
router.post("/register", register);
router.post("/customer/login", customerLogin);
router.get("/me", authenticateToken, me);

export default router;