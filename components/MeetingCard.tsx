"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Meeting = {
  id: string;
  file_name: string;
  processing_status: "pending" | "processing" | "complete" | "failed";
  processing_error?: string | null;
  word_count?: number;
  speaker_count?: number;
  created_at?: string;
  summary?: {
    tldr?: string;
    overall_sentiment?: { label: string; score: number };
    stats?: {
      decisions: number;
      action_items: number;
      dominant_speaker?: string;
    };
    topics?: Array<{ title: string; status: string }>;
  } | null;
};

type MeetingCardProps = {
  meeting: Meeting;
  /** If set, the card is a polling-active card (no link navigation) */
  onStatusChange?: (meetingId: string, newStatus: Meeting["processing_status"]) => void;
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#639922",
  mixed: "#fbbf24",
  tense: "#ba7517",
  negative: "#e24b4a",
};

const SENTIMENT_BG: Record<string, string> = {
  positive: "rgba(99,153,34,0.12)",
  mixed: "rgba(251,191,36,0.12)",
  tense: "rgba(186,117,23,0.12)",
  negative: "rgba(226,75,74,0.12)",
};

export default function MeetingCard({ meeting, onStatusChange }: MeetingCardProps) {
  const supabase = createSupabaseBrowserClient();
  const pollingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentMeeting, setCurrentMeeting] = useState<Meeting>(meeting);

  // Start polling if not complete/failed
  useEffect(() => {
    if (
      currentMeeting.processing_status === "processing" ||
      currentMeeting.processing_status === "pending"
    ) {
      startPolling();
    }
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (pollingInterval.current) return;
    pollingInterval.current = setInterval(async () => {
      const { data } = await supabase
        .from("meetings")
        .select(
          "id, file_name, processing_status, processing_error, word_count, speaker_count, created_at, summary"
        )
        .eq("id", currentMeeting.id)
        .single();

      if (data) {
        setCurrentMeeting(data as Meeting);
        onStatusChange?.(data.id, data.processing_status);
        if (data.processing_status === "complete" || data.processing_status === "failed") {
          stopPolling();
        }
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  }

  async function handleRetry() {
    await supabase.functions.invoke("process-transcript", {
      body: { meetingId: currentMeeting.id },
    });
    setCurrentMeeting((prev) => ({ ...prev, processing_status: "processing", processing_error: null }));
    startPolling();
  }

  const status = currentMeeting.processing_status;

  // ── Pending ─────────────────────────────────────────────────────────────────
  if (status === "pending") {
    return <PendingCard fileName={currentMeeting.file_name} />;
  }

  // ── Processing ──────────────────────────────────────────────────────────────
  if (status === "processing") {
    return <ProcessingCard fileName={currentMeeting.file_name} />;
  }

  // ── Failed ──────────────────────────────────────────────────────────────────
  if (status === "failed") {
    return <FailedCard fileName={currentMeeting.file_name} onRetry={handleRetry} />;
  }

  // ── Complete ────────────────────────────────────────────────────────────────
  const summary = currentMeeting.summary;
  const sentiment = summary?.overall_sentiment;
  const stats = summary?.stats;
  const date = currentMeeting.created_at
    ? new Date(currentMeeting.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <a
      href={`/meetings/${currentMeeting.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.875rem",
        padding: "1.25rem 1.5rem",
        cursor: "pointer",
        transition: "border-color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.875rem" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.9375rem",
              color: "var(--foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: "0.25rem",
            }}
          >
            {currentMeeting.file_name}
          </div>
          <div style={{ fontSize: "0.78125rem", color: "var(--muted)", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {date && <span>{date}</span>}
            {currentMeeting.word_count && <span>{currentMeeting.word_count.toLocaleString()} words</span>}
            {currentMeeting.speaker_count != null && currentMeeting.speaker_count > 0 && (
              <span>{currentMeeting.speaker_count} speaker{currentMeeting.speaker_count !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {/* Sentiment badge */}
        {sentiment && (
          <div
            style={{
              flexShrink: 0,
              padding: "0.25rem 0.625rem",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: SENTIMENT_COLORS[sentiment.label] ?? "var(--muted)",
              background: SENTIMENT_BG[sentiment.label] ?? "var(--surface-2)",
              border: `1px solid ${SENTIMENT_COLORS[sentiment.label] ?? "var(--border)"}`,
              textTransform: "capitalize",
            }}
          >
            {sentiment.label}
          </div>
        )}
      </div>

      {/* TL;DR */}
      {summary?.tldr && (
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--muted)",
            lineHeight: 1.6,
            margin: "0 0 0.875rem",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary.tldr}
        </p>
      )}

      {/* Stats row */}
      {stats && (
        <div
          style={{
            display: "flex",
            gap: "1.25rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border)",
          }}
        >
          <StatPill label="Decisions" value={stats.decisions ?? 0} />
          <StatPill label="Action Items" value={stats.action_items ?? 0} />
          {summary?.topics && (
            <StatPill label="Topics" value={summary.topics.length} />
          )}
        </div>
      )}
    </a>
  );
}

// ── Sub-states ───────────────────────────────────────────────────────────────

function PendingCard({ fileName }: { fileName: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.875rem",
        padding: "1.25rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
      }}
    >
      <PendingIcon />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.875rem",
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fileName}
        </div>
        <div style={{ fontSize: "0.78125rem", color: "var(--muted)", marginTop: "0.125rem" }}>
          Queued for processing
        </div>
      </div>
    </div>
  );
}

function ProcessingCard({ fileName }: { fileName: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.875rem",
        padding: "1.25rem 1.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", marginBottom: "0.875rem" }}>
        <SpinnerIcon />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.875rem",
              color: "var(--foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {fileName}
          </div>
          <div style={{ fontSize: "0.78125rem", color: "var(--accent)", marginTop: "0.125rem", fontWeight: 500 }}>
            Analyzing transcript…
          </div>
        </div>
      </div>
      {/* Animated progress bar */}
      <div
        style={{
          height: "3px",
          borderRadius: "2px",
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "var(--accent)",
            borderRadius: "2px",
            animation: "indeterminate 1.5s ease-in-out infinite",
          }}
        />
        <style>{`
          @keyframes indeterminate {
            0% { transform: translateX(-100%) scaleX(0.3); }
            50% { transform: translateX(0%) scaleX(0.6); }
            100% { transform: translateX(100%) scaleX(0.3); }
          }
        `}</style>
      </div>
    </div>
  );
}

function FailedCard({ fileName, onRetry }: { fileName: string; onRetry: () => void }) {
  return (
    <div
      style={{
        background: "rgba(248,113,113,0.05)",
        border: "1px solid rgba(248,113,113,0.3)",
        borderRadius: "0.875rem",
        padding: "1.25rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
      }}
    >
      <ErrorIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.875rem",
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fileName}
        </div>
        <div style={{ fontSize: "0.78125rem", color: "var(--danger)", marginTop: "0.125rem" }}>
          Processing failed
        </div>
      </div>
      <button
        id={`btn-retry-${fileName.replace(/\W/g, "_")}`}
        onClick={onRetry}
        style={{
          padding: "0.375rem 0.875rem",
          borderRadius: "0.5rem",
          background: "var(--accent)",
          color: "#fff",
          fontSize: "0.8125rem",
          fontWeight: 600,
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Retry
      </button>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--foreground)" }}>
        {value}
      </span>
      <span style={{ fontSize: "0.71875rem", color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
      aria-hidden="true"
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="3" />
      <path d="M12 2a10 10 0 010 20" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="var(--danger)" strokeWidth="2" />
      <path d="M12 8v4M12 16h.01" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="var(--muted)" strokeWidth="2" />
      <path d="M12 6v6l4 2" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
