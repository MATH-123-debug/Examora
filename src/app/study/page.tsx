"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { signOut } from "firebase/auth";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  FilePlus2,
  HelpCircle,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Send,
  Sparkles,
  Sun,
  ClipboardList,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { StudyRichText } from "@/components/study-rich-text";
import { useStudyTheme } from "@/components/study-theme-provider";
import { auth, db } from "@/lib/firebase";

type StudyAction =
  | "summarize"
  | "quick_revision"
  | "explain_like_lecturer"
  | "step_by_step"
  | "generate_questions";

type InputType = "pdf" | "text";

type GeneratedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type MathSolution = {
  given: string;
  method: string;
  steps: string[];
  finalAnswer: string;
  whyItWorks: string;
};

type StudyResponse = {
  title: string;
  summary: string;
  bullets: string[];
  questions: GeneratedQuestion[];
  mathSolution?: MathSolution;
  action: StudyAction;
  inputType: InputType;
};

type SessionItem = {
  id: string;
  title: string;
  action: string;
  inputType: string;
  createdAtLabel: string;
};

type StoredLocalSession = SessionItem & {
  data: Record<string, unknown>;
};

type AttachmentItem = {
  id: string;
  name: string;
  text: string;
  type: "pdf" | "docx";
};

type StoredAttachment = {
  name: string;
  type: "pdf" | "docx";
};

type ConversationHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: StoredAttachment[];
  response?: StudyResponse;
  isLoading?: boolean;
  isError?: boolean;
};

type StudyContextPayload = {
  currentTopic: string;
  rollingSummary: string;
  recentMessages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  lastAssistantSummary: string;
  documentLesson?: {
    topics: string[];
    currentIndex: number;
  };
};

type DocumentLessonState = {
  topics: string[];
  currentIndex: number;
};

const LOCAL_STUDY_SESSIONS_KEY = "examora-study-sessions";
const MAX_DIRECT_UPLOAD_SIZE = 4 * 1024 * 1024;

function normalizeTopicLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeHeading(line: string) {
  const trimmed = normalizeTopicLabel(line);

  if (trimmed.length < 4 || trimmed.length > 120) {
    return false;
  }

  if (/^(attachment|student request|response style)\b/i.test(trimmed)) {
    return false;
  }

  if (/^(topic|chapter|section|unit|module)\s+\d+[:.-]?\s+/i.test(trimmed)) {
    return true;
  }

  if (/^\d+(\.\d+)*[:.)-]?\s+[A-Za-z]/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z][A-Za-z0-9\s,&()/-]{4,}$/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return true;
  }

  return false;
}

function extractDocumentTopicsFromText(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeTopicLabel(line))
    .filter(Boolean);

  const topics = lines.filter(looksLikeHeading);

  if (topics.length > 0) {
    return Array.from(new Set(topics)).slice(0, 24);
  }

  const paragraphTopics = text
    .split(/\n{2,}/)
    .map((block) => normalizeTopicLabel(block))
    .filter((block) => block.length >= 12 && block.length <= 90)
    .map((block) => block.replace(/[:.].*$/, "").trim())
    .filter(Boolean);

  return Array.from(new Set(paragraphTopics)).slice(0, 12);
}

function buildDocumentLessonState(attachments: AttachmentItem[]) {
  const topics = attachments.flatMap((attachment) =>
    extractDocumentTopicsFromText(attachment.text),
  );

  return {
    topics: Array.from(new Set(topics)).slice(0, 24),
    currentIndex: 0,
  } satisfies DocumentLessonState;
}

function areSameAttachmentSet(a: AttachmentItem[], b: AttachmentItem[]) {
  if (a.length !== b.length) {
    return false;
  }

  const left = [...a].map((item) => item.name).sort();
  const right = [...b].map((item) => item.name).sort();

  return left.every((name, index) => name === right[index]);
}

function restoreDocumentLessonState(data: Record<string, unknown>) {
  const value =
    typeof data.documentLesson === "object" && data.documentLesson !== null
      ? (data.documentLesson as Record<string, unknown>)
      : null;

  if (!value) {
    return null;
  }

  const topics = Array.isArray(value.topics)
    ? value.topics.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const currentIndex =
    typeof value.currentIndex === "number" && Number.isFinite(value.currentIndex)
      ? Math.max(0, Math.min(Math.round(value.currentIndex), Math.max(topics.length - 1, 0)))
      : 0;

  if (topics.length === 0) {
    return null;
  }

  return {
    topics,
    currentIndex,
  } satisfies DocumentLessonState;
}

function getRequestedTopicIndex(topics: string[], target: string) {
  if (!target.trim() || topics.length === 0) {
    return -1;
  }

  const numberMatch = target.match(/\b(\d+)\b/);

  if (numberMatch) {
    const requestedNumber = Number(numberMatch[1]);
    const directIndex = requestedNumber - 1;

    if (directIndex >= 0 && directIndex < topics.length) {
      return directIndex;
    }

    const headingIndex = topics.findIndex((topic) =>
      new RegExp(`\\b${requestedNumber}\\b`).test(topic),
    );

    if (headingIndex >= 0) {
      return headingIndex;
    }
  }

  const normalizedTarget = target.toLowerCase();
  return topics.findIndex((topic) =>
    topic.toLowerCase().includes(normalizedTarget),
  );
}

function shouldRenderStructuredBullets(action: StudyAction, bullets: string[]) {
  if (bullets.length === 0) {
    return false;
  }

  return action === "step_by_step" || action === "quick_revision";
}

function shouldShowResponseTitle(action: StudyAction, title: string) {
  if (!title.trim()) {
    return false;
  }

  return action === "generate_questions" || action === "quick_revision";
}

function isMathPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return (
    normalized.includes("solve") ||
    normalized.includes("equation") ||
    normalized.includes("calculus") ||
    normalized.includes("differentiate") ||
    normalized.includes("derivative") ||
    normalized.includes("integrate") ||
    normalized.includes("integral") ||
    normalized.includes("limit") ||
    normalized.includes("matrix") ||
    normalized.includes("statistics") ||
    normalized.includes("probability") ||
    normalized.includes("algebra") ||
    normalized.includes("dy/dx") ||
    normalized.includes("d/dx") ||
    normalized.includes("find x") ||
    /[=^+\-*/]/.test(prompt)
  );
}

function deriveSessionTitle(
  response: StudyResponse,
  prompt: string,
  conversationContext: StudyContextPayload,
) {
  const responseTitle = response.title.trim();

  if (responseTitle) {
    return responseTitle;
  }

  const fromPrompt = prompt.trim();

  if (fromPrompt) {
    return fromPrompt.length > 60 ? `${fromPrompt.slice(0, 57)}...` : fromPrompt;
  }

  const topic = conversationContext.currentTopic.trim();

  if (topic) {
    return topic.length > 60 ? `${topic.slice(0, 57)}...` : topic;
  }

  return "Study session";
}

function buildTutorResponseText(response: StudyResponse) {
  const summary = response.summary.trim();

  if (shouldRenderStructuredBullets(response.action, response.bullets)) {
    return summary;
  }

  const flowingNotes = response.bullets
    .map((bullet) => bullet.trim())
    .filter(Boolean)
    .filter((bullet) => bullet !== summary);

  if (flowingNotes.length === 0) {
    return summary;
  }

  return [summary, ...flowingNotes].join("\n\n");
}

function hasMathSolution(solution?: MathSolution) {
  return Boolean(
    solution &&
      (solution.given.trim() ||
        solution.method.trim() ||
        solution.steps.length > 0 ||
        solution.finalAnswer.trim() ||
        solution.whyItWorks.trim()),
  );
}

function getMathStepLabel(step: string) {
  const trimmed = step.trim();

  if (/^for example\s*\d+/i.test(trimmed)) {
    const match = trimmed.match(/^for (example\s*\d+)\s*:\s*(.*)$/i);

    if (match) {
      return {
        label: match[1].replace(/\s+/g, " ").trim(),
        content: match[2].trim(),
      };
    }
  }

  if (/^example\s*\d+/i.test(trimmed)) {
    const match = trimmed.match(/^(example\s*\d+)\s*:\s*(.*)$/i);

    if (match) {
      return {
        label: match[1].replace(/\s+/g, " ").trim(),
        content: match[2].trim(),
      };
    }
  }

  return {
    label: "",
    content: trimmed,
  };
}

function getActionLabel(action: StudyAction) {
  switch (action) {
    case "quick_revision":
      return "Quick revision";
    case "explain_like_lecturer":
      return "Explain";
    case "step_by_step":
      return "Step by step";
    case "generate_questions":
      return "Questions";
    default:
      return "Summarize";
  }
}

function getRelativeTimeLabel(timestamp: unknown) {
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
    "toDate" in timestamp &&
    typeof timestamp.toDate === "function"
  ) {
    const date = timestamp.toDate();

    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      const diffMs = Date.now() - date.getTime();
      const diffMinutes = Math.round(diffMs / 60000);

      if (diffMinutes <= 1) {
        return "Just now";
      }

      if (diffMinutes < 60) {
        return `${diffMinutes} min ago`;
      }

      const diffHours = Math.round(diffMinutes / 60);

      if (diffHours < 24) {
        return `${diffHours} hr ago`;
      }

      const diffDays = Math.round(diffHours / 24);
      return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    }
  }

  return "Saved recently";
}

function inferActionFromPrompt(prompt: string): StudyAction {
  const normalized = prompt.toLowerCase();

  if (
    normalized.includes("summarize") ||
    normalized.includes("summary of") ||
    normalized.startsWith("summary")
  ) {
    return "summarize";
  }

  if (
    normalized.includes("quick revision") ||
    normalized.includes("revise") ||
    normalized.includes("revision notes") ||
    normalized.includes("revision points")
  ) {
    return "quick_revision";
  }

  if (
    normalized.includes("give example") ||
    normalized.includes("an example") ||
    normalized.includes("examples") ||
    normalized.includes("explain more") ||
    normalized.includes("more explanation") ||
    normalized.includes("simplify it") ||
    normalized.includes("make it simpler") ||
    normalized.includes("break this down") ||
    normalized.includes("another example") ||
    normalized.includes("continue")
  ) {
    return "explain_like_lecturer";
  }

  if (
    normalized.includes("solve") ||
    normalized.includes("work it out") ||
    normalized.includes("work this out") ||
    normalized.includes("show the steps") ||
    normalized.includes("step by step") ||
    normalized.includes("walk me through") ||
    normalized.includes("calculate")
  ) {
    return "step_by_step";
  }

  if (
    normalized.includes("generate questions") ||
    normalized.includes("practice questions") ||
    normalized.includes("quiz me") ||
    normalized.includes("mcq") ||
    normalized.includes("multiple choice") ||
    normalized.includes("cbt") ||
    normalized.includes("test me") ||
    normalized.includes("exam question")
  ) {
    return "generate_questions";
  }

  if (
    normalized.startsWith("what is") ||
    normalized.startsWith("who is") ||
    normalized.startsWith("define") ||
    normalized.includes("difference between") ||
    normalized.includes("mean by") ||
    normalized.includes("explain") ||
    normalized.includes("simpler") ||
    normalized.includes("simple terms") ||
    normalized.includes("understand")
  ) {
    return "explain_like_lecturer";
  }

  return "explain_like_lecturer";
}

function buildStudyMaterial(prompt: string, attachments: AttachmentItem[]) {
  const trimmedPrompt = prompt.trim();

  if (attachments.length === 0) {
    return trimmedPrompt;
  }

  const attachmentText = attachments
    .map(
      (file, index) =>
        `Attachment ${index + 1}: ${file.name}\n${file.text.trim()}`,
    )
    .join("\n\n");

  if (!trimmedPrompt) {
    return `${attachmentText}\n\nStudent request:\nExplain the main topic in this file clearly and smoothly for a student.`;
  }

  return `${attachmentText}\n\nStudent request:\n${trimmedPrompt}\n\nResponse style:\nTeach from the uploaded file like a patient tutor. Follow the document structure where possible, explain in lesson flow, and do not collapse everything into one short summary unless I ask for short notes.`;
}

function buildConversationContext(conversation: ChatTurn[]) {
  const recentTurns = conversation
    .filter((turn) => !turn.isLoading)
    .slice(-4)
    .map((turn) => {
      if (turn.role === "assistant" && turn.response) {
        const bulletPreview =
          turn.response.action === "step_by_step" ||
          turn.response.action === "quick_revision"
            ? turn.response.bullets.slice(0, 2).join(" | ")
            : "";
        return `Examora answered: ${turn.response.summary}${bulletPreview ? ` Key points: ${bulletPreview}` : ""}`;
      }

      return `${turn.role === "user" ? "Student" : "Examora"}: ${turn.content}`;
    });

  return recentTurns.join("\n\n");
}

function buildConversationHistory(conversation: ChatTurn[]): ConversationHistoryItem[] {
  return conversation
    .filter((turn) => !turn.isLoading)
    .map((turn) => ({
      role: turn.role,
      content:
        turn.role === "assistant" && turn.response
          ? buildTutorResponseText(turn.response)
          : turn.content,
    }))
    .filter((turn) => turn.content.trim().length > 0);
}

function buildStudyContextPayload(conversation: ChatTurn[]): StudyContextPayload {
  const usefulTurns = conversation.filter((turn) => !turn.isLoading).slice(-8);
  const reversed = [...usefulTurns].reverse();

  const lastUserMessage =
    reversed.find((turn) => turn.role === "user")?.content.trim() ?? "";
  const lastAssistantTurn = reversed.find(
    (turn) => turn.role === "assistant" && !turn.isError,
  );
  const lastAssistantSummary = lastAssistantTurn?.response?.summary?.trim() ?? "";
  const currentTopic = lastUserMessage || lastAssistantTurn?.response?.title || "";
  const rollingSummary = usefulTurns
    .slice(-6)
    .map((turn) => {
      if (turn.role === "user") {
        return `Student asked: ${turn.content.trim()}`;
      }

      if (turn.response) {
        return `Examora explained: ${turn.response.summary.trim()}`;
      }

      return `Examora replied: ${turn.content.trim()}`;
    })
    .join(" ");

  return {
    currentTopic,
    rollingSummary,
    lastAssistantSummary,
    recentMessages: usefulTurns.map((turn) => ({
      role: turn.role,
      content:
        turn.role === "assistant" && turn.response
          ? buildTutorResponseText(turn.response)
          : turn.content,
    })),
  };
}

function isFollowUpPrompt(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  return [
    "give example",
    "give examples",
    "example",
    "examples",
    "more",
    "more explanation",
    "explain more",
    "simplify it",
    "make it simpler",
    "continue",
    "go on",
    "solve more",
    "solve another",
    "another example",
    "show another one",
  ].some((item) => normalized === item || normalized.startsWith(`${item} `));
}

function isInteractiveTeachingPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return (
    normalized.includes("teach me") ||
    normalized.includes("teach this") ||
    normalized.includes("teach topic") ||
    normalized.includes("teach section") ||
    normalized.includes("teach chapter") ||
    normalized.includes("walk me through") ||
    normalized.includes("take me through") ||
    normalized.includes("lesson on") ||
    normalized.includes("after each topic") ||
    normalized.includes("before moving to the next") ||
    normalized.includes("before moving on") ||
    normalized.includes("ask if i understand") ||
    normalized.includes("ask me if i understand") ||
    normalized.includes("one topic at a time")
  );
}

function isContinueTeachingPrompt(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  return [
    "yes",
    "yeah",
    "yep",
    "i understand",
    "understood",
    "continue",
    "next",
    "move on",
    "go on",
    "next topic",
  ].some((item) => normalized === item || normalized.startsWith(`${item} `));
}

function wantsTutorLedDocumentLesson(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("teach") ||
    normalized.includes("lesson") ||
    normalized.includes("walk me through") ||
    normalized.includes("take me through") ||
    normalized.includes("break it down") ||
    normalized.includes("start with topic") ||
    normalized.includes("start from topic") ||
    normalized.includes("topic ") ||
    normalized.includes("section ") ||
    normalized.includes("chapter ")
  );
}

function extractDocumentTopicTarget(prompt: string) {
  const match = prompt.match(/\b(topic|section|chapter|unit)\s*(\d+)\b/i);

  if (!match) {
    return "";
  }

  return `${match[1].toLowerCase()} ${match[2]}`;
}

function didLastAssistantAskUnderstandingCheck(conversation: ChatTurn[]) {
  const lastAssistantTurn = [...conversation]
    .reverse()
    .find((turn) => turn.role === "assistant" && !turn.isLoading && !turn.isError);

  if (!lastAssistantTurn) {
    return false;
  }

  const content = lastAssistantTurn.response
    ? buildTutorResponseText(lastAssistantTurn.response)
    : lastAssistantTurn.content;

  return hasUnderstandingCheck(content);
}

function hasUnderstandingCheck(value: string) {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("do you understand") ||
    normalized.includes("did you understand") ||
    normalized.includes("should i explain") ||
    normalized.includes("before we continue") ||
    normalized.includes("before moving")
  );
}

function addUnderstandingCheck(value: string) {
  if (hasUnderstandingCheck(value)) {
    return value;
  }

  return `${value.trim()}\n\nDo you understand this part, or should I explain it another way before we continue?`;
}

function getFollowUpInstruction(prompt: string) {
  const normalized = prompt.trim().toLowerCase();

  if (
    normalized.includes("example") ||
    normalized.includes("examples")
  ) {
    return "This is a follow-up request for examples only. Give 2 or 3 clear examples of the immediately previous topic. Do not repeat the full explanation unless needed for one short sentence.";
  }

  if (
    normalized.includes("solve more") ||
    normalized.includes("solve another") ||
    normalized.includes("show another") ||
    normalized.includes("another example")
  ) {
    return "This is a follow-up request for another worked example. Stay on the same topic, solve one fresh example clearly, show the steps, and do not switch into quiz or practice-question mode.";
  }

  if (
    normalized.includes("simplify") ||
    normalized.includes("make it simpler")
  ) {
    return "This is a follow-up request to simplify the immediately previous topic. Explain it in easier language and avoid repeating the full earlier answer.";
  }

  if (
    normalized.includes("explain more") ||
    normalized.includes("more explanation") ||
    normalized === "more" ||
    normalized === "continue" ||
    normalized === "go on"
  ) {
    return "This is a follow-up request for more explanation. Continue from the immediately previous topic, add clarity, and avoid restarting from scratch.";
  }

  return "This is a follow-up request. Continue from the immediately previous topic and answer it naturally.";
}

function serializeConversation(conversation: ChatTurn[]) {
  return conversation
    .filter((turn) => !turn.isLoading)
    .map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      attachments: turn.attachments ?? [],
      response: turn.response ?? null,
      isError: Boolean(turn.isError),
    }));
}

function readLocalStudySessions() {
  if (typeof window === "undefined") {
    return [] as StoredLocalSession[];
  }

  try {
    const saved = window.localStorage.getItem(LOCAL_STUDY_SESSIONS_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (session): session is StoredLocalSession =>
        typeof session === "object" &&
        session !== null &&
        typeof session.id === "string" &&
        typeof session.title === "string" &&
        typeof session.data === "object" &&
        session.data !== null,
    );
  } catch {
    return [];
  }
}

function writeLocalStudySessions(sessions: StoredLocalSession[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    LOCAL_STUDY_SESSIONS_KEY,
    JSON.stringify(sessions.slice(0, 8)),
  );
}

function getLocalRecentSessions() {
  return readLocalStudySessions().map(({ data, ...session }) => {
    void data;
    return session;
  });
}

function upsertLocalStudySession(session: StoredLocalSession) {
  const withoutCurrent = readLocalStudySessions().filter(
    (item) => item.id !== session.id,
  );
  writeLocalStudySessions([session, ...withoutCurrent]);
}

function updateLocalStudySessionTitle(sessionId: string, title: string) {
  const sessions = readLocalStudySessions().map((session) =>
    session.id === sessionId ? { ...session, title } : session,
  );
  writeLocalStudySessions(sessions);
}

function deleteLocalStudySession(sessionId: string) {
  writeLocalStudySessions(
    readLocalStudySessions().filter((session) => session.id !== sessionId),
  );
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  await response.text();
  throw new Error(
    response.ok
      ? "The server returned an unexpected response. Please try again."
      : `Server error ${response.status}. The upload API did not return JSON. Check the Vercel function logs for /api/extract-pdf.`,
  );
}

function getFriendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw || raw.toLowerCase().includes("fetch") || raw.toLowerCase().includes("network") || raw.toLowerCase().includes("failed to fetch")) {
    return "Network issue. Check your connection and try again.";
  }
  if (raw.toLowerCase().includes("rate limit") || raw.toLowerCase().includes("too many") || raw.toLowerCase().includes("429")) {
    return "You're sending requests too fast. Wait a moment and try again.";
  }
  if (raw.toLowerCase().includes("timeout") || raw.toLowerCase().includes("timed out")) {
    return "The request took too long. Try again with a shorter question or smaller file.";
  }
  if (raw.toLowerCase().includes("quota") || raw.toLowerCase().includes("billing") || raw.toLowerCase().includes("503") || raw.toLowerCase().includes("provider")) {
    return "Examora is temporarily busy. Please try again in a moment.";
  }
  if (raw.toLowerCase().includes("format") || raw.toLowerCase().includes("invalid")) {
    return "Something went wrong with the response. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

function findLocalStudySession(sessionId: string) {
  return readLocalStudySessions().find((session) => session.id === sessionId);
}

function restoreConversation(data: Record<string, unknown>) {
  const stored = Array.isArray(data.messages) ? data.messages : [];

  if (stored.length > 0) {
    const restoredTurns: Array<ChatTurn | null> = stored.map((item) => {
        if (typeof item !== "object" || item === null) {
          return null;
        }

        const entry = item as Record<string, unknown>;
        const attachments = Array.isArray(entry.attachments)
          ? entry.attachments
              .map((attachment) => {
                if (typeof attachment !== "object" || attachment === null) {
                  return null;
                }

                const file = attachment as Record<string, unknown>;
                return typeof file.name === "string" &&
                  (file.type === "pdf" || file.type === "docx")
                  ? {
                      name: file.name,
                      type: file.type,
                    }
                  : null;
              })
              .filter((attachment): attachment is StoredAttachment => attachment !== null)
          : [];

        const response =
          typeof entry.response === "object" && entry.response !== null
            ? (entry.response as StudyResponse)
            : undefined;

        return {
          id:
            typeof entry.id === "string"
              ? entry.id
              : `${String(entry.role ?? "turn")}-${Math.random().toString(36).slice(2, 8)}`,
          role: entry.role === "assistant" ? "assistant" : "user",
          content: typeof entry.content === "string" ? entry.content : "",
          attachments,
          response,
          isError: entry.isError === true,
        } satisfies ChatTurn;
      });

    return restoredTurns.filter((turn): turn is ChatTurn => turn !== null);
  }

  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const bullets = Array.isArray(data.bullets)
    ? data.bullets.filter((item): item is string => typeof item === "string")
    : [];
  const title = typeof data.title === "string" ? data.title : "Saved session";

  if (!summary) {
    return [];
  }

  return [
    {
      id: "assistant-fallback",
      role: "assistant",
      content: summary,
      response: {
        title,
        summary,
        bullets,
        questions: [],
        action: "summarize",
        inputType: "text",
      },
    },
  ] satisfies ChatTurn[];
}

export default function DashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useStudyTheme();

  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeFileContext, setActiveFileContext] = useState<AttachmentItem[]>([]);
  const [documentLesson, setDocumentLesson] = useState<DocumentLessonState | null>(null);
  const [conversation, setConversation] = useState<ChatTurn[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtractingFile, setIsExtractingFile] = useState(false);
  const [showInputMenu, setShowInputMenu] = useState(false);
  const [showRecentSessions, setShowRecentSessions] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    async function loadRecentSessions() {
      if (!user) {
        setRecentSessions([]);
        return;
      }

      try {
        const sessionsQuery = query(
          collection(db, "users", user.uid, "studySessions"),
          orderBy("createdAt", "desc"),
          limit(8),
        );
        const snapshot = await getDocs(sessionsQuery);
        const firestoreSessions = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const summaryPreview =
            typeof data.summary === "string" ? data.summary.trim() : "";
          const topicTitle =
            typeof data.currentTopic === "string" ? data.currentTopic.trim() : "";
          const storedTitle =
            typeof data.title === "string" ? data.title.trim() : "";
          return {
            id: docSnapshot.id,
            title:
              storedTitle ||
              topicTitle ||
              (summaryPreview
                ? summaryPreview.slice(0, 60) +
                  (summaryPreview.length > 60 ? "..." : "")
                : "Study session"),
            action:
              typeof data.actionLabel === "string"
                ? data.actionLabel
                : "Study action",
            inputType:
              typeof data.inputTypeLabel === "string"
                ? data.inputTypeLabel
                : "Input",
            createdAtLabel: getRelativeTimeLabel(data.updatedAt ?? data.createdAt),
          };
        });
        const localOnlySessions = getLocalRecentSessions().filter(
          (localSession) =>
            !firestoreSessions.some(
              (firestoreSession) => firestoreSession.id === localSession.id,
            ),
        );
        setRecentSessions([...firestoreSessions, ...localOnlySessions].slice(0, 8));
        setSessionError("");
      } catch {
        setRecentSessions(getLocalRecentSessions());
        setSessionError("Showing saved sessions from this browser.");
      }
    }

    void loadRecentSessions();
  }, [user]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  function handleNewChat() {
    setPrompt("");
    setAttachments([]);
    setActiveFileContext([]);
    setDocumentLesson(null);
    setConversation([]);
    setCurrentSessionId(null);
    setFormError("");
    setShowInputMenu(false);
    setOpenSessionMenuId(null);
  }

  async function handleOpenSession(sessionId: string) {
    if (!user) {
      return;
    }

    const localSession = findLocalStudySession(sessionId);

    if (localSession) {
      setConversation(restoreConversation(localSession.data));
      setDocumentLesson(restoreDocumentLessonState(localSession.data));
      setCurrentSessionId(sessionId);
      setPrompt("");
      setAttachments([]);
      setActiveFileContext([]);
      setFormError("");
      setShowRecentSessions(false);
      setSessionError("");
      setOpenSessionMenuId(null);
      return;
    }

    try {
      const snapshot = await getDoc(doc(db, "users", user.uid, "studySessions", sessionId));

      if (!snapshot.exists()) {
        setSessionError("That session is no longer available.");
        return;
      }

      const data = snapshot.data();
      setConversation(restoreConversation(data));
      setDocumentLesson(restoreDocumentLessonState(data));
      setCurrentSessionId(sessionId);
      setPrompt("");
      setAttachments([]);
      setActiveFileContext([]);
      setFormError("");
      setShowRecentSessions(false);
      setSessionError("");
      setOpenSessionMenuId(null);
    } catch {
      setSessionError("That session could not be opened right now.");
    }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!user) {
      return;
    }

    try {
      try {
        await deleteDoc(doc(db, "users", user.uid, "studySessions", sessionId));
      } catch {
        // Keep local recent sessions usable if Firestore is offline.
      }
      deleteLocalStudySession(sessionId);
      setRecentSessions((current) =>
        current.filter((session) => session.id !== sessionId),
      );
      if (currentSessionId === sessionId) {
        handleNewChat();
      }
      setOpenSessionMenuId((current) => (current === sessionId ? null : current));
      setSessionError("");
    } catch {
      setSessionError("That session could not be deleted right now.");
    }
  }

  function handleStartRename(sessionId: string, currentTitle: string) {
    setEditingSessionId(sessionId);
    setEditingTitle(currentTitle);
    setOpenSessionMenuId(null);
    setSessionError("");
  }

  function handleCancelRename() {
    setEditingSessionId(null);
    setEditingTitle("");
  }

  async function handleSaveRename(sessionId: string) {
    if (!user) {
      return;
    }

    const nextTitle = editingTitle.trim();

    if (!nextTitle) {
      setSessionError("Enter a title before saving.");
      return;
    }

    try {
      try {
        await updateDoc(doc(db, "users", user.uid, "studySessions", sessionId), {
          title: nextTitle,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Keep local recent sessions usable if Firestore is offline.
      }
      updateLocalStudySessionTitle(sessionId, nextTitle);
      setRecentSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, title: nextTitle } : session,
        ),
      );
      setEditingSessionId(null);
      setEditingTitle("");
      setOpenSessionMenuId(null);
      setSessionError("");
    } catch {
      setSessionError("That session title could not be updated right now.");
    }
  }

  async function saveSession(
    response: StudyResponse,
    content: string,
    action: StudyAction,
    usedAttachments: AttachmentItem[],
    nextConversation: ChatTurn[],
    sessionTitle: string,
    nextDocumentLesson: DocumentLessonState | null,
  ) {
    if (!user) {
      return;
    }

    const nextContext = buildStudyContextPayload(nextConversation);
    const payload: Record<string, unknown> = {
      title: sessionTitle,
      summary: response.summary,
      bullets: response.bullets,
      questions: response.questions,
      mathSolution: response.mathSolution ?? null,
      action,
      actionLabel: getActionLabel(action),
      inputType: usedAttachments.length > 0 ? "pdf" : "text",
      inputTypeLabel: usedAttachments.length > 0 ? "File" : "Text",
      sourcePreview: content.slice(0, 500),
      sourceName:
        usedAttachments.length > 0 ? usedAttachments.map((file) => file.name) : null,
      rollingSummary: nextContext.rollingSummary,
      currentTopic:
        nextDocumentLesson?.topics[nextDocumentLesson.currentIndex] ??
        nextContext.currentTopic,
      documentLesson: nextDocumentLesson,
      messages: serializeConversation(nextConversation),
      updatedAt: new Date().toISOString(),
    };
    let sessionId = currentSessionId;

    if (!sessionId) {
      sessionId = `local-${Date.now()}`;
      setCurrentSessionId(sessionId);
    }

    const nextRecent: SessionItem = {
      id: sessionId,
      title: sessionTitle,
      action: getActionLabel(action),
      inputType: usedAttachments.length > 0 ? "File" : "Text",
      createdAtLabel: "Just now",
    };

    upsertLocalStudySession({
      ...nextRecent,
      data: payload,
    });

    setRecentSessions((current) => {
      const withoutCurrent = current.filter((session) => session.id !== sessionId);
      return [nextRecent, ...withoutCurrent].slice(0, 8);
    });

    try {
      const firestorePayload = {
        ...payload,
        updatedAt: serverTimestamp(),
      };

      if (currentSessionId && !currentSessionId.startsWith("local-")) {
        await updateDoc(
          doc(db, "users", user.uid, "studySessions", currentSessionId),
          firestorePayload,
        );
      } else {
        const sessionRef = await addDoc(collection(db, "users", user.uid, "studySessions"), {
          ...firestorePayload,
          createdAt: serverTimestamp(),
        });
        setCurrentSessionId(sessionRef.id);

        setRecentSessions((current) => {
          const withoutLocal = current.filter((session) => session.id !== sessionId);
          const syncedRecent = { ...nextRecent, id: sessionRef.id };
          upsertLocalStudySession({
            ...syncedRecent,
            data: payload,
          });
          deleteLocalStudySession(sessionId);
          return [syncedRecent, ...withoutLocal].slice(0, 8);
        });
      }
      setSessionError("");
    } catch {
      setSessionError("Saved on this browser. Cloud sync will retry when Firestore is reachable.");
    }
  }

  async function handleGenerate() {
    const currentPrompt = prompt.trim();
    const isTeachingContinuation =
      isContinueTeachingPrompt(prompt) && didLastAssistantAskUnderstandingCheck(conversation);
    const shouldContinueTeaching =
      isTeachingContinuation &&
      (activeFileContext.length > 0 || conversation.length > 0);
    const effectiveAttachments =
      attachments.length > 0
        ? attachments
        : shouldContinueTeaching
          ? activeFileContext
          : [];
    const currentInput = buildStudyMaterial(
      shouldContinueTeaching
        ? activeFileContext.length > 0
          ? "Continue to the next topic from this file. Teach it step by step and ask if I understand before moving on."
          : "Continue teaching the same topic from our current conversation. Move naturally to the next part, build on what you already explained, and ask if I understand before moving on."
        : prompt,
      effectiveAttachments,
    );
    const hasAttachedFiles = effectiveAttachments.length > 0;
    const interactiveTeachingRequest =
      isInteractiveTeachingPrompt(prompt) ||
      shouldContinueTeaching ||
      (effectiveAttachments.length > 0 && wantsTutorLedDocumentLesson(prompt));
    const documentTopicTarget =
      effectiveAttachments.length > 0 ? extractDocumentTopicTarget(currentPrompt) : "";
    const priorContext = buildConversationContext(conversation);
    const baseContextPayload = buildStudyContextPayload(conversation);
    let nextDocumentLesson =
      effectiveAttachments.length > 0
        ? documentLesson && areSameAttachmentSet(activeFileContext, effectiveAttachments)
          ? documentLesson
          : buildDocumentLessonState(effectiveAttachments)
        : documentLesson;

    if (effectiveAttachments.length > 0 && nextDocumentLesson) {
      const requestedIndex = getRequestedTopicIndex(
        nextDocumentLesson.topics,
        documentTopicTarget,
      );

      if (requestedIndex >= 0) {
        nextDocumentLesson = {
          ...nextDocumentLesson,
          currentIndex: requestedIndex,
        };
      } else if (shouldContinueTeaching && nextDocumentLesson.topics.length > 0) {
        nextDocumentLesson = {
          ...nextDocumentLesson,
          currentIndex: Math.min(
            nextDocumentLesson.currentIndex + 1,
            nextDocumentLesson.topics.length - 1,
          ),
        };
      }
    }

    const contextPayload: StudyContextPayload = {
      ...baseContextPayload,
      currentTopic:
        nextDocumentLesson && nextDocumentLesson.topics[nextDocumentLesson.currentIndex]
          ? nextDocumentLesson.topics[nextDocumentLesson.currentIndex]
          : baseContextPayload.currentTopic,
      documentLesson: nextDocumentLesson ?? undefined,
    };
    const conversationHistory = buildConversationHistory(conversation);
    const followUpInstruction = isFollowUpPrompt(prompt)
      ? getFollowUpInstruction(prompt)
      : "Answer the latest request directly. If the student changed topic, leave the old topic behind.";
    const studyMaterial = priorContext
      ? `Previous conversation for reference:\n${priorContext}\n\n${followUpInstruction}\n\nLatest request:\n${currentInput}`
      : currentInput;

    if (!studyMaterial.trim()) {
      setFormError("Type what you want to study or attach a file first.");
      return;
    }

    const action = inferActionFromPrompt(prompt);
    const inputType: InputType = hasAttachedFiles ? "pdf" : "text";
    const mathRequest = isMathPrompt(
      `${prompt} ${hasAttachedFiles ? "" : contextPayload.currentTopic}`,
    );
    const currentAttachments = [...effectiveAttachments];
    const currentStudyMaterial = studyMaterial;
    const attachmentPreview = currentAttachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
    }));
    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      content: currentPrompt || "Study these attached notes.",
      attachments: attachmentPreview,
    };
    const loadingTurnId = `assistant-${Date.now()}`;
    const loadingTurn: ChatTurn = {
      id: loadingTurnId,
      role: "assistant",
      content: "",
      isLoading: true,
    };
    const baseConversation = [...conversation, userTurn];

    setFormError("");
    setIsGenerating(true);
    setShowInputMenu(false);
    setConversation([...baseConversation, loadingTurn]);
    setPrompt("");
    setAttachments([]);

    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          inputType,
          content: currentStudyMaterial,
          context: contextPayload,
          conversationHistory,
          latestPrompt: currentPrompt,
          documentTopicTarget,
          followUp: isFollowUpPrompt(prompt) || shouldContinueTeaching,
          mathMode: mathRequest,
          interactiveTeaching: interactiveTeachingRequest,
        }),
      });

      const data = await readJsonResponse(response);

      if (!response.ok) {
        const providerErrors = Array.isArray(data?.providerErrors)
          ? data.providerErrors.filter(
              (item: unknown): item is string => typeof item === "string",
            )
          : [];
        const attemptedProviders = Array.isArray(data?.attemptedProviders)
          ? data.attemptedProviders.filter(
              (item: unknown): item is string => typeof item === "string",
            )
          : [];
        const errorMessage =
          typeof data?.error === "string"
            ? data.error
            : "Unable to generate response.";
        const providerDetails = [
          attemptedProviders.length > 0
            ? `Tried: ${attemptedProviders.join(", ")}`
            : "",
          ...providerErrors,
        ].filter(Boolean);

        throw new Error(
          providerDetails.length > 0
            ? `${errorMessage}\n\n${providerDetails.join("\n")}`
            : errorMessage,
        );
      }

      const parsed =
        typeof data?.title === "string" &&
        typeof data?.summary === "string" &&
        Array.isArray(data?.bullets) &&
        Array.isArray(data?.questions) &&
        typeof data?.action === "string" &&
        typeof data?.inputType === "string"
          ? {
              title: data.title,
              summary: data.summary,
              bullets: data.bullets.filter(
                (item: unknown): item is string => typeof item === "string",
              ),
              questions: data.questions.filter(
                (item: unknown): item is GeneratedQuestion =>
                  typeof item === "object" &&
                  item !== null &&
                  "id" in item &&
                  "prompt" in item &&
                  "options" in item &&
                  "correctAnswer" in item &&
                  "explanation" in item,
              ),
              mathSolution:
                typeof data.mathSolution === "object" && data.mathSolution !== null
                  ? {
                      given:
                        "given" in data.mathSolution &&
                        typeof data.mathSolution.given === "string"
                          ? data.mathSolution.given
                          : "",
                      method:
                        "method" in data.mathSolution &&
                        typeof data.mathSolution.method === "string"
                          ? data.mathSolution.method
                          : "",
                      steps:
                        "steps" in data.mathSolution &&
                        Array.isArray(data.mathSolution.steps)
                          ? data.mathSolution.steps.filter(
                              (item: unknown): item is string =>
                                typeof item === "string",
                            )
                          : [],
                      finalAnswer:
                        "finalAnswer" in data.mathSolution &&
                        typeof data.mathSolution.finalAnswer === "string"
                          ? data.mathSolution.finalAnswer
                          : "",
                      whyItWorks:
                        "whyItWorks" in data.mathSolution &&
                        typeof data.mathSolution.whyItWorks === "string"
                          ? data.mathSolution.whyItWorks
                          : "",
                    }
                  : undefined,
              action: data.action as StudyAction,
              inputType: data.inputType as InputType,
            }
          : null;

      if (!parsed) {
        throw new Error("Generated response format was invalid.");
      }

      if (interactiveTeachingRequest) {
        parsed.summary = addUnderstandingCheck(parsed.summary);
        parsed.bullets = [];
      }

      const assistantTurn: ChatTurn = {
        id: loadingTurnId,
        role: "assistant",
        content: parsed.summary,
        response: parsed,
      };
      const finalConversation = [...baseConversation, assistantTurn];
      const sessionTitle = deriveSessionTitle(parsed, currentPrompt, contextPayload);

      setConversation(finalConversation);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
      if (currentAttachments.length > 0 && interactiveTeachingRequest) {
        setActiveFileContext(currentAttachments);
      }
      if (nextDocumentLesson) {
        setDocumentLesson(nextDocumentLesson);
      } else if (!currentAttachments.length) {
        setDocumentLesson(null);
      }
      await saveSession(
        parsed,
        currentStudyMaterial,
        action,
        currentAttachments,
        finalConversation,
        sessionTitle,
        nextDocumentLesson ?? null,
      );

      if (parsed.questions.length > 0) {
        const nextPracticeSession = {
          title: parsed.title || sessionTitle,
          mode: "cbt",
          sourceType: currentAttachments.length > 0 ? "file" : "topic",
          questions: parsed.questions,
          timeLimitMinutes: Math.max(10, Math.min(45, parsed.questions.length * 2)),
        };

        window.sessionStorage.setItem(
          "examora-test-session",
          JSON.stringify(nextPracticeSession),
        );
      }
    } catch (error) {
      const message = getFriendlyError(error);
      setConversation([
        ...baseConversation,
        {
          id: loadingTurnId,
          role: "assistant",
          content: message,
          isError: true,
        },
      ]);
      setFormError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setFormError("");
    setIsExtractingFile(true);

    try {
      const nextAttachments: AttachmentItem[] = [];

      for (const file of files) {
        const lowerName = file.name.toLowerCase();
        const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
        const isDocx =
          file.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          lowerName.endsWith(".docx");

        if (!isPdf && !isDocx) {
          throw new Error("Only PDF and DOCX files are supported right now.");
        }

        if (file.size > MAX_DIRECT_UPLOAD_SIZE) {
          throw new Error(
            "Each file must be under 4MB for now. Split large notes into a smaller PDF/DOCX before uploading.",
          );
        }

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/extract-pdf", {
          method: "POST",
          body: formData,
        });
        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Unable to extract text from the file.",
          );
        }

        if (typeof data?.text !== "string" || !data.text.trim()) {
          throw new Error(`No readable text was found in ${file.name}.`);
        }

        nextAttachments.push({
          id: `${file.name}-${Date.now()}-${nextAttachments.length}`,
          name: file.name,
          text: data.text.trim(),
          type: data?.fileType === "docx" ? "docx" : "pdf",
        });
      }

      setAttachments((current) => [...current, ...nextAttachments]);
      setShowInputMenu(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to extract text from the file.";
      setFormError(message);
    } finally {
      setIsExtractingFile(false);
      event.target.value = "";
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isGenerating && !isExtractingFile) {
        void handleGenerate();
      }
    }
  }

  function resizeComposerInput(element: HTMLTextAreaElement) {
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  function handleOpenFilePicker() {
    setShowInputMenu(false);
    fileInputRef.current?.click();
  }

  const workspaceMenuItems = [
    {
      label: "New chat",
      icon: Plus,
      action: () => handleNewChat(),
    },
    {
      label: "Dashboard",
      icon: LayoutDashboard,
      action: () => router.push("/dashboard"),
    },
    {
      label: "Exam mode",
      icon: ClipboardList,
      action: () => router.push("/test"),
    },
    {
      label: "Recent sessions",
      icon: Sparkles,
      action: () => setShowRecentSessions((current) => !current),
    },
    {
      label: "Help and support",
      icon: HelpCircle,
      action: () => setFormError("Help and support will be added in the next version."),
    },
    {
      label: "Notifications",
      icon: Bell,
      action: () => setFormError("Notifications will be added in the next version."),
    },
    {
      label: "About App",
      icon: Info,
      action: () => setFormError("Examora helps students understand, revise, and practice from notes, topics, and files."),
    },
    {
      label: theme === "dark" ? "Light mode" : "Dark mode",
      icon: theme === "dark" ? Sun : Moon,
      action: () => toggleTheme(),
    },
    {
      label: "Logout",
      icon: LogOut,
      action: () => void handleLogout(),
    },
  ];

  function handleStartTest(response?: StudyResponse) {
    if (response?.questions.length) {
      window.sessionStorage.setItem(
        "examora-test-session",
        JSON.stringify({
          title: response.title || "Examora practice test",
          mode: "cbt",
          sourceType: attachments.length > 0 ? "file" : "topic",
          questions: response.questions,
          timeLimitMinutes: Math.max(10, Math.min(45, response.questions.length * 2)),
        }),
      );
    }

    router.push("/test");
  }

  if (isLoading) {
    return (
      <main className={`study-shell ${theme} flex items-center justify-center px-6 py-10`}>
        <div className="study-surface rounded-[2rem] px-6 py-5 text-sm text-[var(--study-text-muted)]">
          Checking your session...
        </div>
      </main>
    );
  }

  return (
    <main
      className={`study-shell ${theme}`}
      style={{ backgroundColor: "var(--study-bg)", color: "var(--study-text)" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="mx-auto flex h-screen w-full max-w-7xl flex-col md:flex-row overflow-hidden">
        <aside
          className="hidden shrink-0 border-b px-4 py-3 md:sticky md:top-0 md:block md:h-screen md:w-72 md:overflow-y-auto md:border-b-0 md:border-r md:px-5 md:py-5"
          style={{ borderColor: "var(--study-border)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="study-button flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold text-white">
                E
              </div>
              <div>
                <p className="text-sm font-semibold">Examora</p>
                <button
                  type="button"
                  onClick={() => setShowRecentSessions((current) => !current)}
                  className="hidden items-center gap-1 text-xs md:flex"
                  style={{ color: "var(--study-text-soft)" }}
                >
                  Recent sessions
                  <span className={`${showRecentSessions ? "rotate-180" : ""} transition-transform`}>
                    v
                  </span>
                </button>
              </div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWorkspaceMenu((current) => !current)}
                className="rounded-full px-3 py-2 text-xs font-semibold"
                style={{
                  border: "1px solid var(--study-border)",
                  background: "var(--study-surface-soft)",
                  color: "var(--study-text)",
                }}
              >
                Menu
              </button>

              {showWorkspaceMenu ? (
                <div
                  className="study-surface absolute right-0 top-12 z-20 min-w-52 rounded-2xl border p-1 shadow-lg md:hidden"
                  style={{ borderColor: "var(--study-border)" }}
                >
                  {user ? (
                    <div className="border-b px-3 py-2 text-xs" style={{ borderColor: "var(--study-border)" }}>
                      <p className="font-semibold" style={{ color: "var(--study-text)" }}>
                        {user.displayName || "Student"}
                      </p>
                      <p className="mt-1 break-all" style={{ color: "var(--study-text-soft)" }}>
                        {user.email}
                      </p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      handleNewChat();
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    New chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecentSessions((current) => !current);
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Recent sessions
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      router.push("/dashboard");
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      router.push("/test");
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Exam mode
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toggleTheme();
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleLogout();
                      setShowWorkspaceMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-full px-4 py-2.5 text-xs font-semibold"
              style={{
                border: "1px solid var(--study-border)",
                background: currentSessionId ? "var(--study-surface-soft)" : "var(--study-button)",
                color: currentSessionId ? "var(--study-text)" : "#ffffff",
              }}
            >
              New chat
            </button>
            <button
              type="button"
              onClick={() => router.push("/test")}
              className="rounded-full px-4 py-2.5 text-xs font-semibold"
              style={{
                border: "1px solid var(--study-border)",
                color: "var(--study-text)",
              }}
            >
              Exam mode
            </button>
          </div>

          {showRecentSessions ? (
            <div className="mt-5 max-h-[55vh] space-y-1 overflow-y-auto pr-1">
              {sessionError ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {sessionError}
                </div>
              ) : null}

              {recentSessions.length === 0 ? (
                <div
                  className="rounded-[1.3rem] border border-dashed px-4 py-4 text-sm"
                  style={{
                    borderColor: "var(--study-border)",
                    color: "var(--study-text-muted)",
                  }}
                >
                  No saved sessions yet.
                </div>
              ) : (
                recentSessions.map((session) => (
                  <div key={session.id} className="relative rounded-2xl px-3 py-3">
                    {editingSessionId === session.id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          className="w-full rounded-2xl border px-3 py-2 text-sm"
                          style={{
                            borderColor: "var(--study-border)",
                            background: "var(--study-surface)",
                            color: "var(--study-text)",
                          }}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveRename(session.id)}
                            className="study-button rounded-full px-3 py-2 text-xs font-semibold text-white"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelRename}
                            className="rounded-full px-3 py-2 text-xs font-semibold"
                            style={{
                              border: "1px solid var(--study-border)",
                              color: "var(--study-text-muted)",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => void handleOpenSession(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-semibold">{session.title}</p>
                          <p
                            className="mt-1 text-xs uppercase tracking-[0.18em]"
                            style={{ color: "var(--study-text-soft)" }}
                          >
                            {session.action} - {session.inputType}
                          </p>
                          <p
                            className="mt-2 text-xs"
                            style={{ color: "var(--study-text-muted)" }}
                          >
                            {session.createdAtLabel}
                          </p>
                        </button>

                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenSessionMenuId((current) =>
                                current === session.id ? null : session.id,
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold"
                            style={{
                              background: "var(--study-surface-soft)",
                              color: "var(--study-text-soft)",
                            }}
                          >
                            ...
                          </button>

                          {openSessionMenuId === session.id ? (
                            <div
                              className="study-surface absolute right-0 top-10 z-10 min-w-28 rounded-2xl border p-1 shadow-lg"
                              style={{ borderColor: "var(--study-border)" }}
                            >
                              <button
                                type="button"
                                onClick={() => handleStartRename(session.id, session.title)}
                                className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold"
                                style={{ color: "var(--study-text)" }}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteSession(session.id)}
                                className="block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold"
                                style={{ color: "var(--study-text)" }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </aside>

        <section className="flex flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          <header className="flex items-center justify-between">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.22em]"
                style={{ color: "var(--study-text-soft)" }}
              >
                Study mode
              </p>
              <h1 className="mt-2 text-lg font-semibold sm:text-xl">Guided tutor chat</h1>
            </div>
          </header>

          <div className="mt-5 flex-1 space-y-5 overflow-y-auto pb-6" id="chat-scroll" style={{ WebkitOverflowScrolling: "touch" }}>
            <div ref={bottomRef} />
            {conversation.length === 0 ? (
              <div className="flex min-h-[45vh] items-center justify-center">
                <div
                  className="study-surface rounded-full px-4 py-3 text-center text-xs font-medium shadow-sm sm:px-5 sm:text-sm"
                  style={{ color: "var(--study-text-muted)" }}
                >
                  Ask Examora to teach and revise.
                </div>
              </div>
            ) : (
              conversation.map((turn) =>
                turn.role === "user" ? (
                  <div key={turn.id} className="flex justify-end">
                    <div
                      className="max-w-[94%] rounded-[1.6rem] px-4 py-4 text-sm leading-7 sm:max-w-[78%]"
                      style={{
                        background:
                          theme === "dark" ? "rgba(255,255,255,0.08)" : "#e0e7ff",
                        color: "var(--study-text)",
                      }}
                    >
                      {turn.attachments && turn.attachments.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {turn.attachments.map((attachment, index) => (
                            <span
                              key={`${turn.id}-${attachment.name}-${index}`}
                              className="rounded-full px-3 py-1 text-xs"
                              style={{
                                border: "1px solid rgba(255,255,255,0.14)",
                                background:
                                  theme === "dark"
                                    ? "rgba(255,255,255,0.06)"
                                    : "rgba(255,255,255,0.5)",
                              }}
                            >
                              {attachment.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <StudyRichText
                        className="space-y-3"
                        theme={theme}
                        value={turn.content}
                      />
                    </div>
                  </div>
                ) : turn.isLoading ? (
                  <div key={turn.id} className="study-surface rounded-[1.8rem] px-5 py-5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 animate-pulse rounded-full"
                        style={{ background: "var(--study-button)" }}
                      />
                      <span
                        className="h-2.5 w-2.5 animate-pulse rounded-full"
                        style={{ background: "var(--study-button)", animationDelay: "120ms" }}
                      />
                      <span
                        className="h-2.5 w-2.5 animate-pulse rounded-full"
                        style={{ background: "var(--study-button)", animationDelay: "240ms" }}
                      />
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="h-4 w-32 rounded-full" style={{ background: "var(--study-surface-soft)" }} />
                      <div className="h-4 w-full rounded-full" style={{ background: "var(--study-surface-soft)" }} />
                      <div className="h-4 w-[88%] rounded-full" style={{ background: "var(--study-surface-soft)" }} />
                    </div>
                  </div>
                ) : turn.isError ? (
                  <div
                    key={turn.id}
                    className="rounded-[1.8rem] border border-amber-400/30 bg-amber-500/10 px-5 py-5 text-sm whitespace-pre-wrap text-amber-100"
                  >
                    {turn.content}
                  </div>
                ) : turn.response ? (
                  <div key={turn.id} className="study-surface rounded-[1.8rem] px-5 py-5">
                    {shouldShowResponseTitle(
                      turn.response.action,
                      turn.response.title,
                    ) ? (
                      <p
                        className="text-sm font-semibold"
                        style={{ color: "var(--study-text)" }}
                      >
                        {turn.response.title}
                      </p>
                    ) : null}

                    <div
                      className={`${shouldShowResponseTitle(turn.response.action, turn.response.title) ? "mt-4 " : ""}space-y-4 text-sm leading-7`}
                      style={{ color: "var(--study-text-muted)" }}
                    >
                      {hasMathSolution(turn.response.mathSolution) ? (
                        <div className="space-y-4">
                          <StudyRichText
                            className="space-y-3"
                            theme={theme}
                            value={turn.response.summary}
                          />

                          {turn.response.mathSolution?.given ? (
                            <div className="space-y-2">
                              <p
                                className="text-xs font-semibold uppercase tracking-[0.18em]"
                                style={{ color: "var(--study-text-soft)" }}
                              >
                                Given
                              </p>
                              <StudyRichText
                                className="space-y-2"
                                theme={theme}
                                value={turn.response.mathSolution.given}
                              />
                            </div>
                          ) : null}

                          {turn.response.mathSolution?.method ? (
                            <div className="space-y-2">
                              <p
                                className="text-xs font-semibold uppercase tracking-[0.18em]"
                                style={{ color: "var(--study-text-soft)" }}
                              >
                                Method
                              </p>
                              <StudyRichText
                                className="space-y-2"
                                theme={theme}
                                value={turn.response.mathSolution.method}
                              />
                            </div>
                          ) : null}

                          {turn.response.mathSolution?.steps?.length ? (
                            <div
                              className="math-solution-panel rounded-[1.45rem] px-4 py-4 sm:px-5"
                            >
                              <p
                                className="text-xs font-semibold uppercase tracking-[0.2em]"
                                style={{ color: "var(--study-text-soft)" }}
                              >
                                Worked solution
                              </p>
                              <div className="math-solution-divider mt-3">
                                {turn.response.mathSolution.steps.map((step, index) => {
                                  const parsedStep = getMathStepLabel(step);

                                  return (
                                    <div
                                      key={`${turn.id}-math-step-${index}`}
                                      className={index === 0 ? "pb-4" : "py-4"}
                                    >
                                      {parsedStep.label ? (
                                        <p
                                          className="mb-2 text-sm font-semibold tracking-[-0.01em]"
                                          style={{ color: "var(--study-text)" }}
                                        >
                                          {parsedStep.label}
                                        </p>
                                      ) : null}
                                      <StudyRichText
                                        className="space-y-2"
                                        theme={theme}
                                        value={parsedStep.content}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {turn.response.mathSolution?.finalAnswer ? (
                            <div
                              className="rounded-[1.35rem] px-4 py-4 sm:px-5"
                              style={{ background: "var(--study-math-surface)" }}
                            >
                              <p
                                className="text-xs font-semibold uppercase tracking-[0.18em]"
                                style={{ color: "var(--study-text-soft)" }}
                              >
                                Final answer
                              </p>
                              <StudyRichText
                                className="mt-2 space-y-2"
                                theme={theme}
                                value={turn.response.mathSolution.finalAnswer}
                              />
                            </div>
                          ) : null}

                          {turn.response.mathSolution?.whyItWorks ? (
                            <div className="space-y-2">
                              <p
                                className="text-xs font-semibold uppercase tracking-[0.18em]"
                                style={{ color: "var(--study-text-soft)" }}
                              >
                                Why this works
                              </p>
                              <StudyRichText
                                className="space-y-2"
                                theme={theme}
                                value={turn.response.mathSolution.whyItWorks}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : shouldRenderStructuredBullets(
                        turn.response.action,
                        turn.response.bullets,
                      ) ? (
                        <div className="space-y-4">
                          <StudyRichText
                            className="space-y-3"
                            theme={theme}
                            value={turn.response.summary}
                          />
                          {turn.response.bullets.map((bullet, index) => (
                            <div key={`${turn.id}-${index}`} className="flex gap-3">
                              <span
                                className="mt-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-semibold"
                                style={{
                                  background: "var(--study-surface-soft)",
                                  color: "var(--study-text)",
                                }}
                              >
                                {index + 1}
                              </span>
                              <StudyRichText
                                className="flex-1 space-y-2"
                                theme={theme}
                                value={bullet}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {!shouldRenderStructuredBullets(
                        turn.response.action,
                        turn.response.bullets,
                      ) ? (
                        <StudyRichText
                          className="space-y-3"
                          theme={theme}
                          value={buildTutorResponseText(turn.response)}
                        />
                      ) : null}
                    </div>

                    {turn.response.questions.length > 0 ? (
                      <div
                        className="mt-5 rounded-[1.4rem] border p-4"
                        style={{ borderColor: "var(--study-border)" }}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p
                              className="text-xs font-semibold uppercase tracking-[0.18em]"
                              style={{ color: "var(--study-text-soft)" }}
                            >
                              Practice ready
                            </p>
                            <p
                              className="mt-2 text-sm"
                              style={{ color: "var(--study-text-muted)" }}
                            >
                              {turn.response.questions.length} question
                              {turn.response.questions.length === 1 ? "" : "s"} prepared from this request.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleStartTest(turn.response)}
                            className="study-button rounded-full px-5 py-3 text-sm font-semibold text-white"
                          >
                            Start test
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div key={turn.id} className="study-surface rounded-[1.8rem] px-5 py-5 text-sm leading-7">
                    <StudyRichText
                      className="space-y-3"
                      theme={theme}
                      value={turn.content}
                    />
                  </div>
                ),
              )
            )}
            <div ref={bottomRef} />
          </div>

          <div className="sticky bottom-0 z-20 mt-3 pb-3 pt-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <AnimatePresence>
              {showInputMenu ? (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="mb-2"
                >
                  <button
                    type="button"
                    onClick={handleOpenFilePicker}
                    className="study-floating-card inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl transition hover:-translate-y-0.5"
                    style={{ color: "var(--study-text)" }}
                  >
                    <FilePlus2 size={17} />
                    Attach PDF or DOCX
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <motion.div
              layout
              className="ai-composer mx-auto max-w-4xl rounded-[1.75rem] px-3 py-3 shadow-2xl sm:rounded-[2rem]"
              whileFocus={{ scale: 1.01 }}
            >

              {attachments.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
                      style={{
                        border: "1px solid var(--study-border)",
                        background: "var(--study-surface-soft)",
                        color: "var(--study-text)",
                      }}
                    >
                      <span>{attachment.type === "docx" ? "DOCX" : "PDF"}</span>
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.id)}
                        className="text-[11px]"
                        style={{ color: "var(--study-text-soft)" }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowInputMenu((current) => !current)}
                  className="composer-icon-button mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:scale-105 active:scale-95"
                  aria-label="Attach file"
                >
                  <Plus size={20} />
                </button>

                <textarea
                ref={composerInputRef}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  resizeComposerInput(event.target);
                }}
                onKeyDown={handleComposerKeyDown}
                placeholder="ask anything..."
                rows={1}
                className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-sm leading-6 outline-none placeholder:text-[var(--study-text-soft)] sm:text-[15px]"
                style={{ color: "var(--study-text)" }}
              />

                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating || isExtractingFile}
                  className="composer-send-button mb-0.5 flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-3 text-sm font-semibold text-white transition hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Send message"
                >
                  {isExtractingFile || isGenerating ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </div>

              {formError ? (
                <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {formError}
                </p>
              ) : null}
            </motion.div>
          </div>
        </section>
      </div>

      <button
        type="button"
        onClick={() => setShowWorkspaceMenu((current) => !current)}
        className="floating-menu-button md:hidden"
        style={{ top: "1rem", right: "1rem", bottom: "auto" }}
        aria-label="Open app menu"
      >
        <Menu size={22} />
      </button>

      <AnimatePresence>
        {showWorkspaceMenu ? (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[2px] md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWorkspaceMenu(false)}
            />
            <motion.div
              className="mobile-action-sheet md:hidden"
              initial={{ opacity: 0, y: 32, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
              {user ? (
                <div className="mb-3 rounded-2xl px-3 py-2 text-xs" style={{ background: "var(--study-surface-soft)" }}>
                  <p className="font-semibold">{user.displayName || "Student"}</p>
                  <p className="mt-1 truncate" style={{ color: "var(--study-text-soft)" }}>
                    {user.email}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-1">
                {workspaceMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        item.action();
                        if (item.label !== "Recent sessions") {
                          setShowWorkspaceMenu(false);
                        }
                      }}
                      className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition hover:bg-white/8 active:scale-[0.99]"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--study-surface-soft)" }}>
                        <Icon size={17} />
                      </span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {showRecentSessions ? (
                <div className="mt-3 max-h-52 overflow-y-auto rounded-2xl p-2" style={{ background: "var(--study-surface-soft)" }}>
                  {recentSessions.length === 0 ? (
                    <p className="px-3 py-2 text-sm" style={{ color: "var(--study-text-muted)" }}>
                      No saved sessions yet.
                    </p>
                  ) : (
                    recentSessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          void handleOpenSession(session.id);
                          setShowWorkspaceMenu(false);
                        }}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                      >
                        <span className="block truncate font-semibold">{session.title}</span>
                        <span className="mt-1 block text-xs" style={{ color: "var(--study-text-soft)" }}>
                          {session.action} - {session.createdAtLabel}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
