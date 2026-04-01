"use client";

import { useMemo, useState } from "react";
import { TopicTimelineNode, TOPIC_STATUS_STYLES, URGENCY_STYLES } from "@/lib/phase3";

type TopicTimelineProps = {
  topics: TopicTimelineNode[];
};

function formatWindow(topic: TopicTimelineNode): string {
  const start = topic.start_time ?? "Unknown";
  const end = topic.end_time ?? "Unknown";
  return `${start} - ${end}`;
}

export default function TopicTimeline({ topics }: TopicTimelineProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const topicMap = useMemo(() => new Map(topics.map((topic) => [topic.index, topic])), [topics]);

  if (topics.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "0.75rem",
          padding: "1rem",
          color: "var(--muted)",
          background: "var(--surface)",
          fontSize: "0.9rem",
        }}
      >
        No topics were extracted for this meeting.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {topics.map((topic) => {
        const isExpanded = expandedIndex === topic.index;
        const statusStyle = TOPIC_STATUS_STYLES[topic.status];
        const urgencyStyle = URGENCY_STYLES[topic.urgency];
        const circledBackFrom = topic.circled_back_from;
        const circledBackAt = topic.circled_back_at;

        return (
          <article
            key={`topic-${topic.index}`}
            id={`topic-${topic.index}`}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "0.875rem",
              background: "var(--surface)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setExpandedIndex(isExpanded ? null : topic.index)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "1rem",
                textAlign: "left",
                border: "none",
                background: "transparent",
                padding: "0.9rem 1rem",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                <div style={{ fontSize: "0.74rem", color: "var(--muted)" }}>{formatWindow(topic)}</div>
                <div style={{ fontWeight: 700, color: "var(--foreground)", lineHeight: 1.35 }}>
                  {topic.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      borderRadius: "999px",
                      border: `1px solid ${statusStyle.border}`,
                      color: statusStyle.fg,
                      background: statusStyle.bg,
                      padding: "0.2rem 0.55rem",
                    }}
                  >
                    {topic.status}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      borderRadius: "999px",
                      border: `1px solid ${urgencyStyle.border}`,
                      color: urgencyStyle.fg,
                      background: urgencyStyle.bg,
                      padding: "0.2rem 0.55rem",
                    }}
                  >
                    {topic.urgency}
                  </span>
                  {circledBackFrom != null && topicMap.has(circledBackFrom) && (
                    <a
                      href={`#topic-${circledBackFrom}`}
                      onClick={(event) => event.stopPropagation()}
                      style={{ color: "var(--accent)", fontSize: "0.75rem", textDecoration: "none" }}
                    >
                      Circled back from Topic {circledBackFrom + 1}
                    </a>
                  )}
                  {circledBackAt != null && topicMap.has(circledBackAt) && (
                    <a
                      href={`#topic-${circledBackAt}`}
                      onClick={(event) => event.stopPropagation()}
                      style={{ color: "var(--accent)", fontSize: "0.75rem", textDecoration: "none" }}
                    >
                      Revisited in Topic {circledBackAt + 1}
                    </a>
                  )}
                </div>
              </div>
              <span
                style={{
                  color: "var(--muted)",
                  fontSize: "1.1rem",
                  lineHeight: 1,
                  marginTop: "0.15rem",
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                v
              </span>
            </button>

            {isExpanded && (
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  padding: "0.9rem 1rem 1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <p style={{ margin: 0, color: "var(--foreground)", lineHeight: 1.6, fontSize: "0.93rem" }}>
                  {topic.summary || "No summary text available for this topic."}
                </p>

                <div
                  style={{
                    borderLeft: "3px solid var(--accent)",
                    padding: "0.55rem 0.75rem",
                    background: "var(--surface-2)",
                    borderRadius: "0.35rem",
                    color: "var(--muted)",
                    fontSize: "0.84rem",
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--foreground)", marginBottom: "0.25rem" }}>
                    Supporting Quote
                  </div>
                  {topic.supporting_quote ? (
                    <span>{`"${topic.supporting_quote}"`}</span>
                  ) : (
                    <span>No direct supporting quote was found for this topic.</span>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
