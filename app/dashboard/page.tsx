"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

type Project = {
  id: string;
  name: string;
  created_at: string;
  meeting_count?: number;
};

type User = {
  email?: string;
  user_metadata?: { full_name?: string; avatar_url?: string };
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUser(user ?? null);

    if (user) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });

      if (projectRows && projectRows.length > 0) {
        // Fetch meeting counts for all projects in one query
        const projectIds = projectRows.map((p) => p.id);
        const { data: meetingCounts } = await supabase
          .from("meetings")
          .select("project_id")
          .in("project_id", projectIds);

        const countMap: Record<string, number> = {};
        for (const m of meetingCounts ?? []) {
          countMap[m.project_id] = (countMap[m.project_id] ?? 0) + 1;
        }

        setProjects(
          projectRows.map((p) => ({ ...p, meeting_count: countMap[p.id] ?? 0 }))
        );
      } else {
        setProjects([]);
      }
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setCreating(true);
    setCreateError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreateError("Not authenticated.");
      setCreating(false);
      return;
    }

    const { data: newProject, error } = await supabase
      .from("projects")
      .insert({ name: newProjectName.trim(), owner_id: user.id })
      .select("id")
      .single();

    setCreating(false);
    if (error || !newProject) {
      setCreateError(error?.message ?? "Failed to create project.");
    } else {
      // Redirect straight into the new project
      window.location.href = `/projects/${newProject.id}`;
    }
  }

  async function handleDeleteProject(projectId: string) {
    setDeletingId(projectId);
    await supabase.from("projects").delete().eq("id", projectId);
    setDeletingId(null);
    fetchData();
  }

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top nav */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2rem",
          height: "60px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: "1.125rem",
            color: "var(--foreground)",
            letterSpacing: "-0.01em",
          }}
        >
          Minuta
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            {user?.email}
          </span>
          <button
            id="btn-signout"
            onClick={handleSignOut}
            style={{
              padding: "0.375rem 0.875rem",
              borderRadius: "0.5rem",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--foreground)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--muted)")
            }
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Page content */}
      <main
        style={{
          flex: 1,
          maxWidth: "900px",
          width: "100%",
          margin: "0 auto",
          padding: "3rem 2rem",
        }}
      >
        {/* Page heading */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: "2.5rem",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.875rem",
                fontWeight: 800,
                color: "var(--foreground)",
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              Good to see you, {displayName}
            </h1>
            <p
              style={{
                margin: "0.375rem 0 0",
                color: "var(--muted)",
                fontSize: "0.9375rem",
              }}
            >
              {projects.length === 0
                ? "Create your first project to get started."
                : `You have ${projects.length} project${projects.length !== 1 ? "s" : ""}.`}
            </p>
          </div>

          <button
            id="btn-new-project"
            onClick={() => {
              setShowModal(true);
              setCreateError(null);
              setNewProjectName("");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.9375rem",
              border: "none",
              cursor: "pointer",
              transition: "background 0.15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--accent-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--accent)")
            }
          >
            <PlusIcon />
            New Project
          </button>
        </div>

        {/* Projects list */}
        {loading ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "1rem",
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState 
            title="No projects yet"
            description="Create a project to organize your meetings and start extracting insights."
            icon={<FolderIcon size={28} color="var(--muted)" />}
            action={
              <button
                onClick={() => setShowModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.625rem 1.5rem",
                  borderRadius: "0.5rem",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--accent-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "var(--accent)")
                }
              >
                <PlusIcon />
                Create your first project
              </button>
            }
          />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "1rem",
            }}
          >
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                deleting={deletingId === project.id}
                onDelete={() => handleDeleteProject(project.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* New Project Modal */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            zIndex: 50,
            backdropFilter: "blur(4px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "1rem",
              width: "100%",
              maxWidth: "420px",
              padding: "2rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <h2
              id="modal-title"
              style={{
                margin: 0,
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--foreground)",
              }}
            >
              New Project
            </h2>

            <form
              onSubmit={handleCreateProject}
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.375rem",
                }}
              >
                <label
                  htmlFor="project-name"
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  Project name
                </label>
                <input
                  id="project-name"
                  type="text"
                  required
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Q2 Product Planning"
                  style={{
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.5rem",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                    fontSize: "0.9375rem",
                    outline: "none",
                    transition: "border-color 0.15s",
                    width: "100%",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                />
              </div>

              {createError && (
                <div
                  role="alert"
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    background: "rgba(248,113,113,0.1)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "var(--danger)",
                    fontSize: "0.875rem",
                  }}
                >
                  {createError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: "0.625rem 1.25rem",
                    borderRadius: "0.5rem",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--muted)",
                    fontWeight: 500,
                    fontSize: "0.9375rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-create-project"
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: "0.625rem 1.25rem",
                    borderRadius: "0.5rem",
                    background: creating ? "var(--surface-2)" : "var(--accent)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    border: "none",
                    cursor: creating ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {creating ? "Creating…" : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProjectCard({
  project,
  deleting,
  onDelete,
}: {
  project: Project;
  deleting: boolean;
  onDelete: () => void;
}) {
  const date = new Date(project.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const meetingCount = project.meeting_count ?? 0;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.75rem",
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
        transition: "border-color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--accent)";
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = "var(--border)";
        el.style.transform = "translateY(0)";
      }}
    >
      {/* Top row: icon + delete */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "0.5rem",
            background: "var(--accent-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <FolderIcon />
        </div>
        <AlertDialog>
          <AlertDialogTrigger render={<button
              aria-label={`Delete project ${project.name}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
              disabled={deleting}
              style={{
                background: "none",
                border: "none",
                cursor: deleting ? "not-allowed" : "pointer",
                color: "var(--muted)",
                padding: "0.25rem",
                borderRadius: "0.25rem",
                display: "flex",
                alignItems: "center",
                opacity: deleting ? 0.5 : 1,
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--danger)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--muted)")
              }
            >
              <TrashIcon />
            </button>} />
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Project</AlertDialogTitle>
              <AlertDialogDescription>Are you sure you want to delete this project and all its meetings? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.stopPropagation(); onDelete(); }} className="bg-red-500 hover:bg-red-600 text-white">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Project name + date */}
      <div>
        <div
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: "var(--foreground)",
            marginBottom: "0.25rem",
            lineHeight: 1.3,
          }}
        >
          {project.name}
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          Created {date}
        </div>
      </div>

      {/* Meeting count + View Project CTA */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          {meetingCount === 0
            ? "No meetings"
            : `${meetingCount} meeting${meetingCount !== 1 ? "s" : ""}`}
        </span>
        <a
          id={`btn-view-project-${project.id}`}
          href={`/projects/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.3125rem 0.75rem",
            borderRadius: "0.375rem",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "0.8125rem",
            fontWeight: 600,
            textDecoration: "none",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--accent-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--accent)")
          }
        >
          View Project
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "0.75rem",
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <Skeleton className="w-[36px] h-[36px] rounded-lg" />
        <Skeleton className="w-5 h-5 rounded" />
      </div>
      <div>
        <Skeleton className="h-5 w-48 mb-1" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "0.75rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon({ size = 20, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="18"
      height="18"
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
