import { Router } from "express";
import { authRoutes } from "../module/auth/auth.routes";
import { workAreaRoutes } from "../module/workArea/workArea.routes";
import { availabilityRoutes } from "../module/availability/availability.routes";
import { channelsRoutes } from "../module/channels/channels.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/trader/work-area", workAreaRoutes);
router.use("/trader/availability", availabilityRoutes);
router.use("/channels", channelsRoutes);

export const indexRoute = router;