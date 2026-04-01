"use client";

import { CSSProperties, use, useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import ActionItemsTable from "@/components/ActionItemsTable";
import SentimentDashboard from "@/components/SentimentDashboard";
import TopicTimeline from "@/components/TopicTimeline";
import ChatPanel from "@/components/ChatPanel";
import {
  ExtractionModel,
  IssueMentionModel,
  IssueModel,
  linkActionItemsToIssues,
  normalizeSummary,
  sentimentColorForLabel,
  SentimentSegmentModel,
  unresolvedTopicCount,
} from "@/lib/phase3";

type MeetingRecord = {
  id: string;
  project_id: string;
  file_name: string;
  meeting_date: string | null;
  created_at: string;
  raw_text: string;
  word_count: number | null;
  speaker_count: number | null;
  summary: Record<string, unknown> | null;
};

type ActiveTab = "summary" | "decisions" | "sentiment";
const TAB_LABELS: Record<ActiveTab, string> = {
  summary: "Summary",
  decisions: "Decisions & Actions",
  sentiment: "Sentiment & Timeline",
};

function formatDisplayDate(date: string | null | undefined): string {
  if (!date) return "Unknown date";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function extractDurationFromTopics(summary: ReturnType<typeof normalizeSummary>): string {
  if (summary.topics.length === 0) return "Unknown";
  const first = summary.topics[0].start_time ?? "";
  const last = summary.topics[summary.topics.length - 1].end_time ?? "";
  if (!first || !last) return "Unknown";
  return `${first} - ${last}`;
}

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = use(params);
  const supabase = createSupabaseBrowserClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [projectName, setProjectName] = useState<string>("Project");
  const [decisions, setDecisions] = useState<ExtractionModel[]>([]);
  const [actionItems, setActionItems] = useState<ExtractionModel[]>([]);
  const [supersededRows, setSupersededRows] = useState<ExtractionModel[]>([]);
  const [sentimentSegments, setSentimentSegments] = useState<SentimentSegmentModel[]>([]);
  const [issues, setIssues] = useState<IssueModel[]>([]);
  const [issueMentions, setIssueMentions] = useState<IssueMentionModel[]>([]);
  const [includeAppendix, setIncludeAppendix] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("summary");
  const [deleting, setDeleting] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  async function deleteMeeting() {
    if (!meeting) return;
    setDeleting(true);
    try {
      const resp = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete meeting.");
      }
      window.location.href = `/projects/${meeting.project_id}`;
    } catch (err: any) {
      toast.error(err.message || "Failed to delete meeting.");
      setDeleting(false);
    }
  }

  const fetchMeetingData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "/login";
      return;
    }

    const { data: meetingRow, error: meetingErr } = await supabase
      .from("meetings")
      .select("id, project_id, file_name, meeting_date, created_at, raw_text, word_count, speaker_count, summary")
      .eq("id", meetingId)
      .single();

    if (meetingErr || !meetingRow) {
      setError("Meeting not found.");
      setLoading(false);
      return;
    }

    const typedMeeting = meetingRow as MeetingRecord;
    setMeeting(typedMeeting);

    const projectId = typedMeeting.project_id;
    const [projectResp, extractionResp, sentimentResp, issueResp] = await Promise.all([
      supabase.from("projects").select("name").eq("id", projectId).single(),
      supabase
        .from("extractions")
        .select(
          "id, meeting_id, type, description, owner, due_date, urgency, context, related_topic, status, verified, supporting_quote, quote_location, superseded_by, created_at"
        )
        .eq("meeting_id", meetingId)
        .in("type", ["decision", "action_item"]),
      supabase
        .from("sentiment_segments")
        .select("id, meeting_id, segment_index, speaker, text_excerpt, sentiment_label, sentiment_score, start_time")
        .eq("meeting_id", meetingId)
        .order("segment_index", { ascending: true }),
      supabase
        .from("issues")
        .select("id, project_id, title, description, status, opened_in, resolved_in, obsoleted_in, created_at")
        .eq("project_id", projectId),
    ]);

    if (projectResp.data?.name) setProjectName(projectResp.data.name);

    const extractionRows = (extractionResp.data as ExtractionModel[] | null) ?? [];
    setDecisions(extractionRows.filter((row) => row.type === "decision"));
    const actionRows = extractionRows.filter((row) => row.type === "action_item");
    setActionItems(actionRows);

    const supersededIds = actionRows.map((row) => row.superseded_by).filter((id): id is string => Boolean(id));
    if (supersededIds.length > 0) {
      const { data: supersededData } = await supabase
        .from("extractions")
        .select(
          "id, meeting_id, type, description, owner, due_date, urgency, context, related_topic, status, verified, supporting_quote, quote_location, superseded_by, created_at"
        )
        .in("id", supersededIds);
      setSupersededRows((supersededData as ExtractionModel[] | null) ?? []);
    } else {
      setSupersededRows([]);
    }

    setSentimentSegments((sentimentResp.data as SentimentSegmentModel[] | null) ?? []);
    const issueRows = (issueResp.data as IssueModel[] | null) ?? [];
    setIssues(issueRows);

    if (issueRows.length > 0) {
      const issueIds = issueRows.map((issue) => issue.id);
      const { data: mentionRows } = await supabase
        .from("issue_mentions")
        .select("id, issue_id, meeting_id, mention_type, context, supporting_quote, created_at")
        .in("issue_id", issueIds);
      setIssueMentions((mentionRows as IssueMentionModel[] | null) ?? []);
    } else {
      setIssueMentions([]);
    }

    setLoading(false);
  }, [meetingId, supabase]);

  useEffect(() => {
    fetchMeetingData();
  }, [fetchMeetingData]);

  const summary = useMemo(() => normalizeSummary(meeting?.summary ?? null), [meeting?.summary]);
  const issueById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);
  const linkedIssueByActionId = useMemo(
    () => linkActionItemsToIssues(actionItems, issues, issueMentions),
    [actionItems, issues, issueMentions]
  );
  const supersededLookup = useMemo(
    () => new Map([...actionItems, ...supersededRows].map((row) => [row.id, row])),
    [actionItems, supersededRows]
  );

  async function exportCsv() {
    if (!meeting) return;
    const zip = new JSZip();

    // 1. ACTION ITEMS CSV
    const actionRows = actionItems.map((action) => {
      const linkedIssue = linkedIssueByActionId.get(action.id)?.issueId
        ? issueById.get(linkedIssueByActionId.get(action.id)?.issueId ?? "")
        : null;
      return {
        meeting_name: meeting.file_name,
        task: action.description,
        owner: action.owner ?? "Unassigned",
        due_date: action.due_date ?? "Not specified",
        urgency: action.urgency ?? "Low Priority",
        verified: action.verified ? "true" : "false",
        linked_issue_title: linkedIssue?.title ?? "",
        context: action.context ?? "",
        supporting_quote: action.supporting_quote ?? "",
      };
    });
    zip.file("action_items.csv", Papa.unparse(actionRows));

    // 2. DECISIONS CSV
    const decisionRows = decisions.map((decision) => ({
      meeting_name: meeting.file_name,
      decision: decision.description,
    }));
    zip.file("decisions.csv", Papa.unparse(decisionRows));

    // 3. TOPICS TIMELINE CSV
    const topicRows = summary.topics.map((topic) => ({
      meeting_name: meeting.file_name,
      start_time: topic.start_time ?? "",
      end_time: topic.end_time ?? "",
      topic: topic.title,
      summary: topic.summary ?? "",
      status: topic.status,
      urgency: topic.urgency,
      supporting_quote: topic.supporting_quote ?? "",
    }));
    zip.file("topic_timeline.csv", Papa.unparse(topicRows));

    // GENERATE ZIP BLOB
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const blobUrl = window.URL.createObjectURL(zipBlob);
    
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${meeting.file_name.replace(/\.[^.]+$/, "")}-intelligence-export.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  }

  async function exportPdf() {
    if (!meeting) return;
    setExportingPdf(true);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 42;
      const contentWidth = pageWidth - margin * 2;

      // COVER & HEADERS
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("Meeting Intelligence Report", margin, 58);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 100);
      doc.text(`Meeting: ${meeting.file_name}`, margin, 78);
      doc.text(`Project: ${projectName}`, margin, 92);
      doc.text(`Date: ${formatDisplayDate(meeting.meeting_date ?? meeting.created_at)}`, margin, 106);
      doc.text(`Duration: ${extractDurationFromTopics(summary)}`, margin, 120);
      doc.text(`Word count: ${meeting.word_count ?? 0}`, margin, 134);
      doc.setTextColor(0, 0, 0);

      // KPI TABLE
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Summary Stats", margin, 170);

      autoTable(doc, {
        startY: 182,
        head: [["Decisions", "Action Items", "Unresolved Topics", "Overall Sentiment", "Speakers"]],
        body: [
          [
            String(summary.stats.decisions || decisions.length),
            String(summary.stats.action_items || actionItems.length),
            String(unresolvedTopicCount(summary)),
            summary.overall_sentiment.label || "neutral",
            String(meeting.speaker_count ?? 0),
          ],
        ],
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        styles: { fontSize: 10, halign: "center" },
      });

      // TL;DR
      const lastY = (doc as any).lastAutoTable?.finalY ?? 220;
      let yOffset = lastY + 28;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("TL;DR Rollup", margin, yOffset);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const tldrLines = doc.splitTextToSize(summary.tldr || "No summary text available.", contentWidth);
      doc.text(tldrLines, margin, yOffset + 18);

      // TOPIC TIMELINE
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Topic Timeline", margin, 54);
      autoTable(doc, {
        startY: 68,
        head: [["Time", "Topic", "Status", "Urgency"]],
        body: summary.topics.map((topic) => [
          `${topic.start_time ?? "?"} - ${topic.end_time ?? "?"}`,
          topic.title,
          topic.status,
          topic.urgency,
        ]),
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80] },
        styles: { fontSize: 9 },
      });

      // DECISIONS + ACTION ITEMS
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Decisions and Action Items", margin, 54);
      autoTable(doc, {
        startY: 68,
        head: [["#", "Decision"]],
        body: decisions.map((decision, index) => [String(index + 1), decision.description]),
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80] },
        styles: { fontSize: 9 },
      });

      const actionStartY = ((doc as any).lastAutoTable?.finalY ?? 84) + 24;
      autoTable(doc, {
        startY: actionStartY,
        head: [["Task", "Owner", "Due", "Urgency", "Verification", "Linked Issue"]],
        body: actionItems.map((action) => {
          const linkedIssue = linkedIssueByActionId.get(action.id)?.issueId
            ? issueById.get(linkedIssueByActionId.get(action.id)?.issueId ?? "")
            : null;
          return [
            action.description,
            action.owner ?? "Unassigned",
            action.due_date ?? "Not specified",
            action.urgency ?? "Low Priority",
            action.verified ? "Verified" : "Unverified",
            linkedIssue?.title ?? "Unlinked",
          ];
        }),
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80] },
        styles: { fontSize: 8.5, cellPadding: 3.2 },
      });

      // SENTIMENT OVERVIEW
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Sentiment Analysis", margin, 54);

      let sentimentY = 75;
      if (sentimentSegments.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        doc.text("Meeting Mood Arc (-1.0 to +1.0)", margin, sentimentY);
        
        sentimentY += 15;
        const graphHeight = 150;
        const graphWidth = contentWidth;
        const midY = sentimentY + graphHeight / 2;

        // Draw Zero Line
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(1);
        doc.line(margin, midY, margin + graphWidth, midY);

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("+1.0 Positive", margin, sentimentY + 8);
        doc.text("-1.0 Negative", margin, sentimentY + graphHeight - 4);
        doc.setTextColor(0, 0, 0);

        const xStep = sentimentSegments.length > 1 ? graphWidth / (sentimentSegments.length - 1) : graphWidth / 2;
        const points = sentimentSegments.map((s, i) => {
          const val = s.sentiment_score ?? 0;
          const clampedVal = Math.max(-1, Math.min(1, val));
          return {
            x: margin + (sentimentSegments.length === 1 ? xStep : i * xStep),
            y: midY - (clampedVal * (graphHeight / 2)),
            val: clampedVal
          };
        });

        // Draw Lines
        if (points.length > 1) {
          doc.setDrawColor(100, 100, 100);
          doc.setLineWidth(1.5);
          for (let i = 0; i < points.length - 1; i++) {
            doc.line(points[i].x, points[i].y, points[i+1].x, points[i+1].y);
          }
        }

        // Draw Points
        points.forEach((p) => {
          if (p.val > 0.3) {
            doc.setFillColor(76, 175, 80);
            doc.setDrawColor(56, 142, 60);
          } else if (p.val < -0.3) {
            doc.setFillColor(244, 67, 54);
            doc.setDrawColor(211, 47, 47);
          } else {
            doc.setFillColor(158, 158, 158);
            doc.setDrawColor(117, 117, 117);
          }
          doc.setLineWidth(1);
          doc.circle(p.x, p.y, 4.5, "FD");
        });

        sentimentY += graphHeight + 35;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Speaker Observations:", margin, sentimentY);
      sentimentY += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      summary.speaker_observations.forEach((observation) => {
        const lines = doc.splitTextToSize(
          `- ${observation.speaker}: ${observation.observation}`,
          contentWidth
        );
        doc.text(lines, margin, sentimentY);
        sentimentY += lines.length * 12 + 4;
      });

      sentimentY += 12;
      doc.setFont("helvetica", "bold");
      doc.text("Flagged moments (conflict/frustrated score < -0.5):", margin, sentimentY);
      sentimentY += 16;
      doc.setFont("helvetica", "normal");
      const flagged = sentimentSegments.filter((segment) => {
        const label = (segment.sentiment_label ?? "").toLowerCase();
        return (label === "conflict" || label === "frustrated") && (segment.sentiment_score ?? 0) < -0.5;
      });

      if (flagged.length === 0) {
        doc.text("None detected.", margin, sentimentY);
      } else {
        flagged.forEach((segment) => {
          const lines = doc.splitTextToSize(
            `- Segment ${segment.segment_index} (${segment.start_time ?? "unknown"}): ${segment.text_excerpt ?? "No excerpt"}`,
            contentWidth
          );
          if (sentimentY + lines.length * 12 > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            sentimentY = 54;
          }
          doc.text(lines, margin, sentimentY);
          sentimentY += lines.length * 12 + 6;
        });
      }

      // APPENDIX
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Appendix", margin, 54);

      if (!includeAppendix) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(11);
        doc.text("Appendix omitted. Enable the toggle before export to include full raw transcript.", margin, 82);
      } else if (!meeting.raw_text) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(11);
        doc.text("No transcript text available.", margin, 82);
      } else {
        let textY = 86;
        doc.setFontSize(9.5);
        const rawLines = meeting.raw_text.split(/\r?\n/);
        
        rawLines.forEach((rawLine) => {
          if (!rawLine.trim()) {
            textY += 6;
            return;
          }

          const match = rawLine.match(/^([A-Za-z0-9\s_-]+):\s*(.*)$/);
          if (match) {
            const speaker = match[1] + ": ";
            const speech = match[2];
            const speakerWidth = doc.getTextWidth(speaker);

            if (textY > doc.internal.pageSize.getHeight() - 40) {
              doc.addPage();
              textY = 54;
            }

            doc.setFont("helvetica", "bold");
            doc.text(speaker, margin, textY);

            doc.setFont("helvetica", "normal");
            const speechLines = doc.splitTextToSize(speech, contentWidth - speakerWidth);
            speechLines.forEach((sLine: string) => {
              if (textY > doc.internal.pageSize.getHeight() - 36) {
                doc.addPage();
                textY = 54;
              }
              doc.text(sLine, margin + speakerWidth, textY);
              textY += 12;
            });
          } else {
            doc.setFont("helvetica", "normal");
            const plainLines = doc.splitTextToSize(rawLine, contentWidth);
            plainLines.forEach((pLine: string) => {
              if (textY > doc.internal.pageSize.getHeight() - 36) {
                doc.addPage();
                textY = 54;
              }
              doc.text(pLine, margin, textY);
              textY += 12;
            });
          }
        });
      }

      // PAGE FOOTERS
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const footerStr = `Minuta Intelligence • Page ${i} of ${totalPages} • ${meeting.file_name}`;
        const strWidth = doc.getTextWidth(footerStr);
        const xPos = (doc.internal.pageSize.getWidth() - strWidth) / 2;
        const yPos = doc.internal.pageSize.getHeight() - 20;
        doc.text(footerStr, xPos, yPos);
      }

      doc.save(`${meeting.file_name.replace(/\.[^.]+$/, "")}-report.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        Loading meeting...
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--danger)",
          padding: "1.2rem",
          textAlign: "center",
        }}
      >
        {error || "Meeting not found."}
      </div>
    );
  }

  const unresolvedCount = unresolvedTopicCount(summary);
  const overallSentimentColor = sentimentColorForLabel(summary.overall_sentiment.label);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.65rem 2rem",
          minHeight: "60px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", minWidth: 0 }}>
          <a
            href={`/projects/${meeting.project_id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              color: "var(--muted)",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            <ChevronLeftIcon />
            Project
          </a>
          <span style={{ color: "var(--border)" }}>.</span>
          <div
            style={{
              fontWeight: 700,
              fontSize: "1rem",
              color: "var(--foreground)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meeting.file_name}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
          <AlertDialog>
            <AlertDialogTrigger render={<button
                type="button"
                disabled={deleting}
                style={{
                  background: "none",
                  border: "none",
                  cursor: deleting ? "not-allowed" : "pointer",
                  color: "var(--danger)",
                  padding: "0.38rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "0.4rem",
                  transition: "all 0.15s",
                  opacity: deleting ? 0.5 : 1,
                  marginRight: "0.4rem",
                }}
                title="Delete Meeting"
              >
                <TrashIcon />
              </button>} />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Meeting</AlertDialogTitle>
                <AlertDialogDescription>Are you sure you want to delete this meeting? This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void deleteMeeting()} className="bg-red-500 hover:bg-red-600 text-white">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <button
            type="button"
            onClick={() => void exportCsv()}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              background: "var(--surface-2)",
              color: "var(--foreground)",
              padding: "0.38rem 0.58rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={exportingPdf}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              background: "var(--surface-2)",
              color: exportingPdf ? "var(--muted)" : "var(--foreground)",
              padding: "0.38rem 0.58rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: exportingPdf ? "not-allowed" : "pointer",
            }}
          >
            {exportingPdf ? "Exporting PDF..." : "Export PDF"}
          </button>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              color: "var(--muted)",
              fontSize: "0.78rem",
            }}
          >
            <input
              type="checkbox"
              checked={includeAppendix}
              onChange={(event) => setIncludeAppendix(event.target.checked)}
            />
            Include Appendix
          </label>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          maxWidth: "1040px",
          width: "100%",
          margin: "0 auto",
          padding: "2.2rem 2rem 2.6rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.2rem",
        }}
      >
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: "0.85rem",
            background: "var(--surface)",
            padding: "0.7rem",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {(Object.keys(TAB_LABELS) as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.52rem",
                  padding: "0.42rem 0.6rem",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: activeTab === tab ? "#fff" : "var(--foreground)",
                  background: activeTab === tab ? "var(--accent)" : "var(--surface-2)",
                }}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "summary" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.65rem" }}>
              <MetricCard label="Decisions" value={summary.stats.decisions || decisions.length} />
              <MetricCard label="Action Items" value={summary.stats.action_items || actionItems.length} />
              <MetricCard label="Unresolved Topics" value={unresolvedCount} />
              <MetricCard
                label="Overall Sentiment"
                value={summary.overall_sentiment.label || "neutral"}
                valueColor={overallSentimentColor}
              />
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: "0.8rem", background: "var(--surface)", padding: "1.2rem", marginTop: "0.5rem" }}>
              <div style={{ fontSize: "0.77rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>TL;DR Summary</div>
              <p style={{ margin: "0.65rem 0 0", color: "var(--foreground)", lineHeight: 1.62, fontSize: "0.94rem" }}>
                {summary.tldr || "No TL;DR summary was available for this meeting."}
              </p>
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: "0.8rem", background: "var(--surface)", padding: "1.2rem" }}>
              <div style={{ fontSize: "0.77rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, marginBottom: "0.8rem" }}>
                Speaker Participation
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                {summary.stats.speaker_breakdown.length > 0 ? (
                  summary.stats.speaker_breakdown.map((speaker) => (
                    <div key={`speaker-${speaker.name}`} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <span style={{ color: "var(--foreground)", fontSize: "0.88rem", width: "120px" }}>{speaker.name}</span>
                      <div style={{ flex: 1, height: "8px", borderRadius: "999px", background: "var(--surface-2)", overflow: "hidden" }}>
                        <div style={{ width: `${speaker.percentage}%`, height: "100%", background: "var(--accent)", borderRadius: "999px" }} />
                      </div>
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem", width: "40px", textAlign: "right" }}>{speaker.percentage}%</span>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: "0.86rem" }}>No speaker participation data found.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "decisions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            <div style={{ border: "1px solid var(--border)", borderRadius: "0.8rem", overflow: "hidden", background: "var(--surface)" }}>
              <div style={{ padding: "1.1rem 1.2rem", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "var(--foreground)" }}>Discrete Decisions</h3>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--surface)" }}>
                    <th style={tableHeaderCell}>#</th>
                    <th style={tableHeaderCell}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ ...tableBodyCell, color: "var(--muted)" }}>
                        No decisions extracted for this meeting.
                      </td>
                    </tr>
                  ) : (
                    decisions.map((decision, index) => (
                      <tr key={decision.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={tableBodyCell}>{index + 1}</td>
                        <td style={tableBodyCell}>{decision.description}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <ActionItemsTable
              rows={actionItems}
              linkedIssueByActionId={linkedIssueByActionId}
              issueById={issueById}
              supersededById={supersededLookup}
              emptyLabel="No action items extracted for this meeting."
            />
          </div>
        )}

        {activeTab === "sentiment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <SentimentDashboard segments={sentimentSegments} speakerObservations={summary.speaker_observations} />
            <div>
              <div style={{ marginBottom: "1rem" }}>
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--foreground)" }}>Topic Timeline</h3>
              </div>
              <TopicTimeline topics={summary.topics} />
            </div>
          </div>
        )}

      </main>

      <button
        onClick={() => setIsChatOpen((p) => !p)}
        style={{
          position: "fixed",
          bottom: "2rem",
          right: isChatOpen ? "420px" : "2rem",
          width: "56px",
          height: "56px",
          borderRadius: "28px",
          background: "var(--accent)",
          color: "white",
          border: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "right 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s",
          zIndex: 20,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        aria-label="Toggle chat"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>

      <ChatPanel
        projectId={meeting.project_id}
        meetingId={meeting.id}
        title={meeting.file_name}
        meetingCount={1}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
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
    <div style={{ border: "1px solid var(--border)", borderRadius: "0.72rem", background: "var(--surface)", padding: "0.8rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ color: "var(--muted)", fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ color: valueColor ?? "var(--foreground)", fontSize: "1.25rem", fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

const tableHeaderCell: CSSProperties = {
  textAlign: "left",
  color: "var(--muted)",
  fontSize: "0.74rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "0.8rem 1.2rem",
  fontWeight: 700,
  borderBottom: "1px solid var(--border)",
};

const tableBodyCell: CSSProperties = {
  textAlign: "left",
  color: "var(--foreground)",
  fontSize: "0.88rem",
  padding: "0.8rem 1.2rem",
  verticalAlign: "top",
  lineHeight: 1.55,
};

function ChevronLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: "1.125rem", height: "1.125rem" }}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: "1.125rem", height: "1.125rem" }}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
