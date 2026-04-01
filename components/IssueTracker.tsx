"use client";

import { useMemo, useState } from "react";
import { IssueMentionModel, IssueModel } from "@/lib/phase3";

type MeetingMeta = {
  id: string;
  file_name: string;
  sort_order: number | null;
  meeting_date: string | null;
  created_at: string;
};

type IssueTrackerProps = {
  issues: IssueModel[];
  mentions: IssueMentionModel[];
  meetingsById: Map<string, MeetingMeta>;
  issueUrgencyById: Map<string, string>;
};

function statusTheme(status: string | null | undefined): { fg: string; bg: string; border: string; label: string } {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "resolved") {
    return { fg: "#16A34A", bg: "rgba(22,163,74,0.14)", border: "#16A34A", label: "Resolved" };
  }
  if (normalized === "obsolete") {
    return { fg: "#EF9F27", bg: "rgba(239,159,39,0.14)", border: "#EF9F27", label: "Obsolete" };
  }
  if (normalized === "in_progress") {
    return { fg: "#378ADD", bg: "rgba(55,138,221,0.14)", border: "#378ADD", label: "In Progress" };
  }
  return { fg: "#E24B4A", bg: "rgba(226,75,74,0.14)", border: "#E24B4A", label: "Open" };
}

function mentionTypeTheme(type: string | null | undefined): { fg: string; bg: string; border: string } {
  const normalized = (type ?? "").toLowerCase();
  if (normalized === "resolved") return { fg: "#16A34A", bg: "rgba(22,163,74,0.14)", border: "#16A34A" };
  if (normalized === "obsoleted") return { fg: "#EF9F27", bg: "rgba(239,159,39,0.14)", border: "#EF9F27" };
  if (normalized === "reopened") return { fg: "#E24B4A", bg: "rgba(226,75,74,0.14)", border: "#E24B4A" };
  if (normalized === "escalated") return { fg: "#BA7517", bg: "rgba(186,117,23,0.14)", border: "#BA7517" };
  return { fg: "#378ADD", bg: "rgba(55,138,221,0.14)", border: "#378ADD" };
}

function sectionSort(issue: IssueModel): number {
  const status = (issue.status ?? "").toLowerCase();
  if (status === "resolved") return 1;
  if (status === "obsolete") return 2;
  return 0;
}

function formatMeetingLabel(meeting?: MeetingMeta): string {
  if (!meeting) return "Unknown meeting";
  return meeting.file_name;
}

export default function IssueTracker({
  issues,
  mentions,
  meetingsById,
  issueUrgencyById,
}: IssueTrackerProps) {
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  const mentionsByIssueId = useMemo(() => {
    const map = new Map<string, IssueMentionModel[]>();
    for (const mention of mentions) {
      if (!map.has(mention.issue_id)) map.set(mention.issue_id, []);
      map.get(mention.issue_id)?.push(mention);
    }
    return map;
  }, [mentions]);

  const sortedIssues = useMemo(
    () =>
      [...issues].sort((left, right) => {
        const sectionDelta = sectionSort(left) - sectionSort(right);
        if (sectionDelta !== 0) return sectionDelta;
        return left.title.localeCompare(right.title);
      }),
    [issues]
  );

  const openIssues = sortedIssues.filter((issue) => {
    const status = (issue.status ?? "").toLowerCase();
    return status === "open" || status === "in_progress" || status === "";
  });
  const resolvedIssues = sortedIssues.filter((issue) => (issue.status ?? "").toLowerCase() === "resolved");
  const obsoleteIssues = sortedIssues.filter((issue) => (issue.status ?? "").toLowerCase() === "obsolete");

  const activeIssue = activeIssueId ? issues.find((issue) => issue.id === activeIssueId) ?? null : null;
  const activeMentions = useMemo(() => {
    if (!activeIssue) return [];
    return [...(mentionsByIssueId.get(activeIssue.id) ?? [])].sort((left, right) => {
      const leftMeeting = meetingsById.get(left.meeting_id);
      const rightMeeting = meetingsById.get(right.meeting_id);
      const leftOrder = leftMeeting?.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = rightMeeting?.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.created_at.localeCompare(right.created_at);
    });
  }, [activeIssue, mentionsByIssueId, meetingsById]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <IssueSection
        title="Open / In Progress"
        issues={openIssues}
        mentionsByIssueId={mentionsByIssueId}
        meetingsById={meetingsById}
        issueUrgencyById={issueUrgencyById}
        onOpenTimeline={setActiveIssueId}
      />

      <IssueSection
        title="Resolved"
        issues={resolvedIssues}
        mentionsByIssueId={mentionsByIssueId}
        meetingsById={meetingsById}
        issueUrgencyById={issueUrgencyById}
        onOpenTimeline={setActiveIssueId}
      />

      <IssueSection
        title="Obsolete"
        issues={obsoleteIssues}
        mentionsByIssueId={mentionsByIssueId}
        meetingsById={meetingsById}
        issueUrgencyById={issueUrgencyById}
        onOpenTimeline={setActiveIssueId}
      />

      {activeIssue && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "1.2rem",
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setActiveIssueId(null);
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "860px",
              maxHeight: "88vh",
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: "0.9rem",
              background: "var(--surface)",
              padding: "0.95rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.9rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <h3 style={{ margin: 0, color: "var(--foreground)", fontSize: "1rem" }}>{activeIssue.title}</h3>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                  Full issue timeline
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveIssueId(null)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                  padding: "0.35rem 0.55rem",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            {activeMentions.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
                No mention timeline is available for this issue yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                {activeMentions.map((mention) => {
                  const meeting = meetingsById.get(mention.meeting_id);
                  const mentionTheme = mentionTypeTheme(mention.mention_type);
                  return (
                    <article
                      key={mention.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "0.7rem",
                        background: "var(--surface-2)",
                        padding: "0.7rem 0.75rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.45rem",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.7rem" }}>
                        <span
                          style={{
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            borderRadius: "999px",
                            border: `1px solid ${mentionTheme.border}`,
                            color: mentionTheme.fg,
                            background: mentionTheme.bg,
                            padding: "0.17rem 0.48rem",
                            textTransform: "capitalize",
                          }}
                        >
                          {mention.mention_type ?? "discussed"}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                          {formatMeetingLabel(meeting)}
                        </span>
                      </div>
                      <div style={{ color: "var(--foreground)", fontSize: "0.86rem", lineHeight: 1.5 }}>
                        {mention.context || "No context provided."}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.5 }}>
                        {mention.supporting_quote
                          ? `"${mention.supporting_quote}"`
                          : "No direct supporting quote was attached to this mention."}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type IssueSectionProps = {
  title: string;
  issues: IssueModel[];
  mentionsByIssueId: Map<string, IssueMentionModel[]>;
  meetingsById: Map<string, MeetingMeta>;
  issueUrgencyById: Map<string, string>;
  onOpenTimeline: (issueId: string) => void;
};

function IssueSection({
  title,
  issues,
  mentionsByIssueId,
  meetingsById,
  issueUrgencyById,
  onOpenTimeline,
}: IssueSectionProps) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.85rem",
        background: "var(--surface)",
        padding: "0.82rem",
      }}
    >
      <h3 style={{ margin: "0 0 0.7rem", color: "var(--foreground)", fontSize: "0.93rem" }}>{title}</h3>

      {issues.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.84rem" }}>No issues in this section.</div>
      ) : (
        <div style={{ display: "grid", gap: "0.72rem" }}>
          {issues.map((issue) => {
            const theme = statusTheme(issue.status);
            const issueMentions = mentionsByIssueId.get(issue.id) ?? [];
            const lastMention = [...issueMentions].sort((left, right) =>
              right.created_at.localeCompare(left.created_at)
            )[0];
            const firstMeeting = meetingsById.get(issue.opened_in ?? "");
            const lastMeeting = lastMention
              ? meetingsById.get(lastMention.meeting_id)
              : issue.opened_in
                ? meetingsById.get(issue.opened_in)
                : undefined;
            const urgency = issueUrgencyById.get(issue.id) ?? "No Action";

            return (
              <article
                key={issue.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.72rem",
                  background: "var(--surface-2)",
                  padding: "0.72rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.55rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.7rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "var(--foreground)", fontWeight: 700, lineHeight: 1.35 }}>{issue.title}</div>
                    <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.15rem" }}>
                      {issue.description || "No description available."}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      borderRadius: "999px",
                      border: `1px solid ${theme.border}`,
                      color: theme.fg,
                      background: theme.bg,
                      padding: "0.17rem 0.48rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {theme.label}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", color: "var(--muted)", fontSize: "0.78rem" }}>
                  <span>Urgency: {urgency}</span>
                  <span>First raised: {formatMeetingLabel(firstMeeting)}</span>
                  <span>Last mentioned: {formatMeetingLabel(lastMeeting)}</span>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => onOpenTimeline(issue.id)}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "0.5rem",
                      background: "var(--surface)",
                      color: "var(--foreground)",
                      padding: "0.35rem 0.52rem",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    View Timeline
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
