import { Response, NextFunction } from "express";
import { getAvailableSlots } from "../../services/bufferEngine";
import { formatHHmm } from "../../services/time";
import { IAuthRequest } from "../../middleware/auth.middleware";
import { prisma } from "../../lib/prisma";

const getAvailability = async (req: IAuthRequest, res: Response, next: NextFunction) => {
    try {
        const traderId = req.trader?.traderId;

        if (!traderId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const { date, duration, buffer } = req.query;

        const parsedDuration =
            typeof duration === "string" && duration.length > 0
                ? Number.parseInt(duration, 10)
                : undefined;

        const parsedBuffer =
            typeof buffer === "string" && buffer.length > 0
                ? Number.parseInt(buffer, 10)
                : undefined;

        if (parsedDuration !== undefined && (Number.isNaN(parsedDuration) || parsedDuration <= 0)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid duration (minutes, positive integer)." });
        }

        if (parsedBuffer !== undefined && (Number.isNaN(parsedBuffer) || parsedBuffer < 0)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid buffer (minutes, non-negative integer)." });
        }

        const result = await getAvailableSlots(
            traderId,
            typeof date === "string" ? date : undefined,
            parsedDuration,
            parsedBuffer,
        );

        const [y, m, d] = result.date.split("-").map(Number);
        const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
        const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);

        const bookings = await prisma.booking.findMany({
            where: {
                traderId,
                startTime: { lt: dayEnd },
                bufferedEndTime: { gt: dayStart },
            },
            include: {
                payment: {
                    select: {
                        status: true,
                        amount: true,
                    },
                },
            },
            orderBy: { startTime: "asc" },
        });

        return res.status(200).json({
            success: true,
            traderId: result.traderId,
            date: result.date,
            workingHours: {
                start: result.workingHours.start.toISOString(),
                end: result.workingHours.end.toISOString(),
                startHHmm: formatHHmm(
                    result.workingHours.start.getHours() * 60 +
                    result.workingHours.start.getMinutes(),
                ),
                endHHmm: formatHHmm(
                    result.workingHours.end.getHours() * 60 + result.workingHours.end.getMinutes(),
                ),
            },
            durationMinutes: result.durationMinutes,
            bufferMinutes: result.bufferMinutes,
            slotStepMinutes: result.slotStepMinutes,
            bookings: bookings.map((b) => ({
                id: b.id,
                customerName: b.customerName || "Customer",
                customerLocation: b.customerLocation,
                serviceDescription: b.serviceDescription,
                channelType: b.channelType === "WHATSAPP" ? "whatsapp" : "webchat",
                startTime: b.startTime.toISOString(),
                endTime: b.endTime.toISOString(),
                bufferMinutes: b.bufferMinutes,
                bufferedEndTime: b.bufferedEndTime.toISOString(),
                status: b.status.toLowerCase(),
                totalPrice: Number(b.totalPrice) || 0,
                paymentStatus: b.payment?.status?.toLowerCase() || "pending",
            })),
            occupied: result.occupied.map((b) => ({
                startTime: b.startTime.toISOString(),
                endTime: b.endTime.toISOString(),
                bufferedEndTime: b.bufferedEndTime.toISOString(),
                status: b.status,
            })),
            slots: result.slots.map((s) => ({
                start: s.start.toISOString(),
                end: s.end.toISOString(),
                startHHmm: formatHHmm(s.start.getHours() * 60 + s.start.getMinutes()),
                endHHmm: formatHHmm(s.end.getHours() * 60 + s.end.getMinutes()),
                bufferMinutes: s.bufferMinutes,
            })),
        });
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Trader ")) {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error instanceof Error && error.message.startsWith("Invalid date")) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return next(error);
    }
};

export const availabilityController = {
    getAvailability,
};