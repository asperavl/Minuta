"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import UploadZone from "@/components/UploadZone";
import MeetingCard from "@/components/MeetingCard";
import { use } from "react";

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
  word_count?: number;
  speaker_count?: number;
  created_at?: string;
  summary?: Record<string, unknown> | null;
};

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const supabase = createSupabaseBrowserClient();
  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .select(
        "id, file_name, processing_status, processing_error, word_count, speaker_count, created_at, summary"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    setMeetings((meetingRows as Meeting[]) ?? []);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  function handleMeetingReady(meetingId: string) {
    // Refresh the meeting row when it goes complete
    supabase
      .from("meetings")
      .select(
        "id, file_name, processing_status, processing_error, word_count, speaker_count, created_at, summary"
      )
      .eq("id", meetingId)
      .single()
      .then(({ data }) => {
        if (data) {
          setMeetings((prev) => {
            const exists = prev.find((m) => m.id === meetingId);
            if (exists) {
              return prev.map((m) => (m.id === meetingId ? (data as Meeting) : m));
            }
            return [data as Meeting, ...prev];
          });
        }
      });
  }

  function handleStatusChange(meetingId: string, newStatus: Meeting["processing_status"]) {
    setMeetings((prev) =>
      prev.map((m) => (m.id === meetingId ? { ...m, processing_status: newStatus } : m))
    );
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
        <span style={{ marginLeft: "0.625rem" }}>Loading project…</span>
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

  const completedMeetings = meetings.filter((m) => m.processing_status === "complete");
  const activeMeetings = meetings.filter((m) => m.processing_status !== "complete");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 2rem",
          height: "60px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          gap: "1rem",
        }}
      >
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
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
        >
          <ChevronLeftIcon />
          Dashboard
        </a>

        <span style={{ color: "var(--border)" }}>·</span>

        <div
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project?.name}
        </div>

        <div style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--muted)" }}>
          {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          flex: 1,
          maxWidth: "880px",
          width: "100%",
          margin: "0 auto",
          padding: "2.5rem 2rem",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        {/* Upload zone */}
        <section>
          <h2
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 0.875rem",
            }}
          >
            Add Meeting
          </h2>
          <UploadZone projectId={projectId} onMeetingReady={handleMeetingReady} />
        </section>

        {/* In-progress meetings */}
        {activeMeetings.length > 0 && (
          <section>
            <h2
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 0.875rem",
              }}
            >
              Processing
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {activeMeetings.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  onStatusChange={(mid, status) => {
                    handleStatusChange(mid, status);
                    if (status === "complete") handleMeetingReady(mid);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Completed meetings */}
        {completedMeetings.length > 0 ? (
          <section>
            <h2
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 0.875rem",
              }}
            >
              Meetings ({completedMeetings.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              {completedMeetings.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
          </section>
        ) : (
          activeMeetings.length === 0 && (
            <EmptyMeetings />
          )
        )}
      </main>
    </div>
  );
}

function EmptyMeetings() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "4rem 2rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.875rem",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "0.875rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FileIcon />
      </div>
      <div style={{ fontWeight: 700, fontSize: "1.0625rem", color: "var(--foreground)" }}>
        No meetings yet
      </div>
      <div style={{ fontSize: "0.9375rem", color: "var(--muted)", maxWidth: "300px" }}>
        Upload a transcript above to start extracting decisions and insights.
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="var(--muted)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="var(--muted)" strokeWidth="1.75" strokeLinecap="round" />
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
