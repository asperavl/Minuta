"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { use } from "react";
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
import { useDropzone } from "react-dropzone";
import MeetingCard from "@/components/MeetingCard";
import { StagedCard, ProcessingCard, UploadedMeeting, StagedFile } from "@/components/UploadZone";

// ── Icons ────────────────────────────────────────────────────────────────────
function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LoadingSpinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }} aria-hidden="true">
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
    <div style={{ width: "48px", height: "48px", borderRadius: "0.75rem", background: active ? "var(--accent)" : "var(--accent-subtle)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke={active ? "#fff" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ── Types ───────────────────────────────────────────────────────────────────
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
  | { type: "completed", id: string, meeting: Meeting }
  | { type: "staged", id: string, file: StagedFile };

// ── Component ───────────────────────────────────────────────────────────────
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
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Unified visual order override (optional, to keep UI from flickering before DB saves)
  const [manualVisualOrder, setManualVisualOrder] = useState<string[] | null>(null);

  useEffect(() => {
    const intervals = pollingRef.current;
    return () => {
      intervals.forEach((iv) => clearInterval(iv));
    };
  }, []);

  const fetchProject = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
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
      .select("id, file_name, processing_status, processing_error, processing_stage, word_count, speaker_count, meeting_date, sort_order, created_at, summary")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });

    setMeetings((meetingRows as Meeting[]) ?? []);

    const { data: reconcileRow, error: reconcileErr } = await supabase
      .from("project_reconcile_state")
      .select("project_id, status, running, queued, active_mode, queued_mode, last_error, last_started_at, last_finished_at")
      .eq("project_id", projectId)
      .maybeSingle();

    if (reconcileErr) {
      console.warn("[project] Failed to fetch reconcile state:", reconcileErr);
      setReconcileState(null);
    } else {
      setReconcileState((reconcileRow as ReconcileState | null) ?? null);
    }

    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    const shouldPoll =
      meetings.some((m) => m.processing_status !== "complete") ||
      reconcileState?.running === true ||
      reconcileState?.queued === true;

    if (!shouldPoll) return;
    const interval = setInterval(() => {
      fetchProject().catch((err) => console.warn("[project] Poll failed:", err));
    }, 3000);
    return () => clearInterval(interval);
  }, [meetings, reconcileState, fetchProject]);

  // ── Derived State ───────────────────────────────────────────────────────────
  const activeMeetings = meetings.filter((m) => m.processing_status !== "complete");
  const completedMeetings = meetings.filter((m) => m.processing_status === "complete");

  const timelineItems = useMemo(() => {
    const list: TimelineItem[] = [];
    completedMeetings.forEach(m => list.push({ type: "completed", id: m.id, meeting: m }));
    stagedFiles.forEach(s => list.push({ type: "staged", id: s.id, file: s }));

    // Sort by intended visual order, fallback to DB order or appended order
    list.sort((a, b) => {
      // If we have a manual visual order array from a recent drag, use it!
      if (manualVisualOrder) {
        const aIndex = manualVisualOrder.indexOf(a.id);
        const bIndex = manualVisualOrder.indexOf(b.id);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      }

      // Base sorting
      const valA = a.type === "completed" ? (a.meeting.sort_order ?? 0) : (a.file.intendedSortOrder ?? 999999);
      const valB = b.type === "completed" ? (b.meeting.sort_order ?? 0) : (b.file.intendedSortOrder ?? 999999);

      if (valA === valB) {
        return a.type === "staged" ? -1 : 1; // Stage slips in before Completed if they tie
      }
      return valA - valB;
    });

    return list;
  }, [completedMeetings, stagedFiles, manualVisualOrder]);

  // ── Drag & Drop Handlers ────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = timelineItems.findIndex((i) => i.id === active.id);
    const newIndex = timelineItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(timelineItems, oldIndex, newIndex);
    
    // Set manual visual order to instantly snap UI perfectly
    setManualVisualOrder(reordered.map(item => item.id));

    // Update staged files intendedSortOrder in memory
    const updatedStaged = [...stagedFiles];
    reordered.forEach((item, idx) => {
      if (item.type === "staged") {
        const fileMatch = updatedStaged.find(f => f.id === item.id);
        if (fileMatch) fileMatch.intendedSortOrder = idx + 1;
      }
    });
    setStagedFiles(updatedStaged);

    // If completed meetings actually changed relative to each other, hit the DB
    const oldCompletedIds = timelineItems.filter(i => i.type === "completed").map(i => i.id);
    const newCompletedIds = reordered.filter(i => i.type === "completed").map(i => i.id);
    
    if (oldCompletedIds.join(',') !== newCompletedIds.join(',')) {
      const res = await fetch("/api/meetings/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, orderedMeetingIds: newCompletedIds }),
      }).catch((err) => {
        console.error("[reorder] Failed:", err);
        return null;
      });

      if (!res) {
        setGlobalError("Failed to reorder meetings. Please try again.");
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setGlobalError(formatFunctionErrorMessage(json.error || `Reorder failed (${res.status})`));
        return;
      }
      
      // Refresh to grab the officially computed DB sort_orders
      fetchProject();
      setManualVisualOrder(null); // Clear override
    }
  }

  // ── Upload Handlers ──────────────────────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[], rejections: import("react-dropzone").FileRejection[]) => {
      setGlobalError(null);
      if (rejections.length > 0) {
        setGlobalError("Unsupported format. Please upload .txt or .vtt files only.");
        return;
      }
      
      setStagedFiles((prev) => [
        ...prev,
        ...acceptedFiles.map((file, i) => {
          // Default to bottom of the list
          const highestOrder = completedMeetings.length > 0 ? completedMeetings[completedMeetings.length - 1].sort_order! : 0;
          return {
            id: `staged-${Date.now()}-${Math.random()}`,
            file,
            intendedSortOrder: highestOrder + 1 + i + prev.length
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
    setStagedFiles((prev) => prev.filter((s) => s.id !== id));
    // Also remove from visual order override if present
    if (manualVisualOrder) setManualVisualOrder(prev => prev ? prev.filter(x => x !== id) : null);
  }

  function formatFunctionErrorMessage(raw: string): string {
    const msg = (raw || "").toLowerCase();
    if (
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("429")
    ) {
      return "Rate limit hit on the model API. Retry in a moment or use a lower-cost model tier.";
    }
    if (msg.includes("non-2xx")) {
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

    if (!maybeContext?.clone) {
      return fallback;
    }

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
      setGlobalError(
        "Another transcript is already being analyzed. Please wait for it to reach processing."
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", stagedFile.file);
    formData.append("projectId", projectId);
    
    if (stagedFile.intendedSortOrder) {
      formData.append("intendedSortOrder", stagedFile.intendedSortOrder.toString());
    }

    setStagedFiles((prev) => prev.filter((s) => s.id !== stagedFile.id));
    setAnalyzingOne(true);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStagedFiles((prev) => [...prev, { ...stagedFile, queued: false, error: formatFunctionErrorMessage(json.error || `Upload failed (${res.status})`) }]);
        throw new Error("Upload failed");
      }

      await fetchProject();
      await waitForStage(json.meetingId, null);
      await fetchProject();

      setManualVisualOrder(null);
      return json.meetingId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setStagedFiles((prev) => [...prev, { ...stagedFile, queued: false, error: formatFunctionErrorMessage(msg) }]);
      throw err;
    } finally {
      setAnalyzingOne(false);
    }
  }

  function waitForStage(meetingId: string, targetStage: string | null): Promise<void> {
    return new Promise((resolve) => {
      if (pollingRef.current.has(meetingId)) { resolve(); return; }
      const interval = setInterval(async () => {
        const { data } = await supabase
          .from("meetings")
          .select("processing_status, processing_stage, processing_error")
          .eq("id", meetingId)
          .single();
        if (!data) return;

        setMeetings((prev) =>
          prev.map((m) =>
            m.id === meetingId
              ? {
                  ...m,
                  processing_status: data.processing_status,
                  processing_stage: data.processing_stage,
                  processing_error: data.processing_error,
                }
              : m
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
    setStagedFiles((prev) => prev.map((s) => toProcess.some((t) => t.id === s.id) ? { ...s, queued: true } : s));
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i];
      setStagedFiles((prev) => prev.map((s) => (s.id === file.id ? { ...s, queued: false } : s)));
      
      try {
        await analyzeOne(file);
      } catch (e) {
        console.error("Failed to extract", file.id, e);
      }
    }

    await fetchProject();
    setAnalyzingAll(false);
  }

  async function deleteMeeting(meetingId: string) {
    setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" }).catch(console.error);
    fetchProject();
  }

  async function retryMeeting(meetingId: string) {
    setMeetings((prev) => prev.map((m) => m.id === meetingId ? { ...m, processing_status: "processing", processing_stage: "extracting", processing_error: null } : m));
    const { error: processErr } = await supabase.functions.invoke("process-transcript", { body: { meetingId } });
    if (processErr) {
      console.error("[process-transcript] Retry failed:", processErr);
      const details = await getEdgeFunctionErrorDetails(processErr);
      setGlobalError(
        formatFunctionErrorMessage(
          details || processErr.message || "Failed to retry transcript processing."
        )
      );
      return;
    }
    await waitForStage(meetingId, null);
    await fetchProject();
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        <LoadingSpinner /><span style={{ marginLeft: "0.625rem" }}>Loading project…</span>
      </div>
    );
  }

  if (error) {
    return <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--danger)" }}>{error}</div>;
  }

  const showAnalyzeAll =
    stagedFiles.filter((s) => !s.error).length >= 2 &&
    !analyzingAll &&
    !analyzingOne;

  const reconcileBanner = (() => {
    if (!reconcileState) return null;
    if (reconcileState.status === "failed") {
      return {
        tone: "danger" as const,
        text: reconcileState.last_error
          ? `Reconciliation failed: ${reconcileState.last_error}`
          : "Reconciliation failed.",
      };
    }
    if (reconcileState.running && reconcileState.queued) {
      return {
        tone: "info" as const,
        text: "Reconciliation is running. A follow-up reconcile is queued.",
      };
    }
    if (reconcileState.running) {
      return {
        tone: "info" as const,
        text: `Reconciliation running (${reconcileState.active_mode ?? "incremental"} mode).`,
      };
    }
    if (reconcileState.queued) {
      return {
        tone: "info" as const,
        text: `Reconciliation queued (${reconcileState.queued_mode ?? "incremental"} mode).`,
      };
    }
    return null;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", padding: "0 2rem", height: "60px", borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10, gap: "1rem" }}>
        <a href="/dashboard" style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "var(--muted)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}><ChevronLeftIcon />Dashboard</a>
        <span style={{ color: "var(--border)" }}>·</span>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--foreground)" }}>{project?.name}</div>
      </header>

      <main style={{ flex: 1, maxWidth: "880px", width: "100%", margin: "0 auto", padding: "2.5rem 2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* Upload Zone */}
        <section>
          <div {...getRootProps()} style={{ border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`, borderRadius: "0.875rem", padding: "2.5rem 2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", cursor: "pointer", background: isDragActive ? "var(--accent-subtle)" : "var(--surface)", transition: "border-color 0.2s, background 0.2s" }}>
            <input {...getInputProps()} />
            <UploadIcon active={isDragActive} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--foreground)", marginBottom: "0.25rem" }}>{isDragActive ? "Drop your transcript here" : "Upload a transcript"}</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>Drag and drop or click to browse - .txt or .vtt only</div>
            </div>
          </div>
          {globalError && <div style={{ marginTop: "1rem", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--danger)" }}>{globalError}</div>}
          {reconcileBanner && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.625rem 0.875rem",
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
              }}
            >
              {reconcileBanner.text}
            </div>
          )}
          
          {showAnalyzeAll && (
            <button onClick={analyzeAll} style={{ marginTop: "1rem", width: "100%", padding: "0.625rem", borderRadius: "0.625rem", background: "var(--accent)", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>
              Analyze All ({stagedFiles.length} files)
            </button>
          )}
        </section>

        {/* Processing Meetings */}
        {activeMeetings.length > 0 && (
          <section>
            <h2 style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 0.875rem" }}>Processing</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {activeMeetings.map((m) => (
                 <ProcessingCard key={m.id} meeting={{ meetingId: m.id, fileName: m.file_name, status: m.processing_status, stage: m.processing_stage, wordCount: m.word_count, speakers: [], processingError: m.processing_error ?? null } as UploadedMeeting} onRetry={() => retryMeeting(m.id)} onDelete={() => deleteMeeting(m.id)} />
              ))}
            </div>
          </section>
        )}

        {/* Unified Timeline (Completed + Staged) */}
        {timelineItems.length > 0 && (
          <section>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", margin: "0 0 0.875rem" }}>
              <h2 style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Timeline ({timelineItems.length})</h2>
              {timelineItems.length > 1 && <span style={{ fontSize: "0.75rem", color: "var(--muted)", opacity: 0.6 }}>· Top = Oldest, Bottom = Newest · drag to reorder</span>}
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={timelineItems.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  {timelineItems.map((item) => (
                    <SortableItem key={item.id} id={item.id}>
                      {item.type === "completed" ? (
                        <MeetingCard meeting={item.meeting} />
                      ) : (
                        <StagedCard staged={item.file} onAnalyze={() => analyzeOne(item.file)} onRemove={() => removeStaged(item.file.id)} disabled={analyzingAll || analyzingOne} />
                      )}
                    </SortableItem>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>
        )}
      </main>
    </div>
  );
}

// ── Sortable wrapper ─────────────────────────────────────────────────────────
function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: "relative" }}>
      <div {...attributes} {...listeners} style={{ position: "absolute", top: "50%", right: "-2rem", transform: "translateY(-50%)", cursor: isDragging ? "grabbing" : "grab", color: "var(--muted)", opacity: 0.5, padding: "0.25rem", touchAction: "none", zIndex: 1 }} title="Drag to reorder">
        <DragHandleIcon />
      </div>
      {children}
    </div>
  );
}
