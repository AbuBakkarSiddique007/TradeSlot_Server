/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";

const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, businessName, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const result = await authService.registerTrader({
      name,
      email,
      password,
      businessName,
      phone,
    });

    return res.status(201).json({
      success: true,
      message: "Trader registered successfully.",
      data: result,
    });

  } catch (error: any) {
    if (error.message && error.message.includes("already registered")) {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  }
};

const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const result = await authService.loginTrader({ email, password });

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      data: result,
    });

  } catch (error: any) {
    if (error.message && error.message.includes("Invalid email or password")) {
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }
    return next(error);
  }
};

export const authController = {
  register,
  login,
};