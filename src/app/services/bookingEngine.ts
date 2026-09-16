/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../lib/prisma";
import { BookingStatus, ChannelType, ConversationState } from "../../generated/prisma/enums";
import { addMinutes, businessDay, dateToMinutes, formatHHmm } from "./time";
import { getAvailableSlots, isSlotAvailable } from "./bufferEngine";
import { matchLocationToTrader, LocationMatch } from "./locationRouter";
import { IReplyMessage, NormalizedMessage, ReplyOption, ButtonOption } from "./channels/types";
import { InboundContext, updateSessionState } from "./inbox/inbound.service";
import { createBookingCheckout, decimalFromPence, flatFeePence, flatJobPricePence, isStripeConfigured, StripeNotConfiguredError } from "./stripeService";

export interface BookingEngineResult {
    reply: IReplyMessage;
    newState: ConversationState;
    sessionId: string;
    messageId: string;
    bookingId?: string;
}

const SLOT_CHIP_LIMIT = 5;
const UNKNOWN_LOCATION = "Not provided";

const greet = (name?: string) => (name ? `Hi ${name}, ` : "Hi, ");

const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, "");

const looksLikePhone = (raw: string): boolean => {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
};

const attachCustomerPhone = async (
    sessionId: string,
    customerId: string | null,
    phone: string,
    name?: string | null,
) => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;

    const existing = await prisma.customer.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
    });

    if (existing) {
        await prisma.chatSession.update({
            where: { id: sessionId },
            data: { customerId: existing.id },
        });
        return existing.id;
    }

    if (customerId) {
        return prisma.customer.update({
            where: { id: customerId },
            data: { phone: normalizedPhone, ...(name ? { name } : {}) },
        });
    }

    const created = await prisma.customer.create({
        data: { phone: normalizedPhone, name: name ?? null },
    });
    await prisma.chatSession.update({
        where: { id: sessionId },
        data: { customerId: created.id },
    });
    return created.id;
};

const buildSlotChips = (slots: Array<{ start: Date; end: Date }>): ReplyOption[] => {
    return slots.slice(0, SLOT_CHIP_LIMIT).map((s) => ({
        id: s.start.toISOString(),
        label: `${formatHHmm(dateToMinutes(s.start))} – ${formatHHmm(dateToMinutes(s.end))}`,
        description: undefined,
    }));
};

const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const AREA_KEYWORDS_REGEX = /\b(GEC|Khulshi|Agrabad|Nasirabad|Halishahar|Panchlaish|Muradpur|Bahaddarhat|London|Battersea|Clapham|Islington|Camden|Manchester|Salford|Birmingham|Westminster)\b/i;
const GENERIC_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?|\d{4})\b/i;

const extractFromText = (text: string) => {
    if (!text) return { location: null, service: null };
    const trimmed = text.trim();


    const ukMatch = trimmed.match(UK_POSTCODE_REGEX);
    if (ukMatch && ukMatch[1]) {
        const loc = ukMatch[1].trim();
        const srv = trimmed
            .replace(ukMatch[0], "")
            .replace(/\b(at|in|near|postcode|address|location|for)\b/gi, "")
            .replace(/,\s*$/, "")
            .trim();
        return { location: loc, service: srv.length > 2 ? srv : null };
    }


    const areaMatch = trimmed.match(AREA_KEYWORDS_REGEX);
    if (areaMatch && areaMatch[1]) {
        const loc = areaMatch[1].trim();
        const srv = trimmed
            .replace(areaMatch[0], "")
            .replace(/\b(at|in|near|postcode|address|location|for)\b/gi, "")
            .replace(/,\s*$/, "")
            .trim();
        return { location: loc, service: srv.length > 2 ? srv : null };
    }


    const prefixMatch = trimmed.match(GENERIC_POSTCODE_REGEX);
    if (prefixMatch && prefixMatch[1] && /\b(at|in|near)\s+/i.test(trimmed)) {
        const loc = prefixMatch[1].trim();
        const srv = trimmed
            .replace(prefixMatch[0], "")
            .replace(/\b(at|in|near|postcode|address|location|for)\b/gi, "")
            .replace(/,\s*$/, "")
            .trim();
        return { location: loc, service: srv.length > 2 ? srv : null };
    }

    return { location: null, service: null };
};

const hasServiceDetails = (msg: NormalizedMessage, metadata: Record<string, any> | null) => {
    const extracted = extractFromText(msg.content);
    const inlineLocation = msg.customerLocation?.trim() || extracted.location;
    const inlineService = msg.serviceDescription?.trim() || extracted.service;
    const metaLocation = (metadata?.customerLocation as string | undefined)?.trim();
    const metaService = (metadata?.serviceDescription as string | undefined)?.trim();

    return Boolean(
        (inlineLocation && inlineService) ||
        (inlineLocation && metaService) ||
        (inlineService && metaLocation) ||
        (metaLocation && metaService),
    );
};

const mergeServiceDetails = (msg: NormalizedMessage, metadata: Record<string, any> | null) => {
    const extracted = extractFromText(msg.content);
    return {
        customerName: msg.customerName ?? (metadata?.customerName as string | undefined),
        customerLocation:
            msg.customerLocation?.trim() ??
            extracted.location ??
            (metadata?.customerLocation as string | undefined) ??
            null,

        serviceDescription:
            msg.serviceDescription?.trim() ??
            extracted.service ??
            (metadata?.serviceDescription as string | undefined) ??
            (msg.content.trim().length > 3 && !extracted.location ? msg.content.trim() : null),
    };
};

const pickTrader = async (): Promise<{ id: string; defaultJobDuration: number; defaultBufferTime: number } | null> => {

    const trader = await prisma.trader.findFirst({
        where: { stripeOnboarded: true, stripeAccountId: { not: null } },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            defaultJobDuration: true,
            defaultBufferTime: true,
        },
    });

    if (trader) return trader;
    return prisma.trader.findFirst({
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            defaultJobDuration: true,
            defaultBufferTime: true,
        },
    });
};

export const handleIncomingMessage = async (
    msg: NormalizedMessage,
    ctx: InboundContext,
): Promise<BookingEngineResult> => {
    const currentState = ctx.state ?? ConversationState.INITIAL;
    const metadata = ctx.metadata ?? {};
    const sessionId = ctx.sessionId;
    const messageId = ctx.messageId;

    switch (currentState) {
        case ConversationState.INITIAL: {
            const details = mergeServiceDetails(msg, metadata);
           
            if (hasServiceDetails(msg, metadata)) {
                await updateSessionState(sessionId, ConversationState.AWAITING_SLOT_SELECTION, details);
                return await offerSlotsReply(sessionId, messageId, details, ctx.customerId, msg.channelType, msg.senderRef);
            }

            const missing: string[] = [];
            if (!details.customerLocation) missing.push("location");
            if (!details.serviceDescription) missing.push("service");
            const askFor = missing.includes("location") ? "location" : "service";
            await updateSessionState(sessionId, ConversationState.AWAITING_SERVICE_DETAILS, {
                ...details,
                lastAskedFor: askFor,
            });

            return {
                sessionId,
                messageId,
                newState: ConversationState.AWAITING_SERVICE_DETAILS,
                reply: {
                    text:
                        missing.length === 2
                            ? `${greet(msg.customerName)}could you tell me the job you need done and where it's located?`
                            : missing[0] === "location"
                                ? `${greet(msg.customerName)}what's the address or postcode for the job?`
                                : `${greet(msg.customerName)}could you describe the work you need done?`,
                    metadata: { lastAskedFor: askFor },
                },
            };
        }

        case ConversationState.AWAITING_SERVICE_DETAILS: {
            const details = mergeServiceDetails(msg, metadata);
            const lastAskedFor = (metadata.lastAskedFor as string | undefined) ?? "location";
            const inlineLocation = msg.customerLocation?.trim();
            const inlineService = msg.serviceDescription?.trim();
            const trimmedContent = msg.content.trim();
            const nextMetadata: Record<string, any> = { ...details };

            if (lastAskedFor === "location") {
                if (inlineLocation || details.customerLocation) {
                    nextMetadata.customerLocation = inlineLocation || details.customerLocation;
                } else if (trimmedContent) {
                    nextMetadata.customerLocation = trimmedContent;
                }
            } else {
                if (inlineService || details.serviceDescription) {
                    nextMetadata.serviceDescription = inlineService || details.serviceDescription;
                } else if (trimmedContent) {
                    nextMetadata.serviceDescription = trimmedContent;
                }
            }

            if (!nextMetadata.customerLocation) {
                nextMetadata.lastAskedFor = "location";
                await updateSessionState(sessionId, ConversationState.AWAITING_SERVICE_DETAILS, nextMetadata);
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_SERVICE_DETAILS,
                    reply: {
                        text: "Thanks — and what's the address or postcode for the job?",
                        metadata: nextMetadata,
                    },
                };
            }

            if (!nextMetadata.serviceDescription) {
                nextMetadata.lastAskedFor = "service";
                await updateSessionState(sessionId, ConversationState.AWAITING_SERVICE_DETAILS, nextMetadata);
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_SERVICE_DETAILS,
                    reply: {
                        text: "Got it. Could you describe the work needed in a sentence or two?",
                        metadata: nextMetadata,
                    },
                };
            }

            delete nextMetadata.lastAskedFor;
            await updateSessionState(sessionId, ConversationState.AWAITING_SLOT_SELECTION, nextMetadata);
            return await offerSlotsReply(sessionId, messageId, nextMetadata, ctx.customerId, msg.channelType, msg.senderRef);
        }

        case ConversationState.AWAITING_SLOT_SELECTION: {
            return await offerSlotsReply(sessionId, messageId, metadata, ctx.customerId, msg.channelType, msg.senderRef);
        }

        case ConversationState.OFFERED_SLOT: {
            const traderId = (metadata.traderId as string | undefined) ?? null;
            const slotId = msg.content.trim();
            const start = new Date(slotId);

            if (!traderId || Number.isNaN(start.getTime())) {
                await updateSessionState(sessionId, ConversationState.AWAITING_SLOT_SELECTION, metadata);
                return await offerSlotsReply(sessionId, messageId, metadata, ctx.customerId, msg.channelType, msg.senderRef);
            }

            const stillFree = await isSlotAvailable(traderId, start);
            if (!stillFree) {
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_SLOT_SELECTION,
                    reply: {
                        text: "Sorry, that slot was just taken. Here are the next times I have:",
                        ...(await slotsOnlyReply()),
                    },
                };
            }

            const booking = await createPendingBooking({
                traderId,
                msg,
                metadata,
                startTime: start,
            });

            const checkout = await resolveCheckoutForBooking(booking.id);

            await updateSessionState(sessionId, ConversationState.AWAITING_PAYMENT, {
                ...metadata,
                bookingId: booking.id,
            });

            const startLabel = formatHHmm(dateToMinutes(booking.startTime));
            const endLabel = formatHHmm(dateToMinutes(booking.endTime));
            const buttons: ButtonOption[] = checkout.url
                ? [
                    {
                        id: "checkout",
                        label: "Pay now",
                        description: checkout.url,
                    },
                ]
                : [];

            return {
                sessionId,
                messageId,
                bookingId: booking.id,
                newState: ConversationState.AWAITING_PAYMENT,
                reply: {
                    text: checkout.url
                        ? `Great — I've held ${startLabel} – ${endLabel} for you. Tap "Pay now" below to confirm the booking.`
                        : `Great — I've held ${startLabel} – ${endLabel} for you. Payment is not configured yet, so we'll send the link separately.`,
                    ...(buttons.length > 0 ? { buttons } : {}),
                    metadata: {
                        bookingId: booking.id,
                        ...(checkout.url ? { checkoutUrl: checkout.url } : {}),
                        ...(checkout.warning ? { checkoutWarning: checkout.warning } : {}),
                    },
                },
            };
        }

        case ConversationState.AWAITING_PAYMENT: {
            return {
                sessionId,
                messageId,
                newState: ConversationState.AWAITING_PAYMENT,
                reply: {
                    text: "Your booking is held while we send the payment link. We'll confirm as soon as it's paid.",
                },
            };
        }

        case ConversationState.AWAITING_CONTACT_DETAILS: {
            const phoneRaw = msg.content.trim();

            if (!looksLikePhone(phoneRaw)) {
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_CONTACT_DETAILS,
                    reply: {
                        text: "That doesn't look like a phone number. Could you type it again as digits, e.g. 07890 123456?",
                    },
                };
            }

            await attachCustomerPhone(
                sessionId,
                ctx.customerId,
                phoneRaw,
                (metadata.customerName as string | undefined) ?? msg.customerName ?? null,
            );

            const normalizedPhone = normalizePhone(phoneRaw);
            await updateSessionState(sessionId, ConversationState.LEAD, {
                ...metadata,
                customerPhone: normalizedPhone,
            });

            return {
                sessionId,
                messageId,
                newState: ConversationState.LEAD,
                reply: {
                    text: `Thanks — we've saved your enquiry. A trader covering ${metadata.customerLocation ?? "your area"} will call ${normalizedPhone} to arrange the job.`,
                },
            };
        }

        case ConversationState.LEAD: {
            return {
                sessionId,
                messageId,
                newState: ConversationState.LEAD,
                reply: {
                    text: "We've got your enquiry on the list — a trader will be in touch with you shortly.",
                },
            };
        }

        case ConversationState.CONFIRMED: {
            return {
                sessionId,
                messageId,
                newState: ConversationState.CONFIRMED,
                reply: {
                    text: "You're all booked. We'll see you on the day — anything else I can help with?",
                },
            };
        }

        case ConversationState.COMPLETED: {
            return {
                sessionId,
                messageId,
                newState: ConversationState.COMPLETED,
                reply: {
                    text: "That job is done. If you need anything else, just message here.",
                },
            };
        }

        default: {
            return {
                sessionId,
                messageId,
                newState: currentState,
                reply: {
                    text: "Thanks — we've got your message.",
                },
            };
        }
    }
};


const offerSlotsReply = async (
    sessionId: string,
    messageId: string,
    metadata: Record<string, any>,
    customerId: string | null,
    channelType: ChannelType,
    senderRef: string,
): Promise<BookingEngineResult> => {

    const trader = await pickTrader();
    if (!trader) {
        return {
            sessionId,
            messageId,
            newState: ConversationState.AWAITING_SLOT_SELECTION,
            reply: {
                text: "We don't have any tradespeople available right now. Please try again later.",
            },
        };
    }

    const location = (metadata.customerLocation as string | undefined)?.trim();
    if (!location) {
        await updateSessionState(sessionId, ConversationState.AWAITING_SERVICE_DETAILS, {
            ...metadata,
            lastAskedFor: "location",
        });
        return {
            sessionId,
            messageId,
            newState: ConversationState.AWAITING_SERVICE_DETAILS,
            reply: {
                text: "Which postcode or area is the job in? That way I can confirm we cover it.",
            },
        };
    }

    const match = await matchLocationToTrader(trader.id, location, businessDay());

    if (match.outcome === "OUT_OF_AREA" || match.outcome === "NO_ZONE") {
        return startLeadFlow(sessionId, messageId, metadata, customerId, channelType, senderRef, match);
    }

    const availability = await getAvailableSlots(trader.id, businessDay());
    const chips = buildSlotChips(availability.slots);

    if (chips.length === 0) {
        return {
            sessionId,
            messageId,
            newState: ConversationState.AWAITING_SLOT_SELECTION,
            reply: {
                text: "I don't have any free slots today. Want me to check tomorrow instead?",
                metadata: { traderId: trader.id },
            },
        };
    }

    await updateSessionState(sessionId, ConversationState.OFFERED_SLOT, {
        ...metadata,
        traderId: trader.id,
        offeredAt: new Date().toISOString(),
    });

    return {
        sessionId,
        messageId,
        newState: ConversationState.OFFERED_SLOT,
        reply: {
            text: "Here are the next available times — tap one to hold it:",
            options: chips,
            metadata: { traderId: trader.id },
        },
    };
};

const startLeadFlow = async (
    sessionId: string,
    messageId: string,
    metadata: Record<string, any>,
    customerId: string | null,
    channelType: ChannelType,
    senderRef: string,
    match: LocationMatch,
): Promise<BookingEngineResult> => {
    const customerName = (metadata.customerName as string | undefined) ?? undefined;
    const locationLabel = (metadata.customerLocation as string | undefined) ?? "your area";
    const zoneLabel = match.zoneName ?? "today's zone";
    const leadMetadata = {
        ...metadata,
        lead: true,
        leadOutcome: match.outcome,
        leadZoneName: match.zoneName ?? null,
    };

    if (channelType === ChannelType.WHATSAPP) {
        const phone = normalizePhone(senderRef);
        await attachCustomerPhone(sessionId, customerId, phone, customerName);
        await updateSessionState(sessionId, ConversationState.LEAD, {
            ...leadMetadata,
            customerPhone: phone,
        });
        return {
            sessionId,
            messageId,
            newState: ConversationState.LEAD,
            reply: {
                text: `${greet(customerName)}${zoneLabel} isn't covered right now, but we've saved your job (${locationLabel}) and a trader will call ${phone} to discuss it.`,
            },
        };
    }

    await updateSessionState(sessionId, ConversationState.AWAITING_CONTACT_DETAILS, {
        ...leadMetadata,
        customerPhone: null,
        lastAskedFor: "phone",
    });

    return {
        sessionId,
        messageId,
        newState: ConversationState.AWAITING_CONTACT_DETAILS,
        reply: {
            text: `${greet(customerName)}${zoneLabel} isn't covered right now — but I can pass your job to a trader anyway. What's the best phone number for them to reach you on?`,
        },
    };
};

const slotsOnlyReply = async (): Promise<{ options?: ReplyOption[]; metadata?: Record<string, any> }> => {

    const trader = await pickTrader();

    if (!trader) return {};
    const availability = await getAvailableSlots(trader.id, businessDay());
    return {
        options: buildSlotChips(availability.slots),
        metadata: { traderId: trader.id },
    };
};

interface CreatePendingBookingInput {
    traderId: string;
    msg: NormalizedMessage;
    metadata: Record<string, any>;
    startTime: Date;
}

interface CheckoutResolution {
    url: string | null;
    warning?: string;
}

const resolveCheckoutForBooking = async (bookingId: string): Promise<CheckoutResolution> => {
    if (!isStripeConfigured()) {
        return {
            url: null,
            warning: "Stripe is not configured on the server. The trader must set STRIPE_SECRET_KEY before payments can be taken.",
        };
    }
    try {
        const checkout = await createBookingCheckout(bookingId);
        return { url: checkout.url };

    } catch (err) {

        if (err instanceof StripeNotConfiguredError) {
            return {
                url: null,
                warning: "Stripe is not configured on the server. The trader must set STRIPE_SECRET_KEY before payments can be taken.",
            };
        }

        const message = err instanceof Error ? err.message : String(err);
        console.error(`[bookingEngine] createBookingCheckout failed for ${bookingId}: ${message}`);

        return {
            url: null,
            warning: `We could not start the payment session: ${message}. The booking is still held — we'll retry the link shortly.`,
        };
    }
};

const createPendingBooking = async ({
    traderId,
    msg,
    metadata,
    startTime,
}: CreatePendingBookingInput) => {
    
    const trader = await prisma.trader.findUniqueOrThrow({
        where: { id: traderId },
        select: { defaultJobDuration: true, defaultBufferTime: true },
    });

    const endTime = addMinutes(startTime, trader.defaultJobDuration);
    const bufferedEndTime = addMinutes(endTime, trader.defaultBufferTime);
    const customerName =
        msg.customerName ?? (metadata.customerName as string | undefined) ?? null;

    const customerLocation =
        msg.customerLocation?.trim() ??
        (metadata.customerLocation as string | undefined) ??
        UNKNOWN_LOCATION;

    const serviceDescription =
        msg.serviceDescription?.trim() ??
        (metadata.serviceDescription as string | undefined) ??
        msg.content.trim();

    return prisma.booking.create({
        data: {
            traderId,
            customerId: null,
            channelType: msg.channelType,
            customerRef: msg.senderRef,
            customerName,
            customerLocation,
            serviceDescription,
            startTime,
            endTime,
            bufferMinutes: trader.defaultBufferTime,
            bufferedEndTime,
            status: BookingStatus.PAYMENT_PENDING,
            totalPrice: decimalFromPence(flatJobPricePence()) as any,
            feeAmount: decimalFromPence(flatFeePence()) as any,
            currency: "gbp",
        },
    });
};