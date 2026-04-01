"use client";

import { CSSProperties, useMemo } from "react";
import SentimentDashboard from "@/components/SentimentDashboard";
import SentimentTrendChart from "@/components/SentimentTrendChart";
import {
  buildProjectAnalysisReadModel,
  ExtractionModel,
  IssueModel,
  ProjectAnalysisMeeting,
  sentimentColorForLabel,
  SentimentSegmentModel,
} from "@/lib/phase3";

type ProjectAnalysisPanelProps = {
  meetings: ProjectAnalysisMeeting[];
  decisions: ExtractionModel[];
  actionItems: ExtractionModel[];
  sentimentSegments: SentimentSegmentModel[];
  issues: IssueModel[];
};

function formatDisplayDate(date: string | null | undefined): string {
  if (!date) return "Unknown date";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProjectAnalysisPanel({
  meetings,
  decisions,
  actionItems,
  sentimentSegments,
  issues,
}: ProjectAnalysisPanelProps) {
  const model = useMemo(
    () =>
      buildProjectAnalysisReadModel({
        meetings,
        decisions,
        actionItems,
        sentimentSegments,
        issues,
      }),
    [meetings, decisions, actionItems, sentimentSegments, issues]
  );

  const trendPoints = model.sentimentTrendSeries.map((point) => ({
    meetingId: point.meetingId,
    label: point.label,
    sentiment: point.sentiment,
  }));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <SectionHeading title="Section 1: Project Overview" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.65rem" }}>
        <MetricCard label="Completed Meetings" value={model.completedMeetingCount} />
        <MetricCard label="Decisions" value={model.totalDecisions} />
        <MetricCard label="Action Items" value={model.totalActionItems} />
        <MetricCard label="Open / In Progress" value={`${model.openIssueCount} / ${model.inProgressIssueCount}`} />
        <MetricCard
          label="Average Sentiment"
          value={model.averageSentiment == null ? "N/A" : model.averageSentiment.toFixed(2)}
          valueColor={sentimentColorForLabel(
            model.averageSentiment == null
              ? "neutral"
              : model.averageSentiment >= 0.2
                ? "positive"
                : model.averageSentiment <= -0.2
                  ? "conflict"
                  : "neutral"
          )}
        />
      </div>

      <div style={surfaceCardStyle}>
        <div style={subheadingStyle}>Project TL;DR Rollup</div>
        <div style={{ color: "var(--foreground)", whiteSpace: "pre-wrap", lineHeight: 1.62, fontSize: "0.9rem" }}>
          {model.tldrRollup}
        </div>
      </div>

      <div style={surfaceCardStyle}>
        <div style={subheadingStyle}>Meeting-Level Snapshot</div>
        {model.meetingSnapshots.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
            No completed meetings available yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  <th style={tableHeaderCell}>Meeting</th>
                  <th style={tableHeaderCell}>Date</th>
                  <th style={tableHeaderCell}>Sentiment</th>
                  <th style={tableHeaderCell}>Decisions</th>
                  <th style={tableHeaderCell}>Action Items</th>
                  <th style={tableHeaderCell}>Unresolved Topics</th>
                </tr>
              </thead>
              <tbody>
                {model.meetingSnapshots.map((snapshot) => (
                  <tr key={snapshot.meeting_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={tableBodyCell}>{snapshot.file_name}</td>
                    <td style={tableBodyCell}>{formatDisplayDate(snapshot.meeting_date)}</td>
                    <td style={tableBodyCell}>
                      {snapshot.sentiment_label}
                      {snapshot.sentiment_score == null ? "" : ` (${snapshot.sentiment_score.toFixed(2)})`}
                    </td>
                    <td style={tableBodyCell}>{snapshot.decisions}</td>
                    <td style={tableBodyCell}>{snapshot.action_items}</td>
                    <td style={tableBodyCell}>{snapshot.unresolved_topics}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SectionHeading title="Section 2: Sentiment Signals" />
      {trendPoints.length >= 2 ? (
        <SentimentTrendChart points={trendPoints} />
      ) : (
        <div style={surfaceCardStyle}>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
            Sentiment trend appears when at least 2 completed meetings are available.
          </div>
        </div>
      )}

      <SentimentDashboard
        segments={model.flattenedSentimentSegments}
        speakerObservations={model.speakerObservations}
      />
    </section>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.45rem" }}>
      <h2 style={{ margin: 0, color: "var(--foreground)", fontSize: "1rem" }}>{title}</h2>
    </div>
  );
}

function MetricCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: number | string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.72rem",
        background: "var(--surface)",
        padding: "0.72rem 0.8rem",
      }}
    >
      <div
        style={{
          color: "var(--muted)",
          fontSize: "0.74rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: "0.35rem",
          color: valueColor ?? "var(--foreground)",
          fontSize: "1.06rem",
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const surfaceCardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "0.8rem",
  background: "var(--surface)",
  padding: "0.85rem 0.9rem",
};

const subheadingStyle: CSSProperties = {
  marginBottom: "0.55rem",
  color: "var(--muted)",
  fontSize: "0.77rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tableHeaderCell: CSSProperties = {
  textAlign: "left",
  color: "var(--muted)",
  fontSize: "0.74rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "0.66rem 0.8rem",
  fontWeight: 700,
  borderBottom: "1px solid var(--border)",
};

const tableBodyCell: CSSProperties = {
  textAlign: "left",
  color: "var(--foreground)",
  fontSize: "0.88rem",
  padding: "0.66rem 0.8rem",
  verticalAlign: "top",
  lineHeight: 1.55,
};
