export type TopicStatus = "Resolved" | "Unresolved" | "Deferred" | "Uncertain";
export type UrgencyLabel = "Immediate" | "This Week" | "Low Priority" | "No Action";
export type ActionStatus = "Pending" | "In Progress" | "Done";
export type SentimentLabel =
  | "positive"
  | "neutral"
  | "conflict"
  | "frustrated"
  | "uncertain"
  | "enthusiastic";

export type SpeakerBreakdown = {
  name: string;
  percentage: number;
};

export type TopicTimelineNode = {
  index: number;
  title: string;
  start_time: string | null;
  end_time: string | null;
  summary: string;
  status: TopicStatus;
  supporting_quote: string | null;
  urgency: UrgencyLabel;
  circled_back_from: number | null;
  circled_back_at: number | null;
};

export type SpeakerObservation = {
  speaker: string;
  observation: string;
  average_score: number | null;
};

export type MeetingSummaryModel = {
  tldr: string;
  overall_sentiment: {
    label: string;
    score: number | null;
  };
  stats: {
    decisions: number;
    action_items: number;
    dominant_speaker: string | null;
    speaker_breakdown: SpeakerBreakdown[];
  };
  topics: TopicTimelineNode[];
  speaker_observations: SpeakerObservation[];
};

export type ExtractionModel = {
  id: string;
  meeting_id: string;
  type: "decision" | "action_item" | "issue_event";
  description: string;
  owner: string | null;
  due_date: string | null;
  urgency: string | null;
  context: string | null;
  related_topic: string | null;
  status: string | null;
  verified: boolean;
  supporting_quote: string | null;
  quote_location: string | null;
  superseded_by: string | null;
  issue_event_type?: string | null;
  issue_candidate_title?: string | null;
  created_at: string;
};

export type SentimentSegmentModel = {
  id: string;
  meeting_id: string;
  segment_index: number;
  speaker: string | null;
  text_excerpt: string | null;
  sentiment_label: string | null;
  sentiment_score: number | null;
  start_time: string | null;
};

export type IssueModel = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "resolved" | "obsolete" | string | null;
  opened_in: string | null;
  resolved_in: string | null;
  obsoleted_in: string | null;
  created_at: string;
};

export type IssueMentionModel = {
  id: string;
  issue_id: string;
  meeting_id: string;
  mention_type:
    | "raised"
    | "discussed"
    | "escalated"
    | "resolved"
    | "obsoleted"
    | "reopened"
    | string
    | null;
  context: string | null;
  supporting_quote: string | null;
  created_at: string;
};

export type LinkedIssueMatch = {
  issueId: string | null;
  confidence: number;
};

const VALID_TOPIC_STATUSES: TopicStatus[] = [
  "Resolved",
  "Unresolved",
  "Deferred",
  "Uncertain",
];

const VALID_URGENCY: UrgencyLabel[] = [
  "Immediate",
  "This Week",
  "Low Priority",
  "No Action",
];

const SENTIMENT_ORDER: SentimentLabel[] = [
  "positive",
  "neutral",
  "conflict",
  "frustrated",
  "uncertain",
  "enthusiastic",
];

export const SENTIMENT_COLORS: Record<SentimentLabel, string> = {
  positive: "#639922",
  neutral: "#378ADD",
  conflict: "#E24B4A",
  frustrated: "#BA7517",
  uncertain: "#EF9F27",
  enthusiastic: "#16A34A",
};

export const TOPIC_STATUS_STYLES: Record<
  TopicStatus,
  { fg: string; bg: string; border: string }
> = {
  Resolved: { fg: "#16A34A", bg: "rgba(22,163,74,0.14)", border: "#16A34A" },
  Unresolved: { fg: "#E24B4A", bg: "rgba(226,75,74,0.14)", border: "#E24B4A" },
  Deferred: { fg: "#EF9F27", bg: "rgba(239,159,39,0.14)", border: "#EF9F27" },
  Uncertain: { fg: "#378ADD", bg: "rgba(55,138,221,0.14)", border: "#378ADD" },
};

export const URGENCY_STYLES: Record<
  UrgencyLabel,
  { fg: string; bg: string; border: string }
> = {
  Immediate: { fg: "#E24B4A", bg: "rgba(226,75,74,0.14)", border: "#E24B4A" },
  "This Week": { fg: "#EF9F27", bg: "rgba(239,159,39,0.14)", border: "#EF9F27" },
  "Low Priority": {
    fg: "#378ADD",
    bg: "rgba(55,138,221,0.14)",
    border: "#378ADD",
  },
  "No Action": { fg: "#16A34A", bg: "rgba(22,163,74,0.14)", border: "#16A34A" },
};

export const ACTION_STATUS_OPTIONS: ActionStatus[] = ["Pending", "In Progress", "Done"];

export const URGENCY_SORT_WEIGHT: Record<UrgencyLabel, number> = {
  Immediate: 0,
  "This Week": 1,
  "Low Priority": 2,
  "No Action": 3,
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function asTopicStatus(value: unknown): TopicStatus {
  if (typeof value === "string") {
    const matched = VALID_TOPIC_STATUSES.find(
      (item) => item.toLowerCase() === value.toLowerCase()
    );
    if (matched) return matched;
  }
  return "Uncertain";
}

export function asUrgency(value: unknown): UrgencyLabel {
  if (typeof value === "string") {
    const matched = VALID_URGENCY.find(
      (item) => item.toLowerCase() === value.toLowerCase()
    );
    if (matched) return matched;
  }
  return "Low Priority";
}

function sanitizeSentimentLabel(value: unknown): SentimentLabel {
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as SentimentLabel;
    if (SENTIMENT_ORDER.includes(normalized)) return normalized;
  }
  return "neutral";
}

export function normalizeSummary(summary: unknown): MeetingSummaryModel {
  const raw = typeof summary === "object" && summary !== null ? summary : {};
  const summaryObj = raw as Record<string, unknown>;
  const statsObj =
    typeof summaryObj.stats === "object" && summaryObj.stats !== null
      ? (summaryObj.stats as Record<string, unknown>)
      : {};

  const topicList = Array.isArray(summaryObj.topics)
    ? (summaryObj.topics as Record<string, unknown>[])
    : [];

  const speakerList = Array.isArray(statsObj.speaker_breakdown)
    ? (statsObj.speaker_breakdown as Record<string, unknown>[])
    : [];

  const observationList = Array.isArray(summaryObj.speaker_observations)
    ? (summaryObj.speaker_observations as Record<string, unknown>[])
    : [];

  const overallSentimentObj =
    typeof summaryObj.overall_sentiment === "object" &&
    summaryObj.overall_sentiment !== null
      ? (summaryObj.overall_sentiment as Record<string, unknown>)
      : {};

  return {
    tldr: asString(summaryObj.tldr, ""),
    overall_sentiment: {
      label: asString(overallSentimentObj.label, "neutral"),
      score:
        typeof overallSentimentObj.score === "number"
          ? overallSentimentObj.score
          : null,
    },
    stats: {
      decisions: asNumber(statsObj.decisions, 0),
      action_items: asNumber(statsObj.action_items, 0),
      dominant_speaker:
        asString(statsObj.dominant_speaker, "").trim() || null,
      speaker_breakdown: speakerList.map((speaker) => ({
        name: asString(speaker.name, "Unknown"),
        percentage: Math.max(0, Math.min(100, asNumber(speaker.percentage, 0))),
      })),
    },
    topics: topicList.map((topic, index) => ({
      index: asNumber(topic.index, index),
      title: asString(topic.title, `Topic ${index + 1}`),
      start_time:
        asString(topic.start_time, "").trim() === ""
          ? null
          : asString(topic.start_time),
      end_time:
        asString(topic.end_time, "").trim() === "" ? null : asString(topic.end_time),
      summary: asString(topic.summary, ""),
      status: asTopicStatus(topic.status),
      supporting_quote:
        asString(topic.supporting_quote, "").trim() === ""
          ? null
          : asString(topic.supporting_quote),
      urgency: asUrgency(topic.urgency),
      circled_back_from:
        typeof topic.circled_back_from === "number"
          ? topic.circled_back_from
          : null,
      circled_back_at:
        typeof topic.circled_back_at === "number" ? topic.circled_back_at : null,
    })),
    speaker_observations: observationList.map((observation) => ({
      speaker: asString(observation.speaker, "Unknown"),
      observation: asString(observation.observation, ""),
      average_score:
        typeof observation.average_score === "number"
          ? observation.average_score
          : null,
    })),
  };
}

export function normalizeSentimentSegments(
  segments: SentimentSegmentModel[]
): SentimentSegmentModel[] {
  return [...segments]
    .map((segment) => ({
      ...segment,
      sentiment_label: sanitizeSentimentLabel(segment.sentiment_label),
    }))
    .sort((a, b) => a.segment_index - b.segment_index);
}

function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(raw: string): string[] {
  return normalizeText(raw)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function tokenOverlapScore(left: string, right: string): number {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));

  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftSet.size, rightSet.size);
}

function actionIssueText(action: ExtractionModel): string {
  return [
    action.description,
    action.context ?? "",
    action.related_topic ?? "",
    action.supporting_quote ?? "",
  ]
    .join(" ")
    .trim();
}

function issueText(issue: IssueModel): string {
  return `${issue.title ?? ""} ${issue.description ?? ""}`.trim();
}

export function linkActionItemsToIssues(
  actionItems: ExtractionModel[],
  issues: IssueModel[],
  issueMentions: IssueMentionModel[]
): Map<string, LinkedIssueMatch> {
  const byMeeting = new Map<string, Set<string>>();
  const mentionContextByIssue = new Map<string, string>();

  for (const mention of issueMentions) {
    if (!byMeeting.has(mention.meeting_id)) {
      byMeeting.set(mention.meeting_id, new Set<string>());
    }
    byMeeting.get(mention.meeting_id)?.add(mention.issue_id);

    const existing = mentionContextByIssue.get(mention.issue_id) ?? "";
    mentionContextByIssue.set(
      mention.issue_id,
      `${existing} ${mention.context ?? ""} ${mention.supporting_quote ?? ""}`.trim()
    );
  }

  const matches = new Map<string, LinkedIssueMatch>();

  for (const action of actionItems) {
    const meetingIssueCandidates = Array.from(byMeeting.get(action.meeting_id) ?? []);
    const candidateIds =
      meetingIssueCandidates.length > 0
        ? meetingIssueCandidates
        : issues.map((issue) => issue.id);

    let bestIssueId: string | null = null;
    let bestScore = 0;

    const actionText = actionIssueText(action);
    for (const issueId of candidateIds) {
      const issue = issues.find((item) => item.id === issueId);
      if (!issue) continue;

      const baseScore = tokenOverlapScore(actionText, issueText(issue));
      const mentionScore = tokenOverlapScore(
        actionText,
        mentionContextByIssue.get(issueId) ?? ""
      );
      const combinedScore = Math.max(baseScore, mentionScore * 0.85);

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestIssueId = issueId;
      }
    }

    const threshold = meetingIssueCandidates.length > 0 ? 0.14 : 0.24;
    matches.set(action.id, {
      issueId: bestScore >= threshold ? bestIssueId : null,
      confidence: bestScore,
    });
  }

  return matches;
}

function dueDateSortValue(dueDate: string | null): number {
  if (!dueDate || dueDate.toLowerCase() === "not specified") return Number.POSITIVE_INFINITY;
  const normalized = dueDate.toLowerCase().trim();
  if (normalized.includes("today")) return Date.now();
  if (normalized.includes("tomorrow")) return Date.now() + 24 * 60 * 60 * 1000;
  if (normalized.includes("monday")) return Date.now() + 2 * 24 * 60 * 60 * 1000;
  if (normalized.includes("tuesday")) return Date.now() + 3 * 24 * 60 * 60 * 1000;
  if (normalized.includes("wednesday")) return Date.now() + 4 * 24 * 60 * 60 * 1000;
  if (normalized.includes("thursday")) return Date.now() + 5 * 24 * 60 * 60 * 1000;
  if (normalized.includes("friday")) return Date.now() + 6 * 24 * 60 * 60 * 1000;
  if (normalized.includes("this week")) return Date.now() + 7 * 24 * 60 * 60 * 1000;
  const parsed = Date.parse(dueDate);
  if (!Number.isNaN(parsed)) return parsed;
  return Number.POSITIVE_INFINITY;
}

export function sortActionItems(
  rows: ExtractionModel[],
  mode: "urgency" | "due_date",
  direction: "asc" | "desc"
): ExtractionModel[] {
  const dir = direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    if (mode === "urgency") {
      const leftRank = URGENCY_SORT_WEIGHT[asUrgency(left.urgency)];
      const rightRank = URGENCY_SORT_WEIGHT[asUrgency(right.urgency)];
      if (leftRank !== rightRank) return (leftRank - rightRank) * dir;
    } else {
      const leftDue = dueDateSortValue(left.due_date);
      const rightDue = dueDateSortValue(right.due_date);
      if (leftDue !== rightDue) return (leftDue - rightDue) * dir;
    }
    return left.description.localeCompare(right.description) * dir;
  });
}

export function unresolvedTopicCount(summary: MeetingSummaryModel): number {
  return summary.topics.filter((topic) => topic.status !== "Resolved").length;
}

export function sentimentLabelForBadge(rawLabel: string | null | undefined): SentimentLabel {
  return sanitizeSentimentLabel(rawLabel);
}

export function sentimentColorForLabel(rawLabel: string | null | undefined): string {
  return SENTIMENT_COLORS[sentimentLabelForBadge(rawLabel)];
}

export type ProjectAnalysisMeeting = {
  id: string;
  file_name: string;
  sort_order: number | null;
  meeting_date: string | null;
  created_at: string;
  raw_text: string | null;
  summary: Record<string, unknown> | null;
};

export type ProjectDecisionRow = {
  id: string;
  meeting_id: string;
  description: string;
  created_at: string;
};

export type ProjectMeetingSnapshot = {
  meeting_id: string;
  file_name: string;
  meeting_date: string | null;
  sentiment_label: string;
  sentiment_score: number | null;
  decisions: number;
  action_items: number;
  unresolved_topics: number;
};

export type ProjectSentimentTrendPoint = {
  meetingId: string;
  label: string;
  meetingName: string;
  meetingDate: string | null;
  sentiment: number;
};

export type ProjectTranscriptBundleEntry = {
  meeting_id: string;
  file_name: string;
  raw_text: string;
};

export type ProjectAnalysisReadModel = {
  completedMeetingCount: number;
  totalDecisions: number;
  totalActionItems: number;
  openIssueCount: number;
  inProgressIssueCount: number;
  averageSentiment: number | null;
  tldrRollup: string;
  meetingSnapshots: ProjectMeetingSnapshot[];
  consolidatedDecisions: ProjectDecisionRow[];
  consolidatedActionItems: ExtractionModel[];
  flattenedSentimentSegments: SentimentSegmentModel[];
  sentimentTrendSeries: ProjectSentimentTrendPoint[];
  transcriptBundle: ProjectTranscriptBundleEntry[];
  speakerObservations: SpeakerObservation[];
};

function compareMeetingsChronologically(
  left: Pick<ProjectAnalysisMeeting, "sort_order" | "created_at">,
  right: Pick<ProjectAnalysisMeeting, "sort_order" | "created_at">
): number {
  const leftOrder = typeof left.sort_order === "number" ? left.sort_order : null;
  const rightOrder = typeof right.sort_order === "number" ? right.sort_order : null;

  if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (leftOrder != null && rightOrder == null) return -1;
  if (leftOrder == null && rightOrder != null) return 1;

  const leftCreated = Date.parse(left.created_at);
  const rightCreated = Date.parse(right.created_at);
  if (!Number.isNaN(leftCreated) && !Number.isNaN(rightCreated) && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  return 0;
}

export function buildProjectAnalysisReadModel({
  meetings,
  decisions,
  actionItems,
  sentimentSegments,
  issues,
}: {
  meetings: ProjectAnalysisMeeting[];
  decisions: ExtractionModel[];
  actionItems: ExtractionModel[];
  sentimentSegments: SentimentSegmentModel[];
  issues: IssueModel[];
}): ProjectAnalysisReadModel {
  const orderedMeetings = [...meetings].sort(compareMeetingsChronologically);
  const meetingOrder = new Map<string, number>();
  orderedMeetings.forEach((meeting, index) => meetingOrder.set(meeting.id, index));
  const meetingIdSet = new Set(orderedMeetings.map((meeting) => meeting.id));

  const summaryByMeetingId = new Map<string, MeetingSummaryModel>();
  for (const meeting of orderedMeetings) {
    summaryByMeetingId.set(meeting.id, normalizeSummary(meeting.summary));
  }

  const consolidatedDecisions = decisions
    .filter((decision) => meetingIdSet.has(decision.meeting_id))
    .map((decision) => ({
      id: decision.id,
      meeting_id: decision.meeting_id,
      description: decision.description,
      created_at: decision.created_at,
    }))
    .sort((left, right) => {
      const leftOrder = meetingOrder.get(left.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = meetingOrder.get(right.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.created_at !== right.created_at) return left.created_at.localeCompare(right.created_at);
      return left.description.localeCompare(right.description);
    });

  const consolidatedActionItems = actionItems
    .filter((actionItem) => meetingIdSet.has(actionItem.meeting_id))
    .sort((left, right) => {
      const leftOrder = meetingOrder.get(left.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = meetingOrder.get(right.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.created_at !== right.created_at) return left.created_at.localeCompare(right.created_at);
      return left.description.localeCompare(right.description);
    });

  const flattenedSentimentSegments = sentimentSegments
    .filter((segment) => meetingIdSet.has(segment.meeting_id))
    .sort((left, right) => {
      const leftOrder = meetingOrder.get(left.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = meetingOrder.get(right.meeting_id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.segment_index - right.segment_index;
    })
    .map((segment, index) => {
      const meeting = orderedMeetings.find((item) => item.id === segment.meeting_id);
      const meetingPrefix = meeting ? meeting.file_name : segment.meeting_id;
      const composedStart = segment.start_time ? `${meetingPrefix} | ${segment.start_time}` : meetingPrefix;
      return {
        ...segment,
        segment_index: index + 1,
        start_time: composedStart,
      };
    });

  const meetingSnapshots = orderedMeetings.map((meeting) => {
    const summary = summaryByMeetingId.get(meeting.id) ?? normalizeSummary(meeting.summary);
    const meetingDecisions = consolidatedDecisions.filter(
      (decision) => decision.meeting_id === meeting.id
    ).length;
    const meetingActionItems = consolidatedActionItems.filter(
      (actionItem) => actionItem.meeting_id === meeting.id
    ).length;

    return {
      meeting_id: meeting.id,
      file_name: meeting.file_name,
      meeting_date: meeting.meeting_date,
      sentiment_label: summary.overall_sentiment.label || "neutral",
      sentiment_score: summary.overall_sentiment.score,
      decisions: meetingDecisions,
      action_items: meetingActionItems,
      unresolved_topics: unresolvedTopicCount(summary),
    };
  });

  const sentimentTrendSeries = orderedMeetings
    .map((meeting, index) => {
      const summary = summaryByMeetingId.get(meeting.id) ?? normalizeSummary(meeting.summary);
      const score = summary.overall_sentiment.score;
      if (typeof score !== "number" || !Number.isFinite(score)) return null;
      return {
        meetingId: meeting.id,
        label: `M${index + 1}`,
        meetingName: meeting.file_name,
        meetingDate: meeting.meeting_date,
        sentiment: score,
      };
    })
    .filter((item): item is ProjectSentimentTrendPoint => item !== null);

  const averageSentiment =
    sentimentTrendSeries.length > 0
      ? sentimentTrendSeries.reduce((sum, point) => sum + point.sentiment, 0) /
        sentimentTrendSeries.length
      : null;

  const tldrChunks = orderedMeetings
    .map((meeting) => {
      const summary = summaryByMeetingId.get(meeting.id) ?? normalizeSummary(meeting.summary);
      const tldr = summary.tldr.trim();
      if (!tldr) return null;
      return `${meeting.file_name}: ${tldr}`;
    })
    .filter((item): item is string => item !== null);

  const tldrRollup =
    tldrChunks.length > 0
      ? tldrChunks.join("\n\n")
      : "No meeting TL;DR summaries are available yet.";

  const transcriptBundle = orderedMeetings
    .map((meeting) => ({
      meeting_id: meeting.id,
      file_name: meeting.file_name,
      raw_text: (meeting.raw_text ?? "").trim(),
    }))
    .filter((entry) => entry.raw_text.length > 0);

  const speakerAggregate = new Map<
    string,
    { notes: string[]; scores: number[] }
  >();
  for (const meeting of orderedMeetings) {
    const summary = summaryByMeetingId.get(meeting.id) ?? normalizeSummary(meeting.summary);
    for (const observation of summary.speaker_observations) {
      const speaker = observation.speaker || "Unknown";
      if (!speakerAggregate.has(speaker)) {
        speakerAggregate.set(speaker, { notes: [], scores: [] });
      }
      const aggregate = speakerAggregate.get(speaker);
      if (!aggregate) continue;
      if (observation.observation.trim()) aggregate.notes.push(observation.observation.trim());
      if (typeof observation.average_score === "number") {
        aggregate.scores.push(observation.average_score);
      }
    }
  }

  const speakerObservations: SpeakerObservation[] = Array.from(speakerAggregate.entries()).map(
    ([speaker, aggregate]) => {
      const uniqueNotes = Array.from(new Set(aggregate.notes));
      const averageScore =
        aggregate.scores.length > 0
          ? aggregate.scores.reduce((sum, value) => sum + value, 0) / aggregate.scores.length
          : null;
      return {
        speaker,
        observation:
          uniqueNotes.length > 0
            ? uniqueNotes.slice(0, 3).join(" | ")
            : "No speaker-level observation available.",
        average_score: averageScore,
      };
    }
  );

  return {
    completedMeetingCount: orderedMeetings.length,
    totalDecisions: consolidatedDecisions.length,
    totalActionItems: consolidatedActionItems.length,
    openIssueCount: issues.filter((issue) => (issue.status ?? "").toLowerCase() === "open").length,
    inProgressIssueCount: issues.filter(
      (issue) => (issue.status ?? "").toLowerCase() === "in_progress"
    ).length,
    averageSentiment,
    tldrRollup,
    meetingSnapshots,
    consolidatedDecisions,
    consolidatedActionItems,
    flattenedSentimentSegments,
    sentimentTrendSeries,
    transcriptBundle,
    speakerObservations,
  };
}
