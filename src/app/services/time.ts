// Hosts (Render) preset TZ=UTC; force the trading region's wall clock.
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


const BUSINESS_UTC_OFFSET_MINUTES = Number(process.env.BUSINESS_UTC_OFFSET_MINUTES ?? 360);


export const utcDayKey = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));


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


export const dateToMinutes = (date: Date): number => {
    return date.getHours() * 60 + date.getMinutes();
};


export const addMinutes = (date: Date, minutes: number): Date => {
    return new Date(date.getTime() + minutes * MS_PER_MINUTE);
};


export const startOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};


export const endOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};


export const setTimeOnDate = (date: Date, hhmm: string): Date => {
    const minutes = parseHHmm(hhmm);
    const d = new Date(date);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d;
};

export const SLOT_STEP_MINUTES = 30;

