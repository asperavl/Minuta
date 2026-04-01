import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const PAGE_SIZE = 500;

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getRuntimeEnv() {
  const envFile = parseDotEnv(path.resolve(REPO_ROOT, ".env.local"));
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    envFile.NEXT_PUBLIC_SUPABASE_URL ||
    envFile.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE URL in env (.env.local or process env).");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env.");
  }

  return { supabaseUrl, serviceRoleKey };
}

function normalizeSearchText(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(raw) {
  return normalizeSearchText(raw)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function tokenRecallScore(quoteTokens, candidateTokens) {
  if (quoteTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of quoteTokens) {
    if (candidateSet.has(token)) overlap += 1;
  }
  return overlap / quoteTokens.length;
}

function normalizeTimestamp(raw) {
  const trimmed = raw.trim();
  const hhmmssMatch = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hhmmssMatch) {
    const hh = hhmmssMatch[1].padStart(2, "0");
    return `${hh}:${hhmmssMatch[2]}:${hhmmssMatch[3]}`;
  }
  const mmssMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (mmssMatch) {
    return `00:${mmssMatch[1].padStart(2, "0")}:${mmssMatch[2]}`;
  }
  return null;
}

function extractTimestampFromLine(line) {
  const cueMatch = line.match(/(\d{1,2}:\d{2}:\d{2})(?:[.,]\d{1,3})?\s*-->/);
  if (cueMatch) return normalizeTimestamp(cueMatch[1]);

  const hhmmssMatch = line.match(/\b(\d{1,2}:\d{2}:\d{2})(?:[.,]\d{1,3})?\b/);
  if (hhmmssMatch) return normalizeTimestamp(hhmmssMatch[1]);

  const mmssMatch = line.match(/\b(\d{1,2}:\d{2})(?:[.,]\d{1,3})?\b/);
  if (mmssMatch) return normalizeTimestamp(mmssMatch[1]);

  return null;
}

function lineForCharIndex(rawText, charIndex) {
  let line = 1;
  for (let i = 0; i < charIndex; i += 1) {
    if (rawText[i] === "\n") line += 1;
  }
  return line;
}

function quoteLineNumber(rawText, supportingQuote) {
  const quote = String(supportingQuote ?? "").trim();
  if (!quote) return null;

  const loweredRaw = rawText.toLowerCase();
  const loweredQuote = quote.toLowerCase();
  const exactIndex = loweredRaw.indexOf(loweredQuote);
  if (exactIndex >= 0) {
    return lineForCharIndex(rawText, exactIndex);
  }

  const lines = rawText.split(/\r?\n/);
  const normalizedQuote = normalizeSearchText(quote);
  if (!normalizedQuote) return null;

  const quoteTokens = tokenizeSearch(quote);
  let bestLine = null;
  let bestScore = 0;

  for (let windowSize = 1; windowSize <= 3; windowSize += 1) {
    for (let i = 0; i < lines.length; i += 1) {
      const windowText = lines.slice(i, i + windowSize).join(" ");
      const normalizedWindow = normalizeSearchText(windowText);
      if (!normalizedWindow) continue;

      if (
        normalizedWindow.includes(normalizedQuote) ||
        normalizedQuote.includes(normalizedWindow)
      ) {
        return i + 1;
      }

      if (quoteTokens.length > 0) {
        const score = tokenRecallScore(quoteTokens, tokenizeSearch(windowText));
        if (score > bestScore) {
          bestScore = score;
          bestLine = i + 1;
        }
      }
    }
  }

  const threshold = quoteTokens.length >= 6 ? 0.5 : 0.66;
  if (bestLine != null && bestScore >= threshold) return bestLine;
  return null;
}

function resolveQuoteLocation(rawText, supportingQuote) {
  const transcript = String(rawText ?? "");
  const quote = String(supportingQuote ?? "").trim();
  if (!transcript || !quote) return null;

  const lineNumber = quoteLineNumber(transcript, quote);
  if (!lineNumber) return null;

  const lines = transcript.split(/\r?\n/);
  const index = Math.min(Math.max(lineNumber - 1, 0), Math.max(lines.length - 1, 0));
  let timestamp = null;

  for (let offset = 0; offset <= 8; offset += 1) {
    const lineIndex = index - offset;
    if (lineIndex < 0) break;
    timestamp = extractTimestampFromLine(lines[lineIndex]);
    if (timestamp) break;
  }

  if (timestamp) return `${timestamp} (line ${lineNumber})`;
  return `Line ${lineNumber}`;
}

async function fetchAllQuoteCandidates(supabase) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("extractions")
      .select("id, meeting_id, type, supporting_quote, quote_location")
      .in("type", ["decision", "action_item"])
      .not("supporting_quote", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchMeetingTextMap(supabase, meetingIds) {
  const map = new Map();
  const uniqueIds = Array.from(new Set(meetingIds));

  for (let i = 0; i < uniqueIds.length; i += PAGE_SIZE) {
    const chunk = uniqueIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("meetings")
      .select("id, raw_text")
      .in("id", chunk);
    if (error) throw error;

    for (const row of data ?? []) {
      map.set(row.id, row.raw_text ?? "");
    }
  }

  return map;
}

async function run() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeEnv();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const extractedRows = await fetchAllQuoteCandidates(supabase);
  const targets = extractedRows.filter((row) => {
    const quote = String(row.supporting_quote ?? "").trim();
    const location = String(row.quote_location ?? "").trim();
    return quote.length > 0 && location.length === 0;
  });

  if (targets.length === 0) {
    console.log("[backfill] No rows need quote_location backfill.");
    return;
  }

  const meetingTextMap = await fetchMeetingTextMap(
    supabase,
    targets.map((row) => row.meeting_id)
  );

  let resolved = 0;
  let updated = 0;
  let unresolved = 0;

  for (const row of targets) {
    const rawText = meetingTextMap.get(row.meeting_id) ?? "";
    const nextLocation = resolveQuoteLocation(rawText, row.supporting_quote);

    if (!nextLocation) {
      unresolved += 1;
      continue;
    }

    resolved += 1;
    const { error } = await supabase
      .from("extractions")
      .update({ quote_location: nextLocation })
      .eq("id", row.id);
    if (error) {
      console.error(`[backfill] Failed update for extraction ${row.id}:`, error.message);
      continue;
    }
    updated += 1;
  }

  const coverage = targets.length === 0 ? 100 : (resolved / targets.length) * 100;
  console.log(`[backfill] candidates: ${targets.length}`);
  console.log(`[backfill] resolved:   ${resolved}`);
  console.log(`[backfill] updated:    ${updated}`);
  console.log(`[backfill] unresolved: ${unresolved}`);
  console.log(`[backfill] coverage:   ${coverage.toFixed(2)}%`);

  if (coverage < 95) {
    throw new Error(
      `Quote-location coverage gate failed: ${coverage.toFixed(
        2
      )}% < 95%. Review unresolved rows before rollout.`
    );
  }
}

run().catch((error) => {
  console.error("[backfill] Failed:", error);
  process.exitCode = 1;
});
