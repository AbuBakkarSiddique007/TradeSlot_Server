import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { availabilityController } from "./availability.controller";

const router = Router();

router.use(authMiddleware.requireTraderAuth);

router.get("/", availabilityController.getAvailability);

export const availabilityRoutes = router;