import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// Mock the LLM client before importing tasks
vi.mock('../llm/client.js', () => ({
  lmStudio: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  MODEL_ID: 'qwen3.8-27b',
}))

import { lmStudio } from '../llm/client.js'
import { normalizeOne, normalizeBatch, adjudicateOne } from '../llm/tasks.js'
import type { NormalizeInput, AdjudicateInput } from '../llm/tasks.js'

const mockCreate = vi.mocked(lmStudio.chat.completions.create)

function makeValidNormalizationResponse(overrides?: Record<string, unknown>) {
  return JSON.stringify([
    {
      coaster_id: 'test-id',
      cleaned_name: 'Fury 325',
      issue: 'none',
      confidence: 1.0,
      reasoning: 'Name is correct',
      ...overrides,
    },
  ])
}

function makeValidAdjudicationResponse(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    verdict: 'duplicate',
    confidence: 0.9,
    reasoning: 'Same coaster',
    ...overrides,
  })
}

const sampleNormalizeInput: NormalizeInput = {
  coaster_id: 'test-id',
  name: 'Fury 325',
  park_name: 'Carowinds',
}

const sampleAdjudicateInput: AdjudicateInput = {
  pair_id: 'pair-1',
  coaster_a: {
    coaster_id: 'a1',
    name: 'Fury 325',
    park_name: 'Carowinds',
    manufacturer: 'B&M',
    opening_date: '2015-03-27',
    height_m: 94,
  },
  coaster_b: {
    coaster_id: 'a2',
    name: 'Fury 325 ',
    park_name: 'Carowinds',
    manufacturer: null,
    opening_date: '2015',
    height_m: null,
  },
  similarity: 0.95,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Feature: track-a-data-quality, Property 2: Retry-then-throw on double parse failure
describe('callWithRetry retry behavior', () => {
  it('calls LLM exactly twice before throwing on double Zod failure (normalizeOne)', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: invalidJson } }],
    } as never)

    await expect(normalizeOne(sampleNormalizeInput)).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )

    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('calls LLM exactly twice before throwing on double Zod failure (adjudicateOne)', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: invalidJson } }],
    } as never)

    await expect(adjudicateOne(sampleAdjudicateInput)).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )

    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('calls LLM exactly twice before throwing on double Zod failure (normalizeBatch)', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: invalidJson } }],
    } as never)

    await expect(normalizeBatch([sampleNormalizeInput])).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )

    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('returns result on first valid attempt without retrying (normalizeOne)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: makeValidNormalizationResponse() } }],
    } as never)

    const result = await normalizeOne(sampleNormalizeInput)
    expect(result.coaster_id).toBe('test-id')
    expect(result.cleaned_name).toBe('Fury 325')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('retries once and succeeds on second attempt (normalizeOne)', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: invalidJson } }],
      } as never)
      .mockResolvedValueOnce({
        choices: [{ message: { content: makeValidNormalizationResponse() } }],
      } as never)

    const result = await normalizeOne(sampleNormalizeInput)
    expect(result.coaster_id).toBe('test-id')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('sends schema-reminder user turn on retry', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: invalidJson } }],
      } as never)
      .mockResolvedValueOnce({
        choices: [{ message: { content: makeValidNormalizationResponse() } }],
      } as never)

    await normalizeOne(sampleNormalizeInput)

    const retryCall = mockCreate.mock.calls[1]![0]
    const retryMessages = retryCall.messages as Array<{ role: string; content: string }>
    const lastUserMsg = retryMessages[retryMessages.length - 1]!
    expect(lastUserMsg.role).toBe('user')
    expect(lastUserMsg.content).toContain('did not match the required JSON schema')
  })

  it('retries on JSON parse error (markdown fences) and succeeds on second attempt', async () => {
    const markdownResponse = '```json\n{"coaster_id":"test","cleaned_name":"Fury","issue":"none","confidence":1,"reasoning":"ok"}\n```'
    const validResponse = makeValidNormalizationResponse({ coaster_id: 'test', cleaned_name: 'Fury' })
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: markdownResponse } }],
      } as never)
      .mockResolvedValueOnce({
        choices: [{ message: { content: validResponse } }],
      } as never)

    const result = await normalizeOne({ coaster_id: 'test', name: 'Fury', park_name: 'Park' })
    expect(result.coaster_id).toBe('test')
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('throws after two JSON parse errors', async () => {
    const badResponse = 'Sure, here is the JSON:\n{"invalid": true}'
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: badResponse } }],
    } as never)

    await expect(normalizeOne({ coaster_id: 'x', name: 'X', park_name: 'P' })).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })
})

// Feature: track-a-data-quality, Property 3: normalizeBatch throw marks all N batch records
describe('normalizeBatch fallback behavior', () => {
  it('throws on double failure, allowing caller to mark all N records', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: invalidJson } }],
    } as never)

    const batch = [
      { coaster_id: 'a', name: 'A', park_name: 'Park A' },
      { coaster_id: 'b', name: 'B', park_name: 'Park B' },
      { coaster_id: 'c', name: 'C', park_name: 'Park C' },
    ]

    await expect(normalizeBatch(batch)).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )

    // The caller would catch this and mark all 3 records as needs_review.
    // Here we verify the throw happened, which is the task function's contract.
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })
})

// Feature: track-a-data-quality, Property 4: adjudicateOne throw sets correct fallback fields
describe('adjudicateOne fallback behavior', () => {
  it('throws on double failure, allowing caller to set needs_human fields', async () => {
    const invalidJson = JSON.stringify({ invalid: 'schema' })
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: invalidJson } }],
    } as never)

    await expect(adjudicateOne(sampleAdjudicateInput)).rejects.toThrow(
      'LLM response failed Zod validation after retry',
    )

    // The caller would catch this and set:
    // verdict = 'needs_human', verdict_confidence = null, verdict_reasoning = 'llm_parse_failure'
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })
})
