import { Request, Response, NextFunction } from "express";
import { getChannels } from "../../services/channels";
import { ingestInboundMessage } from "../../services/inbox/inbound.service";
import { handleIncomingMessage } from "../../services/bookingEngine";

const WEBHOOK_DEBUG_LOG = "/tmp/tradeslot-wa-webhook.log";

async function logWebhook(kind: string, detail: string): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.appendFile(
      WEBHOOK_DEBUG_LOG,
      `${new Date().toISOString()} [${kind}] ${detail}\n`,
      "utf8",
    );
  } catch {
    /* noop */
  }
}

const verifyWhatsAppWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"] as string | undefined;
  const verifyToken = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  void logWebhook(
    "GET-VERIFY",
    `mode=${String(mode)} token=${String(verifyToken)} challenge=${String(challenge)}`,
  );

  if (
    mode === "subscribe" &&
    !!expectedToken &&
    verifyToken === expectedToken &&
    !!challenge
  ) {
    return res.status(200).type("text/plain").send(challenge);
  }

  return res.status(403).json({
    success: false,
    message: "WhatsApp webhook verification failed",
  });
};

const receiveWebchat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adapter = getChannels().webchat;
    const normalized = await adapter.normalize(req);

    if (!normalized) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload. Expected { senderRef, content }.",
      });
    }

    const ctx = await ingestInboundMessage(normalized);
    const result = await handleIncomingMessage(normalized, ctx);

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      messageId: result.messageId,
      state: result.newState,
      bookingId: result.bookingId,
      reply: result.reply,
    });
  } catch (error) {
    return next(error);
  }
};

const receiveWhatsApp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodyPreview = (req.body ? JSON.stringify(req.body) : "EMPTY").slice(0, 300);
    void logWebhook(
      "POST-INBOUND",
      `sig=${String((req.headers["x-hub-signature-256"] ?? "").slice(0, 20))}` +
        ` len=${String((bodyPreview as string).length)} body=${String(bodyPreview)}`,
    );

    const adapter = getChannels().whatsapp;
    const normalized = await adapter.normalize(req);

    void logWebhook(
      "NORMALIZED",
      `from=${String(normalized?.senderRef)} content=${String(normalized?.content)}`,
    );

    if (!normalized) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const ctx = await ingestInboundMessage(normalized);
    const result = await handleIncomingMessage(normalized, ctx);

    await adapter.sendReply(normalized.senderRef, result.reply);

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      messageId: result.messageId,
      state: result.newState,
      bookingId: result.bookingId,
      reply: result.reply,
    });
  } catch (error) {
    return next(error);
  }
};

export const channelsController = {
  logWebhook,
  verifyWhatsAppWebhook,
  receiveWebchat,
  receiveWhatsApp,
};
