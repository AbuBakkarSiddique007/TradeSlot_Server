/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChannelType } from "../../../generated/prisma/enums";


export interface NormalizedMessage {
  channelType: ChannelType;
  senderRef: string;
  customerName?: string;
  content: string;
  timestamp: Date;
  rawPayload?: unknown;
}


export interface IReplyMessage {
  text: string;
  options?: {
    buttons?: Array<{ id: string; label: string }>;
    chips?: Array<{ id: string; label: string }>;
  };
}


export interface IChannelAdapter {
  readonly channelType: ChannelType;
  normalize(req: any): Promise<NormalizedMessage | null>;
  sendReply(senderRef: string, reply: IReplyMessage): Promise<void>;
}


export const pickString = (...candidates: Array<unknown>): string | undefined => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
};
