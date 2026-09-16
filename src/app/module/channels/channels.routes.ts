import { Router } from "express";
import { channelsController } from "./channels.controller";

const router = Router();

// Log any request that reaches the channels mount, even unmatched ones.
router.use((req, _res, next) => {
    const { referer, "user-agent": ua, "x-hub-signature-256": sig, "content-type": ct } = req.headers;
    const rawLen = req.headers["content-length"] ?? "-";
    const detail =
        `${req.method} ${req.originalUrl} ct=${String(ct ?? "-")} len=${String(rawLen)} ` +
        `ua=${String(ua ?? "-").slice(0, 60)} sig=${String(sig ?? "-").slice(0, 16)} ` +
        `ref=${String(referer ?? "-").slice(0, 40)}`;
    void channelsController.logWebhook("CAPTURE", detail);
    next();
});

// Webchat
router.post("/webchat/message", channelsController.receiveWebchat);

// WhatsApp
router.get("/whatsapp/message", channelsController.verifyWhatsAppWebhook);
router.post("/whatsapp/message", channelsController.receiveWhatsApp);

export const channelsRoutes = router;