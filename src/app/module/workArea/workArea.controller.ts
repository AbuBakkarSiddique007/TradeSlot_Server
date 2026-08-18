/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response, NextFunction } from "express";
import { IAuthRequest } from "../../middleware/auth.middleware";
import { workAreaService } from "./workArea.service";

const setWorkArea = async (req: IAuthRequest, res: Response, next: NextFunction) => {
  try {
    const traderId = req.trader?.traderId;

    if (!traderId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Trader not identified.",
      });
    }

    const { zoneName, date, postalCodes } = req.body;

    if (!zoneName || typeof zoneName !== "string" || !zoneName.trim()) {
      return res.status(400).json({
        success: false,
        message: "zoneName is required.",
      });
    }

    const result = await workAreaService.setWorkArea(traderId, {
      zoneName,
      date,
      postalCodes,
    });

    return res.status(200).json({
      success: true,
      message: "Daily work area set successfully.",
      data: result,
    });

  } catch (error: any) {

    if (error.message && error.message.includes("Invalid date format")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return next(error);
  }
};

const getWorkArea = async (req: IAuthRequest, res: Response, next: NextFunction) => {
  try {
    const traderId = req.trader?.traderId;

    if (!traderId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Trader not identified.",
      });
    }

    const dateQuery = req.query.date as string | undefined;

    const result = await workAreaService.getWorkAreaByDate(traderId, dateQuery);

    if (!result) {
      return res.status(200).json({
        success: true,
        message: "No work area set for this date.",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error: any) {
    if (error.message && error.message.includes("Invalid date format")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return next(error);
  }
};

export const workAreaController = {
  setWorkArea,
  getWorkArea,
};
