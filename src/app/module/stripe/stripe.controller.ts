import { Request, Response, NextFunction } from "express";
import { IAuthRequest } from "../../middleware/auth.middleware";
import {
  createTraderOnboardingLink,
  isStripeConfigured,
  StripeNotConfiguredError,
} from "../../services/stripeService";

const startOnboarding = async (
  req: IAuthRequest,
  res: Response,
  next: NextFunction,
) => {

  try {
    const traderId = req.trader?.traderId;

    if (!traderId) {
      return res.status(401).json({
        success: false,
        message: "Trader authentication required.",
      });
    }

    if (!isStripeConfigured()) {
      return res.status(503).json({
        success: false,
        message:
          "Stripe is not configured on this server (STRIPE_SECRET_KEY missing or placeholder).",
      });
    }

    const result = await createTraderOnboardingLink(traderId);
    return res.status(200).json({
      success: true,
      url: result.url,
      accountId: result.accountId,
      alreadyOnboarded: result.alreadyOnboarded,
    });

  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return res.status(503).json({ success: false, message: error.message });
    }
    
    return next(error);
  }
};

const stripeReturn = async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message:
      "Stripe onboarding return URL. The trader's status will update via webhook.",
  });
};

const stripeRefresh = async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Stripe onboarding refresh URL. Restart onboarding.",
  });
};

export const stripeController = {
  startOnboarding,
  stripeReturn,
  stripeRefresh,
};