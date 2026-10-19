/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../lib/prisma";
import { BookingStatus, ChannelType, ConversationState } from "../../generated/prisma/enums";
import { addMinutes, businessDay, dateToMinutes, formatHHmm } from "./time";
import { getAvailableSlots, isSlotAvailable } from "./bufferEngine";
import { matchLocationToTrader, LocationMatch, getActiveCoverage } from "./locationRouter";
import { IReplyMessage, NormalizedMessage, ReplyOption, ButtonOption } from "./channels/types";
import { InboundContext, updateSessionState } from "./inbox/inbound.service";
import { createBookingCheckout, decimalFromPence, flatFeePence, flatJobPricePence, isStripeConfigured, StripeNotConfiguredError } from "./stripeService";
import { extractFromMessage, rephraseReply, ExtractedIntent } from "./ai/aiConversation";

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

const formatServiceForPrompt = (service?: string | null): string => {
    if (!service) return "job";
    const trimmed = service.replace(/^(my|a|an|the)\s+/i, "").trim();
    if (trimmed.length > 25 || /\b(is|are|has|broken|leaking|stopped)\b/i.test(trimmed)) {
        return "job";
    }
    return trimmed;
};

const normalizePhone = (raw: string): string => {
    let clean = raw.replace(/[^\d+]/g, "");
    if (clean.startsWith("+880")) clean = "0" + clean.slice(4);
    if (clean.startsWith("880")) clean = "0" + clean.slice(3);
    return clean;
};

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

const BD_POSTCODE_REGEX = /\b(1[0-3]\d{2}|4[0-3]\d{2}|[1-9]\d{3})\b/;
const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const AREA_KEYWORDS_REGEX =
    /\b(GEC|Khulshi|Agrabad|Nasirabad|Halishahar|Panchlaish|Muradpur|Bahaddarhat|Chawkbazar|Chandgaon|Kotwali|Patenga|Lalkhan\s*Bazar|Anderkilla|Gulshan|Banani|Dhanmondi|Mirpur|Uttara|Mohammadpur|Badda|Motijheel|Bashundhara|Mohakhali|Tejgaon|Lalmatia|Shantinagar|Malibagh|Rampura|Khilgaon|Baridhara|Chattogram|Chittagong|Dhaka|Sylhet|London|Camden|Battersea)\b/i;
const GENERIC_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?|\d{4})\b/i;

const extractFromText = (text: string) => {
    if (!text) return { location: null, service: null };
    const trimmed = text.trim();

    // 1. Check Bangladesh 4-digit postcode (e.g. 4000, 1205)
    const bdMatch = trimmed.match(BD_POSTCODE_REGEX);
    if (bdMatch && bdMatch[1]) {
        const loc = bdMatch[1].trim();
        const srv = trimmed
            .replace(bdMatch[0], "")
            .replace(/\b(at|in|near|postcode|address|location|for)\b/gi, "")
            .replace(/,\s*$/, "")
            .trim();
        return { location: loc, service: srv.length > 2 ? srv : null };
    }

    // 2. Check UK postcode
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

    // 3. Check area keywords (Chattogram, Dhaka, etc.)
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

const isGreetingOrQuestion = (text: string): boolean => {
    const t = text.trim();
    if (/^(hi|hello|hey|good morning|good afternoon|good evening|salam|assalamu alaikum)\b/i.test(t)) return true;
    if (/(how does (this|it|tradeslot|everything|platform) work|how to work|how it works|what (is this|do you do|services|is tradeslot)|how much|pricing|price|cost|fee|features?|buffer|who are you|can you help|which (areas|regions|locations|zones))\b/i.test(t)) return true;
    if (/^\s*(how|what|why|who|when|where|is it|can you|are you)\b/i.test(t) && !/\b(plumber|electrician|repair|leak|pipe|boiler|paint|clean|ac|wiring|tap|generator)\b/i.test(t)) return true;
    if (t.endsWith("?") && !/\b(plumber|electrician|repair|leak|pipe|boiler|paint|clean|ac|wiring|tap|generator)\b/i.test(t)) return true;
    return false;
};

const mergeServiceDetails = (
    msg: NormalizedMessage,
    metadata: Record<string, any> | null,
    aiExtracted?: ExtractedIntent,
) => {
    const extracted = extractFromText(msg.content);
    const content = msg.content.trim();
    const isChitchat = aiExtracted
        ? aiExtracted.intent === "greeting" || aiExtracted.intent === "question"
        : isGreetingOrQuestion(content);

    return {
        customerName:
            aiExtracted?.customerName ??
            msg.customerName ??
            (metadata?.customerName as string | undefined),
        customerLocation:
            aiExtracted?.customerLocation?.trim() ??
            msg.customerLocation?.trim() ??
            extracted.location ??
            (metadata?.customerLocation as string | undefined) ??
            null,
        serviceDescription:
            aiExtracted?.serviceDescription?.trim() ??
            msg.serviceDescription?.trim() ??
            extracted.service ??
            (metadata?.serviceDescription as string | undefined) ??
            (!isChitchat && content.length > 3 && !extracted.location ? content : null),
    };
};

const hasServiceDetails = (details: { customerLocation?: string | null; serviceDescription?: string | null }) => {
    return Boolean(details.customerLocation && details.serviceDescription);
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

    // 1. AI Intent & Entity Extraction with Active Coverage Context
    const activeCoverage = await getActiveCoverage();
    const aiExtracted = await extractFromMessage(msg.content, {
        currentState,
        metadata,
        activeCoverage,
    });

    if (aiExtracted.customerName && !msg.customerName) {
        msg.customerName = aiExtracted.customerName;
    }
    if (aiExtracted.customerLocation && !msg.customerLocation) {
        msg.customerLocation = aiExtracted.customerLocation;
    }
    if (aiExtracted.serviceDescription && !msg.serviceDescription) {
        msg.serviceDescription = aiExtracted.serviceDescription;
    }

    if (aiExtracted.customerName && ctx.customerId) {
        try {
            await prisma.customer.update({
                where: { id: ctx.customerId },
                data: { name: aiExtracted.customerName },
            });
        } catch {
            /* ignore */
        }
    }

    // 2. Execute State Machine Transition
    const result = await processStateTransition(msg, ctx, currentState, metadata, aiExtracted);

    // 3. AI Reply Polishing (if applicable)
    if (result.reply && result.reply.text) {
        result.reply.text = await rephraseReply(result.reply.text, {
            customerName: (metadata.customerName as string | undefined) ?? msg.customerName ?? null,
            currentState: result.newState,
        });
    }

    return result;
};

const processStateTransition = async (
    msg: NormalizedMessage,
    ctx: InboundContext,
    currentState: ConversationState,
    metadata: Record<string, any>,
    aiExtracted: ExtractedIntent,
): Promise<BookingEngineResult> => {
    const sessionId = ctx.sessionId;
    const messageId = ctx.messageId;

    switch (currentState) {
        case ConversationState.INITIAL: {
            const details = mergeServiceDetails(msg, metadata, aiExtracted);

            // Friendly AI greeting / FAQ reply if user is greeting or asking questions without job info
            const isQuestionOrGreeting =
                aiExtracted.intent === "greeting" ||
                aiExtracted.intent === "question" ||
                isGreetingOrQuestion(msg.content);

            if (isQuestionOrGreeting && !details.customerLocation && !details.serviceDescription) {
                const lower = msg.content.toLowerCase();
                let answerText = aiExtracted.assistantResponse;
                const buttons: ButtonOption[] = [];

                if (!answerText) {
                    if (/price|pricing|cost|fee|rate/i.test(lower)) {
                        answerText = "TradeSlot features 100% transparent pricing with zero subscription lock-ins or lead bidding. Tradespeople only pay a flat £15 platform fee per confirmed booking, while customers get clear upfront quotes. View our live pricing breakdown below!";
                    } else if (/feature|buffer|capability/i.test(lower)) {
                        answerText = "TradeSlot is built around 4 core features: 1) Automated 30-minute travel buffers after each job to eliminate late arrivals. 2) Dual instant booking via Webchat & WhatsApp. 3) Daily territory geofencing. 4) Direct bank payouts via Stripe Connect.";
                    } else if (/work|step|how/i.test(lower)) {
                        answerText = "TradeSlot makes booking trusted trades effortless: 1) Describe your service & location. 2) Pick an available guaranteed time slot. 3) A vetted tradesperson arrives on schedule! What trade service do you need help with today?";
                    } else if (/area|cover|region|zone/i.test(lower)) {
                        answerText = "We actively dispatch trades in designated zones (including Chattogram and Dhaka) with nationwide coverage for custom enquiries. Tell us your job and area or postcode to get started!";
                    } else {
                        answerText = "Hello! I am your TradeSlot booking assistant. What trade service do you need help with and what is your location or area?";
                    }
                }

                if (/price|pricing|cost|fee/i.test(lower)) {
                    buttons.push({ id: "nav_pricing", label: "View Pricing Page", description: "/pricing" });
                } else if (/work|how/i.test(lower)) {
                    buttons.push({ id: "nav_how_it_works", label: "How It Works Guide", description: "/how-it-works" });
                } else if (/feature|buffer/i.test(lower)) {
                    buttons.push({ id: "nav_features", label: "Explore Platform Features", description: "/features" });
                }

                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.INITIAL,
                    reply: {
                        text: answerText,
                        ...(buttons.length > 0 ? { buttons } : {}),
                    },
                };
            }

            if (hasServiceDetails(details)) {
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

            const promptText =
                missing.length === 2
                    ? `${greet(msg.customerName)}could you tell me what job you need done and your postcode or area?`
                    : missing[0] === "location"
                        ? `${greet(msg.customerName)}what's the address or postcode for the ${formatServiceForPrompt(details.serviceDescription)}?`
                        : `${greet(msg.customerName)}could you describe the work needed in ${details.customerLocation ?? "your area"}?`;

            return {
                sessionId,
                messageId,
                newState: ConversationState.AWAITING_SERVICE_DETAILS,
                reply: {
                    text: promptText,
                    metadata: { lastAskedFor: askFor },
                },
            };
        }

        case ConversationState.AWAITING_SERVICE_DETAILS: {
            const details = mergeServiceDetails(msg, metadata, aiExtracted);
            const lastAskedFor = (metadata.lastAskedFor as string | undefined) ?? "location";
            const inlineLocation = msg.customerLocation?.trim();
            const inlineService = msg.serviceDescription?.trim();
            const trimmedContent = msg.content.trim();
            const nextMetadata: Record<string, any> = { ...details };

            const isQuestion =
                aiExtracted.intent === "greeting" ||
                aiExtracted.intent === "question" ||
                isGreetingOrQuestion(trimmedContent);

            if (isQuestion && !inlineLocation && !inlineService) {
                const answerText =
                    aiExtracted.assistantResponse ||
                    "TradeSlot matches you with verified local tradespeople with protected 30-minute travel buffers.";
                const promptBack =
                    lastAskedFor === "location"
                        ? `${answerText}\n\nTo match you with available slots, which area or postcode is your job in?`
                        : `${answerText}\n\nTo find you the right technician, what trade service do you need done?`;
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_SERVICE_DETAILS,
                    reply: {
                        text: promptBack,
                        metadata: nextMetadata,
                    },
                };
            }

            if (lastAskedFor === "location") {
                if (inlineLocation || details.customerLocation) {
                    nextMetadata.customerLocation = inlineLocation || details.customerLocation;
                } else if (trimmedContent && !isQuestion) {
                    nextMetadata.customerLocation = trimmedContent;
                }
            } else {
                if (inlineService || details.serviceDescription) {
                    nextMetadata.serviceDescription = inlineService || details.serviceDescription;
                } else if (trimmedContent && !isQuestion) {
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
                        text: `Thanks${nextMetadata.customerName ? ` ${nextMetadata.customerName}` : ""} — what's the address or postcode for the ${formatServiceForPrompt(nextMetadata.serviceDescription)}?`,
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
                        text: `Got it${nextMetadata.customerLocation ? ` for ${nextMetadata.customerLocation}` : ""}. Could you describe the work needed in a sentence or two?`,
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
            let start = new Date(slotId);

            // Natural language slot resolution
            const offeredSlots = (metadata.offeredSlots as Array<{ id: string; label: string }> | undefined) ?? [];
            if (Number.isNaN(start.getTime()) && offeredSlots.length > 0) {
                const preference = (aiExtracted.slotPreference || msg.content).toLowerCase().trim();

                // Check by ordinal / index
                if (/^(1|first|1st)\b/.test(preference) && offeredSlots[0]) {
                    start = new Date(offeredSlots[0].id);
                } else if (/^(2|second|2nd)\b/.test(preference) && offeredSlots[1]) {
                    start = new Date(offeredSlots[1].id);
                } else if (/^(3|third|3rd)\b/.test(preference) && offeredSlots[2]) {
                    start = new Date(offeredSlots[2].id);
                } else if (/^(4|fourth|4th)\b/.test(preference) && offeredSlots[3]) {
                    start = new Date(offeredSlots[3].id);
                } else if (/^(5|fifth|5th)\b/.test(preference) && offeredSlots[4]) {
                    start = new Date(offeredSlots[4].id);
                } else {
                    // Match by time string like "10:00" or "10" or "10am"
                    const timeMatch = preference.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
                    if (timeMatch) {
                        let hour = parseInt(timeMatch[1], 10);
                        const isPm = timeMatch[3] === "pm";
                        const isAm = timeMatch[3] === "am";
                        if (isPm && hour < 12) hour += 12;
                        if (isAm && hour === 12) hour = 0;
                        const hourStr = String(hour).padStart(2, "0");

                        const matched = offeredSlots.find((s) => s.label.startsWith(hourStr) || s.label.includes(`${hour}:00`) || s.label.includes(`${hourStr}:`));
                        if (matched) {
                            start = new Date(matched.id);
                        }
                    }
                }
            }

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
            const phoneRaw = aiExtracted.customerPhone ?? msg.content.trim();

            if (!looksLikePhone(phoneRaw)) {
                return {
                    sessionId,
                    messageId,
                    newState: ConversationState.AWAITING_CONTACT_DETAILS,
                    reply: {
                        text: "That doesn't look like a phone number. Could you type it again as digits, e.g. 01712 345678?",
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
        offeredSlots: chips.map((c) => ({ id: c.id, label: c.label })),
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
    const leadMetadata = {
        ...metadata,
        lead: true,
        leadOutcome: match.outcome,
        leadZoneName: match.zoneName ?? null,
    };

    const zoneInfo = match.zoneName ? `in ${match.zoneName}` : "in today's scheduled zone";

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
                text: `${greet(customerName)}our tradespeople are currently dispatching ${zoneInfo}, so ${locationLabel} is outside today's instant-booking slots. We've saved your enquiry and a trader will call ${phone} to arrange the job!`,
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
            text: `${greet(customerName)}our tradespeople are currently dispatching ${zoneInfo}, so ${locationLabel} is outside today's instant-booking slots — but I can pass your job to a trader anyway! What's the best phone number for them to reach you on?`,
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