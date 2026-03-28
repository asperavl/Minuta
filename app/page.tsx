export default function Home() {
  return (
    <>
      <style>{`
        .landing-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--background);
          padding: 2rem;
          text-align: center;
          gap: 1.5rem;
        }
        .landing-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 1rem;
          border-radius: 999px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent);
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--accent);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .landing-h1 {
          font-size: clamp(2rem, 6vw, 4rem);
          font-weight: 800;
          line-height: 1.1;
          color: var(--foreground);
          max-width: 700px;
          margin: 0;
        }
        .landing-accent { color: var(--accent); }
        .landing-sub {
          font-size: 1.125rem;
          color: var(--muted);
          max-width: 520px;
          line-height: 1.7;
          margin: 0;
        }
        .landing-actions {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          justify-content: center;
        }
        .btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.75rem 2rem;
          border-radius: 0.5rem;
          background: var(--accent);
          color: #fff;
          font-weight: 600;
          font-size: 1rem;
          text-decoration: none;
          transition: background 0.15s;
        }
        .btn-primary:hover { background: var(--accent-hover); }
        .btn-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.75rem 2rem;
          border-radius: 0.5rem;
          background: var(--surface-2);
          color: var(--foreground);
          font-weight: 600;
          font-size: 1rem;
          text-decoration: none;
          border: 1px solid var(--border);
          transition: background 0.15s;
        }
        .btn-secondary:hover { background: var(--surface); }
      `}</style>
      <main className="landing-root">
        <div className="landing-badge">
          Meeting Intelligence · Powered by Gemini
        </div>

        <h1 className="landing-h1">
          Turn transcripts into{" "}
          <span className="landing-accent">actionable insights</span>
        </h1>

        <p className="landing-sub">
          Minuta extracts decisions, action items, and sentiment from your
          meeting transcripts — automatically. Never miss a follow-up again.
        </p>

        <div className="landing-actions">
          <a href="/signup" id="cta-signup" className="btn-primary">
            Get started free
          </a>
          <a href="/login" id="cta-login" className="btn-secondary">
            Sign in
          </a>
        </div>
      </main>
    </>
  );
}
