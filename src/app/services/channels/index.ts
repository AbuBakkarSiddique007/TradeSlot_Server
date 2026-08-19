import { MockWhatsAppAdapter } from "./WhatsAppAdapter.mock";
import { WebChatbotAdapter } from "./WebChatbotAdapter";
import { IChannelAdapter } from "./types";

export interface ChannelBundle {
  whatsapp: IChannelAdapter;
  webchat: IChannelAdapter;
}


export const buildChannels = (): ChannelBundle => ({
  whatsapp: new MockWhatsAppAdapter(),
  webchat: new WebChatbotAdapter(),
});


let cached: ChannelBundle | null = null;
export const getChannels = (): ChannelBundle => {
  if (!cached) cached = buildChannels();
  return cached;
};

export type { NormalizedMessage, IChannelAdapter, IReplyMessage } from "./types";
