import { GoogleGenAI } from '@google/genai'

// IMPORTANT: use @google/genai NOT @google/generative-ai
// @google/generative-ai reached EOL August 2025

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

export async function geminiPrompt(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-002',
    contents: prompt,
    config: {
      temperature: 0,
    },
  })
  return response.text ?? ''
}

export async function geminiPromptWithRetry(
  prompt: string,
  retries = 3
): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      return await geminiPrompt(prompt)
    } catch (err: any) {
      if (i === retries - 1) throw err
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
  throw new Error('Max retries exceeded')
}
