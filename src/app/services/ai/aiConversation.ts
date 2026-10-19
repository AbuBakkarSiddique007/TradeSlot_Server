/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * aiConversation.ts
 *
 * Responsibilities:
 * 1. EXTRACT — analyze natural language messages from customers to extract
 *    { customerName, customerLocation, serviceDescription, slotPreference, customerPhone, intent }
 * 2. ASSIST — provide warm, user-friendly onboarding guidance when new users greet, ask questions,
 *    or inquire about currently covered regions.
 * 3. REPHRASE — polish bot replies to sound welcoming, human, and clear.
 *
 * Provides a graceful fallback when AI provider keys are not yet configured.
 */

import { getAIProvider } from "./aiProvider";
import type { AIChatMessage } from "./aiProvider";

// ── Extraction Types ────────────────────────────────────────────────────────

export interface ExtractedIntent {
  customerName?: string | null;
  customerLocation?: string | null;
  serviceDescription?: string | null;
  slotPreference?: string | null;
  customerPhone?: string | null;
  intent: "greeting" | "question" | "book" | "slot_select" | "phone" | "unknown";
  assistantResponse?: string | null;
  _raw?: string;
}

export interface CoverageContext {
  hasActiveZone: boolean;
  zoneName?: string;
  postalCodes: string[];
  summary: string;
}

const BD_POSTCODE_REGEX = /\b(1[0-3]\d{2}|4[0-3]\d{2}|[1-9]\d{3})\b/;
const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const AREA_KEYWORDS_REGEX =
  /\b(GEC|Khulshi|Agrabad|Nasirabad|Halishahar|Panchlaish|Muradpur|Bahaddarhat|Chawkbazar|Chandgaon|Kotwali|Patenga|Lalkhan\s*Bazar|Anderkilla|Gulshan|Banani|Dhanmondi|Mirpur|Uttara|Mohammadpur|Badda|Motijheel|Bashundhara|Mohakhali|Tejgaon|Lalmatia|Shantinagar|Malibagh|Rampura|Khilgaon|Baridhara|Chattogram|Chittagong|Dhaka|Sylhet|Rajshahi|Khulna|London|Camden|Battersea)\b/i;

const PHONE_REGEX =
  /(?:(?:\+880\s?|880\s?|0)1[3-9]\d{2}\s?\d{3}\s?\d{3}|(?:\+44\s?\(0\)\s?|\+44\s?|0)(?:7\d{3}|[123]\d{2,3})\s?\d{3}\s?\d{3,4}|\b\d{10,12}\b)/;

const GREETING_REGEX =
  /^(hi|hello|hey|good morning|good afternoon|good evening|salam|assalamu alaikum|hiya|yo)\b/i;
const REGION_QUERY_REGEX =
  /(which (areas|regions|postcodes|locations|cities|towns|zones)|where (do you|are you) (cover|operating|operate|work|based)|what (areas|regions|zones) (do you|are you)|do you cover|are you available in|coverage area|service area)\b/i;
const PRICING_REGEX =
  /(price|pricing|how much|cost|fees?|charges?|rates?|subscription|how much do you charge)\b/i;
const FEATURES_REGEX =
  /(features?|buffer|travel buffer|buffer math|what can you do|capabilities|why tradeslot)\b/i;
const HOW_IT_WORKS_REGEX =
  /(how does (this|it|tradeslot|everything|the platform) work|how (does it|to) work|how it works|workflow|steps to book)\b/i;
const QUESTION_REGEX =
  /(how does (this|it|tradeslot|everything|the platform) work|how (does it|to) work|how it works|what (is this|do you do|services|is tradeslot)|how much|pricing|price|cost|fee|features?|buffer|who are you|can you help|\?)/i;

const buildSystemPrompt = (coverageSummary?: string) => `You are a helpful, expert AI booking assistant for TradeSlot, an automated on-demand trade service booking platform.
Your job is to analyze the customer's message, understand their intent, extract all relevant booking information, and assist them if they are new or have questions.

TradeSlot connects customers with vetted, reliable tradespeople (electrician, AC repair & servicing, plumber & water motor, refrigerator repair, appliance technician, carpenter, painting, etc.) with upfront pricing and automated time-slot scheduling.

Currently Active Trading Coverage: ${coverageSummary || "Active local zones (Chattogram / Dhaka / Bangladesh-wide)"}

Analyze the user's message and return ONLY a valid JSON object matching this schema:
{
  "customerName": string | null,
  "customerLocation": string | null,
  "serviceDescription": string | null,
  "slotPreference": string | null,
  "customerPhone": string | null,
  "intent": "greeting" | "question" | "book" | "slot_select" | "phone" | "unknown",
  "assistantResponse": string | null
}

Rules:
1. "customerLocation": Extract clean area names (e.g. "GEC", "Agrabad", "Khulshi", "Gulshan", "Dhanmondi", "Mirpur", "Camden") or 4-digit postcodes (e.g. "4000", "1205", "1212"). Do not include words like "in" or "postcode".
2. "serviceDescription": Extract ONLY the specific trade job (e.g. "AC servicing", "leaking water pipe", "ceiling fan wiring", "plumber", "replace switch board"). Omit filler words, greetings, or locations.
3. "customerName": Extract the user's name if they introduced themselves (e.g. "I'm Tanvir", "My name is John").
4. "slotPreference": If the user is picking a slot (e.g. "10:00", "10am", "first one", "slot 1", "2pm"), extract the chosen time or index.
5. "customerPhone": Extract any valid phone number (e.g. "01712345678").
6. "intent":
   - "greeting": User says hello or introduces themselves without describing a job.
   - "question": User asks what TradeSlot is, how it works, what regions/areas are covered, what services are offered, pricing, or platform features.
   - "book": User describes a job or provides a location for booking.
   - "slot_select": User indicates a time slot.
   - "phone": User provides contact phone number.
   - "unknown": Anything else.
7. "assistantResponse":
   - If user asks how TradeSlot works: explain clearly in 2 sentences that they describe their trade job & location, pick a convenient protected time slot, and a verified technician arrives on schedule.
   - If user asks about pricing / cost / fees: explain that TradeSlot features 100% transparent pricing with zero subscription lock-ins or lead bidding. Tradespeople pay a flat platform fee (£15 flat fee) only on confirmed bookings, while customers get clear upfront pricing.
   - If user asks about features / capabilities: highlight our 4 key pillars: 1) Automated 30-minute travel buffers to eliminate late arrivals. 2) Dual intake via Webchat & WhatsApp. 3) Daily zone geofencing. 4) Direct digital payouts via Stripe Connect.
   - If user asks about covered areas/regions: clearly tell them the Currently Active Trading Coverage. Explain that if their job is outside today's instant slots, they can still request a trade and we will connect them with a local technician.
   - If user greets or asks general questions: provide a warm, 1-2 sentence response welcoming them to TradeSlot and asking what trade job they need help with and their area/postcode.
8. NEVER wrap your output in markdown code blocks. Output ONLY raw valid JSON.`;

// ── Fallback Heuristic Extractor ───────────────────────────────────────────

function fallbackExtract(userContent: string, activeCoverage?: CoverageContext | null): ExtractedIntent {
  const trimmed = userContent.trim();
  let customerLocation: string | null = null;
  let serviceDescription: string | null = null;
  let customerPhone: string | null = null;
  let customerName: string | null = null;
  let slotPreference: string | null = null;
  let intent: ExtractedIntent["intent"] = "unknown";
  let assistantResponse: string | null = null;

  // Phone match
  const phoneMatch = trimmed.match(PHONE_REGEX);
  if (phoneMatch) {
    customerPhone = phoneMatch[0].replace(/\s+/g, "");
    intent = "phone";
  }

  // Name match: "my name is X" or "I am X" or "I'm X"
  const nameMatch = trimmed.match(/\b(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  if (nameMatch && nameMatch[1]) {
    customerName = nameMatch[1].trim();
  }

  // Postcode / Area match
  const bdMatch = trimmed.match(BD_POSTCODE_REGEX);
  if (bdMatch && bdMatch[1]) {
    customerLocation = bdMatch[1].trim();
  } else {
    const ukMatch = trimmed.match(UK_POSTCODE_REGEX);
    if (ukMatch && ukMatch[1]) {
      customerLocation = ukMatch[1].trim();
    } else {
      const areaMatch = trimmed.match(AREA_KEYWORDS_REGEX);
      if (areaMatch && areaMatch[1]) {
        customerLocation = areaMatch[1].trim();
      }
    }
  }

  // Service extraction
  if (customerLocation) {
    const srv = trimmed
      .replace(BD_POSTCODE_REGEX, "")
      .replace(UK_POSTCODE_REGEX, "")
      .replace(AREA_KEYWORDS_REGEX, "")
      .replace(/\b(my name is|i am|i'm)\s+[A-Za-z]+\b/gi, "")
      .replace(/\b(at|in|near|postcode|address|location|for|please|hello|hi|hey|i need|can you help with)\b/gi, "")
      .replace(/[,.]$/, "")
      .trim();
    if (srv.length > 2) {
      serviceDescription = srv;
    }
  }

  // Slot preference match (e.g. "10:00", "10am", "first", "1")
  const slotMatch = trimmed.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|first|second|third|1st|2nd|3rd)\b/i);
  if (slotMatch && !customerLocation && !serviceDescription) {
    slotPreference = slotMatch[1];
  }

  // Intent classification
  if (customerLocation || serviceDescription) {
    intent = "book";
  } else if (slotPreference) {
    intent = "slot_select";
  } else if (customerPhone) {
    intent = "phone";
  } else if (REGION_QUERY_REGEX.test(trimmed)) {
    intent = "question";
    assistantResponse = activeCoverage?.hasActiveZone
      ? `Our tradespeople are currently dispatching in ${activeCoverage.summary}. If you're outside this area, you can still tell us your job and area/postcode, and we'll match you directly with a local technician!`
      : "We cover trades across Bangladesh. Tell us what service you need and your area or postcode to check instant availability!";
  } else if (PRICING_REGEX.test(trimmed)) {
    intent = "question";
    assistantResponse =
      "TradeSlot features 100% transparent pricing with zero subscription lock-ins or lead bidding. Tradespeople only pay a flat £15 platform fee per confirmed booking, while customers get clear upfront pricing. Visit our Pricing page (/pricing) to view the live calculator!";
  } else if (FEATURES_REGEX.test(trimmed)) {
    intent = "question";
    assistantResponse =
      "TradeSlot is built around 4 core features: 1) Mandatory 30-minute travel buffer scheduling to guarantee on-time arrivals. 2) Instant booking via Webchat & WhatsApp. 3) Daily zone geofencing. 4) Direct bank payouts via Stripe Connect.";
  } else if (HOW_IT_WORKS_REGEX.test(trimmed) || trimmed.toLowerCase().includes("work")) {
    intent = "question";
    assistantResponse =
      "TradeSlot makes booking trusted trades easy: 1) Describe your service & location. 2) Pick an available time slot. 3) A vetted tradesperson arrives on time! What job do you need done today?";
  } else if (QUESTION_REGEX.test(trimmed)) {
    intent = "question";
    assistantResponse =
      "Hello! TradeSlot connects you with vetted local technicians (AC servicing, plumbing, electrical, home repairs). What service do you need help with and what's your area or postcode?";
  } else if (GREETING_REGEX.test(trimmed)) {
    intent = "greeting";
    assistantResponse =
      `Hello${customerName ? ` ${customerName}` : ""}! I am your TradeSlot booking assistant. What trade service do you need done and what's your area or postcode?`;
  }

  return {
    customerName,
    customerLocation,
    serviceDescription,
    slotPreference,
    customerPhone,
    intent,
    assistantResponse,
  };
}

// ── Main Extract Function ──────────────────────────────────────────────────

export async function extractFromMessage(
  userContent: string,
  context: {
    currentState: string;
    metadata: Record<string, any> | null;
    activeCoverage?: CoverageContext | null;
    conversationHistory?: Array<{ role: "user" | "model"; content: string }>;
  },
): Promise<ExtractedIntent> {
  const provider = await getAIProvider();
  if (!provider) {
    return fallbackExtract(userContent, context.activeCoverage);
  }

  const contextSummary = [
    `Current booking state: ${context.currentState}`,
    context.activeCoverage?.summary
      ? `Currently active coverage zone: ${context.activeCoverage.summary}`
      : null,
    context.metadata?.customerName ? `Known customer name: ${context.metadata.customerName}` : null,
    context.metadata?.customerLocation ? `Known location: ${context.metadata.customerLocation}` : null,
    context.metadata?.serviceDescription ? `Known service: ${context.metadata.serviceDescription}` : null,
    context.metadata?.offeredSlots
      ? `Currently offered slots: ${JSON.stringify(context.metadata.offeredSlots)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = buildSystemPrompt(context.activeCoverage?.summary);

  const messages: AIChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...(context.conversationHistory ?? []),
    {
      role: "user",
      content: `Context:\n${contextSummary}\n\nCustomer message: "${userContent}"`,
    },
  ];

  try {
    const raw = await provider.complete(messages);
    const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as ExtractedIntent;
    parsed._raw = raw;

    // Merge fallback if AI left any field blank that heuristic detected
    const fallback = fallbackExtract(userContent, context.activeCoverage);
    if (!parsed.customerLocation && fallback.customerLocation) {
      parsed.customerLocation = fallback.customerLocation;
    }
    if (!parsed.customerName && fallback.customerName) {
      parsed.customerName = fallback.customerName;
    }
    if (!parsed.serviceDescription && fallback.serviceDescription) {
      parsed.serviceDescription = fallback.serviceDescription;
    }
    if (!parsed.customerPhone && fallback.customerPhone) {
      parsed.customerPhone = fallback.customerPhone;
    }
    if (!parsed.slotPreference && fallback.slotPreference) {
      parsed.slotPreference = fallback.slotPreference;
    }
    if (!parsed.assistantResponse && fallback.assistantResponse) {
      parsed.assistantResponse = fallback.assistantResponse;
    }

    return parsed;
  } catch (err) {
    console.warn("[aiConversation] extractFromMessage error, using fallback:", err);
    return fallbackExtract(userContent, context.activeCoverage);
  }
}

// ── Rephrasing ──────────────────────────────────────────────────────────────

const REPHRASE_SYSTEM = `You are TradeSlot Assistant — a friendly, concise trade booking chatbot in Bangladesh.
Rephrase the given bot reply to sound warm, natural, and helpful to a first-time user.
Keep all factual details (dates, times, amounts, links, button text) strictly unchanged.
Use polite English (simple, friendly). Maximum 2 to 3 sentences. Do NOT add invented information.
Return ONLY the rephrased text — no quotes, no markdown.`;

export async function rephraseReply(
  originalText: string,
  context: {
    customerName?: string | null;
    currentState: string;
  },
): Promise<string> {
  const provider = await getAIProvider();
  if (!provider) return originalText;

  // Don't rephrase very short messages or messages containing links
  if (originalText.length < 15 || originalText.includes("http")) {
    return originalText;
  }

  const messages: AIChatMessage[] = [
    { role: "system", content: REPHRASE_SYSTEM },
    {
      role: "user",
      content: [
        context.customerName ? `Customer name: ${context.customerName}` : null,
        `Current booking state: ${context.currentState}`,
        `Original reply: ${originalText}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const rephrased = await provider.complete(messages);
    const clean = rephrased.trim();
    return clean.length > 10 ? clean : originalText;
  } catch {
    return originalText;
  }
}
