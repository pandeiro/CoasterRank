import { z } from "zod";
import type OpenAI from "openai";
import { lmStudio, MODEL_ID } from "./client.js";
import { NORMALIZATION_SYSTEM_PROMPT, ADJUDICATION_SYSTEM_PROMPT } from "./prompts.js";

// --- Zod schemas ---

export const NormalizationResult = z.object({
  coaster_id: z.string(),
  cleaned_name: z.string(),
  issue: z.enum(["park_name_embedded", "truncated", "abbreviation", "none"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});
export type NormalizationResult = z.infer<typeof NormalizationResult>;

export const NormalizationBatch = z.array(NormalizationResult);
export type NormalizationBatch = z.infer<typeof NormalizationBatch>;

export const AdjudicationResult = z.object({
  pair_id: z.string(),
  verdict: z.enum(["duplicate", "not_duplicate", "needs_human"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});
export type AdjudicationResult = z.infer<typeof AdjudicationResult>;

// --- Input types ---

export type NormalizeInput = {
  coaster_id: string;
  name: string;
  park_name: string;
};

export type AdjudicateInput = {
  pair_id: string;
  coaster_a: {
    coaster_id: string;
    name: string;
    park_name: string;
    manufacturer: string | null;
    opening_date: string | null;
    height_m: number | null;
  };
  coaster_b: {
    coaster_id: string;
    name: string;
    park_name: string;
    manufacturer: string | null;
    opening_date: string | null;
    height_m: number | null;
  };
  similarity: number;
};

// --- Retry helper ---

async function callWithRetry<T>(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
): Promise<T> {
  const attempt = async (msgs: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    const completion = await lmStudio.chat.completions.create({
      model: MODEL_ID,
      temperature: 0,
      messages: msgs,
      response_format: { type: "json_object" },
    });
    return completion.choices[0]?.message.content ?? "{}";
  };

  const rawFirst = await attempt(messages);
  const firstParse = schema.safeParse(JSON.parse(rawFirst));
  if (firstParse.success) return firstParse.data;

  process.stderr.write(`[llm] Zod validation failed (attempt 1): ${firstParse.error.message}\n`);
  process.stderr.write(`[llm] Raw response: ${rawFirst}\n`);

  const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    { role: "assistant", content: rawFirst },
    {
      role: "user",
      content:
        "Your response did not match the required JSON schema. " +
        "Output ONLY valid JSON matching the schema. No prose, no markdown.",
    },
  ];
  const rawRetry = await attempt(retryMessages);
  const retryParse = schema.safeParse(JSON.parse(rawRetry));
  if (retryParse.success) return retryParse.data;

  process.stderr.write(`[llm] Zod validation failed (attempt 2): ${retryParse.error.message}\n`);
  process.stderr.write(`[llm] Raw response: ${rawRetry}\n`);
  throw new Error("LLM response failed Zod validation after retry");
}

// --- Task functions ---

export async function normalizeOne(input: NormalizeInput): Promise<NormalizationResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: NORMALIZATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify([
        { coaster_id: input.coaster_id, name: input.name, park_name: input.park_name },
      ]),
    },
  ];
  const batch = await callWithRetry(messages, NormalizationBatch);
  return batch[0]!;
}

export async function normalizeBatch(records: NormalizeInput[]): Promise<NormalizationBatch> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: NORMALIZATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(
        records.map((r) => ({ coaster_id: r.coaster_id, name: r.name, park_name: r.park_name })),
      ),
    },
  ];
  const result = await callWithRetry(messages, NormalizationBatch);
  return result;
}

export async function adjudicateOne(input: AdjudicateInput): Promise<AdjudicationResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: ADJUDICATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        coaster_a: input.coaster_a,
        coaster_b: input.coaster_b,
        similarity: input.similarity,
      }),
    },
  ];
  const result = await callWithRetry(messages, AdjudicationResult);
  // The LLM returns without pair_id; we inject it from the input.
  return { ...result, pair_id: input.pair_id };
}
