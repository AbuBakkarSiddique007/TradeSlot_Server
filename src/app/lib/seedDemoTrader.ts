import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { prisma } from "./prisma";
import { isStripeConfigured } from "../services/stripeService";
import { addMinutes, businessDay, utcDayKey } from "../services/time";

const DEMO_EMAIL = "trader.ctg@tradeslot.com";
const DEMO_PASSWORD = "password123";
const DEMO_NAME = "Demo Trader";
const DEMO_BUSINESS_NAME = "TradeSlot Demo";
const DEMO_ZONE_NAME = "Chattogram";
const DEMO_POSTAL_CODES = ["4000", "4100", "4210", "4001", "4003"];

const stripeClient: Stripe | null = isStripeConfigured()
  ? new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2026-07-29.dahlia",
    })
  : null;

const ensureWorkArea = async (traderId: string, day: Date) => {
  const dateKey = utcDayKey(day);
  await prisma.workArea.upsert({
    where: { traderId_date: { traderId, date: dateKey } },
    update: { zoneName: DEMO_ZONE_NAME, postalCodes: DEMO_POSTAL_CODES },
    create: {
      traderId,
      date: dateKey,
      zoneName: DEMO_ZONE_NAME,
      postalCodes: DEMO_POSTAL_CODES,
    },
  });
};

const completeDemoStripeAccount = async (
  traderId: string,
  email: string,
): Promise<boolean> => {
  if (!stripeClient) return false;

  const trader = await prisma.trader.findUnique({
    where: { id: traderId },
    select: { stripeAccountId: true },
  });

  let accountId = trader?.stripeAccountId;
  if (!accountId) {
    const account = await stripeClient.accounts.create({
      type: "express",
      email,
      country: "US",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;

    await stripeClient.accounts.update(accountId, {
      individual: {
        first_name: "TradeSlot",
        last_name: "Demo",
        email,
        phone: "+8801631407571",
        dob: { day: 1, month: 1, year: 1990 },
        address: {
          line1: "1 Market Street",
          city: "San Francisco",
          state: "CA",
          postal_code: "94105",
          country: "US",
        },
        ssn_last_4: "0000",
      },
      business_profile: {
        mcc: "7399",
        url: process.env.CLIENT_BASE_URL ?? "https://trade-slot-theta.vercel.app",
        name: DEMO_BUSINESS_NAME,
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "127.0.0.1",
        user_agent: "TradeSlot Demo Seed",
      },
      external_account: "tok_visa",
    });

    await prisma.trader.update({
      where: { id: traderId },
      data: { stripeAccountId: accountId },
    });
  }

  const account = await stripeClient.accounts.retrieve(accountId);
  const onboarded = Boolean(
    account.charges_enabled && account.payouts_enabled && account.details_submitted,
  );

  await prisma.trader.update({
    where: { id: traderId },
    data: { stripeOnboarded: onboarded },
  });

  return onboarded;
};

const seedWorkAreasForEnginePick = async () => {
  const enginePick = await prisma.trader.findFirst({
    where: { stripeOnboarded: true, stripeAccountId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!enginePick) return;

  await ensureWorkArea(enginePick.id, businessDay());
  await ensureWorkArea(enginePick.id, addMinutes(businessDay(), 24 * 60));
};

export const seedDemoTrader = async (): Promise<void> => {
  const email = DEMO_EMAIL;
  const today = businessDay();
  const tomorrow = addMinutes(today, 24 * 60);

  let trader = await prisma.trader.findUnique({ where: { email } });

  if (!trader) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const business = await prisma.business.create({
      data: {
        name: DEMO_BUSINESS_NAME,
        traders: {
          create: {
            name: DEMO_NAME,
            email,
            passwordHash,
            phone: null,
            workingHoursStart: "08:00",
            workingHoursEnd: "18:00",
            defaultJobDuration: 60,
            defaultBufferTime: 30,
          },
        },
      },
      include: { traders: true },
    });
    trader = business.traders[0];
  }

  if (trader.stripeAccountId) {
    const account = await stripeClient?.accounts.retrieve(trader.stripeAccountId);
    if (account) {
      const onboarded = Boolean(
        account.charges_enabled && account.payouts_enabled && account.details_submitted,
      );
      if (onboarded && !trader.stripeOnboarded) {
        await prisma.trader.update({
          where: { id: trader.id },
          data: { stripeOnboarded: true },
        });
      }
    }
  } else {
    try {
      await completeDemoStripeAccount(trader.id, email);
    } catch (error) {
      console.warn("Demo Stripe onboarding skipped:", error);
    }
  }

  await ensureWorkArea(trader.id, today);
  await ensureWorkArea(trader.id, tomorrow);
  await seedWorkAreasForEnginePick();

  console.log(`Demo trader ready → ${DEMO_EMAIL}`);
};

export const DEMO_TRADER_LOGIN = {
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
} as const;