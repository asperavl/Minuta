export interface ParsedTranscript {
  rawText: string
  speakers: string[]
  segments: { speaker: string; text: string; time: string }[]
  wordCount: number
  isVTT: boolean
}

export function parseTranscript(
  content: string,
  fileName: string
): ParsedTranscript {
  const isVTT = fileName.toLowerCase().endsWith('.vtt')
  return isVTT ? parseVTT(content) : parsePlainText(content)
}

function parseVTT(content: string): ParsedTranscript {
  const lines = content.split('\n')
  const segments: { speaker: string; text: string; time: string }[] = []
  let currentTime = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'WEBVTT') continue

    const timeMatch = trimmed.match(/(\d{2}:\d{2}:\d{2})/)
    if (timeMatch) {
      currentTime = timeMatch[1]
      continue
    }

    const speakerMatch = trimmed.match(/^([^:]+):\s(.+)/)
    if (speakerMatch) {
      segments.push({
        speaker: speakerMatch[1].trim(),
        text: speakerMatch[2].trim(),
        time: currentTime,
      })
    }
  }

  const speakers = [...new Set(segments.map(s => s.speaker))]
  const rawText = segments.map(s => `${s.speaker}: ${s.text}`).join('\n')
  return { rawText, speakers, segments, wordCount: rawText.split(' ').length, isVTT: true }
}

function parsePlainText(content: string): ParsedTranscript {
  const rawText = content.trim()
  const speakerMatches = rawText.match(/^([A-Za-z][A-Za-z\s]{0,30})\s*:/gm) ?? []
  const speakers = [...new Set(speakerMatches.map(s => s.replace(':', '').trim()))]
  return {
    rawText,
    speakers,
    segments: [],
    wordCount: rawText.split(/\s+/).length,
    isVTT: false,
  }
}
