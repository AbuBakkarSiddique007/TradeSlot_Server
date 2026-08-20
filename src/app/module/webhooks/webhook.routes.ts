import { Router, raw } from "express";
import { stripeWebhookController } from "./stripeWebhook.controller";

const router = Router();

router.post(
  "/stripe",
  raw({ type: "application/json" }),
  stripeWebhookController.stripeWebhookHandler,
);

export const webhookRoutes = router;