import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export async function groqChat(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  stream = false
) {
  return groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: 1000,
    temperature: 0,
    stream,
  })
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(' ').length * 1.3)
}
