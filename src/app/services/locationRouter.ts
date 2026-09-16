import { prisma } from "../lib/prisma";
import { utcDayKey } from "./time";

export type LocationMatchOutcome = "IN_AREA" | "OUT_OF_AREA" | "NO_ZONE" | "UNKNOWN";

export interface LocationMatch {
  outcome: LocationMatchOutcome;
  traderId: string;
  zoneName?: string;
  reason?: string;
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

export const matchLocationToTrader = async (
  traderId: string,
  location: string | null | undefined,
  date: Date,
): Promise<LocationMatch> => {
  const trimLocation = location?.trim();

  if (!trimLocation) {
    return { outcome: "UNKNOWN", traderId };
  }

  const workArea = await prisma.workArea.findUnique({
    where: {
      traderId_date: {
        traderId,
        date: utcDayKey(date),
      },
    },
    select: { id: true, zoneName: true, postalCodes: true },
  });

  if (!workArea) {
    return {
      outcome: "NO_ZONE",
      traderId,
      reason: "No active zone set for this date.",
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