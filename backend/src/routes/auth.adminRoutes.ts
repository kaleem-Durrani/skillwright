import express from "express";
import {
  loginAdmin,
  logoutAdmin,
  signupAdmin,
} from "../controllers/auth.adminController.js";
import { loginValidation } from "../routesValidation/auth.adminRoutes.validation.js";
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";

const router = express.Router();

router.post("/signup", signupAdmin);
router.post("/login", loginValidation, loginAdmin);
router.post("/logout", protectAdminRoute, logoutAdmin);

export default router;
