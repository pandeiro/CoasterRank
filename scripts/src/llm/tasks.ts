import { z } from 'zod'
import type OpenAI from 'openai'
import { lmStudio, MODEL_ID } from './client.js'
import { NORMALIZATION_SYSTEM_PROMPT, ADJUDICATION_SYSTEM_PROMPT } from './prompts.js'

// --- Zod schemas ---

export const NormalizationResult = z.object({
  coaster_id: z.string(),
  cleaned_name: z.string(),
  issue: z.enum(['park_name_embedded', 'truncated', 'abbreviation', 'none']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
})
export type NormalizationResult = z.infer<typeof NormalizationResult>

export const NormalizationBatch = z.array(NormalizationResult)
export type NormalizationBatch = z.infer<typeof NormalizationBatch>

// Schema for raw LLM output (no pair_id — injected by adjudicateOne)
const AdjudicationLLMOutput = z.object({
  verdict: z.enum(['duplicate', 'not_duplicate', 'needs_human']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
})

export const AdjudicationResult = AdjudicationLLMOutput.extend({
  pair_id: z.string(),
})
export type AdjudicationResult = z.infer<typeof AdjudicationResult>

// --- Input types ---

export type NormalizeInput = {
  coaster_id: string
  name: string
  park_name: string
}

export type AdjudicateInput = {
  pair_id: string
  coaster_a: {
    coaster_id: string
    name: string
    park_name: string
    manufacturer: string | null
    opening_date: string | null
    height_m: number | null
  }
  coaster_b: {
    coaster_id: string
    name: string
    park_name: string
    manufacturer: string | null
    opening_date: string | null
    height_m: number | null
  }
  similarity: number
}

// --- Retry helper ---

function safeParseJSON(raw: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(raw) }
  } catch (e) {
    return { ok: false, error: (e as SyntaxError).message }
  }
}

async function callWithRetry<T>(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
): Promise<T> {
  const attempt = async (msgs: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    const completion = await lmStudio.chat.completions.create({
      model: MODEL_ID,
      temperature: 0,
      messages: msgs,
    })
    return completion.choices[0]?.message.content ?? '{}'
  }

  const validate = (
    raw: string,
    attemptNum: number,
  ): { ok: true; data: T } | { ok: false; reason: string } => {
    const json = safeParseJSON(raw)
    if (!json.ok) {
      return { ok: false, reason: `JSON parse error: ${json.error}` }
    }
    const zodResult = schema.safeParse(json.data)
    if (zodResult.success) {
      return { ok: true, data: zodResult.data }
    }
    return { ok: false, reason: `Zod validation failed: ${zodResult.error.message}` }
  }

  const rawFirst = await attempt(messages)
  const first = validate(rawFirst, 1)
  if (first.ok) return first.data

  process.stderr.write(`[llm] ${first.reason} (attempt 1)\n`)
  process.stderr.write(`[llm] Raw response: ${rawFirst}\n`)

  const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    { role: 'assistant', content: rawFirst },
    {
      role: 'user',
      content:
        'Your response did not match the required JSON schema. ' +
        'Output ONLY valid JSON matching the schema. No prose, no markdown.',
    },
  ]
  const rawRetry = await attempt(retryMessages)
  const second = validate(rawRetry, 2)
  if (second.ok) return second.data

  process.stderr.write(`[llm] ${second.reason} (attempt 2)\n`)
  process.stderr.write(`[llm] Raw response: ${rawRetry}\n`)
  throw new Error('LLM response failed Zod validation after retry')
}

// --- Task functions ---

export async function normalizeOne(input: NormalizeInput): Promise<NormalizationResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: NORMALIZATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify([
        { coaster_id: input.coaster_id, name: input.name, park_name: input.park_name },
      ]),
    },
  ]
  const batch = await callWithRetry(messages, NormalizationBatch)
  if (batch.length === 0) {
    throw new Error('LLM returned empty normalization batch')
  }
  return batch[0]!
}

export async function normalizeBatch(records: NormalizeInput[]): Promise<NormalizationBatch> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: NORMALIZATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify(
        records.map((r) => ({ coaster_id: r.coaster_id, name: r.name, park_name: r.park_name })),
      ),
    },
  ]
  const result = await callWithRetry(messages, NormalizationBatch)
  return result
}

export async function adjudicateOne(input: AdjudicateInput): Promise<AdjudicationResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: ADJUDICATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        coaster_a: input.coaster_a,
        coaster_b: input.coaster_b,
        similarity: input.similarity,
      }),
    },
  ]
  const result = await callWithRetry(messages, AdjudicationLLMOutput)
  return { ...result, pair_id: input.pair_id }
}
