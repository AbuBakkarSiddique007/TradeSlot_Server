import { Router } from "express";
import { authRoutes } from "../module/auth/auth.routes";
import { workAreaRoutes } from "../module/workArea/workArea.routes";
import { availabilityRoutes } from "../module/availability/availability.routes";
import { channelsRoutes } from "../module/channels/channels.routes";
import { stripeRoutes } from "../module/stripe/stripe.routes";
import { leadsRoutes } from "../module/leads/leads.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/trader/work-area", workAreaRoutes);
router.use("/trader/availability", availabilityRoutes);
router.use("/trader/stripe", stripeRoutes);
router.use("/trader/leads", leadsRoutes);
router.use("/channels", channelsRoutes);

export const indexRoute = router;