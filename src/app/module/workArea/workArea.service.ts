import { prisma } from "../../lib/prisma";
import { ISetWorkAreaInput } from "./workArea.interface";

const normalizeDate = (dateStr?: string): Date => {
  if (dateStr) {
    const date = new Date(dateStr);

    if (isNaN(date.getTime())) {
      throw new Error("Invalid date format. Please use YYYY-MM-DD.");
    }

    return new Date(date.toISOString().split("T")[0]);
  }

  const today = new Date();

  return new Date(today.toISOString().split("T")[0]);
};


const setWorkArea = async (traderId: string, data: ISetWorkAreaInput) => {
  const targetDate = normalizeDate(data.date);

  const workArea = await prisma.workArea.upsert({
    where: {
      traderId_date: {
        traderId,
        date: targetDate,
      },
    },
    update: {
      zoneName: data.zoneName.trim(),
      postalCodes: data.postalCodes || [],
    },
    create: {
      traderId,
      date: targetDate,
      zoneName: data.zoneName.trim(),
      postalCodes: data.postalCodes || [],
    },
  });

  return {
    id: workArea.id,
    traderId: workArea.traderId,
    date: workArea.date.toISOString().split("T")[0],
    zoneName: workArea.zoneName,
    postalCodes: workArea.postalCodes,
    createdAt: workArea.createdAt,
    updatedAt: workArea.updatedAt,
  };
};

const getWorkAreaByDate = async (traderId: string, dateStr?: string) => {
  const targetDate = normalizeDate(dateStr);

  const workArea = await prisma.workArea.findUnique({
    where: {
      traderId_date: {
        traderId,
        date: targetDate,
      },
    },
  });

  if (!workArea) {
    return null;
  }

  return {
    id: workArea.id,
    traderId: workArea.traderId,
    date: workArea.date.toISOString().split("T")[0],
    zoneName: workArea.zoneName,
    postalCodes: workArea.postalCodes,
    createdAt: workArea.createdAt,
    updatedAt: workArea.updatedAt,
  };
};

export const workAreaService = {
  setWorkArea,
  getWorkAreaByDate,
};
