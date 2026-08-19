/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChannelType } from "../../../generated/prisma/enums";
import { IChannelAdapter, IReplyMessage, NormalizedMessage, pickString } from "./types";

export class WebChatbotAdapter implements IChannelAdapter {
  public readonly channelType = ChannelType.WEB_CHATBOT;

  async normalize(req: any): Promise<NormalizedMessage | null> {
    const body = req?.body ?? {};
    const senderRef = pickString(body.senderRef, body.sessionId, body.sender);
    const content = pickString(body.content, body.message, body.text);

    if (!senderRef || !content) {
      return null;
    }

    const customerName = pickString(body.customerName, body.name);

    return {
      channelType: ChannelType.WEB_CHATBOT,
      senderRef,
      customerName,
      content,
      timestamp: new Date(),
      rawPayload: req.body,
    };
  }


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendReply(_senderRef: string, _reply: IReplyMessage): Promise<void> {
    return;
  }
}
