import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { stripeController } from "./stripe.controller";

const router = Router();

router.get("/return", stripeController.stripeReturn);
router.get("/refresh", stripeController.stripeRefresh);

router.use(authMiddleware.requireTraderAuth);

router.post("/onboard", stripeController.startOnboarding);

export const stripeRoutes = router;