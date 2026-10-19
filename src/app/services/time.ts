// Timezone and day utilities for TradeSlot (Asia/Dhaka, UTC+6).
// Using explicit UTC offsets prevents host timezone skew between dev (Windows BST)
// and cloud deployments (Render/Linux UTC).

const resolveBusinessTz = (): string => {
  const candidate = process.env.BUSINESS_TZ || "Asia/Dhaka";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    process.env.BUSINESS_TZ = "Asia/Dhaka";
    return "Asia/Dhaka";
  }
};
process.env.TZ = resolveBusinessTz();

const MS_PER_MINUTE = 60_000;

export const BUSINESS_UTC_OFFSET_MINUTES = Number(
  process.env.BUSINESS_UTC_OFFSET_MINUTES ?? 360,
);

/**
 * Returns a normalized UTC date representing the start of the day (00:00:00.000 UTC).
 */
export const utcDayKey = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Returns the current date in the business timezone (Asia/Dhaka) normalized to midnight UTC.
 */
export const businessDay = (now: Date = new Date()): Date => {
  const shifted = new Date(now.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
};

export const parseHHmm = (hhmm: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Invalid HH:mm string: "${hhmm}"`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Out-of-range HH:mm string: "${hhmm}"`);
  }
  return hours * 60 + minutes;
};

export const formatHHmm = (minutes: number): string => {
  const safe = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(safe / 60).toString().padStart(2, "0");
  const m = (safe % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
};

/**
 * Converts a Date to total minutes from midnight in the business timezone (Asia/Dhaka).
 * Uses explicit UTC offset so it never suffers from host OS timezone differences.
 */
export const dateToMinutes = (date: Date): number => {
  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
};

/**
 * Returns the start of the day (00:00:00.000 in Asia/Dhaka) as a UTC Date.
 */
export const startOfDay = (date: Date): Date => {
  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
};

/**
 * Returns the end of the day (23:59:59.999 in Asia/Dhaka) as a UTC Date.
 */
export const endOfDay = (date: Date): Date => {
  const start = startOfDay(date);
  return new Date(start.getTime() + 24 * 60 * MS_PER_MINUTE - 1);
};

/**
 * Sets a specific HH:mm in Asia/Dhaka timezone onto the given date, returning a UTC Date.
 */
export const setTimeOnDate = (date: Date, hhmm: string): Date => {
  const totalMinutes = parseHHmm(hhmm);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  return new Date(Date.UTC(y, m, d, hours, minutes, 0, 0) - BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
};

export const SLOT_STEP_MINUTES = 30;
