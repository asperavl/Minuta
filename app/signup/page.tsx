"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const supabase = createSupabaseBrowserClient();

  async function handleGoogleSignIn() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) setError(error.message);
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        data: {
          full_name: fullName.trim(),
        },
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "var(--background)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "1rem",
          padding: "2.5rem 2rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "var(--foreground)",
              marginBottom: "0.25rem",
            }}
          >
            Create your account
          </div>
          <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
            Start turning transcripts into actionable insights
          </div>
        </div>

        {success ? (
          <div
            style={{
              padding: "1rem",
              borderRadius: "0.5rem",
              background: "rgba(52,211,153,0.1)",
              border: "1px solid rgba(52,211,153,0.3)",
              color: "var(--success)",
              fontSize: "0.9375rem",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Check your email to confirm your account, then{" "}
            <a
              href="/login"
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
            >
              sign in
            </a>
            .
          </div>
        ) : (
          <>
            {/* Google OAuth */}
            <button
              id="btn-google-signup"
              onClick={handleGoogleSignIn}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "0.5rem",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontWeight: 600,
                fontSize: "0.9375rem",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--surface-2)")
              }
            >
              <GoogleIcon />
              Continue with Google
            </button>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                color: "var(--muted)",
                fontSize: "0.8125rem",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
              or
              <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            </div>

            {/* Email/password form */}
            <form
              onSubmit={handleEmailSignUp}
              style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
              >
                <label
                  htmlFor="full-name"
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  Full name
                </label>
                <input
                  id="full-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
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

              <div
                style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
              >
                <label
                  htmlFor="email"
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
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

              <div
                style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
              >
                <label
                  htmlFor="password"
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
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

              {error && (
                <div
                  role="alert"
                  style={{
                    padding: "0.625rem 0.875rem",
                    borderRadius: "0.5rem",
                    background: "rgba(248,113,113,0.1)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "var(--danger)",
                    fontSize: "0.875rem",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                id="btn-email-signup"
                type="submit"
                disabled={loading}
                style={{
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  background: loading ? "var(--surface-2)" : "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                }}
              >
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
          </>
        )}

        <p
          style={{
            textAlign: "center",
            fontSize: "0.875rem",
            color: "var(--muted)",
            margin: 0,
          }}
        >
          Already have an account?{" "}
          <a
            href="/login"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.805.54-1.835.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
