/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChannelType } from "../../../generated/prisma/enums";

export interface NormalizedMessage {
  channelType: ChannelType;
  senderRef: string;
  customerName?: string;
  customerLocation?: string;
  serviceDescription?: string;
  content: string;
  timestamp: Date;
  rawPayload?: any;
}

export interface IReplyMessage {
  text: string;
  options?: ReplyOption[];
  buttons?: ButtonOption[];
  metadata?: Record<string, any>;
}

export interface ReplyOption {
  id: string;
  label: string;
  description?: string;
}

export interface ButtonOption {
  id: string;
  label: string;
  description?: string;
}

export interface IChannelAdapter {
  channelType: ChannelType;
  normalize(req: any): Promise<NormalizedMessage | null>;
  sendReply(senderRef: string, reply: IReplyMessage): Promise<void>;
}

export function pickString(...candidates: any[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c;
    }
  }
  return undefined;
}
