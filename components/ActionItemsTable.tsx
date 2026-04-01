"use client";

import { CSSProperties, Fragment, useState } from "react";
import {
  asUrgency,
  ExtractionModel,
  IssueModel,
  LinkedIssueMatch,
  URGENCY_STYLES,
} from "@/lib/phase3";

const UNVERIFIED_WARNING =
  "No direct supporting quote was found. Please review this item manually before acting on it.";

type MeetingMeta = {
  id: string;
  file_name: string;
};

type ActionItemsTableProps = {
  rows: ExtractionModel[];
  showMeetingSource?: boolean;
  meetingMetaById?: Map<string, MeetingMeta>;
  linkedIssueByActionId?: Map<string, LinkedIssueMatch>;
  issueById?: Map<string, IssueModel>;
  supersededById?: Map<string, ExtractionModel>;
  emptyLabel?: string;
};

function statusStyle(status: string | null | undefined): {
  fg: string;
  bg: string;
  border: string;
} {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done") {
    return { fg: "#16A34A", bg: "rgba(22,163,74,0.14)", border: "#16A34A" };
  }
  if (normalized === "in progress") {
    return { fg: "#EF9F27", bg: "rgba(239,159,39,0.14)", border: "#EF9F27" };
  }
  return { fg: "#378ADD", bg: "rgba(55,138,221,0.14)", border: "#378ADD" };
}

function quoteLocationLabel(row: ExtractionModel): string {
  if (row.quote_location && row.quote_location.trim().length > 0) {
    return row.quote_location;
  }
  if (row.supporting_quote && row.supporting_quote.trim().length > 0) {
    return "Supporting quote found, but exact location could not be resolved.";
  }
  return "No supporting quote available.";
}

export default function ActionItemsTable({
  rows,
  showMeetingSource = false,
  meetingMetaById,
  linkedIssueByActionId,
  issueById,
  supersededById,
  emptyLabel = "No action items available.",
}: ActionItemsTableProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "0.75rem",
          padding: "1rem",
          background: "var(--surface)",
          color: "var(--muted)",
          fontSize: "0.9rem",
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.875rem",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: showMeetingSource ? "980px" : "860px" }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={headerCellStyle}>Task</th>
              <th style={headerCellStyle}>Owner</th>
              <th style={headerCellStyle}>Due Date</th>
              <th style={headerCellStyle}>Urgency</th>
              {showMeetingSource && <th style={headerCellStyle}>Meeting Source</th>}
              <th style={headerCellStyle}>Linked Issue</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const urgency = asUrgency(row.urgency);
              const urgencyTheme = URGENCY_STYLES[urgency];
              const isExpanded = expandedRowId === row.id;
              const linkedMatch = linkedIssueByActionId?.get(row.id);
              const linkedIssue = linkedMatch?.issueId ? issueById?.get(linkedMatch.issueId) ?? null : null;
              const isSuperseded = Boolean(row.superseded_by);
              const supersededTarget = row.superseded_by ? supersededById?.get(row.superseded_by) ?? null : null;
              const statusTheme = statusStyle(row.status);
              const meetingMeta = meetingMetaById?.get(row.meeting_id);

              return (
                <Fragment key={row.id}>
                  <tr
                    id={`action-${row.id}`}
                    onClick={() => setExpandedRowId(isExpanded ? null : row.id)}
                    style={{
                      borderTop: "1px solid var(--border)",
                      cursor: "pointer",
                      background: isExpanded ? "rgba(124,111,247,0.06)" : "transparent",
                    }}
                  >
                    <td style={bodyCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.38rem" }}>
                        <div
                          style={{
                            color: "var(--foreground)",
                            textDecoration: isSuperseded ? "line-through" : "none",
                            lineHeight: 1.45,
                          }}
                        >
                          {row.description}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                          {row.verified ? (
                            <span
                              style={{
                                color: "#16A34A",
                                fontSize: "0.75rem",
                                border: "1px solid #16A34A",
                                borderRadius: "999px",
                                padding: "0.15rem 0.45rem",
                                background: "rgba(22,163,74,0.14)",
                                fontWeight: 600,
                              }}
                            >
                              Verified
                            </span>
                          ) : (
                            <span
                              style={{
                                color: "#EF9F27",
                                fontSize: "0.75rem",
                                border: "1px solid #EF9F27",
                                borderRadius: "999px",
                                padding: "0.15rem 0.45rem",
                                background: "rgba(239,159,39,0.14)",
                                fontWeight: 600,
                              }}
                            >
                              Unverified
                            </span>
                          )}

                          {isSuperseded && (
                            <span
                              style={{
                                color: "var(--muted)",
                                fontSize: "0.75rem",
                                border: "1px solid var(--border)",
                                borderRadius: "999px",
                                padding: "0.15rem 0.45rem",
                                background: "var(--surface-2)",
                                fontWeight: 600,
                              }}
                            >
                              Superseded
                            </span>
                          )}
                        </div>

                        {!row.verified && (
                          <div
                            style={{
                              fontSize: "0.76rem",
                              color: "#EF9F27",
                              background: "rgba(239,159,39,0.12)",
                              border: "1px solid rgba(239,159,39,0.35)",
                              borderRadius: "0.45rem",
                              padding: "0.35rem 0.5rem",
                              lineHeight: 1.45,
                            }}
                          >
                            {UNVERIFIED_WARNING}
                          </div>
                        )}
                      </div>
                    </td>

                    <td style={bodyCellStyle}>{row.owner ?? "Unassigned"}</td>
                    <td style={bodyCellStyle}>{row.due_date ?? "Not specified"}</td>
                    <td style={bodyCellStyle}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          borderRadius: "999px",
                          border: `1px solid ${urgencyTheme.border}`,
                          color: urgencyTheme.fg,
                          background: urgencyTheme.bg,
                          padding: "0.2rem 0.55rem",
                          display: "inline-flex",
                          alignItems: "center",
                          whiteSpace: "nowrap",
                          lineHeight: 1,
                        }}
                      >
                        {urgency}
                      </span>
                    </td>

                    {showMeetingSource && (
                      <td style={bodyCellStyle}>
                        <span style={{ color: "var(--foreground)" }}>
                          {meetingMeta?.file_name ?? row.meeting_id}
                        </span>
                      </td>
                    )}

                    <td style={bodyCellStyle}>
                      {linkedIssue ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            fontSize: "0.76rem",
                            fontWeight: 600,
                            borderRadius: "999px",
                            border: "1px solid rgba(124,111,247,0.55)",
                            color: "var(--accent)",
                            background: "var(--accent-subtle)",
                            padding: "0.2rem 0.55rem",
                          }}
                          title={`Linked to: "${linkedIssue.title}" (Confidence: ${Math.round((linkedMatch?.confidence ?? 0) * 100)}%)`}
                        >
                          Linked
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Unlinked</span>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={showMeetingSource ? 6 : 5} style={{ ...bodyCellStyle, background: "rgba(255,255,255,0.01)" }}>
                        <div
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: "0.6rem",
                            padding: "0.8rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.55rem",
                          }}
                        >
                          <DetailRow label="Context" value={row.context ?? "No context available."} />
                          <DetailRow
                            label="Supporting Quote"
                            value={row.supporting_quote ? `"${row.supporting_quote}"` : "No supporting quote available."}
                          />
                          <DetailRow label="Quote Location" value={quoteLocationLabel(row)} />

                          {row.superseded_by && supersededTarget && (
                            <div style={{ fontSize: "0.84rem", color: "var(--muted)" }}>
                              Superseded by:{" "}
                              <a href={`#action-${supersededTarget.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                                {supersededTarget.description}
                              </a>
                            </div>
                          )}

                          {linkedIssue && (
                            <div style={{ fontSize: "0.84rem", color: "var(--muted)" }}>
                              Linked issue:{" "}
                              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{linkedIssue.title}</span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ color: "var(--foreground)", fontSize: "0.88rem", lineHeight: 1.55 }}>{value}</div>
    </div>
  );
}

const headerCellStyle: CSSProperties = {
  textAlign: "left",
  color: "var(--muted)",
  fontSize: "0.73rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "0.72rem 0.85rem",
  fontWeight: 700,
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const bodyCellStyle: CSSProperties = {
  textAlign: "left",
  color: "var(--foreground)",
  fontSize: "0.86rem",
  padding: "0.78rem 0.85rem",
  verticalAlign: "top",
};
