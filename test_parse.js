const fs = require('fs');
const raw = fs.readFileSync('llm_out_fixed.json', 'utf8');

function safeParseJSON(raw) {
  if (!raw) return null;
  try {
    let cleaned = raw.trim();

    // First try extracting exactly what's inside a markdown code block (if present)
    // The CoT block might contain stray braces { } which breaks indexOf("{")
    const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (mdMatch) {
      console.log("MDMATCH TRIGGERED!");
      cleaned = mdMatch[1].trim();
    } else {
      console.log("FALLBACK TRIGGERED!");
      // If no markdown block is found, try slicing from { or [ to the matching closing brace } or ]
      const firstBrace = cleaned.indexOf("{");
      const firstBracket = cleaned.indexOf("[");
      const lastBrace = cleaned.lastIndexOf("}");
      const lastBracket = cleaned.lastIndexOf("]");
      
      let start = -1;
      let end = -1;

      if (firstBrace !== -1 && firstBracket !== -1) start = Math.min(firstBrace, firstBracket);
      else if (firstBrace !== -1) start = firstBrace;
      else if (firstBracket !== -1) start = firstBracket;
      
      if (lastBrace !== -1 && lastBracket !== -1) end = Math.max(lastBrace, lastBracket) + 1;
      else if (lastBrace !== -1) end = lastBrace + 1;
      else if (lastBracket !== -1) end = lastBracket + 1;

      if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.substring(start, end);
      }
    }

    console.log("CLEANED length:", cleaned.length);
    const parsed = JSON.parse(cleaned);
    console.log("SUCCESS");
    return parsed;
  } catch (err) {
    console.warn("safeParseJSON Error:", err);
    return null;
  }
}

safeParseJSON(raw);
