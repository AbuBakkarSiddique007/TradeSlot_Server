/**
 * aiProvider.ts
 *
 * Thin abstraction over Gemini (primary) and Groq (fallback).
 * Both are configured via env vars; if neither is configured the
 * service degrades silently so the booking engine still works.
 */

export interface AIChatMessage {
  role: "user" | "model" | "system";
  content: string;
}

export interface AIProvider {
  name: string;
  complete(messages: AIChatMessage[]): Promise<string>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[aiProvider] ${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ── Gemini ─────────────────────────────────────────────────────────────────
async function buildGeminiProvider(): Promise<AIProvider | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("placeholder") || apiKey.length < 10) return null;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey });

    // Fast candidate models
    const candidateModels = ["gemini-2.5-flash", "gemini-3.8-flash"];

    return {
      name: "gemini",
      async complete(messages) {
        const systemMsg = messages.find((m) => m.role === "system");
        const turns = messages.filter((m) => m.role !== "system");

        const history = turns.slice(0, -1).map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        }));

        const lastMessage = turns[turns.length - 1]?.content ?? "";

        let lastErr: unknown;
        for (const model of candidateModels) {
          try {
            const chat = client.chats.create({
              model,
              config: {
                systemInstruction: systemMsg?.content,
                temperature: 0.3,
              },
              history,
            });
            const response = await withTimeout(
              chat.sendMessage({ message: lastMessage }),
              3500,
              `Gemini ${model}`,
            );
            if (response.text) return response.text;
          } catch (err) {
            lastErr = err;
          }
        }
        throw lastErr;
      },
    };
  } catch (err) {
    console.warn("[aiProvider] Gemini init failed:", err);
    return null;
  }
}

// ── Groq ───────────────────────────────────────────────────────────────────
async function buildGroqProvider(): Promise<AIProvider | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes("placeholder") || !apiKey.startsWith("gsk_")) return null;

  try {
    const { default: Groq } = await import("groq-sdk");
    const client = new Groq({ apiKey });

    // Available Groq models for instant text completion
    const candidateModels = [
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
    ];

    return {
      name: "groq",
      async complete(messages) {
        const mapped = messages.map((m) => ({
          role: m.role === "model" ? ("assistant" as const) : (m.role as "user" | "system"),
          content: m.content,
        }));

        let lastErr: unknown;
        for (const model of candidateModels) {
          try {
            const res = await withTimeout(
              client.chat.completions.create({
                model,
                messages: mapped,
                temperature: 0.3,
                max_tokens: 512,
              }),
              3500,
              `Groq ${model}`,
            );
            const text = res.choices[0]?.message?.content;
            if (text) return text;
          } catch (err) {
            lastErr = err;
          }
        }
        throw lastErr;
      },
    };
  } catch (err) {
    console.warn("[aiProvider] Groq init failed:", err);
    return null;
  }
}

// ── Cascading Provider (Gemini with Groq fallback) ─────────────────────────
let _resolvedProvider: AIProvider | null = null;

export async function getAIProvider(): Promise<AIProvider | null> {
  if (_resolvedProvider) return _resolvedProvider;

  const gemini = await buildGeminiProvider();
  const groq = await buildGroqProvider();

  if (!gemini && !groq) return null;

  _resolvedProvider = {
    name: gemini ? "gemini+groq-fallback" : "groq",
    async complete(messages) {
      if (gemini) {
        try {
          return await gemini.complete(messages);
        } catch (err) {
          console.warn("[aiProvider] Gemini failed or timed out, trying Groq fallback:", err);
        }
      }
      if (groq) {
        try {
          return await groq.complete(messages);
        } catch (err) {
          console.warn("[aiProvider] Groq fallback failed or timed out:", err);
        }
      }
      throw new Error("[aiProvider] All AI providers failed or timed out");
    },
  };

  return _resolvedProvider;
}
