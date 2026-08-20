import { Request, Response, NextFunction } from "express";
import { handleStripeEvent, verifyWebhookSignature } from "../../services/stripeService";

const stripeWebhookHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const signature = req.headers["stripe-signature"];

    if (!signature || typeof signature !== "string") {
      return res.status(400).json({
        success: false,
        message: "Missing Stripe-Signature header.",
      });
    }

    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({
        success: false,
        message: "Webhook body must be raw bytes (configure express.raw).",
      });
    }

    const event = verifyWebhookSignature(rawBody, signature);
    await handleStripeEvent(event);

    return res.status(200).json({ received: true, type: event.type });

  } catch (error) {

    if (error instanceof Error && error.message.includes("signature")) {
      return res.status(400).json({
        success: false,
        message: `Webhook signature verification failed: ${error.message}`,
      });
    }
    
    return next(error);
  }
};

export const stripeWebhookController = {
  stripeWebhookHandler,
};