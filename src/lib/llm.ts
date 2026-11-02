import type {
  ChatMessage,
  LlmChatMessage,
  LlmConfig,
  LlmProvider,
} from "../shared/types";

export interface ProviderPreset {
  label: string;
  description: string;
  baseUrl: string;
  model: string;
  keyRequired: boolean;
}

export const PROVIDER_ORDER: LlmProvider[] = [
  "openai",
  "ollama",
  "lmstudio",
  "openrouter",
  "custom",
];

export const PROVIDER_PRESETS: Record<LlmProvider, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    description: "OpenAI 公式 API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyRequired: true,
  },
  ollama: {
    label: "Ollama",
    description: "ローカルで動く Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    keyRequired: false,
  },
  lmstudio: {
    label: "LM Studio",
    description: "ローカルの OpenAI 互換サーバー",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    keyRequired: false,
  },
  openrouter: {
    label: "OpenRouter",
    description: "複数のモデルをまとめて利用",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyRequired: true,
  },
  custom: {
    label: "カスタム",
    description: "OpenAI 互換の任意エンドポイント",
    baseUrl: "",
    model: "",
    keyRequired: false,
  },
};

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "openai",
  baseUrl: PROVIDER_PRESETS.openai.baseUrl,
  model: PROVIDER_PRESETS.openai.model,
  temperature: 0.7,
  maxTokens: 2048,
};

export const SYSTEM_PROMPT = [
  "あなたは Right-Stuff Agent IDE のコーディングアシスタントです。",
  "日本語で簡潔に回答してください。",
  "不確実なことは推測せず、確認が必要な点を明示してください。",
  "LLM から直接ファイルや OS を操作することはできません。提案と説明のみを行ってください。",
].join("\n");

/**
 * Convert the visible chat transcript into the OpenAI-compatible message
 * format. Local notices and command output are intentionally excluded.
 */
export function toRequestMessages(
  messages: ChatMessage[],
  limit = 20,
): LlmChatMessage[] {
  const history = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "agent") &&
        !message.local &&
        !message.command &&
        message.text.trim().length > 0,
    )
    .slice(-limit)
    .map<LlmChatMessage>((message) => ({
      role: message.role === "agent" ? "assistant" : "user",
      content: message.text,
    }));

  return [{ role: "system", content: SYSTEM_PROMPT }, ...history];
}
