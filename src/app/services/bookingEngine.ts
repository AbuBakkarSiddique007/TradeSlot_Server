/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../lib/prisma";
import { BookingStatus, ConversationState } from "../../generated/prisma/enums";
import { addMinutes, dateToMinutes, formatHHmm, startOfDay } from "./time";
import { getAvailableSlots, isSlotAvailable } from "./bufferEngine";
import { IReplyMessage, NormalizedMessage, ReplyOption, ButtonOption } from "./channels/types";
import { InboundContext, updateSessionState } from "./inbox/inbound.service";
import { createBookingCheckout, isStripeConfigured, StripeNotConfiguredError } from "./stripeService";

export interface BookingEngineResult {
    reply: IReplyMessage;
    newState: ConversationState;
    sessionId: string;
    messageId: string;
    bookingId?: string;
}

const SLOT_CHIP_LIMIT = 5;
const UNKNOWN_LOCATION = "Not provided";
const PRICE_FALLBACK_GBP = "0.00";
const FEE_FALLBACK_GBP = "0.00";

const greet = (name?: string) => (name ? `Hi ${name}, ` : "Hi, ");

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
                return await offerSlotsReply(sessionId, messageId, details);
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
            return await offerSlotsReply(sessionId, messageId, nextMetadata);
        }

        case ConversationState.AWAITING_SLOT_SELECTION: {
            return await offerSlotsReply(sessionId, messageId, metadata);
        }

        case ConversationState.OFFERED_SLOT: {
            const traderId = (metadata.traderId as string | undefined) ?? null;
            const slotId = msg.content.trim();
            const start = new Date(slotId);

            if (!traderId || Number.isNaN(start.getTime())) {
                await updateSessionState(sessionId, ConversationState.AWAITING_SLOT_SELECTION, metadata);
                return await offerSlotsReply(sessionId, messageId, metadata);
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

    const availability = await getAvailableSlots(trader.id, startOfDay(new Date()));
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

const slotsOnlyReply = async (): Promise<{ options?: ReplyOption[]; metadata?: Record<string, any> }> => {

    const trader = await pickTrader();

    if (!trader) return {};
    const availability = await getAvailableSlots(trader.id, startOfDay(new Date()));
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
            totalPrice: PRICE_FALLBACK_GBP as any,
            feeAmount: FEE_FALLBACK_GBP as any,
            currency: "gbp",
        },
    });
};