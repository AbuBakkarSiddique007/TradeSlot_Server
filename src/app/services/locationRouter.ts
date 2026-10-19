import { prisma } from "../lib/prisma";
import { utcDayKey, businessDay } from "./time";

export type LocationMatchOutcome = "IN_AREA" | "OUT_OF_AREA" | "NO_ZONE" | "UNKNOWN";

export interface LocationMatch {
  outcome: LocationMatchOutcome;
  traderId: string;
  zoneName?: string;
  reason?: string;
}

export interface ActiveCoverageInfo {
  hasActiveZone: boolean;
  zoneName?: string;
  postalCodes: string[];
  summary: string;
}

const normalizeToken = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

const zoneTokens = (zoneName: string): string[] =>
  zoneName
    .split(/[\s,]+/)
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length >= 3);

const locationMeetsZone = (location: string, zoneName: string): boolean => {
  const upper = location.toUpperCase();
  const locTokens = location
    .split(/[\s,]+/)
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length >= 3)
    .filter((w) => !["AND", "THE", "FOR", "NEAR", "POSTCODE"].includes(w));
  const zoneTokensUpper = zoneTokens(zoneName);

  if (locTokens.some((t) => zoneTokensUpper.includes(t))) return true;
  if (zoneTokensUpper.some((t) => upper.includes(t))) return true;
  return false;
};

/**
 * Returns the currently active coverage zone and postal codes.
 * Checks for today's scheduled zone first, then falls back to the most recent zone.
 */
export const getActiveCoverage = async (traderId?: string, date?: Date): Promise<ActiveCoverageInfo> => {
  const targetDate = date ? utcDayKey(date) : businessDay();

  // 1. Check trader's zone for the target date
  let workArea = traderId
    ? await prisma.workArea.findUnique({
        where: {
          traderId_date: {
            traderId,
            date: targetDate,
          },
        },
        select: { zoneName: true, postalCodes: true },
      })
    : null;

  // 2. Fallback to trader's latest set work area
  if (!workArea && traderId) {
    workArea = await prisma.workArea.findFirst({
      where: { traderId },
      orderBy: { date: "desc" },
      select: { zoneName: true, postalCodes: true },
    });
  }

  // 3. Fallback to any latest active work area in system
  if (!workArea) {
    workArea = await prisma.workArea.findFirst({
      orderBy: { date: "desc" },
      select: { zoneName: true, postalCodes: true },
    });
  }

  if (!workArea) {
    return {
      hasActiveZone: false,
      postalCodes: [],
      summary: "Nationwide coverage across Bangladesh (all regions accepted via enquiry)",
    };
  }

  const postcodesStr =
    workArea.postalCodes.length > 0
      ? ` (postcodes: ${workArea.postalCodes.join(", ")})`
      : "";

  return {
    hasActiveZone: true,
    zoneName: workArea.zoneName,
    postalCodes: workArea.postalCodes,
    summary: `${workArea.zoneName}${postcodesStr}`,
  };
};

export const matchLocationToTrader = async (
  traderId: string,
  location: string | null | undefined,
  date: Date,
): Promise<LocationMatch> => {
  const trimLocation = location?.trim();

  if (!trimLocation) {
    return { outcome: "UNKNOWN", traderId };
  }

  // 1. Try exact date match
  let workArea = await prisma.workArea.findUnique({
    where: {
      traderId_date: {
        traderId,
        date: utcDayKey(date),
      },
    },
    select: { id: true, zoneName: true, postalCodes: true },
  });

  // 2. Fallback to trader's most recently configured work area so regional coverage is retained
  if (!workArea) {
    workArea = await prisma.workArea.findFirst({
      where: { traderId },
      orderBy: { date: "desc" },
      select: { id: true, zoneName: true, postalCodes: true },
    });
  }

  // 3. Fallback to any trader's latest work area
  if (!workArea) {
    workArea = await prisma.workArea.findFirst({
      orderBy: { date: "desc" },
      select: { id: true, zoneName: true, postalCodes: true },
    });
  }

  if (!workArea) {
    return {
      outcome: "NO_ZONE",
      traderId,
      reason: "No active zone set in system.",
    };
  }

  const normLocation = normalizeToken(trimLocation);

  const postcodeMatch = workArea.postalCodes.some((pc) => {
    const normPc = normalizeToken(pc);
    if (!normPc) return false;
    return (
      normPc === normLocation ||
      normLocation.startsWith(normPc) ||
      normPc.startsWith(normLocation)
    );
  });

  if (postcodeMatch) {
    return {
      outcome: "IN_AREA",
      traderId,
      zoneName: workArea.zoneName,
      reason: "Postcode is inside the trading zone.",
    };
  }

  if (locationMeetsZone(trimLocation, workArea.zoneName)) {
    return {
      outcome: "IN_AREA",
      traderId,
      zoneName: workArea.zoneName,
      reason: "Area name matched the trading zone.",
    };
  }

  return {
    outcome: "OUT_OF_AREA",
    traderId,
    zoneName: workArea.zoneName,
    reason: `Location "${trimLocation}" is outside zone "${workArea.zoneName}".`,
  };
};