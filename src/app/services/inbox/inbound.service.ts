/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "../../lib/prisma";
import { ConversationState } from "../../../generated/prisma/enums";
import { NormalizedMessage } from "../channels/types";

export interface InboundContext {
  sessionId: string;
  messageId: string;
  customerId: string | null;
  state: ConversationState;
  metadata: Record<string, any> | null;
}

export const ingestInboundMessage = async (
  msg: NormalizedMessage,
): Promise<InboundContext> => {

  const customer = await prisma.customer.upsert({
    where: { phone: msg.senderRef },
    update: msg.customerName ? { name: msg.customerName } : {},
    create: {
      phone: msg.senderRef,
      name: msg.customerName ?? null,
    },
  });

  const customerId = customer.id;


  const session = await prisma.chatSession.upsert({
    where: {
      channelType_senderRef: {
        channelType: msg.channelType,
        senderRef: msg.senderRef,
      },
    },
    update: {
      lastInteraction: msg.timestamp,
      customerId,
    },
    create: {
      channelType: msg.channelType,
      senderRef: msg.senderRef,
      customerId,
      state: ConversationState.INITIAL,
      lastInteraction: msg.timestamp,
    },
  });


  const message = await prisma.inboundMessage.create({
    data: {
      sessionId: session.id,
      channelType: msg.channelType,
      senderRef: msg.senderRef,
      content: msg.content,
      rawPayload: (msg.rawPayload as any) ?? undefined,
      timestamp: msg.timestamp,
    },
  });

  return {
    sessionId: session.id,
    messageId: message.id,
    customerId,
    state: session.state,
    metadata: (session.metadata as Record<string, any> | null) ?? null,
  };
};


export const updateSessionState = async (
  sessionId: string,
  nextState: ConversationState,
  metadataPatch?: Record<string, any>,
) => {
  const existing = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  const merged = { ...((existing?.metadata as object) ?? {}), ...(metadataPatch ?? {}) };

  return prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      state: nextState,
      metadata: merged,
      lastInteraction: new Date(),
    },
  });
};
