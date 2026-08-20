/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChannelType } from "../../../generated/prisma/enums";
import {
  IChannelAdapter,
  IReplyMessage,
  NormalizedMessage,
  pickString,
} from "./types";


export class MockWhatsAppAdapter implements IChannelAdapter {
  public readonly channelType = ChannelType.WHATSAPP;

  async normalize(req: any): Promise<NormalizedMessage | null> {
    const payload = req?.body;

    if (payload?.entry?.length) {
      const change = payload.entry[0]?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      if (msg?.type === "text") {
        const contact = value?.contacts?.[0];
        return {
          channelType: ChannelType.WHATSAPP,
          senderRef: msg.from,
          customerName: pickString(contact?.profile?.name),
          content: msg.text.body,
          timestamp: msg.timestamp
            ? new Date(Number(msg.timestamp) * 1000)
            : new Date(),
          rawPayload: payload,
        };
      }
    }

    const senderRef = pickString(payload?.from, payload?.senderRef);
    const content = pickString(payload?.body, payload?.content, payload?.text);
    if (!senderRef || !content) return null;

    return {
      channelType: ChannelType.WHATSAPP,
      senderRef,
      customerName: pickString(payload?.profileName, payload?.customerName),
      content,
      timestamp: new Date(),
      rawPayload: payload,
    };
  }

  async sendReply(senderRef: string, reply: IReplyMessage): Promise<void> {
    const line = `[MOCK-WA → ${senderRef}] ${reply.text}${
      reply.buttons?.length
        ? " [buttons: " + reply.buttons.map((b) => b.label).join(", ") + "]"
        : ""
    }\n`;
    process.stdout.write(line);

    try {
      const fs = await import("node:fs/promises");
      await fs.appendFile(
        "/tmp/tradeslot-mock-wa-outbox.log",
        `${new Date().toISOString()} ${line}`,
        "utf8",
      );
    } catch {
      console.log("Something went wrong!");
    }
  }
}
