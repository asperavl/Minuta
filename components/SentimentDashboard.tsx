"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  SentimentLabel,
  SentimentSegmentModel,
  SpeakerObservation,
  SENTIMENT_COLORS,
  normalizeSentimentSegments,
  sentimentLabelForBadge,
} from "@/lib/phase3";
import { EmptyState } from "@/components/ui/empty-state";

const SENTIMENT_SEQUENCE: SentimentLabel[] = [
  "positive",
  "neutral",
  "conflict",
  "frustrated",
  "uncertain",
  "enthusiastic",
];

type SentimentDashboardProps = {
  segments: SentimentSegmentModel[];
  speakerObservations: SpeakerObservation[];
};

type MoodArcDotPayload = {
  segment_id?: string;
};

type MoodArcDotProps = {
  cx?: number;
  cy?: number;
  payload?: MoodArcDotPayload;
};

function tooltipContainerStyle() {
  return {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    color: "var(--foreground)",
    fontSize: "0.78rem",
  };
}

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

export default function SentimentDashboard({
  segments,
  speakerObservations,
}: SentimentDashboardProps) {
  const normalizedSegments = useMemo(
    () => normalizeSentimentSegments(segments),
    [segments]
  );
  const { containerRef: moodChartRef, width: moodChartWidth } = useMeasuredWidth();
  const { containerRef: speakerChartRef, width: speakerChartWidth } = useMeasuredWidth();
  const [selectedSegment, setSelectedSegment] = useState<SentimentSegmentModel | null>(null);

  const segmentById = useMemo(() => {
    const map = new Map<string, SentimentSegmentModel>();
    for (const segment of normalizedSegments) {
      map.set(segment.id, segment);
    }
    return map;
  }, [normalizedSegments]);

  const moodArcSeries = useMemo(
    () =>
      normalizedSegments.map((segment) => ({
        segment_id: segment.id,
        segment_index: segment.segment_index,
        sentiment_score: segment.sentiment_score ?? 0,
        label: sentimentLabelForBadge(segment.sentiment_label),
      })),
    [normalizedSegments]
  );

  const speakerBars = useMemo(() => {
    const bySpeaker = new Map<
      string,
      { total: number; labels: Record<SentimentLabel, number> }
    >();

    for (const segment of normalizedSegments) {
      const speaker = segment.speaker?.trim() || "Unknown";
      if (!bySpeaker.has(speaker)) {
        bySpeaker.set(speaker, {
          total: 0,
          labels: {
            positive: 0,
            neutral: 0,
            conflict: 0,
            frustrated: 0,
            uncertain: 0,
            enthusiastic: 0,
          },
        });
      }
      const bucket = bySpeaker.get(speaker);
      if (!bucket) continue;
      const label = sentimentLabelForBadge(segment.sentiment_label);
      bucket.total += 1;
      bucket.labels[label] += 1;
    }

    return Array.from(bySpeaker.entries()).map(([speaker, value]) => {
      const total = value.total || 1;
      return {
        speaker,
        positive: (value.labels.positive / total) * 100,
        neutral: (value.labels.neutral / total) * 100,
        conflict: (value.labels.conflict / total) * 100,
        frustrated: (value.labels.frustrated / total) * 100,
        uncertain: (value.labels.uncertain / total) * 100,
        enthusiastic: (value.labels.enthusiastic / total) * 100,
      };
    });
  }, [normalizedSegments]);

  const observationBySpeaker = useMemo(() => {
    const map = new Map<string, SpeakerObservation>();
    for (const observation of speakerObservations) {
      map.set(observation.speaker, observation);
    }
    return map;
  }, [speakerObservations]);

  const timelineTotalWeight = useMemo(
    () =>
      normalizedSegments.reduce((sum, segment) => {
      const textWeight = segment.text_excerpt?.length ?? 0;
      return sum + Math.max(textWeight, 20);
    }, 0),
    [normalizedSegments]
  );

  function selectSegmentById(segmentId: string | null | undefined) {
    if (!segmentId) return;
    const segment = segmentById.get(segmentId);
    if (segment) setSelectedSegment(segment);
  }

  if (normalizedSegments.length === 0) {
    return (
      <EmptyState 
        title="No Sentiment Data" 
        description="No sentiment segments are available for this meeting." 
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div
        style={{
          color: "var(--muted)",
          fontSize: "0.86rem",
          lineHeight: 1.5,
          border: "1px solid var(--border)",
          borderRadius: "0.6rem",
          padding: "0.7rem 0.8rem",
          background: "var(--surface)",
        }}
      >
        AI-detected signals - not verdicts. Click a Mood Arc point or Color Timeline segment to read the original dialogue.
      </div>

      <Card title="Mood Arc">
        <div ref={moodChartRef} style={{ width: "100%", minWidth: 0, height: 280 }}>
          {moodChartWidth > 0 ? (
            <LineChart 
              width={moodChartWidth} 
              height={280} 
              data={moodArcSeries}
              onClick={(state) => {
                const s = state as any;
                if (s && s.activePayload && s.activePayload.length > 0) {
                  selectSegmentById(s.activePayload[0].payload.segment_id);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
              <XAxis
                dataKey="segment_index"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                stroke="rgba(255,255,255,0.12)"
              />
              <YAxis
                domain={[-1, 1]}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                stroke="rgba(255,255,255,0.12)"
              />
              <Tooltip contentStyle={tooltipContainerStyle()} />
              <Line
                type="monotone"
                dataKey="sentiment_score"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={(props: MoodArcDotProps) => {
                  const segmentId = props.payload?.segment_id;
                  const isSelected = selectedSegment?.id === segmentId;
                  return (
                    <circle
                      key={`dot-${segmentId}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={isSelected ? 5 : 3}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      fill={isSelected ? "var(--accent)" : "var(--surface)"}
                    />
                  );
                }}
                activeDot={{ r: 5, fill: "var(--accent)" }}
              />
            </LineChart>
          ) : null}
        </div>
      </Card>

      <Card title="Color Timeline">
        <div
          style={{
            width: "100%",
            minHeight: "42px",
            border: "1px solid var(--border)",
            borderRadius: "0.6rem",
            overflow: "hidden",
            display: "flex",
            background: "var(--surface-2)",
          }}
        >
          {normalizedSegments.map((segment) => {
            const label = sentimentLabelForBadge(segment.sentiment_label);
            const weight = Math.max(segment.text_excerpt?.length ?? 0, 20);
            const widthPercent = (weight / Math.max(timelineTotalWeight, 1)) * 100;
            return (
              <button
                key={segment.id}
                type="button"
                title={`Segment ${segment.segment_index} - ${label}`}
                onClick={() => setSelectedSegment(segment)}
                style={{
                  width: `${widthPercent}%`,
                  border: "none",
                  minWidth: "8px",
                  background: SENTIMENT_COLORS[label],
                  cursor: "pointer",
                  opacity: selectedSegment?.id === segment.id ? 1 : 0.88,
                  transition: "opacity 0.15s ease",
                }}
              />
            );
          })}
        </div>

        {selectedSegment && (
          <div
            style={{
              marginTop: "0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "0.6rem",
              padding: "0.75rem 0.8rem",
              background: "var(--surface-2)",
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}
          >
            <div style={{ color: "var(--muted)", fontSize: "0.76rem" }}>
              Segment {selectedSegment.segment_index}{" "}
              {selectedSegment.start_time ? `~${selectedSegment.start_time}` : ""}
            </div>
            <div style={{ color: "var(--foreground)", fontWeight: 600, fontSize: "0.9rem" }}>
              {selectedSegment.speaker || "Unknown speaker"}
            </div>
            <div style={{ color: "var(--foreground)", lineHeight: 1.55, fontSize: "0.88rem" }}>
              {selectedSegment.text_excerpt || "No excerpt available."}
            </div>
          </div>
        )}
      </Card>

      <Card title="Speaker Sentiment Distribution">
        <div ref={speakerChartRef} style={{ width: "100%", minWidth: 0, height: 320 }}>
          {speakerChartWidth > 0 ? (
            <BarChart width={speakerChartWidth} height={320} data={speakerBars}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
              <XAxis dataKey="speaker" tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                stroke="rgba(255,255,255,0.12)"
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip contentStyle={tooltipContainerStyle()} />
              {SENTIMENT_SEQUENCE.map((label) => (
                <Bar key={label} dataKey={label} stackId="speaker" fill={SENTIMENT_COLORS[label]} />
              ))}
            </BarChart>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.4rem" }}>
          {speakerBars.map((bar) => {
            const observation = observationBySpeaker.get(bar.speaker);
            return (
              <div
                key={`obs-${bar.speaker}`}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.55rem",
                  padding: "0.6rem 0.7rem",
                  background: "var(--surface-2)",
                }}
              >
                <div style={{ color: "var(--foreground)", fontWeight: 600, fontSize: "0.85rem" }}>
                  {bar.speaker}
                </div>
                <div style={{ color: "var(--muted)", fontSize: "0.8rem", lineHeight: 1.5, marginTop: "0.2rem" }}>
                  {observation?.observation || "No speaker-level observation available."}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Legend">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          {SENTIMENT_SEQUENCE.map((label) => (
            <span
              key={`legend-${label}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.38rem",
                border: "1px solid var(--border)",
                borderRadius: "999px",
                padding: "0.22rem 0.52rem",
                fontSize: "0.78rem",
                color: "var(--foreground)",
                background: "var(--surface-2)",
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "999px",
                  display: "inline-block",
                  background: SENTIMENT_COLORS[label],
                }}
              />
              {label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.85rem",
        background: "var(--surface)",
        padding: "0.85rem 0.9rem 0.95rem",
      }}
    >
      <h3 style={{ margin: "0 0 0.7rem", color: "var(--foreground)", fontSize: "0.95rem" }}>{title}</h3>
      {children}
    </section>
  );
}
