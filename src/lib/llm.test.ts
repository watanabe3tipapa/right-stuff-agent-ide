import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../shared/types";
import { PROVIDER_PRESETS, SYSTEM_PROMPT, toRequestMessages } from "./llm";

function message(
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `${role}-${text}`,
    role,
    text,
    createdAt: 0,
    ...extra,
  };
}

describe("llm request messages", () => {
  it("starts with the system prompt", () => {
    const result = toRequestMessages([message("user", "こんにちは")]);

    expect(result[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
  });

  it("maps agent replies to the assistant role", () => {
    const result = toRequestMessages([
      message("user", "質問"),
      message("agent", "回答"),
    ]);

    expect(result.slice(1)).toEqual([
      { role: "user", content: "質問" },
      { role: "assistant", content: "回答" },
    ]);
  });

  it("drops local notices, command output and empty text", () => {
    const result = toRequestMessages([
      message("agent", "ローカル通知", { local: true }),
      message("user", "/status", { local: true }),
      message("agent", "snapshot", { command: "agent-desktop snapshot" }),
      message("user", "   "),
      message("system", "システム通知"),
      message("user", "残す"),
    ]);

    expect(result.slice(1)).toEqual([{ role: "user", content: "残す" }]);
  });

  it("keeps only the most recent messages", () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      message("user", `message-${index}`),
    );

    const result = toRequestMessages(messages, 5);

    expect(result).toHaveLength(6);
    expect(result[1]?.content).toBe("message-25");
    expect(result[5]?.content).toBe("message-29");
  });
});

describe("provider presets", () => {
  it("uses https for hosted providers and localhost for local ones", () => {
    expect(PROVIDER_PRESETS.openai.baseUrl).toMatch(/^https:\/\//);
    expect(PROVIDER_PRESETS.openrouter.baseUrl).toMatch(/^https:\/\//);
    expect(PROVIDER_PRESETS.ollama.baseUrl).toContain("localhost");
    expect(PROVIDER_PRESETS.lmstudio.baseUrl).toContain("localhost");
  });
});
