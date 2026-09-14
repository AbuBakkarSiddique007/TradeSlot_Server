/* eslint-disable @typescript-eslint/no-explicit-any */
import { Response, NextFunction } from "express";
import { IAuthRequest } from "../../middleware/auth.middleware";
import { prisma } from "../../lib/prisma";
import { ConversationState } from "../../../generated/prisma/enums";

const looksLikePhone = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? raw : null;
};

const getLeads = async (req: IAuthRequest, res: Response, next: NextFunction) => {
    try {
        const traderId = req.trader?.traderId;
        if (!traderId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const sessions = await prisma.chatSession.findMany({
            where: { state: ConversationState.LEAD },
            orderBy: { lastInteraction: "desc" },
            take: 50,
            include: {
                customer: { select: { name: true, phone: true, email: true } },
            },
        });

        const leads = sessions.map((s) => {
            const meta = (s.metadata ?? {}) as Record<string, any>;
            return {
                id: s.id,
                channelType: s.channelType,
                senderRef: s.senderRef,
                customerName: s.customer?.name ?? meta.customerName ?? null,
                customerPhone: looksLikePhone(meta.customerPhone) ?? looksLikePhone(s.customer?.phone),
                customerLocation: meta.customerLocation ?? null,
                serviceDescription: meta.serviceDescription ?? null,
                leadOutcome: meta.leadOutcome ?? "OUT_OF_AREA",
                leadZoneName: meta.leadZoneName ?? null,
                updatedAt: s.lastInteraction.toISOString(),
            };
        });

        return res.status(200).json({ success: true, data: leads });
    } catch (error) {
        return next(error);
    }
};

export const leadsController = {
    getLeads,
};