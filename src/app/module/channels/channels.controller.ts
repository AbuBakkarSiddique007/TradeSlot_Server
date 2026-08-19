import { Request, Response, NextFunction } from "express";
import { getChannels } from "../../services/channels";
import { ingestInboundMessage } from "../../services/inbox/inbound.service";

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

    const replyText = bookingEngineReply();

    return res.status(200).json({
      success: true,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      reply: { text: replyText },
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

    const replyText = bookingEngineReply();

    await adapter.sendReply(normalized.senderRef, { text: replyText });

    return res.status(200).json({
      success: true,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      reply: { text: replyText },
    });
  } catch (error) {
    return next(error);
  }
};


const bookingEngineReply = (): string => {
  return "Thanks! We've received your message and will be in touch shortly.";
};

export const channelsController = {
  receiveWebchat,
  receiveWhatsApp,
};