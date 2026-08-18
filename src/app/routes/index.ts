import { Router } from "express";
import { authRoutes } from "../module/auth/auth.routes";

const router = Router();

router.use("/auth", authRoutes);

export const indexRoute = router;