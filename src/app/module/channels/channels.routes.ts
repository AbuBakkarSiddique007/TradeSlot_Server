import { Router } from "express";
import { channelsController } from "./channels.controller";

const router = Router();

// Webchat
router.post("/webchat/message", channelsController.receiveWebchat);

// WhatsApp
router.post("/whatsapp/message", channelsController.receiveWhatsApp);

export const channelsRoutes = router;