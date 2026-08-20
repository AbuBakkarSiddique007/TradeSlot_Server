import { Request, Response, NextFunction } from "express";
import { getChannels } from "../../services/channels";
import { ingestInboundMessage } from "../../services/inbox/inbound.service";
import { handleIncomingMessage } from "../../services/bookingEngine";

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
    const adapter = getChannels().whatsapp;
    const normalized = await adapter.normalize(req);

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
  receiveWebchat,
  receiveWhatsApp,
};
