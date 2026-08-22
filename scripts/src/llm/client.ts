import OpenAI from 'openai'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') })

const apiKey = process.env.OPENAI_SECRET_KEY
if (!apiKey) {
  console.error('Error: OPENAI_SECRET_KEY must be set in .env')
  process.exit(1)
}

export const MODEL_ID = 'gpt-5.4'

export const lmStudio = new OpenAI({ apiKey })
