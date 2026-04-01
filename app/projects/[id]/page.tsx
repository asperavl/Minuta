"use client";

import React, { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useDropzone } from "react-dropzone";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MeetingCard from "@/components/MeetingCard";
import ChatPanel from "@/components/ChatPanel";
import { ProcessingCard, StagedCard, StagedFile, UploadedMeeting } from "@/components/UploadZone";
import ActionItemsTable from "@/components/ActionItemsTable";
import IssueTracker from "@/components/IssueTracker";
import ProjectAnalysisPanel from "@/components/ProjectAnalysisPanel";
import SentimentTrendChart from "@/components/SentimentTrendChart";
import {
  asUrgency,
  buildProjectAnalysisReadModel,
  ExtractionModel,
  IssueMentionModel,
  IssueModel,
  linkActionItemsToIssues,
  normalizeSummary,
  ProjectAnalysisMeeting,
  SentimentSegmentModel,
  sortActionItems,
  URGENCY_SORT_WEIGHT,
} from "@/lib/phase3";

type Project = {
  id: string;
  name: string;
  created_at: string;
};

type Meeting = {
  id: string;
  file_name: string;
  processing_status: "pending" | "processing" | "complete" | "failed";
  processing_error?: string | null;
  processing_stage?: string | null;
  word_count?: number;
  speaker_count?: number;
  meeting_date?: string | null;
  sort_order?: number;
  created_at?: string;
  raw_text?: string | null;
  summary?: Record<string, unknown> | null;
};

type ReconcileState = {
  project_id: string;
  status: "idle" | "queued" | "running" | "failed" | "complete";
  running: boolean;
  queued: boolean;
  active_mode?: "incremental" | "full" | null;
  queued_mode?: "incremental" | "full" | null;
  last_error?: string | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
};

type TimelineItem =
  | { type: "completed"; id: string; meeting: Meeting }
  | { type: "staged"; id: string; file: StagedFile };

type ActiveTab = "meetings" | "analysis" | "actions" | "issues";

const TAB_LABELS: Record<ActiveTab, string> = {
  meetings: "Meetings",
  analysis: "Analysis",
  actions: "All Action Items",
  issues: "Issue Tracker",
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

function toSafeFileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "project";
  return trimmed.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}

function downloadTextFile(name: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const supabase = createSupabaseBrowserClient();

  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [reconcileState, setReconcileState] = useState<ReconcileState | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analyzingOne, setAnalyzingOne] = useState(false);
  const [manualVisualOrder, setManualVisualOrder] = useState<string[] | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("meetings");
  const [allDecisions, setAllDecisions] = useState<ExtractionModel[]>([]);
  const [allActionItems, setAllActionItems] = useState<ExtractionModel[]>([]);
  const [projectSentimentSegments, setProjectSentimentSegments] = useState<SentimentSegmentModel[]>([]);
  const [projectIssues, setProjectIssues] = useState<IssueModel[]>([]);
  const [projectIssueMentions, setProjectIssueMentions] = useState<IssueMentionModel[]>([]);
  const [actionSortMode, setActionSortMode] = useState<"urgency" | "due_date">("urgency");
  const [actionSortDirection, setActionSortDirection] = useState<"asc" | "desc">("asc");
  const [includeAppendix, setIncludeAppendix] = useState(false);
  const [exportingProjectPdf, setExportingProjectPdf] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    const intervals = pollingRef.current;
    return () => {
      intervals.forEach((iv) => clearInterval(iv));
    };
  }, []);

  const fetchProject = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "/login";
      return;
    }

    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id, name, created_at")
      .eq("id", projectId)
      .eq("owner_id", user.id)
      .single();

    if (projErr || !proj) {
      setError("Project not found.");
      setLoading(false);
      return;
    }

    setProject(proj);

    const { data: meetingRows } = await supabase
      .from("meetings")
      .select(
        "id, file_name, processing_status, processing_error, processing_stage, word_count, speaker_count, meeting_date, sort_order, created_at, raw_text, summary"
      )
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });

    const typedMeetings = (meetingRows as Meeting[]) ?? [];
    setMeetings(typedMeetings);

    const { data: reconcileRow, error: reconcileErr } = await supabase
      .from("project_reconcile_state")
      .select(
        "project_id, status, running, queued, active_mode, queued_mode, last_error, last_started_at, last_finished_at"
      )
      .eq("project_id", projectId)
      .maybeSingle();

    if (reconcileErr) {
      console.warn("[project] Failed to fetch reconcile state:", reconcileErr);
      setReconcileState(null);
    } else {
      setReconcileState((reconcileRow as ReconcileState | null) ?? null);
    }

    const meetingIds = typedMeetings.map((meeting) => meeting.id);
    if (meetingIds.length === 0) {
      setAllDecisions([]);
      setAllActionItems([]);
      setProjectSentimentSegments([]);
      setProjectIssues([]);
      setProjectIssueMentions([]);
      setLoading(false);
      return;
    }

    const [extractionRowsResp, sentimentResp, issuesResp] = await Promise.all([
      supabase
        .from("extractions")
        .select(
          "id, meeting_id, type, description, owner, due_date, urgency, context, related_topic, status, verified, supporting_quote, quote_location, superseded_by, created_at"
        )
        .in("meeting_id", meetingIds)
        .in("type", ["decision", "action_item"]),
      supabase
        .from("sentiment_segments")
        .select(
          "id, meeting_id, segment_index, speaker, text_excerpt, sentiment_label, sentiment_score, start_time"
        )
        .in("meeting_id", meetingIds)
        .order("segment_index", { ascending: true }),
      supabase
        .from("issues")
        .select(
          "id, project_id, title, description, status, opened_in, resolved_in, obsoleted_in, created_at"
        )
        .eq("project_id", projectId),
    ]);

    const extractionRows = (extractionRowsResp.data as ExtractionModel[] | null) ?? [];
    setAllDecisions(extractionRows.filter((row) => row.type === "decision"));
    setAllActionItems(extractionRows.filter((row) => row.type === "action_item"));
    setProjectSentimentSegments((sentimentResp.data as SentimentSegmentModel[] | null) ?? []);
    const issues = (issuesResp.data as IssueModel[] | null) ?? [];
    setProjectIssues(issues);

    if (issues.length === 0) {
      setProjectIssueMentions([]);
      setLoading(false);
      return;
    }

    const issueIds = issues.map((issue) => issue.id);
    const { data: mentionRows } = await supabase
      .from("issue_mentions")
      .select("id, issue_id, meeting_id, mention_type, context, supporting_quote, created_at")
      .in("issue_id", issueIds);
    setProjectIssueMentions((mentionRows as IssueMentionModel[] | null) ?? []);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    const shouldPoll =
      meetings.some((meeting) => meeting.processing_status !== "complete") ||
      reconcileState?.running === true ||
      reconcileState?.queued === true;

    if (!shouldPoll) return;
    const interval = setInterval(() => {
      fetchProject().catch((pollErr) => console.warn("[project] Poll failed:", pollErr));
    }, 3000);
    return () => clearInterval(interval);
  }, [meetings, reconcileState, fetchProject]);

  const activeMeetings = meetings.filter((meeting) => meeting.processing_status !== "complete");
  const completedMeetings = meetings.filter((meeting) => meeting.processing_status === "complete");
  const completedMeetingsForAnalysis = useMemo(
    () =>
      completedMeetings.map(
        (meeting): ProjectAnalysisMeeting => ({
          id: meeting.id,
          file_name: meeting.file_name,
          sort_order: meeting.sort_order ?? null,
          meeting_date: meeting.meeting_date ?? null,
          created_at: meeting.created_at ?? new Date(0).toISOString(),
          raw_text: meeting.raw_text ?? null,
          summary: meeting.summary ?? null,
        })
      ),
    [completedMeetings]
  );

  const timelineItems = useMemo(() => {
    const list: TimelineItem[] = [];
    completedMeetings.forEach((meeting) => list.push({ type: "completed", id: meeting.id, meeting }));
    stagedFiles.forEach((file) => list.push({ type: "staged", id: file.id, file }));

    list.sort((left, right) => {
      if (manualVisualOrder) {
        const leftIndex = manualVisualOrder.indexOf(left.id);
        const rightIndex = manualVisualOrder.indexOf(right.id);
        if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
      }

      const leftValue =
        left.type === "completed" ? left.meeting.sort_order ?? 0 : left.file.intendedSortOrder ?? 999999;
      const rightValue =
        right.type === "completed" ? right.meeting.sort_order ?? 0 : right.file.intendedSortOrder ?? 999999;

      if (leftValue === rightValue) return left.type === "staged" ? -1 : 1;
      return leftValue - rightValue;
    });

    return list;
  }, [completedMeetings, stagedFiles, manualVisualOrder]);

  const meetingMetaById = useMemo(
    () =>
      new Map(
        meetings.map((meeting) => [
          meeting.id,
          {
            id: meeting.id,
            file_name: meeting.file_name,
            sort_order: meeting.sort_order ?? null,
            meeting_date: meeting.meeting_date ?? null,
            created_at: meeting.created_at ?? "",
          },
        ])
      ),
    [meetings]
  );

  const issueById = useMemo(
    () => new Map(projectIssues.map((issue) => [issue.id, issue])),
    [projectIssues]
  );

  const linkedIssueByActionId = useMemo(
    () => linkActionItemsToIssues(allActionItems, projectIssues, projectIssueMentions),
    [allActionItems, projectIssues, projectIssueMentions]
  );

  const issueUrgencyById = useMemo(() => {
    const urgencyRankByIssue = new Map<string, number>();
    for (const action of allActionItems) {
      const linked = linkedIssueByActionId.get(action.id);
      if (!linked?.issueId) continue;
      const rank = URGENCY_SORT_WEIGHT[asUrgency(action.urgency)];
      const previousRank = urgencyRankByIssue.get(linked.issueId);
      if (previousRank == null || rank < previousRank) urgencyRankByIssue.set(linked.issueId, rank);
    }

    const labelMap = new Map<string, string>();
    urgencyRankByIssue.forEach((rank, issueId) => {
      const label = Object.entries(URGENCY_SORT_WEIGHT).find(([, value]) => value === rank)?.[0] ?? "No Action";
      labelMap.set(issueId, label);
    });
    return labelMap;
  }, [allActionItems, linkedIssueByActionId]);

  const sortedActionItems = useMemo(
    () => sortActionItems(allActionItems, actionSortMode, actionSortDirection),
    [allActionItems, actionSortDirection, actionSortMode]
  );

  const supersededLookup = useMemo(
    () => new Map(allActionItems.map((row) => [row.id, row])),
    [allActionItems]
  );

  const trendPoints = useMemo(() => {
    return completedMeetings
      .map((meeting, index) => {
        const summary = normalizeSummary(meeting.summary ?? null);
        return {
          meetingId: meeting.id,
          label: `M${index + 1}`,
          sentiment: summary.overall_sentiment.score ?? 0,
        };
      })
      .filter((point) => Number.isFinite(point.sentiment));
  }, [completedMeetings]);

  const projectAnalysisModel = useMemo(
    () =>
      buildProjectAnalysisReadModel({
        meetings: completedMeetingsForAnalysis,
        decisions: allDecisions,
        actionItems: allActionItems,
        sentimentSegments: projectSentimentSegments,
        issues: projectIssues,
      }),
    [completedMeetingsForAnalysis, allDecisions, allActionItems, projectSentimentSegments, projectIssues]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = timelineItems.findIndex((item) => item.id === active.id);
    const newIndex = timelineItems.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(timelineItems, oldIndex, newIndex);
    setManualVisualOrder(reordered.map((item) => item.id));

    const updatedStaged = [...stagedFiles];
    reordered.forEach((item, index) => {
      if (item.type !== "staged") return;
      const stagedMatch = updatedStaged.find((staged) => staged.id === item.id);
      if (stagedMatch) stagedMatch.intendedSortOrder = index + 1;
    });
    setStagedFiles(updatedStaged);

    const oldCompletedIds = timelineItems.filter((item) => item.type === "completed").map((item) => item.id);
    const newCompletedIds = reordered.filter((item) => item.type === "completed").map((item) => item.id);
    if (oldCompletedIds.join(",") === newCompletedIds.join(",")) return;

    const response = await fetch("/api/meetings/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, orderedMeetingIds: newCompletedIds }),
    }).catch((dragErr) => {
      console.error("[reorder] Failed:", dragErr);
      return null;
    });

    if (!response) {
      setGlobalError("Failed to reorder meetings. Please try again.");
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setGlobalError(formatFunctionErrorMessage(payload.error || `Reorder failed (${response.status})`));
      return;
    }

    await fetchProject();
    setManualVisualOrder(null);
  }

  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: import("react-dropzone").FileRejection[]) => {
      setGlobalError(null);
      if (rejections.length > 0) {
        setGlobalError("Unsupported format. Please upload .txt or .vtt files only.");
        return;
      }

      setStagedFiles((previous) => [
        ...previous,
        ...acceptedFiles.map((file, index) => {
          const highestOrder =
            completedMeetings.length > 0
              ? completedMeetings[completedMeetings.length - 1].sort_order ?? 0
              : 0;
          return {
            id: `staged-${Date.now()}-${Math.random()}`,
            file,
            intendedSortOrder: highestOrder + 1 + index + previous.length,
          };
        }),
      ]);
    },
    [completedMeetings]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/plain": [".txt"], "text/vtt": [".vtt"] },
    multiple: true,
  });

  function removeStaged(id: string) {
    setStagedFiles((previous) => previous.filter((item) => item.id !== id));
    if (manualVisualOrder) {
      setManualVisualOrder((previous) => (previous ? previous.filter((itemId) => itemId !== id) : null));
    }
  }

  function formatFunctionErrorMessage(raw: string): string {
    const message = (raw || "").toLowerCase();
    if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
      return "Rate limit hit on the model API. Retry in a moment or use a lower-cost model tier.";
    }
    if (message.includes("non-2xx")) {
      return "Processing service returned a non-2xx response. Check the detailed error shown on the failed meeting card.";
    }
    return raw;
  }

  async function getEdgeFunctionErrorDetails(err: unknown): Promise<string> {
    const fallback = err instanceof Error ? err.message : "Edge function request failed.";
    const maybeContext = (err as {
      context?: { status?: number; clone?: () => { text: () => Promise<string> } };
      message?: string;
    })?.context;

    if (!maybeContext?.clone) return fallback;
    const status = maybeContext.status;
    let body = "";
    try {
      body = (await maybeContext.clone().text()) || "";
    } catch {
      body = "";
    }

    if (status && body) return `HTTP ${status}: ${body}`;
    if (status) return `HTTP ${status}: ${fallback}`;
    return body || fallback;
  }

  async function analyzeOne(stagedFile: StagedFile): Promise<string | undefined> {
    if (analyzingOne) {
      setGlobalError("Another transcript is already being analyzed. Please wait for it to reach processing.");
      return;
    }

    const formData = new FormData();
    formData.append("file", stagedFile.file);
    formData.append("projectId", projectId);
    if (stagedFile.intendedSortOrder != null) {
      formData.append("intendedSortOrder", stagedFile.intendedSortOrder.toString());
    }

    setStagedFiles((previous) => previous.filter((item) => item.id !== stagedFile.id));
    setAnalyzingOne(true);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStagedFiles((previous) => [
          ...previous,
          { ...stagedFile, queued: false, error: formatFunctionErrorMessage(payload.error || `Upload failed (${response.status})`) },
        ]);
        throw new Error("Upload failed");
      }

      await fetchProject();
      await waitForStage(payload.meetingId, null);
      await fetchProject();
      setManualVisualOrder(null);
      return payload.meetingId;
    } catch (uploadErr) {
      const message = uploadErr instanceof Error ? uploadErr.message : "Upload failed";
      setStagedFiles((previous) => [
        ...previous,
        { ...stagedFile, queued: false, error: formatFunctionErrorMessage(message) },
      ]);
      throw uploadErr;
    } finally {
      setAnalyzingOne(false);
    }
  }

  function waitForStage(meetingId: string, targetStage: string | null): Promise<void> {
    return new Promise((resolve) => {
      if (pollingRef.current.has(meetingId)) {
        resolve();
        return;
      }

      const interval = setInterval(async () => {
        const { data } = await supabase
          .from("meetings")
          .select("processing_status, processing_stage, processing_error")
          .eq("id", meetingId)
          .single();

        if (!data) return;

        setMeetings((previous) =>
          previous.map((meeting) =>
            meeting.id === meetingId
              ? { ...meeting, processing_status: data.processing_status, processing_stage: data.processing_stage, processing_error: data.processing_error }
              : meeting
          )
        );

        if (data.processing_status === "failed") {
          clearInterval(pollingRef.current.get(meetingId));
          pollingRef.current.delete(meetingId);
          resolve();
          return;
        }

        if (data.processing_stage === targetStage || data.processing_status === "complete") {
          clearInterval(pollingRef.current.get(meetingId));
          pollingRef.current.delete(meetingId);
          resolve();
        }
      }, 2500);

      pollingRef.current.set(meetingId, interval);
    });
  }

  async function analyzeAll() {
    if (analyzingAll || stagedFiles.length === 0) return;
    setAnalyzingAll(true);

    const toProcess = [...stagedFiles];
    setStagedFiles((previous) =>
      previous.map((item) => (toProcess.some((queuedItem) => queuedItem.id === item.id) ? { ...item, queued: true } : item))
    );

    for (const staged of toProcess) {
      setStagedFiles((previous) => previous.map((item) => (item.id === staged.id ? { ...item, queued: false } : item)));
      try {
        await analyzeOne(staged);
      } catch (batchErr) {
        console.error("Analyze all failed for staged file", staged.id, batchErr);
      }
    }

    await fetchProject();
    setAnalyzingAll(false);
  }

  async function deleteMeeting(meetingId: string) {
    setMeetings((previous) => previous.filter((meeting) => meeting.id !== meetingId));
    await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" }).catch(console.error);
    await fetchProject();
  }

  async function retryMeeting(meetingId: string) {
    setMeetings((previous) =>
      previous.map((meeting) =>
        meeting.id === meetingId
          ? { ...meeting, processing_status: "processing", processing_stage: "extracting", processing_error: null }
          : meeting
      )
    );

    const { error: processError } = await supabase.functions.invoke("process-transcript", { body: { meetingId } });
    if (processError) {
      const details = await getEdgeFunctionErrorDetails(processError);
      setGlobalError(formatFunctionErrorMessage(details || processError.message));
      return;
    }

    await waitForStage(meetingId, null);
    await fetchProject();
  }

  async function exportProjectCsv() {
    const projectName = project?.name ?? "project";
    const zip = new JSZip();

    // 1. ACTION ITEMS CSV
    const actionRows = projectAnalysisModel.consolidatedActionItems.map((action) => {
      const linkedIssueMatch = linkedIssueByActionId.get(action.id);
      const linkedIssue = linkedIssueMatch?.issueId
        ? issueById.get(linkedIssueMatch.issueId) ?? null
        : null;
      const meetingMeta = meetingMetaById.get(action.meeting_id);

      return {
        meeting_name: meetingMeta?.file_name ?? action.meeting_id,
        meeting_date: formatDisplayDate(meetingMeta?.meeting_date),
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
    const decisionRows = projectAnalysisModel.consolidatedDecisions.map((decision) => {
      const meetingMeta = meetingMetaById.get(decision.meeting_id);
      return {
        meeting_name: meetingMeta?.file_name ?? decision.meeting_id,
        meeting_date: formatDisplayDate(meetingMeta?.meeting_date),
        decision: decision.description,
      };
    });
    zip.file("decisions.csv", Papa.unparse(decisionRows));

    // 3. SENTIMENT TIMELINE CSV
    const sentimentRows = projectAnalysisModel.meetingSnapshots.map((snapshot) => ({
      meeting_name: snapshot.file_name,
      meeting_date: snapshot.meeting_date || "",
      sentiment_score: snapshot.sentiment_score ?? "",
      sentiment_label: snapshot.sentiment_label ?? "",
      decisions_count: snapshot.decisions,
      action_items_count: snapshot.action_items,
      unresolved_topics_count: snapshot.unresolved_topics,
    }));
    zip.file("sentiment_trends.csv", Papa.unparse(sentimentRows));

    // 4. GENERATE AND DOWNLOAD BLOB
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const blobUrl = window.URL.createObjectURL(zipBlob);
    
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${toSafeFileName(projectName)}-intelligence-export.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  }

  async function exportProjectPdf() {
    const projectName = project?.name ?? "Project";
    setExportingProjectPdf(true);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 42;
      const contentWidth = doc.internal.pageSize.getWidth() - margin * 2;

      // COVER & HEADERS
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("Project Intelligence Report", margin, 58);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 100);
      doc.text(`Project: ${projectName}`, margin, 78);
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 92);
      doc.text(`Completed Meetings: ${projectAnalysisModel.completedMeetingCount}`, margin, 106);
      doc.setTextColor(0, 0, 0);

      // KPI TABLE
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Summary Stats", margin, 142);

      const avgSentiment =
        projectAnalysisModel.averageSentiment == null
          ? "N/A"
          : projectAnalysisModel.averageSentiment.toFixed(2);

      autoTable(doc, {
        startY: 154,
        head: [["Decisions", "Action Items", "Open Issues", "In Progress Issues", "Avg Sentiment"]],
        body: [
          [
            String(projectAnalysisModel.totalDecisions),
            String(projectAnalysisModel.totalActionItems),
            String(projectAnalysisModel.openIssueCount),
            String(projectAnalysisModel.inProgressIssueCount),
            avgSentiment,
          ],
        ],
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        styles: { fontSize: 10, halign: "center" },
      });

      // TL;DR ROLLUP
      const lastFinalY =
        (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 174;
      let yOffset = lastFinalY + 28;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("TL;DR Rollup", margin, yOffset);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const tldrLines = doc.splitTextToSize(projectAnalysisModel.tldrRollup, contentWidth);
      doc.text(tldrLines, margin, yOffset + 18);

      // MEETING SNAPSHOT
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Meeting Snapshot", margin, 54);
      autoTable(doc, {
        startY: 68,
        head: [["Meeting", "Date", "Sentiment", "Decisions", "Action Items", "Unresolved Topics"]],
        body: projectAnalysisModel.meetingSnapshots.map((snapshot) => [
          snapshot.file_name,
          formatDisplayDate(snapshot.meeting_date),
          `${snapshot.sentiment_label}${
            snapshot.sentiment_score == null ? "" : ` (${snapshot.sentiment_score.toFixed(2)})`
          }`,
          String(snapshot.decisions),
          String(snapshot.action_items),
          String(snapshot.unresolved_topics),
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
        head: [["Meeting", "Decision"]],
        body: projectAnalysisModel.consolidatedDecisions.map((decision) => {
          const meeting = meetingMetaById.get(decision.meeting_id);
          return [meeting?.file_name ?? decision.meeting_id, decision.description];
        }),
        theme: "grid",
        headStyles: { fillColor: [80, 80, 80] },
        styles: { fontSize: 9 },
      });

      const actionStartY =
        ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 84) +
        24;
      autoTable(doc, {
        startY: actionStartY,
        head: [["Meeting", "Task", "Owner", "Due", "Urgency", "Verification", "Linked Issue"]],
        body: projectAnalysisModel.consolidatedActionItems.map((action) => {
          const meeting = meetingMetaById.get(action.meeting_id);
          const linkedIssueMatch = linkedIssueByActionId.get(action.id);
          const linkedIssue = linkedIssueMatch?.issueId
            ? issueById.get(linkedIssueMatch.issueId) ?? null
            : null;
          return [
            meeting?.file_name ?? action.meeting_id,
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
      doc.text("Sentiment Overview", margin, 54);

      let sentimentY = 75;
      const trendSeries = projectAnalysisModel.sentimentTrendSeries;

      if (trendSeries.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        doc.text("Timeline Trend Graph (-1.0 to +1.0)", margin, sentimentY);
        
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

        const xStep = trendSeries.length > 1 ? graphWidth / (trendSeries.length - 1) : graphWidth / 2;
        const points = trendSeries.map((t, i) => {
          const clampedVal = Math.max(-1, Math.min(1, t.sentiment ?? 0));
          return {
            x: margin + (trendSeries.length === 1 ? xStep : i * xStep),
            y: midY - (clampedVal * (graphHeight / 2)),
            val: clampedVal
          };
        });

        // Draw Lines connecting points
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
            doc.setFillColor(76, 175, 80); // Green
            doc.setDrawColor(56, 142, 60);
          } else if (p.val < -0.3) {
            doc.setFillColor(244, 67, 54); // Red
            doc.setDrawColor(211, 47, 47);
          } else {
            doc.setFillColor(158, 158, 158); // Gray
            doc.setDrawColor(117, 117, 117);
          }
          doc.setLineWidth(1);
          doc.circle(p.x, p.y, 4.5, "FD"); // Fill and Draw
        });

        sentimentY += graphHeight + 35;
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        doc.text("Not enough trend points available to plot graph.", margin, sentimentY);
        sentimentY += 35;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Flagged moments (conflict/frustrated score < -0.5):", margin, sentimentY);

      sentimentY += 16;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const flagged = projectAnalysisModel.flattenedSentimentSegments.filter((segment) => {
        const label = (segment.sentiment_label ?? "").toLowerCase();
        return (label === "conflict" || label === "frustrated") && (segment.sentiment_score ?? 0) < -0.5;
      });

      if (flagged.length === 0) {
        doc.text("None detected.", margin, sentimentY);
      } else {
        flagged.slice(0, 18).forEach((segment) => {
          const lines = doc.splitTextToSize(
            `- Segment ${segment.segment_index}: ${segment.text_excerpt ?? "No excerpt available."}`,
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
        doc.text(
          "Appendix omitted. Enable the toggle before export to include all transcripts.",
          margin,
          82
        );
      } else if (projectAnalysisModel.transcriptBundle.length === 0) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(11);
        doc.text("No transcript text available for appendix export.", margin, 82);
      } else {
        let textY = 86;
        projectAnalysisModel.transcriptBundle.forEach((entry, index) => {
          const header = `${index + 1}. ${entry.file_name}`;
          if (textY > doc.internal.pageSize.getHeight() - 60) {
            doc.addPage();
            textY = 54;
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(13);
          doc.text(header, margin, textY);
          textY += 18;

          doc.setFontSize(9.5);
          const rawLines = (entry.raw_text ?? "").split(/\r?\n/);

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
          textY += 18;
        });
      }

      // PAGE FOOTERS
      const totalPages = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const footerStr = `Minuta Intelligence • Page ${i} of ${totalPages} • ${projectName}`;
        const strWidth = doc.getTextWidth(footerStr);
        const xPos = (doc.internal.pageSize.getWidth() - strWidth) / 2;
        const yPos = doc.internal.pageSize.getHeight() - 20;
        doc.text(footerStr, xPos, yPos);
      }

      doc.save(`${toSafeFileName(projectName)}-project-report.pdf`);
    } finally {
      setExportingProjectPdf(false);
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
        <LoadingSpinner />
        <span style={{ marginLeft: "0.625rem" }}>Loading project...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--background)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--danger)",
        }}
      >
        {error}
      </div>
    );
  }

  const showAnalyzeAll = stagedFiles.filter((item) => !item.error).length >= 2 && !analyzingAll && !analyzingOne;

  const reconcileBanner = (() => {
    if (!reconcileState) return null;
    if (reconcileState.status === "failed") {
      return {
        tone: "danger" as const,
        text: reconcileState.last_error ? `Reconciliation failed: ${reconcileState.last_error}` : "Reconciliation failed.",
      };
    }
    if (reconcileState.running && reconcileState.queued) {
      return { tone: "info" as const, text: "Reconciliation is running. A follow-up reconcile is queued." };
    }
    if (reconcileState.running) {
      return { tone: "info" as const, text: `Reconciliation running (${reconcileState.active_mode ?? "incremental"} mode).` };
    }
    if (reconcileState.queued) {
      return { tone: "info" as const, text: `Reconciliation queued (${reconcileState.queued_mode ?? "incremental"} mode).` };
    }
    return null;
  })();

  const projectCsvDisabled = projectAnalysisModel.consolidatedActionItems.length === 0;
  const projectPdfDisabled =
    exportingProjectPdf || projectAnalysisModel.completedMeetingCount === 0;

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
            href="/dashboard"
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
            Dashboard
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
            {project?.name}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={exportProjectCsv}
            disabled={projectCsvDisabled}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              background: "var(--surface-2)",
              color: projectCsvDisabled ? "var(--muted)" : "var(--foreground)",
              padding: "0.38rem 0.58rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: projectCsvDisabled ? "not-allowed" : "pointer",
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void exportProjectPdf()}
            disabled={projectPdfDisabled}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              background: "var(--surface-2)",
              color: projectPdfDisabled ? "var(--muted)" : "var(--foreground)",
              padding: "0.38rem 0.58rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: projectPdfDisabled ? "not-allowed" : "pointer",
            }}
          >
            {exportingProjectPdf ? "Exporting PDF..." : "Export PDF"}
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
          marginRight: chatOpen ? "400px" : "auto",
          transition: "margin-right 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          padding: "2.2rem 2rem 2.6rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.2rem",
        }}
      >
        <section>
          <div
            {...getRootProps()}
            style={{
              border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "0.875rem",
              padding: "2.15rem 1.95rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
              cursor: "pointer",
              background: isDragActive ? "var(--accent-subtle)" : "var(--surface)",
              transition: "border-color 0.2s, background 0.2s",
            }}
          >
            <input {...getInputProps()} />
            <UploadIcon active={isDragActive} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--foreground)", marginBottom: "0.25rem" }}>
                {isDragActive ? "Drop your transcript here" : "Upload a transcript"}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                Drag and drop or click to browse - .txt or .vtt only
              </div>
            </div>
          </div>

          {globalError && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.62rem 0.86rem",
                borderRadius: "0.5rem",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.25)",
                color: "var(--danger)",
                fontSize: "0.84rem",
              }}
            >
              {globalError}
            </div>
          )}

          {reconcileBanner && (
            <div
              style={{
                marginTop: "0.7rem",
                padding: "0.62rem 0.86rem",
                borderRadius: "0.5rem",
                background:
                  reconcileBanner.tone === "danger"
                    ? "rgba(248,113,113,0.08)"
                    : "rgba(99,102,241,0.08)",
                border:
                  reconcileBanner.tone === "danger"
                    ? "1px solid rgba(248,113,113,0.25)"
                    : "1px solid rgba(99,102,241,0.25)",
                color: reconcileBanner.tone === "danger" ? "var(--danger)" : "var(--foreground)",
                fontSize: "0.84rem",
              }}
            >
              {reconcileBanner.text}
            </div>
          )}

          {showAnalyzeAll && (
            <button
              onClick={() => void analyzeAll()}
              style={{
                marginTop: "0.75rem",
                width: "100%",
                padding: "0.62rem",
                borderRadius: "0.62rem",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Analyze All ({stagedFiles.length} files)
            </button>
          )}
        </section>

        {trendPoints.length >= 2 && <SentimentTrendChart points={trendPoints} />}

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

        {activeTab === "meetings" && (
          <>
            {activeMeetings.length > 0 && (
              <section>
                <h2
                  style={{
                    fontSize: "0.79rem",
                    fontWeight: 600,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 0.82rem",
                  }}
                >
                  Processing
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                  {activeMeetings.map((meeting) => (
                    <ProcessingCard
                      key={meeting.id}
                      meeting={
                        {
                          meetingId: meeting.id,
                          fileName: meeting.file_name,
                          status:
                            meeting.processing_status === "pending"
                              ? "processing"
                              : (meeting.processing_status as UploadedMeeting["status"]),
                          stage: meeting.processing_stage as UploadedMeeting["stage"],
                          wordCount: meeting.word_count,
                          speakers: [],
                          processingError: meeting.processing_error ?? null,
                        } as UploadedMeeting
                      }
                      onRetry={() => void retryMeeting(meeting.id)}
                      onDelete={() => void deleteMeeting(meeting.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {timelineItems.length > 0 && (
              <section>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", margin: "0 0 0.875rem" }}>
                  <h2
                    style={{
                      fontSize: "0.79rem",
                      fontWeight: 600,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      margin: 0,
                    }}
                  >
                    Timeline ({timelineItems.length})
                  </h2>
                  {timelineItems.length > 1 && (
                    <span style={{ fontSize: "0.74rem", color: "var(--muted)", opacity: 0.66 }}>
                      Top = Oldest, Bottom = Newest - drag to reorder
                    </span>
                  )}
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={timelineItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.86rem" }}>
                      {timelineItems.map((item) => (
                        <SortableItem key={item.id} id={item.id}>
                          {item.type === "completed" ? (
                            <MeetingCard meeting={item.meeting} onDelete={() => void deleteMeeting(item.meeting.id)} />
                          ) : (
                            <StagedCard
                              staged={item.file}
                              onAnalyze={() => void analyzeOne(item.file)}
                              onRemove={() => removeStaged(item.file.id)}
                              disabled={analyzingAll || analyzingOne}
                            />
                          )}
                        </SortableItem>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </section>
            )}
          </>
        )}

        {activeTab === "analysis" && (
          <ProjectAnalysisPanel
            meetings={completedMeetingsForAnalysis}
            decisions={allDecisions}
            actionItems={allActionItems}
            sentimentSegments={projectSentimentSegments}
            issues={projectIssues}
          />
        )}

        {activeTab === "actions" && (
          <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "0.75rem",
                background: "var(--surface)",
                padding: "0.65rem",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.55rem",
              }}
            >
              <label style={{ color: "var(--muted)", fontSize: "0.78rem" }}>Sort by</label>
              <select
                value={actionSortMode}
                onChange={(event) => setActionSortMode(event.target.value === "due_date" ? "due_date" : "urgency")}
                style={{
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                  padding: "0.38rem 0.5rem",
                  fontSize: "0.8rem",
                }}
              >
                <option value="urgency">Urgency</option>
                <option value="due_date">Due Date</option>
              </select>

              <button
                type="button"
                onClick={() => setActionSortDirection((previous) => (previous === "asc" ? "desc" : "asc"))}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  background: "var(--surface-2)",
                  color: "var(--foreground)",
                  padding: "0.38rem 0.5rem",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Direction: {actionSortDirection === "asc" ? "Ascending" : "Descending"}
              </button>
            </div>

            <ActionItemsTable
              rows={sortedActionItems}
              showMeetingSource
              meetingMetaById={meetingMetaById}
              linkedIssueByActionId={linkedIssueByActionId}
              issueById={issueById}
              supersededById={supersededLookup}
              emptyLabel="No action items across meetings yet."
            />
          </section>
        )}

        {activeTab === "issues" && (
          <IssueTracker
            issues={projectIssues}
            mentions={projectIssueMentions}
            meetingsById={meetingMetaById}
            issueUrgencyById={issueUrgencyById}
          />
        )}
      </main>

      <button
        onClick={() => setChatOpen((prev) => !prev)}
        style={{
          position: "fixed",
          bottom: "2rem",
          right: chatOpen ? "420px" : "2rem",
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
        projectId={projectId}
        title={project?.name || "Project"}
        meetingCount={completedMeetings.length}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: "relative",
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          position: "absolute",
          top: "50%",
          right: "-2rem",
          transform: "translateY(-50%)",
          cursor: isDragging ? "grabbing" : "grab",
          color: "var(--muted)",
          opacity: 0.5,
          padding: "0.25rem",
          touchAction: "none",
          zIndex: 1,
        }}
        title="Drag to reorder"
      >
        <DragHandleIcon />
      </div>
      {children}
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite" }}
      aria-hidden="true"
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="3" />
      <path d="M12 2a10 10 0 010 20" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="4" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="11" cy="4" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="11" cy="12" r="1.25" />
    </svg>
  );
}

function UploadIcon({ active }: { active: boolean }) {
  return (
    <div
      style={{
        width: "48px",
        height: "48px",
        borderRadius: "0.75rem",
        background: active ? "var(--accent)" : "var(--accent-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.2s",
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
          stroke={active ? "#fff" : "var(--accent)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
