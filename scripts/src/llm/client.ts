import OpenAI from "openai";

export const MODEL_ID = "qwen3.8-27b";

export const lmStudio = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "lm-studio",
});
