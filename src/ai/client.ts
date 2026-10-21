import { setTimeout as delay } from "node:timers/promises";
import { config } from "../config.js";
import { clipped, redact } from "../lib/redact.js";

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string }; }
export interface AIMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; }
export interface AITool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> }; }
export interface AIResult { message: AIMessage; inputTokens: number; outputTokens: number; }
export type Completion = (messages: AIMessage[], tools: AITool[], signal?: AbortSignal) => Promise<AIResult>;

export const complete: Completion = async (messages, tools, signal) => {
  const url = config.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions";
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${config.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.AI_MODEL, messages, tools, tool_choice: "auto", max_completion_tokens: 8192 }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
      redirect: "error",
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel();
      await delay(Math.min(Number(response.headers.get("retry-after")) * 1000 || (attempt + 1) * 2000, 15000), undefined, signal ? { signal } : {});
      continue;
    }
    const raw = await response.text();
    if (!response.ok) throw new Error(`AI provider ${response.status}: ${clipped(redact(raw), 2000)}`);
    const body = JSON.parse(raw) as { choices?: { finish_reason?: string; message?: AIMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("AI response exceeded its output limit. Retry with a smaller task.");
    const message = choice?.message;
    if (!message || message.role !== "assistant" || (!message.content && !message.tool_calls?.length)) throw new Error("AI returned no answer or tool calls. Use a model that supports Chat Completions function tools.");
    if (message.tool_calls && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 12)) throw new Error("Invalid AI tool response");
    return { message: { role: "assistant", content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) }, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
  }
  throw new Error("AI provider retry limit reached");
};
