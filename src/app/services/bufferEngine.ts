import { prisma } from "../lib/prisma";
import { BookingStatus } from "../../generated/prisma/enums";
import {
    addMinutes,
    endOfDay,
    formatHHmm,
    setTimeOnDate,
    startOfDay,
    SLOT_STEP_MINUTES,
} from "./time";


export interface AvailableSlot {
    start: Date;
    end: Date;
    bufferMinutes: number;
}

export interface AvailabilityWindow {
    start: Date;
    end: Date;
}

export interface AvailabilityResult {
    traderId: string;
    date: string;
    workingHours: AvailabilityWindow;
    durationMinutes: number;
    bufferMinutes: number;
    slotStepMinutes: number;
    occupied: Array<{
        startTime: Date;
        endTime: Date;
        bufferedEndTime: Date;
        status: BookingStatus;
    }>;
    slots: AvailableSlot[];
}

const BLOCKING_STATUSES: BookingStatus[] = [
    BookingStatus.PENDING,
    BookingStatus.OFFERED,
    BookingStatus.CONFIRMED,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.PAID,
    BookingStatus.COMPLETED,
];


const parseDateInput = (dateInput?: string | Date): Date => {
    if (dateInput instanceof Date) {
        return startOfDay(dateInput);
    }
    if (typeof dateInput === "string" && dateInput.length > 0) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
            throw new Error(`Invalid date "${dateInput}". Expected YYYY-MM-DD.`);
        }
        const [y, m, d] = dateInput.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    return startOfDay(new Date());
};

const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
};


const slotsConflict = (
    candidateStart: Date,
    candidateEnd: Date,
    candidateBuffer: number,
    jobStart: Date,
    jobBufferedEnd: Date,
): boolean => {
    return (
        addMinutes(candidateEnd, candidateBuffer).getTime() > jobStart.getTime() &&
        jobBufferedEnd.getTime() > candidateStart.getTime()
    );
};


interface BlockingBookingRow {
    startTime: Date;
    endTime: Date;
    bufferedEndTime: Date;
    status: BookingStatus;
}

export const getAvailableSlots = async (
    traderId: string,
    dateInput?: string | Date,
    duration?: number,
    buffer?: number,
): Promise<AvailabilityResult> => {
    const trader = await prisma.trader.findUnique({
        where: { id: traderId },
        select: {
            workingHoursStart: true,
            workingHoursEnd: true,
            defaultJobDuration: true,
            defaultBufferTime: true,
        },
    });

    if (!trader) {
        throw new Error(`Trader ${traderId} not found.`);
    }

    const effectiveDuration = duration ?? trader.defaultJobDuration;
    const effectiveBuffer = buffer ?? trader.defaultBufferTime;
    const targetDate = parseDateInput(dateInput);
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    const workingStart = setTimeOnDate(targetDate, trader.workingHoursStart);
    const workingEnd = setTimeOnDate(targetDate, trader.workingHoursEnd);

    const blockingBookings = await prisma.booking.findMany({
        where: {
            traderId,
            status: { in: BLOCKING_STATUSES },

            startTime: { lt: dayEnd },
            bufferedEndTime: { gt: dayStart },
        },
        select: {
            startTime: true,
            endTime: true,
            bufferedEndTime: true,
            status: true,
        },
        orderBy: { startTime: "asc" },
    });

    const slots: AvailableSlot[] = [];
    for (
        let cursor = workingStart.getTime();
        cursor + effectiveDuration * 60_000 <= workingEnd.getTime();
        cursor += SLOT_STEP_MINUTES * 60_000
    ) {
        const candidateStart = new Date(cursor);
        const candidateEnd = addMinutes(candidateStart, effectiveDuration);

        const conflict = blockingBookings.find((b: BlockingBookingRow) =>
            slotsConflict(
                candidateStart,
                candidateEnd,
                effectiveBuffer,
                b.startTime,
                b.bufferedEndTime,
            ),
        );

        if (!conflict) {
            slots.push({
                start: candidateStart,
                end: candidateEnd,
                bufferMinutes: effectiveBuffer,
            });
        }
    }

    return {
        traderId,
        date: formatDate(targetDate),
        workingHours: { start: workingStart, end: workingEnd },
        durationMinutes: effectiveDuration,
        bufferMinutes: effectiveBuffer,
        slotStepMinutes: SLOT_STEP_MINUTES,
        occupied: blockingBookings.map((b: BlockingBookingRow) => ({
            startTime: b.startTime,
            endTime: b.endTime,
            bufferedEndTime: b.bufferedEndTime,
            status: b.status,
        })),
        slots,
    };
};


export const isSlotAvailable = async (
    traderId: string,
    startTime: Date,
    duration?: number,
    buffer?: number,
): Promise<boolean> => {
    const trader = await prisma.trader.findUnique({
        where: { id: traderId },
        select: {
            workingHoursStart: true,
            workingHoursEnd: true,
            defaultJobDuration: true,
            defaultBufferTime: true,
        },
    });

    if (!trader) {
        throw new Error(`Trader ${traderId} not found.`);
    }

    const effectiveDuration = duration ?? trader.defaultJobDuration;
    const effectiveBuffer = buffer ?? trader.defaultBufferTime;
    const endTime = addMinutes(startTime, effectiveDuration);

    const workingStart = setTimeOnDate(startTime, trader.workingHoursStart);
    const workingEnd = setTimeOnDate(startTime, trader.workingHoursEnd);

    if (
        startTime.getTime() < workingStart.getTime() ||
        addMinutes(endTime, effectiveBuffer).getTime() > workingEnd.getTime()
    ) {
        return false;
    }

    const conflict = await prisma.booking.findFirst({
        where: {
            traderId,
            status: { in: BLOCKING_STATUSES },

            startTime: { lt: addMinutes(endTime, effectiveBuffer) },
            bufferedEndTime: { gt: startTime },
        },
        select: { id: true },
    });

    return conflict === null;
};


export const formatSlotTime = formatHHmm;
