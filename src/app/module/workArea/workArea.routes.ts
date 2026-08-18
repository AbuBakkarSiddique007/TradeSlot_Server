import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { workAreaController } from "./workArea.controller";

const router = Router();

// All work-area routes require trader authentication
router.use(authMiddleware.requireTraderAuth);

router.post("/", workAreaController.setWorkArea);
router.get("/", workAreaController.getWorkArea);

export const workAreaRoutes = router;
