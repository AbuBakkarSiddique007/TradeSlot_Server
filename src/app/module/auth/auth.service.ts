import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import {
  IAuthResponse,
  ILoginTraderInput,
  IRegisterTraderInput,
  ITraderAuthPayload,
} from "./auth.interface";

const JWT_SECRET = process.env.JWT_SECRET || "tradeslot_fallback_secret";
const SALT_ROUNDS = 10;

const registerTrader = async (data: IRegisterTraderInput): Promise<IAuthResponse> => {
  const normalizedEmail = data.email.trim().toLowerCase();


  const existingTrader = await prisma.trader.findUnique({
    where: {
      email: normalizedEmail
    },
  });

  if (existingTrader) {
    throw new Error("A trader with this email is already registered.");
  }

  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const businessName = data.businessName?.trim() || `${data.name}'s Trade Services`;

  const newBusiness = await prisma.business.create({
    data: {
      name: businessName,
      traders: {
        create: {
          name: data.name.trim(),
          email: normalizedEmail,
          passwordHash,
          phone: data.phone?.trim() || null,
        },
      },
    },
    include: {
      traders: true,
    },
  });

  const createdTrader = newBusiness.traders[0];


  const payload: ITraderAuthPayload = {
    traderId: createdTrader.id,
    email: createdTrader.email,
    businessId: createdTrader.businessId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  return {
    token,
    trader: {
      id: createdTrader.id,
      name: createdTrader.name,
      email: createdTrader.email,
      phone: createdTrader.phone,
      businessId: createdTrader.businessId,
      businessName: newBusiness.name,
      stripeOnboarded: createdTrader.stripeOnboarded,
      workingHoursStart: createdTrader.workingHoursStart,
      workingHoursEnd: createdTrader.workingHoursEnd,
      defaultBufferTime: createdTrader.defaultBufferTime,
      defaultJobDuration: createdTrader.defaultJobDuration,
    },
  };
};

const loginTrader = async (data: ILoginTraderInput): Promise<IAuthResponse> => {
  const normalizedEmail = data.email.trim().toLowerCase();

  const trader = await prisma.trader.findUnique({
    where: { email: normalizedEmail },
    include: { business: true },
  });

  if (!trader) {
    throw new Error("Invalid email or password.");
  }


  const isPasswordValid = await bcrypt.compare(data.password, trader.passwordHash);

  if (!isPasswordValid) {
    throw new Error("Invalid email or password.");
  }

  const payload: ITraderAuthPayload = {
    traderId: trader.id,
    email: trader.email,
    businessId: trader.businessId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  return {
    token,
    trader: {
      id: trader.id,
      name: trader.name,
      email: trader.email,
      phone: trader.phone,
      businessId: trader.businessId,
      businessName: trader.business.name,
      stripeOnboarded: trader.stripeOnboarded,
      workingHoursStart: trader.workingHoursStart,
      workingHoursEnd: trader.workingHoursEnd,
      defaultBufferTime: trader.defaultBufferTime,
      defaultJobDuration: trader.defaultJobDuration,
    },
  };
};

export const authService = {
  registerTrader,
  loginTrader,
};
