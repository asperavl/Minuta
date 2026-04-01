"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendPoint = {
  meetingId: string;
  label: string;
  sentiment: number;
};

type SentimentTrendChartProps = {
  points: TrendPoint[];
};

function useMeasuredWidth() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;
      if (Number.isFinite(nextWidth) && nextWidth > 0) {
        setWidth(Math.floor(nextWidth));
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

export default function SentimentTrendChart({ points }: SentimentTrendChartProps) {
  const { containerRef, width } = useMeasuredWidth();
  if (points.length < 2) return null;

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.9rem",
        background: "var(--surface)",
        padding: "0.9rem",
      }}
    >
      <div style={{ marginBottom: "0.7rem" }}>
        <h3 style={{ margin: 0, color: "var(--foreground)", fontSize: "0.96rem" }}>
          Sentiment Trend
        </h3>
        <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8rem" }}>
          Average meeting sentiment over time.
        </p>
      </div>

      <div ref={containerRef} style={{ width: "100%", minWidth: 0, height: 260 }}>
        {width > 0 ? (
          <LineChart width={width} height={260} data={points}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              stroke="rgba(255,255,255,0.12)"
            />
            <YAxis
              domain={[-1, 1]}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              stroke="rgba(255,255,255,0.12)"
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                color: "var(--foreground)",
                fontSize: "0.78rem",
              }}
            />
            <Line
              dataKey="sentiment"
              stroke="var(--accent)"
              strokeWidth={2.5}
              type="monotone"
              dot={{ r: 3.5, fill: "var(--accent)" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        ) : null}
      </div>
    </section>
  );
}
