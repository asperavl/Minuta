"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// ── Stage metadata ──────────────────────────────────────────────────────────

const STAGES = [
  { key: "summarizing",         label: "Summarizing meeting",          pct: 17 },
  { key: "extracting",          label: "Extracting decisions & actions", pct: 33 },
  { key: "verifying",           label: "Verifying extractions",         pct: 50 },
  { key: "merging",             label: "Merging results",               pct: 67 },
  { key: "analyzing_sentiment", label: "Analyzing sentiment",           pct: 83 },
  { key: "reconciling",         label: "Reconciling issues",            pct: 95 },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

function getStageInfo(stage: StageKey | null | undefined): { label: string; pct: number } {
  const found = STAGES.find((s) => s.key === stage);
  return found ?? { label: "Starting analysis...", pct: 5 };
}

// ── Types ───────────────────────────────────────────────────────────────────

type StagedFile = {
  id: string;
  file: File;
  queued?: boolean; // waiting in Analyze All queue
  error?: string;
};

type UploadedMeeting = {
  meetingId: string;
  fileName: string;
  status: "processing" | "complete" | "failed";
  stage?: StageKey | null;
  wordCount?: number;
  speakers?: string[];
};

type UploadZoneProps = {
  projectId: string;
  onMeetingReady?: (meetingId: string) => void;
};

// ── Component ───────────────────────────────────────────────────────────────

export default function UploadZone({ projectId, onMeetingReady }: UploadZoneProps) {
  const supabase = createSupabaseBrowserClient();
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [meetings, setMeetings] = useState<UploadedMeeting[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    return () => {
      pollingRef.current.forEach((iv) => clearInterval(iv));
    };
  }, []);

  // ── Dropzone ────────────────────────────────────────────────────────────────
  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: import("react-dropzone").FileRejection[]) => {
      setGlobalError(null);
      if (rejections.length > 0) {
        setGlobalError("Unsupported format. Please upload .txt or .vtt files only.");
        return;
      }
      setStaged((prev) => [
        ...prev,
        ...acceptedFiles.map((file) => ({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
        })),
      ]);
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/plain": [".txt"], "text/vtt": [".vtt"] },
    multiple: true,
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function removeStaged(id: string) {
    setStaged((prev) => prev.filter((s) => s.id !== id));
  }

  async function analyzeOne(stagedFile: StagedFile): Promise<void> {
    const formData = new FormData();
    formData.append("file", stagedFile.file);
    formData.append("projectId", projectId);

    // Remove from staged immediately
    setStaged((prev) => prev.filter((s) => s.id !== stagedFile.id));

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStaged((prev) => [
          ...prev,
          { ...stagedFile, queued: false, error: json.error || `Upload failed (${res.status})` },
        ]);
        return;
      }

      const { meetingId, wordCount, speakers } = json;

      setMeetings((prev) => [
        {
          meetingId,
          fileName: stagedFile.file.name,
          status: "processing",
          stage: null,
          wordCount,
          speakers,
        },
        ...prev,
      ]);

      // Trigger Edge Function from browser (session JWT)
      supabase.functions
        .invoke("process-transcript", { body: { meetingId } })
        .catch((err) => console.error("[UploadZone] Edge Function trigger failed:", err));

      // Wait for completion (used by Analyze All queue)
      await waitForCompletion(meetingId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setStaged((prev) => [...prev, { ...stagedFile, queued: false, error: msg }]);
    }
  }

  // Returns a promise that resolves when meeting reaches complete/failed
  function waitForCompletion(meetingId: string): Promise<void> {
    return new Promise((resolve) => {
      if (pollingRef.current.has(meetingId)) {
        resolve();
        return;
      }
      const interval = setInterval(async () => {
        const { data } = await supabase
          .from("meetings")
          .select("processing_status, processing_stage")
          .eq("id", meetingId)
          .single();

        if (!data) return;

        const status = data.processing_status as UploadedMeeting["status"];
        const stage = data.processing_stage as StageKey | null;

        setMeetings((prev) =>
          prev.map((m) => (m.meetingId === meetingId ? { ...m, status, stage } : m))
        );

        if (status === "complete" || status === "failed") {
          clearInterval(pollingRef.current.get(meetingId));
          pollingRef.current.delete(meetingId);
          if (status === "complete") onMeetingReady?.(meetingId);
          resolve();
        }
      }, 2500);

      pollingRef.current.set(meetingId, interval);
    });
  }

  // ── Analyze All (sequential queue) ──────────────────────────────────────────
  async function analyzeAll() {
    if (analyzingAll || staged.length === 0) return;
    setAnalyzingAll(true);

    // Mark all as queued in UI
    const toProcess = [...staged];
    setStaged((prev) =>
      prev.map((s) =>
        toProcess.some((t) => t.id === s.id) ? { ...s, queued: true } : s
      )
    );

    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i];
      // Un-queue the one about to run
      setStaged((prev) =>
        prev.map((s) => (s.id === file.id ? { ...s, queued: false } : s))
      );
      await analyzeOne(file);
      
      // Option 2 throttle: 15-second break between sequential triggers
      if (i < toProcess.length - 1) {
        await new Promise((r) => setTimeout(r, 15000));
      }
    }

    setAnalyzingAll(false);
  }

  async function deleteMeeting(meetingId: string) {
    setMeetings((prev) => prev.filter((m) => m.meetingId !== meetingId));
    await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" }).catch(console.error);
  }

  function retryMeeting(meetingId: string) {
    setMeetings((prev) =>
      prev.map((m) =>
        m.meetingId === meetingId ? { ...m, status: "processing", stage: null } : m
      )
    );
    supabase.functions
      .invoke("process-transcript", { body: { meetingId } })
      .catch((err) => console.error("[Retry] Edge Function failed:", err));
    waitForCompletion(meetingId);
  }

  const pendingStaged = staged.filter((s) => !s.error);
  const showAnalyzeAll = pendingStaged.length >= 2 && !analyzingAll;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Drop zone */}
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "0.875rem",
          padding: "2.5rem 2rem",
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
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Minimum 300 words required
          </div>
        </div>
      </div>

      {globalError && (
        <div role="alert" style={{ padding: "0.625rem 0.875rem", borderRadius: "0.5rem", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--danger)", fontSize: "0.875rem" }}>
          {globalError}
        </div>
      )}

      {/* Analyze All button */}
      {showAnalyzeAll && (
        <button
          onClick={analyzeAll}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.375rem",
            padding: "0.625rem 1rem",
            borderRadius: "0.625rem",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
          </svg>
          Analyze All ({pendingStaged.length} files)
        </button>
      )}

      {/* Staged files */}
      {staged.map((s) => (
        <StagedCard
          key={s.id}
          staged={s}
          onAnalyze={() => analyzeOne(s)}
          onRemove={() => removeStaged(s.id)}
          disabled={analyzingAll}
        />
      ))}

      {/* Processing / failed meetings */}
      {meetings
        .filter((m) => m.status !== "complete")
        .map((m) => (
          <ProcessingCard
            key={m.meetingId}
            meeting={m}
            onRetry={() => retryMeeting(m.meetingId)}
            onDelete={() => deleteMeeting(m.meetingId)}
          />
        ))}
    </div>
  );
}

// ── Staged card ──────────────────────────────────────────────────────────────

function StagedCard({
  staged,
  onAnalyze,
  onRemove,
  disabled,
}: {
  staged: StagedFile;
  onAnalyze: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const sizeKb = Math.round(staged.file.size / 1024);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${staged.error ? "rgba(248,113,113,0.35)" : staged.queued ? "var(--border)" : "var(--accent)"}`,
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        display: "flex",
        alignItems: "center",
        gap: "0.875rem",
        opacity: staged.queued ? 0.6 : 1,
        transition: "opacity 0.2s",
      }}
    >
      <FileIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {staged.file.name}
        </div>
        <div style={{ fontSize: "0.78125rem", color: staged.error ? "var(--danger)" : "var(--muted)", marginTop: "0.125rem" }}>
          {staged.error ? staged.error : staged.queued ? "Queued..." : `${sizeKb} KB - ready to analyze`}
        </div>
      </div>

      {!staged.queued && (
        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
          <button
            onClick={onRemove}
            disabled={disabled}
            style={{ padding: "0.375rem 0.75rem", borderRadius: "0.5rem", background: "transparent", color: "var(--muted)", fontSize: "0.8125rem", fontWeight: 500, border: "1px solid var(--border)", cursor: disabled ? "not-allowed" : "pointer", transition: "color 0.15s, border-color 0.15s" }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.borderColor = "rgba(248,113,113,0.4)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            Remove
          </button>
          <button
            onClick={onAnalyze}
            disabled={disabled}
            style={{ padding: "0.375rem 0.875rem", borderRadius: "0.5rem", background: disabled ? "var(--muted)" : "var(--accent)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, border: "none", cursor: disabled ? "not-allowed" : "pointer", transition: "background 0.15s" }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = "var(--accent)"; }}
          >
            Analyze
          </button>
        </div>
      )}
    </div>
  );
}

// ── Processing / failed card with real progress bar ──────────────────────────

function ProcessingCard({
  meeting,
  onRetry,
  onDelete,
}: {
  meeting: UploadedMeeting;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const stageInfo = getStageInfo(meeting.stage);
  const isProcessing = meeting.status === "processing";

  async function handleDelete() {
    if (!confirm("Delete this meeting? This cannot be undone.")) return;
    setDeleting(true);
    await onDelete();
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${meeting.status === "failed" ? "rgba(248,113,113,0.35)" : "var(--border)"}`,
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
        {isProcessing && <SpinnerIcon />}
        {meeting.status === "failed" && <ErrorIcon />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meeting.fileName}
          </div>
          <div style={{ fontSize: "0.78125rem", color: "var(--muted)", marginTop: "0.125rem" }}>
            {isProcessing ? stageInfo.label : "Processing failed"}
          </div>
        </div>

        {meeting.status === "failed" && (
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ padding: "0.375rem 0.75rem", borderRadius: "0.5rem", background: "transparent", color: deleting ? "var(--muted)" : "var(--danger)", fontSize: "0.8125rem", fontWeight: 500, border: "1px solid rgba(248,113,113,0.4)", cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={onRetry}
              style={{ padding: "0.375rem 0.875rem", borderRadius: "0.5rem", background: "var(--accent)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, border: "none", cursor: "pointer", transition: "background 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Progress bar (only while processing) */}
      {isProcessing && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <div style={{ height: "4px", borderRadius: "2px", background: "var(--surface-2, rgba(255,255,255,0.06))", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${stageInfo.pct}%`,
                background: "var(--accent)",
                borderRadius: "2px",
                transition: "width 1.2s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", color: "var(--muted)" }}>
            <span>Stage {STAGES.findIndex((s) => s.key === meeting.stage) + 1 || 1} of {STAGES.length} &mdash; {stageInfo.label}</span>
            <span>{stageInfo.pct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function UploadIcon({ active }: { active: boolean }) {
  return (
    <div style={{ width: "48px", height: "48px", borderRadius: "0.75rem", background: active ? "var(--accent)" : "var(--accent-subtle)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke={active ? "#fff" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} aria-hidden="true">
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
