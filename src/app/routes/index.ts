import { Router } from "express";
import { authRoutes } from "../module/auth/auth.routes";
import { workAreaRoutes } from "../module/workArea/workArea.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/trader/work-area", workAreaRoutes);

export const indexRoute = router;