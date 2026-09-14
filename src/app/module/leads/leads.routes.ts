import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { leadsController } from "./leads.controller";

const router = Router();

router.use(authMiddleware.requireTraderAuth);
router.get("/", leadsController.getLeads);

export const leadsRoutes = router;