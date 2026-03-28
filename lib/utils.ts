export function safeParseJSON<T = any>(raw: string): T | null {
  try {
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{\[]*/, '')
      .replace(/[^}\]]*$/, '')
      .trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(' ').length * 1.3)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
