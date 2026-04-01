"use client";

import { useState, useRef, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export type ChatPanelProps = {
  projectId: string;
  meetingId?: string;
  title: string;
  meetingCount: number;
  isOpen: boolean;
  onClose: () => void;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatPanel({
  projectId,
  meetingId,
  title,
  meetingCount,
  isOpen,
  onClose,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createSupabaseBrowserClient();

  // Highlight citation patterns (Source: meeting name, ~location)
  const formatContent = (content: string) => {
    // Basic formatting for citations to make them muted/accent
    return content.split(/(?=\(Source:)/g).map((part, index) => {
      if (part.startsWith("(Source:")) {
        const citationEnd = part.indexOf(")") + 1;
        if (citationEnd > 0) {
          const citation = part.substring(0, citationEnd);
          const rest = part.substring(citationEnd);
          return (
            <span key={index}>
              <span style={{ fontSize: "0.76rem", color: "var(--accent)", opacity: 0.85, display: "block", marginTop: "0.4rem" }}>
                {citation}
              </span>
              {rest}
            </span>
          );
        }
      }
      return <span key={index}>{part}</span>;
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchHistory = async () => {
      setIsHistoryLoading(true);
      let query = supabase
        .from("chat_messages")
        .select("role, content")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (meetingId) {
        query = query.eq("meeting_id", meetingId);
      } else {
        query = query.is("meeting_id", null);
      }
      const { data, error } = await query;

      if (isMounted && !error && data) {
        setMessages(data as Message[]);
      }
      if (isMounted) setIsHistoryLoading(false);
    };

    if (messages.length === 0) {
      fetchHistory();
    }
  }, [isOpen, projectId, supabase]);

  useEffect(() => {
    // Auto scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const currentHistory = [...messages];
    
    setMessages([...currentHistory, userMessage]);
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          meetingId,
          question: userMessage.content,
          history: currentHistory,
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      if (!response.body) throw new Error("No response body");

      // Add placeholder assistant message that we will stream into
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        streamBuffer += text;

        const lines = streamBuffer.split("\n");
        // Keep the last incomplete line in the buffer
        streamBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") {
              break;
            }
            try {
              const token = JSON.parse(dataStr);
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + token };
                }
                return updated;
              });
            } catch (err) {
              console.error("Failed to parse SSE token:", err, "Raw data:", dataStr);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, an error occurred while connecting. Please try again." }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const clearChat = async () => {
    setMessages([]);
    let query = supabase.from("chat_messages").delete().eq("project_id", projectId);
    if (meetingId) {
      query = query.eq("meeting_id", meetingId);
    } else {
      query = query.is("meeting_id", null);
    }
    await query;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 58, // Below header
        right: isOpen ? 0 : "-400px",
        bottom: 0,
        width: "400px",
        maxWidth: "100vw",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        boxShadow: isOpen ? "-4px 0 24px rgba(0,0,0,0.06)" : "none",
        transition: "right 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "1rem 1.1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--surface)",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "250px" }}>
            Chat · {title}
          </h2>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            {meetingId ? "Searching this specific meeting" : `Searching across ${meetingCount} meeting${meetingCount !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {messages.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger render={<button
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "0.4rem",
                    color: "var(--muted)",
                    fontSize: "1rem",
                    display: "flex",
                    alignItems: "center",
                  }}
                  aria-label="Clear chat"
                  title="Clear chat"
                >
                  ⎚
                </button>} />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear Chat</AlertDialogTitle>
                  <AlertDialogDescription>Are you sure you want to clear the conversation history?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={clearChat} className="bg-red-500 hover:bg-red-600 text-white">Clear</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0.4rem",
              color: "var(--muted)",
              fontSize: "1.2rem",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
            }}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1.1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.1rem",
          scrollBehavior: "smooth",
        }}
      >
        {isHistoryLoading && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.85rem", marginTop: "2rem" }}>
            Loading history...
          </div>
        )}

        {!isHistoryLoading && messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.85rem", marginTop: "2rem" }}>
            Ask a question about {title}
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: msg.role === "user" ? "var(--accent)" : "var(--surface-2)",
              color: msg.role === "user" ? "white" : "var(--foreground)",
              padding: "0.75rem 0.95rem",
              borderRadius: msg.role === "user" ? "1.1rem 1.1rem 0.1rem 1.1rem" : "1.1rem 1.1rem 1.1rem 0.1rem",
              fontSize: "0.9rem",
              lineHeight: 1.5,
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {formatContent(msg.content)}
          </div>
        ))}
        {isStreaming && (messages.length === 0 || messages[messages.length - 1].role === "user") && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "var(--surface-2)",
              padding: "0.75rem 0.95rem",
              borderRadius: "1.1rem 1.1rem 1.1rem 0.1rem",
              display: "flex",
              gap: "0.3rem",
              alignItems: "center",
              height: "40px",
            }}
          >
            <div className="typing-dot" style={{ width: "6px", height: "6px", background: "var(--muted)", borderRadius: "50%", animation: "typing 1.4s infinite ease-in-out both", animationDelay: "-0.32s" }} />
            <div className="typing-dot" style={{ width: "6px", height: "6px", background: "var(--muted)", borderRadius: "50%", animation: "typing 1.4s infinite ease-in-out both", animationDelay: "-0.16s" }} />
            <div className="typing-dot" style={{ width: "6px", height: "6px", background: "var(--muted)", borderRadius: "50%", animation: "typing 1.4s infinite ease-in-out both" }} />
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes typing {
                0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
                40% { transform: scale(1); opacity: 1; }
              }
            ` }} />
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "1rem 1.1rem",
          background: "var(--surface)",
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.6rem" }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
            placeholder="Ask about this project..."
            style={{
              flex: 1,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "0.6rem",
              padding: "0.65rem 0.85rem",
              fontSize: "0.9rem",
              color: "var(--foreground)",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            style={{
              background: isStreaming || !input.trim() ? "var(--surface-2)" : "var(--accent)",
              color: isStreaming || !input.trim() ? "var(--muted)" : "white",
              border: "none",
              borderRadius: "0.6rem",
              padding: "0 1rem",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: isStreaming || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Send
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: "0.6rem", fontSize: "0.72rem", color: "var(--muted)" }}>
          Answers are generated from your transcripts. Always verify important details directly.
        </div>
      </div>
    </div>
  );
}
