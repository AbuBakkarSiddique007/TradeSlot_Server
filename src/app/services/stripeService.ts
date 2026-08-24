/* eslint-disable @typescript-eslint/no-explicit-any */
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { PaymentStatus, BookingStatus } from "../../generated/prisma/enums";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const CLIENT_BASE_URL = process.env.CLIENT_BASE_URL ?? "http://localhost:3000";
const FLAT_FEE_GBP_RAW = process.env.FLAT_BOOKING_FEE_GBP ?? "15.00";

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY in the server .env.");
    this.name = "StripeNotConfiguredError";
  }
}

export const isStripeConfigured = (): boolean => {
  return (
    STRIPE_SECRET_KEY.length > 0 &&
    !STRIPE_SECRET_KEY.includes("placeholder")
  );
};

const stripeClient: Stripe | null = isStripeConfigured()
  ? new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2026-07-29.dahlia",
  })
  : null;

const flatFeePence = (): number => {
  const n = Number(FLAT_FEE_GBP_RAW);
  if (!Number.isFinite(n) || n < 0) return 1500;
  return Math.round(n * 100);
};

const decimalFromPence = (pence: number): string => (pence / 100).toFixed(2);

export interface OnboardingLinkResult {
  url: string;
  accountId: string;
  alreadyOnboarded: boolean;
}

export const createTraderOnboardingLink = async (
  traderId: string,
): Promise<OnboardingLinkResult> => {
  if (!stripeClient) throw new StripeNotConfiguredError();

  const trader = await prisma.trader.findUniqueOrThrow({
    where: { id: traderId },
    select: {
      id: true,
      email: true,
      stripeAccountId: true,
      stripeOnboarded: true,
    },
  });

  let accountId = trader.stripeAccountId;
  if (!accountId) {
    const account = await stripeClient.accounts.create({
      type: "express",
      email: trader.email,
      country: "GB",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;
    await prisma.trader.update({
      where: { id: trader.id },
      data: { stripeAccountId: accountId },
    });
  }

  if (trader.stripeOnboarded) {
    return {
      url: `${CLIENT_BASE_URL}/dashboard/stripe?stripe=already_onboarded`,
      accountId,
      alreadyOnboarded: true,
    };
  }

  const link = await stripeClient.accountLinks.create({
    account: accountId,
    refresh_url: `${CLIENT_BASE_URL}/dashboard/stripe?stripe=refresh`,
    return_url: `${CLIENT_BASE_URL}/dashboard/stripe?stripe=success`,
    type: "account_onboarding",
  });

  return { url: link.url, accountId, alreadyOnboarded: false };
};

export const syncTraderStripeStatus = async (traderId: string): Promise<boolean> => {
  if (!stripeClient) return false;
  try {
    const trader = await prisma.trader.findUnique({
      where: { id: traderId },
      select: { stripeAccountId: true, stripeOnboarded: true },
    });
    if (!trader?.stripeAccountId || trader.stripeOnboarded) {
      return trader?.stripeOnboarded ?? false;
    }

    const account = await stripeClient.accounts.retrieve(trader.stripeAccountId);
    const onboarded = Boolean(
      account.charges_enabled && account.payouts_enabled && account.details_submitted
    );

    if (onboarded) {
      await prisma.trader.update({
        where: { id: traderId },
        data: { stripeOnboarded: true },
      });
      return true;
    }
  } catch (err) {
    console.warn("Error syncing Stripe account status:", err);
  }
  return false;
};


export interface CheckoutResult {
  url: string;
  paymentId: string;
  amount: number;
  currency: string;
}

export const createBookingCheckout = async (
  bookingId: string,
): Promise<CheckoutResult> => {
  if (!stripeClient) throw new StripeNotConfiguredError();

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      trader: {
        select: {
          id: true,
          stripeAccountId: true,
          stripeOnboarded: true,
        },
      },
    },
  });

  if (!booking.trader.stripeAccountId) {
    throw new Error(
      `Trader ${booking.trader.id} has no Stripe account. Onboard the trader first.`,
    );
  }

  const amount = flatFeePence();
  const feePence = amount;
  const traderPayout = 0;

  const session = await stripeClient.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: undefined,
    client_reference_id: booking.id,
    line_items: [
      {
        price_data: {
          currency: booking.currency,
          unit_amount: amount,
          product_data: {
            name: `TradeSlot booking — ${booking.serviceDescription}`,
            description: `${booking.customerLocation} • ${booking.startTime.toISOString()}`,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: feePence,
      transfer_data: {
        destination: booking.trader.stripeAccountId,
      },
      metadata: {
        bookingId: booking.id,
        traderId: booking.trader.id,
      },
    },
    metadata: {
      bookingId: booking.id,
      traderId: booking.trader.id,
    },
    success_url: `${CLIENT_BASE_URL}/booking/success?bookingId=${booking.id}`,
    cancel_url: `${CLIENT_BASE_URL}/booking/cancelled?bookingId=${booking.id}`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout session URL.");
  }

  const payment = await prisma.payment.upsert({
    where: { bookingId: booking.id },

    update: {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      amount: decimalFromPence(amount) as any,
      applicationFeeAmount: decimalFromPence(feePence) as any,
      traderPayoutAmount: decimalFromPence(traderPayout) as any,
      currency: booking.currency,
      status: PaymentStatus.PENDING,
    },

    create: {
      bookingId: booking.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      amount: decimalFromPence(amount) as any,
      applicationFeeAmount: decimalFromPence(feePence) as any,
      traderPayoutAmount: decimalFromPence(traderPayout) as any,
      currency: booking.currency,
      status: PaymentStatus.PENDING,
    },
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      totalPrice: decimalFromPence(amount) as any,
      feeAmount: decimalFromPence(feePence) as any,
    },
  });

  return {
    url: session.url,
    paymentId: payment.id,
    amount,
    currency: booking.currency,
  };
};

export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string,
): Stripe.Event => {

  if (!stripeClient) throw new StripeNotConfiguredError();
  if (!STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET.includes("placeholder")) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }

  return stripeClient.webhooks.constructEvent(
    rawBody,
    signature,
    STRIPE_WEBHOOK_SECRET,
  );
};

export const handleStripeEvent = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const onboarded = Boolean(
        account.charges_enabled && account.payouts_enabled && account.details_submitted,
      );

      await prisma.trader.updateMany({
        where: { stripeAccountId: account.id },
        data: { stripeOnboarded: onboarded },
      });
      return;
    }

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId ?? session.client_reference_id;
      if (!bookingId) return;

      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

      await prisma.payment.updateMany({
        where: { bookingId },
        data: {
          stripePaymentIntentId: paymentIntentId,
          stripeReceiptUrl: null,
          status: PaymentStatus.SUCCEEDED,
        },
      });

      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.PAID },
      });

      await markSessionConfirmedByBooking(bookingId);
      return;
    }

    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const bookingId = intent.metadata?.bookingId;

      if (!bookingId) return;

      await prisma.payment.updateMany({
        where: { bookingId, stripePaymentIntentId: intent.id },
        data: { status: PaymentStatus.SUCCEEDED },
      });

      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.PAID },
      });

      await markSessionConfirmedByBooking(bookingId);
      return;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const bookingId = intent.metadata?.bookingId;

      if (!bookingId) return;

      await prisma.payment.updateMany({
        where: { bookingId, stripePaymentIntentId: intent.id },
        data: { status: PaymentStatus.FAILED },
      });

      return;
    }

    default:
      return;
  }
};

const markSessionConfirmedByBooking = async (bookingId: string) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customerRef: true, channelType: true },
  });

  if (!booking) return;

  await prisma.chatSession.updateMany({
    where: {
      channelType: booking.channelType,
      senderRef: booking.customerRef,
    },
    data: {
      state: "CONFIRMED" as any,
      lastInteraction: new Date(),
    },
  });
};