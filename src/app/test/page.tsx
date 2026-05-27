"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { useStudyTheme } from "@/components/study-theme-provider";
import { auth, db } from "@/lib/firebase";

type ExamMode = "cbt" | "writing";
type SourceType = "topic" | "outline" | "file";

type GeneratedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type TestSession = {
  title: string;
  mode: ExamMode;
  sourceType: SourceType;
  questions: GeneratedQuestion[];
  timeLimitMinutes: number;
};

type AttachmentItem = {
  name: string;
  text: string;
  type: "pdf" | "docx";
};

type WritingReview = {
  score: number;
  verdict: string;
  strengths: string[];
  missingPoints: string[];
  whyWrong: string[];
  languageNotes: string[];
};

type ExamResultItem = {
  id: string;
  title: string;
  mode: ExamMode;
  percentage: number;
  label: string;
  scoreLabel: string;
  createdAtLabel: string;
};

type StoredExamResult = {
  id: string;
  title: string;
  mode: ExamMode;
  percentage: number;
  label: string;
  scoreLabel: string;
  createdAt: string;
};

type ExamStage = "taking" | "summary" | "review";

const sourceOptions: Array<{
  id: SourceType;
  title: string;
  description: string;
}> = [
  {
    id: "topic",
    title: "Topic",
    description: "Generate an exam from one topic or question area.",
  },
  {
    id: "outline",
    title: "Course outline",
    description: "Use a list of topics from a whole course.",
  },
  {
    id: "file",
    title: "File",
    description: "Upload PDF or DOCX notes and test from them.",
  },
];

function normalizeQuestionForMode(question: GeneratedQuestion, mode: ExamMode) {
  if (mode === "cbt") {
    return {
      ...question,
      correctAnswer: resolveCbtCorrectAnswer(question.options, question.correctAnswer),
    };
  }

  return {
    ...question,
    options: [],
  };
}

function normalizeAnswerValue(value: string) {
  return value
    .toLowerCase()
    .replace(/^[a-d][\).\:\-\s]+/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCbtCorrectAnswer(options: string[], correctAnswer: string) {
  const trimmed = correctAnswer.trim();
  const normalizedTarget = normalizeAnswerValue(trimmed);

  const directMatch = options.find(
    (option) => normalizeAnswerValue(option) === normalizedTarget,
  );

  if (directMatch) {
    return directMatch;
  }

  const letterMatch = trimmed.match(/^([A-Da-d])(?:[\).\:\-\s]|$)/);

  if (letterMatch) {
    const index = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < options.length) {
      return options[index];
    }
  }

  return trimmed;
}

function areAnswersEquivalent(selected: string, correctAnswer: string) {
  return normalizeAnswerValue(selected) === normalizeAnswerValue(correctAnswer);
}

function estimateWritingScore(answer: string, modelAnswer: string) {
  const answerWords = new Set(
    answer
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
  const modelWords = modelAnswer
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  if (answerWords.size === 0 || modelWords.length === 0) {
    return 0;
  }

  const matchedWords = modelWords.filter((word) => answerWords.has(word));
  const ratio = matchedWords.length / Math.max(modelWords.length, 1);

  return Math.min(10, Math.round(ratio * 10));
}

function extractKeyPhrases(text: string, limit = 6) {
  return Array.from(
    new Set(
      text
        .split(/[\n.;:]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 12),
    ),
  ).slice(0, limit);
}

function buildWritingReview(
  answer: string,
  modelAnswer: string,
  markingGuide: string,
): WritingReview {
  const score = estimateWritingScore(answer, modelAnswer);
  const answerLower = answer.toLowerCase();
  const modelPoints = extractKeyPhrases(modelAnswer, 4);
  const guidePoints = extractKeyPhrases(markingGuide, 4);
  const strengths = modelPoints.filter((point) =>
    point
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length > 4 && answerLower.includes(word)),
  );
  const missingPoints = [...modelPoints, ...guidePoints]
    .filter((point) => !strengths.includes(point))
    .slice(0, 4);
  const languageNotes: string[] = [];
  const whyWrong: string[] = [];

  if (score <= 3) {
    whyWrong.push("Your answer does not cover the main idea expected by the question.");
  }

  if (missingPoints.length >= 2) {
    whyWrong.push("Important supporting points from the expected answer are missing.");
  }

  if (!answer.trim()) {
    whyWrong.push("No answer was submitted, so there is nothing to mark against the model answer.");
  }

  if (answer.trim().length < 40) {
    languageNotes.push("Your answer is too short. Expand your explanation with clearer supporting points.");
  }

  if (answer.trim() && !/^[A-Z]/.test(answer.trim())) {
    languageNotes.push("Start your answer with a capital letter to improve presentation.");
  }

  if (answer.trim() && !/[.!?]$/.test(answer.trim())) {
    languageNotes.push("End your answer with proper punctuation so it reads more clearly.");
  }

  if (!/\n/.test(answer) && answer.trim().split(/\s+/).length > 80) {
    languageNotes.push("Break long answers into paragraphs or short sections so they are easier to read.");
  }

  if (languageNotes.length === 0) {
    languageNotes.push("Your grammar and presentation are generally clear. Keep your points structured and direct.");
  }

  return {
    score,
    verdict:
      !answer.trim()
        ? "No answer submitted yet."
        : score >= 8
          ? "Your answer is mostly correct."
          : score >= 5
            ? "Your answer is partly correct, but it needs stronger detail."
            : "Your answer is weak or incorrect compared with the expected answer.",
    strengths:
      strengths.length > 0
        ? strengths
        : ["You touched part of the expected answer, but more depth is needed."],
    missingPoints,
    whyWrong,
    languageNotes,
  };
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

function getPerformanceLabel(percentage: number) {
  if (percentage >= 85) {
    return "Excellent";
  }

  if (percentage >= 70) {
    return "Pass";
  }

  if (percentage >= 50) {
    return "Fair";
  }

  return "Fail";
}

function formatTimeRemaining(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getTimerState(totalSeconds: number) {
  if (totalSeconds <= 60) {
    return "critical";
  }

  if (totalSeconds <= 300) {
    return "warning";
  }

  return "normal";
}

function readLocalExamResults(): ExamResultItem[] {
  if (typeof window === "undefined") {
    return [] as ExamResultItem[];
  }

  try {
    const saved = window.localStorage.getItem("examora-exam-results");
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as StoredExamResult[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((result) => {
      const mode: ExamMode = result.mode === "writing" ? "writing" : "cbt";

      return {
        id: result.id,
        title: result.title,
        mode,
      percentage: typeof result.percentage === "number" ? result.percentage : 0,
      label:
        typeof result.label === "string"
          ? result.label
          : getPerformanceLabel(result.percentage ?? 0),
      scoreLabel:
        typeof result.scoreLabel === "string"
          ? result.scoreLabel
          : "0 / 0",
        createdAtLabel: result.createdAt || "Saved recently",
      };
    });
  } catch {
    return [];
  }
}

function writeLocalExamResults(results: ExamResultItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  const serializable: StoredExamResult[] = results.slice(0, 6).map((result) => ({
    id: result.id,
    title: result.title,
    mode: result.mode,
    percentage: result.percentage,
    label: result.label,
    scoreLabel: result.scoreLabel,
    createdAt: result.createdAtLabel,
  }));

  window.localStorage.setItem("examora-exam-results", JSON.stringify(serializable));
}

function parsePositiveInteger(value: string, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(max, Math.round(parsed));
}

export default function TestPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useStudyTheme();
  const [sourceType, setSourceType] = useState<SourceType>("topic");
  const [examMode, setExamMode] = useState<ExamMode>("cbt");
  const [questionCountInput, setQuestionCountInput] = useState("0");
  const [timeLimitInput, setTimeLimitInput] = useState("0");
  const [topicText, setTopicText] = useState("");
  const [outlineText, setOutlineText] = useState("");
  const [attachment, setAttachment] = useState<AttachmentItem | null>(null);
  const [session, setSession] = useState<TestSession | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [recentResults, setRecentResults] = useState<ExamResultItem[]>([]);
  const [hasSavedResult, setHasSavedResult] = useState(false);
  const [showPageMenu, setShowPageMenu] = useState(false);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(0);
  const [examStage, setExamStage] = useState<ExamStage>("taking");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const saved = window.sessionStorage.getItem("examora-test-session");

    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as Partial<TestSession>;
      if (parsed?.title && Array.isArray(parsed?.questions)) {
        const parsedTimeLimitMinutes =
          typeof parsed.timeLimitMinutes === "number" && parsed.timeLimitMinutes > 0
            ? parsed.timeLimitMinutes
            : 15;
        setSession({
          title: parsed.title,
          mode: parsed.mode === "writing" ? "writing" : "cbt",
          sourceType:
            parsed.sourceType === "outline" || parsed.sourceType === "file"
              ? parsed.sourceType
              : "topic",
          questions: parsed.questions,
          timeLimitMinutes: parsedTimeLimitMinutes,
        });
        setQuestionCountInput(String(parsed.questions.length));
        setTimeLimitInput(String(parsedTimeLimitMinutes));
        setTimeRemainingSeconds(parsedTimeLimitMinutes * 60);
        setExamStage("taking");
      }
    } catch {
      setSession(null);
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    async function loadRecentResults() {
      if (!user) {
        setRecentResults(readLocalExamResults());
        return;
      }

      try {
        const resultsQuery = query(
          collection(db, "users", user.uid, "examResults"),
          orderBy("createdAt", "desc"),
          limit(6),
        );
        const snapshot = await getDocs(resultsQuery);
        setRecentResults(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data();
            const percentage =
              typeof data.percentage === "number" ? data.percentage : 0;

            return {
              id: docSnapshot.id,
              title:
                typeof data.title === "string" ? data.title : "Exam result",
              mode: data.mode === "writing" ? "writing" : "cbt",
              percentage,
              label:
                typeof data.label === "string"
                  ? data.label
                  : getPerformanceLabel(percentage),
              scoreLabel:
                typeof data.scoreLabel === "string"
                  ? data.scoreLabel
                  : `${data.score ?? 0} / ${data.maxScore ?? 0}`,
              createdAtLabel: getRelativeTimeLabel(data.createdAt),
            };
          }),
        );
      } catch {
        setRecentResults(readLocalExamResults());
      }
    }

    void loadRecentResults();
  }, [user]);

  const score = useMemo(() => {
    if (!session) {
      return 0;
    }

    if (session.mode === "writing") {
      return session.questions.reduce((total, question) => {
        return (
          total +
          estimateWritingScore(
            answers[question.id] ?? "",
            question.correctAnswer || question.explanation,
          )
        );
      }, 0);
    }

    return session.questions.reduce((total, question) => {
      return areAnswersEquivalent(
        answers[question.id] ?? "",
        question.correctAnswer,
      )
        ? total + 1
        : total;
    }, 0);
  }, [answers, session]);

  const maxScore = session
    ? session.mode === "writing"
      ? session.questions.length * 10
      : session.questions.length
    : 0;
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const performanceLabel = getPerformanceLabel(percentage);
  const timerState = getTimerState(timeRemainingSeconds);
  const activeQuestion = session?.questions[activeQuestionIndex] ?? null;
  const writingReview =
    session?.mode === "writing" && activeQuestion
      ? buildWritingReview(
          answers[activeQuestion.id] ?? "",
          activeQuestion.correctAnswer,
          activeQuestion.explanation,
        )
      : null;
  const correctCount =
    session?.mode === "cbt"
      ? session.questions.filter((question) =>
          areAnswersEquivalent(
            answers[question.id] ?? "",
            question.correctAnswer,
          ),
        ).length
      : 0;
  const incorrectCount =
    session?.mode === "cbt"
      ? session.questions.filter(
          (question) =>
            Boolean(answers[question.id]?.trim()) &&
            !areAnswersEquivalent(
              answers[question.id] ?? "",
              question.correctAnswer,
            ),
        ).length
      : 0;
  const answeredCount = session
    ? session.questions.filter((question) => Boolean(answers[question.id]?.trim())).length
    : 0;
  const unansweredCount =
    session == null
      ? 0
      : session.mode === "cbt"
        ? session.questions.filter((question) => !answers[question.id]?.trim()).length
        : Math.max(session.questions.length - answeredCount, 0);
  const averageWritingScore =
    session?.mode === "writing" && session.questions.length > 0
      ? Math.round(score / session.questions.length)
      : 0;
  const timeUsedSeconds = session
    ? Math.max((session.timeLimitMinutes * 60) - timeRemainingSeconds, 0)
    : 0;
  const missedQuestionIndexes = session
    ? session.questions
        .map((question, index) => {
          if (session.mode === "writing") {
            const questionScore = estimateWritingScore(
              answers[question.id] ?? "",
              question.correctAnswer || question.explanation,
            );
            return questionScore < 7 ? index : null;
          }

          return areAnswersEquivalent(
            answers[question.id] ?? "",
            question.correctAnswer,
          )
            ? null
            : index;
        })
        .filter((value): value is number => value !== null)
    : [];

  function resetExam() {
    setSession(null);
    setAnswers({});
    setHasSubmitted(false);
    setHasSavedResult(false);
    setActiveQuestionIndex(0);
    setTimeRemainingSeconds(0);
    setExamStage("taking");
    setQuestionCountInput("0");
    setTimeLimitInput("0");
    window.sessionStorage.removeItem("examora-test-session");
  }

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  function submitExam() {
    setHasSubmitted(true);
    setExamStage("summary");
  }

  function handleRemoveAttachment() {
    setAttachment(null);
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    async function saveExamResult() {
      if (!user || !session || !hasSubmitted || hasSavedResult) {
        return;
      }

      try {
        await addDoc(collection(db, "users", user.uid, "examResults"), {
          title: session.title,
          mode: session.mode,
          score,
          maxScore,
          percentage,
          label: performanceLabel,
          scoreLabel: `${score} / ${maxScore}`,
          totalQuestions: session.questions.length,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Keep the current test experience running even if saving history fails.
      }

      const nextLocalResult: ExamResultItem = {
        id: `local-${Date.now()}`,
        title: session.title,
        mode: session.mode,
        percentage,
        label: performanceLabel,
        scoreLabel: `${score} / ${maxScore}`,
        createdAtLabel: "Just now",
      };

      setRecentResults((current) => {
        const nextResults = [nextLocalResult, ...current].slice(0, 6);
        writeLocalExamResults(nextResults);
        return nextResults;
      });
      setHasSavedResult(true);
    }

    void saveExamResult();
  }, [
    hasSavedResult,
    hasSubmitted,
    maxScore,
    percentage,
    performanceLabel,
    score,
    session,
    user,
  ]);

  useEffect(() => {
    if (!session || hasSubmitted) {
      return;
    }

    if (timeRemainingSeconds <= 0) {
      submitExam();
      return;
    }

    const timer = window.setInterval(() => {
      setTimeRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [hasSubmitted, session, timeRemainingSeconds]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setError("");
    setIsExtracting(true);

    try {
      const lowerName = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
      const isDocx =
        file.type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        lowerName.endsWith(".docx");

      if (!isPdf && !isDocx) {
        throw new Error("Only PDF and DOCX files are supported right now.");
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract-pdf", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok || typeof data?.text !== "string") {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to read this file.",
        );
      }

      setAttachment({
        name: file.name,
        text: data.text.trim(),
        type: data?.fileType === "docx" ? "docx" : "pdf",
      });
    } catch (fileError) {
      setError(
        fileError instanceof Error
          ? fileError.message
          : "Unable to read this file.",
      );
    } finally {
      setIsExtracting(false);
      event.target.value = "";
    }
  }

  async function handleGenerateExam() {
    const sourceText = sourceType === "outline" ? outlineText : topicText;
    const trimmedSourceText = sourceText.trim();
    const parsedQuestionCount = parsePositiveInteger(questionCountInput, 30);
    const parsedTimeLimitMinutes = parsePositiveInteger(timeLimitInput, 180);
    const content =
      sourceType === "file"
        ? attachment
          ? `${attachment.name}\n\n${attachment.text}`
          : ""
        : sourceType === "outline"
          ? `Use every topic in this course outline. Spread the questions across the outline instead of focusing on only one topic.\n\nCourse outline:\n${trimmedSourceText}`
          : trimmedSourceText;

    if (!content.trim()) {
      setError(
        sourceType === "file"
          ? "Upload a file first."
          : "Enter the topic or course outline first.",
      );
      return;
    }

    if (parsedQuestionCount === null) {
      setError("Input the number of questions from 1 and above.");
      return;
    }

    if (parsedTimeLimitMinutes === null) {
      setError("Input the exam time from 1 minute and above.");
      return;
    }

    setError("");
    setIsGenerating(true);

    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "generate_questions",
          inputType: sourceType === "file" ? "pdf" : sourceType,
          questionCount: parsedQuestionCount,
          questionType: examMode,
          content: `${examMode === "writing" ? "Generate writing/theory exam questions. Do not create options. Provide a model answer in correctAnswer and marking guide in explanation." : "Generate CBT multiple-choice exam questions with four options."}
${sourceType === "outline" ? "Use all topics listed in the outline. Distribute the questions across the outline and do not stay on just one topic." : ""}
Question count requested: ${parsedQuestionCount}

${content}`,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const providerErrors = Array.isArray(data?.providerErrors)
          ? data.providerErrors.filter(
              (item: unknown): item is string => typeof item === "string",
            )
          : [];
        throw new Error(
          providerErrors.length > 0
            ? `${data?.error ?? "Unable to generate exam."}\n\n${providerErrors.join("\n")}`
            : data?.error ?? "Unable to generate exam.",
        );
      }

      const questions = Array.isArray(data?.questions)
        ? data.questions
            .filter(
              (question: unknown): question is GeneratedQuestion =>
                typeof question === "object" &&
                question !== null &&
                "id" in question &&
                "prompt" in question &&
                "options" in question &&
                "correctAnswer" in question &&
                "explanation" in question,
            )
            .map((question: GeneratedQuestion) =>
              normalizeQuestionForMode(question, examMode),
            )
        : [];

      if (questions.length === 0) {
        throw new Error("No exam questions were generated. Try fewer questions or a clearer topic.");
      }

      const nextSession: TestSession = {
        title: typeof data?.title === "string" ? data.title : "Examora test",
        mode: examMode,
        sourceType,
        questions: questions.slice(0, parsedQuestionCount),
        timeLimitMinutes: parsedTimeLimitMinutes,
      };

      setSession(nextSession);
      setAnswers({});
      setHasSubmitted(false);
      setHasSavedResult(false);
      setActiveQuestionIndex(0);
      setExamStage("taking");
      setTimeRemainingSeconds(parsedTimeLimitMinutes * 60);
      window.sessionStorage.setItem(
        "examora-test-session",
        JSON.stringify(nextSession),
      );
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Unable to generate exam.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (isLoading) {
    return (
      <main className={`study-shell ${theme} flex items-center justify-center px-6 py-10`}>
        <div className="study-surface rounded-[2rem] px-6 py-5 text-sm">
          Checking your session...
        </div>
      </main>
    );
  }

  if (!session || !activeQuestion) {
    return (
      <main className={`study-shell ${theme}`}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileChange}
          className="hidden"
        />

        <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <header className="flex items-center justify-between gap-3">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.24em]"
                style={{ color: "var(--study-text-soft)" }}
              >
                Exam mode
              </p>
              <h1 className="mt-2 text-lg font-semibold sm:text-xl">Build your test</h1>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPageMenu((current) => !current)}
                className="rounded-full px-4 py-2.5 text-sm font-semibold"
                style={{
                  border: "1px solid var(--study-border)",
                  background: "var(--study-surface-soft)",
                  color: "var(--study-text)",
                }}
              >
                Menu
              </button>

              {showPageMenu ? (
                <div
                  className="study-surface absolute right-0 top-12 z-20 min-w-60 rounded-2xl border p-1 shadow-lg"
                  style={{ borderColor: "var(--study-border)" }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      router.push("/dashboard");
                      setShowPageMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toggleTheme();
                      setShowPageMenu(false);
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
                      setShowPageMenu(false);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                    style={{ color: "var(--study-text)" }}
                  >
                    Log out
                  </button>

                  <div className="mt-1 border-t px-3 py-2" style={{ borderColor: "var(--study-border)" }}>
                    <p
                      className="text-xs font-semibold uppercase tracking-[0.16em]"
                      style={{ color: "var(--study-text-soft)" }}
                    >
                      Recent results
                    </p>
                  </div>

                  <div className="max-h-64 overflow-y-auto px-1 pb-1">
                    {recentResults.length === 0 ? (
                      <p className="px-3 py-2 text-sm" style={{ color: "var(--study-text-muted)" }}>
                        No saved exam results yet.
                      </p>
                    ) : (
                      recentResults.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-xl px-3 py-2"
                          style={{ border: "1px solid var(--study-border)" }}
                        >
                          <p className="truncate text-sm font-semibold">{result.title}</p>
                          <p className="mt-1 text-xs" style={{ color: "var(--study-text-soft)" }}>
                            {result.scoreLabel} - {result.createdAtLabel}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <div className="grid flex-1 gap-5 py-5 sm:py-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
                Build a focused test.
              </h1>
              <p
                className="mt-4 max-w-xl text-sm leading-7"
                style={{ color: "var(--study-text-muted)" }}
              >
                Pick a source, set your question count and time, then start.
              </p>
            </div>

            <div className="study-surface rounded-[2rem] p-4 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                {sourceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSourceType(option.id)}
                    className="rounded-[1.15rem] border p-3.5 text-left transition hover:-translate-y-0.5"
                    style={{
                      borderColor:
                        sourceType === option.id
                          ? "var(--study-button)"
                          : "var(--study-border)",
                      background:
                        sourceType === option.id
                          ? "var(--study-surface-soft)"
                          : "transparent",
                    }}
                  >
                    <p className="font-semibold">{option.title}</p>
                    <p className="mt-2 text-xs leading-5" style={{ color: "var(--study-text-muted)" }}>
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {(["cbt", "writing"] as ExamMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setExamMode(mode)}
                    className="rounded-[1.3rem] border px-4 py-3 text-left text-sm font-semibold capitalize"
                    style={{
                      borderColor:
                        examMode === mode
                          ? "var(--study-button)"
                          : "var(--study-border)",
                      background:
                        examMode === mode
                          ? "var(--study-surface-soft)"
                          : "transparent",
                    }}
                  >
                    {mode === "cbt" ? "CBT objective" : "Writing / theory"}
                  </button>
                ))}
              </div>

              <div className="mt-5">
                {sourceType === "file" ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full rounded-[1.25rem] border border-dashed px-4 py-5 text-sm font-semibold"
                      style={{
                        borderColor: "var(--study-border)",
                        color: "var(--study-text)",
                      }}
                    >
                      {isExtracting
                        ? "Reading file..."
                        : attachment
                          ? `${attachment.type.toUpperCase()} attached: ${attachment.name}`
                          : "Upload PDF or DOCX"}
                    </button>

                    {attachment ? (
                      <button
                        type="button"
                        onClick={handleRemoveAttachment}
                        className="rounded-full px-4 py-2 text-sm font-semibold"
                        style={{
                          border: "1px solid var(--study-border)",
                          color: "var(--study-text)",
                        }}
                      >
                        Replace file
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <textarea
                    value={sourceType === "topic" ? topicText : outlineText}
                    onChange={(event) => {
                      if (sourceType === "topic") {
                        setTopicText(event.target.value);
                        return;
                      }

                      setOutlineText(event.target.value);
                    }}
                    placeholder={
                      sourceType === "topic"
                        ? "Example: Demand and supply"
                        : "Paste your outline..."
                    }
                    className="min-h-36 w-full resize-none rounded-[1.25rem] border bg-transparent px-4 py-4 text-sm leading-7 outline-none"
                    style={{
                      borderColor: "var(--study-border)",
                      color: "var(--study-text)",
                    }}
                  />
                )}
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Questions
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={questionCountInput}
                      onChange={(event) => setQuestionCountInput(event.target.value)}
                      className="mt-2 block w-full rounded-full border bg-transparent px-4 py-2 text-sm outline-none"
                      style={{
                        borderColor: "var(--study-border)",
                        color: "var(--study-text)",
                      }}
                    />
                  </label>

                  <label className="text-sm font-semibold">
                    Time (mins)
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={timeLimitInput}
                      onChange={(event) => setTimeLimitInput(event.target.value)}
                      className="mt-2 block w-full rounded-full border bg-transparent px-4 py-2 text-sm outline-none"
                      style={{
                        borderColor: "var(--study-border)",
                        color: "var(--study-text)",
                      }}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateExam}
                  disabled={isGenerating || isExtracting}
                  className="study-button rounded-full px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isGenerating ? "Building exam..." : "Generate exam"}
                </button>
              </div>

              {error ? (
                <p className="mt-4 whitespace-pre-wrap rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`study-shell ${theme}`}>
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.22em]"
              style={{ color: "var(--study-text-soft)" }}
            >
              {examStage === "review" ? "Review mode" : "Exam room"}
            </p>
            <h1 className="mt-2 text-lg font-semibold sm:text-xl">{session.title}</h1>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPageMenu((current) => !current)}
              className="rounded-full px-4 py-2.5 text-sm font-semibold"
              style={{
                border: "1px solid var(--study-border)",
                background: "var(--study-surface-soft)",
                color: "var(--study-text)",
              }}
            >
              Menu
            </button>

            {showPageMenu ? (
              <div
                className="study-surface absolute right-0 top-12 z-20 min-w-52 rounded-2xl border p-1 shadow-lg"
                style={{ borderColor: "var(--study-border)" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    resetExam();
                    setShowPageMenu(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: "var(--study-text)" }}
                >
                  New test
                </button>
                <button
                  type="button"
                  onClick={() => {
                    router.push("/dashboard");
                    setShowPageMenu(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: "var(--study-text)" }}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleTheme();
                    setShowPageMenu(false);
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
                    setShowPageMenu(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: "var(--study-text)" }}
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {examStage === "summary" ? (
          <section className="mt-6 study-surface rounded-[2rem] p-5 sm:p-6">
            <p
              className="text-xs font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--study-text-soft)" }}
            >
              Exam submitted
            </p>
            <h2 className="mt-3 text-3xl font-semibold">
              {percentage}% - {performanceLabel}
            </h2>
            <p className="mt-3 text-sm leading-7" style={{ color: "var(--study-text-muted)" }}>
              Your test is complete. Open review mode if you want to check each answer one by one.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-[1.2rem] border px-4 py-3" style={{ borderColor: "var(--study-border)" }}>
                <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--study-text-soft)" }}>
                  Overall
                </p>
                <p className="mt-2 text-xl font-semibold">{score} / {maxScore}</p>
              </div>
              <div className="rounded-[1.2rem] border px-4 py-3" style={{ borderColor: "rgba(16,185,129,0.28)" }}>
                <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--study-text-soft)" }}>
                  Correct
                </p>
                <p className="mt-2 text-xl font-semibold">{session.mode === "cbt" ? correctCount : averageWritingScore}</p>
              </div>
              <div className="rounded-[1.2rem] border px-4 py-3" style={{ borderColor: "rgba(239,68,68,0.28)" }}>
                <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--study-text-soft)" }}>
                  {session.mode === "cbt" ? "Wrong" : "Needs work"}
                </p>
                <p className="mt-2 text-xl font-semibold">{session.mode === "cbt" ? incorrectCount : missedQuestionIndexes.length}</p>
              </div>
              <div className="rounded-[1.2rem] border px-4 py-3" style={{ borderColor: "rgba(148,163,184,0.28)" }}>
                <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--study-text-soft)" }}>
                  Blank
                </p>
                <p className="mt-2 text-xl font-semibold">{unansweredCount}</p>
              </div>
              <div className="rounded-[1.2rem] border px-4 py-3" style={{ borderColor: "rgba(99,102,241,0.22)" }}>
                <p className="text-xs uppercase tracking-[0.14em]" style={{ color: "var(--study-text-soft)" }}>
                  Time used
                </p>
                <p className="mt-2 text-xl font-semibold">{formatTimeRemaining(timeUsedSeconds)}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setExamStage("review")}
                className="study-button rounded-full px-5 py-3 text-sm font-semibold text-white"
              >
                Review mode
              </button>
              <button
                type="button"
                onClick={resetExam}
                className="rounded-full px-5 py-3 text-sm font-semibold"
                style={{
                  border: "1px solid var(--study-border)",
                  color: "var(--study-text)",
                }}
              >
                New test
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="mt-4 inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold" style={{
              border:
                timerState === "critical"
                  ? "1px solid rgba(239,68,68,0.35)"
                  : timerState === "warning"
                    ? "1px solid rgba(245,158,11,0.35)"
                    : "1px solid var(--study-border)",
              background:
                timerState === "critical"
                  ? "rgba(239,68,68,0.14)"
                  : timerState === "warning"
                    ? "rgba(245,158,11,0.14)"
                    : "var(--study-surface-soft)",
              color:
                timerState === "critical"
                  ? "#fca5a5"
                  : timerState === "warning"
                    ? "#fcd34d"
                    : "var(--study-text)",
            }}>
              <span>{timerState === "critical" ? "Time almost up" : "Timer"}</span>
              <span>{formatTimeRemaining(timeRemainingSeconds)}</span>
            </div>

            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--study-surface-soft)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(6, Math.round(((activeQuestionIndex + 1) / session.questions.length) * 100))}%`,
                    background:
                      timerState === "critical"
                        ? "#ef4444"
                        : timerState === "warning"
                          ? "#f59e0b"
                          : "var(--study-button)",
                  }}
                />
              </div>
            </div>

            <div className="study-surface mt-5 rounded-[2rem] p-5 sm:p-7">
              {examStage === "review" ? (
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--study-text-soft)" }}>
                  Reviewing question {activeQuestionIndex + 1} of {session.questions.length}
                </p>
              ) : (
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--study-text-soft)" }}>
                  Question {activeQuestionIndex + 1} of {session.questions.length}
                </p>
              )}

              <h2 className="mt-4 text-xl font-semibold leading-8">{activeQuestion.prompt}</h2>

              {session.mode === "cbt" ? (
                <div className="mt-6 grid gap-3">
                  {activeQuestion.options.map((option) => {
                    const selected = answers[activeQuestion.id] === option;
                    const isCorrect = areAnswersEquivalent(option, activeQuestion.correctAnswer);

                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={examStage === "review"}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [activeQuestion.id]: option,
                          }))
                        }
                        className="rounded-[1.3rem] border px-4 py-4 text-left text-sm transition"
                        style={{
                          borderColor: selected ? "var(--study-button)" : "var(--study-border)",
                          background:
                            examStage === "review" && isCorrect
                              ? "rgba(16,185,129,0.16)"
                              : selected
                                ? "var(--study-surface-soft)"
                                : "transparent",
                          color: "var(--study-text)",
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  value={answers[activeQuestion.id] ?? ""}
                  disabled={examStage === "review"}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [activeQuestion.id]: event.target.value,
                    }))
                  }
                  placeholder="Type your answer here like a real theory exam..."
                  className="mt-6 min-h-40 w-full resize-none rounded-[1.5rem] border bg-transparent px-4 py-4 text-sm leading-7 outline-none sm:min-h-56"
                  style={{
                    borderColor: "var(--study-border)",
                    color: "var(--study-text)",
                  }}
                />
              )}

              {examStage === "review" ? (
                <div className="mt-6 rounded-[1.5rem] border p-4 text-sm leading-7" style={{ borderColor: "var(--study-border)" }}>
                  {session.mode === "writing" && writingReview ? (
                    <div className="space-y-4">
                      <p className="font-semibold">Estimated mark: {writingReview.score} / 10</p>
                      <p className="rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--study-surface-soft)", color: "var(--study-text)" }}>
                        {writingReview.verdict}
                      </p>
                      <div>
                        <p className="font-semibold">Your answer</p>
                        <p className="mt-2 whitespace-pre-wrap" style={{ color: "var(--study-text-muted)" }}>
                          {answers[activeQuestion.id]?.trim() || "No answer submitted."}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold">Model answer</p>
                        <p className="mt-2 whitespace-pre-wrap" style={{ color: "var(--study-text-muted)" }}>
                          {activeQuestion.correctAnswer}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold">Marking guide</p>
                        <p className="mt-2 whitespace-pre-wrap" style={{ color: "var(--study-text-muted)" }}>
                          {activeQuestion.explanation}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="font-semibold">Your answer: {answers[activeQuestion.id] || "No answer selected"}</p>
                      <p className="font-semibold">Correct answer: {activeQuestion.correctAnswer}</p>
                      <p style={{ color: "var(--study-text-muted)" }}>{activeQuestion.explanation}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-8">
              {session.questions.map((question, index) => {
                const isActive = index === activeQuestionIndex;
                const isAnswered = Boolean(answers[question.id]?.trim());
                const isCorrectAfterSubmit =
                  hasSubmitted &&
                  (session.mode === "writing"
                    ? estimateWritingScore(
                        answers[question.id] ?? "",
                        question.correctAnswer || question.explanation,
                      ) >= 7
                    : areAnswersEquivalent(
                        answers[question.id] ?? "",
                        question.correctAnswer,
                      ));
                const isWrongAfterSubmit = hasSubmitted && isAnswered && !isCorrectAfterSubmit;

                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => setActiveQuestionIndex(index)}
                    className="h-10 rounded-xl text-xs font-semibold"
                    style={{
                      background: isActive
                        ? "var(--study-button)"
                        : isCorrectAfterSubmit
                          ? "rgba(16,185,129,0.16)"
                          : isWrongAfterSubmit
                            ? "rgba(239,68,68,0.14)"
                            : isAnswered
                              ? "var(--study-surface-soft)"
                              : "transparent",
                      border: "1px solid var(--study-border)",
                      color: isActive ? "#ffffff" : "var(--study-text)",
                    }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setActiveQuestionIndex((current) => Math.max(0, current - 1))}
                disabled={activeQuestionIndex === 0}
                className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{
                  border: "1px solid var(--study-border)",
                  color: "var(--study-text)",
                }}
              >
                Previous
              </button>

              {examStage === "review" ? (
                <button
                  type="button"
                  onClick={resetExam}
                  className="study-button rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                >
                  New test
                </button>
              ) : activeQuestionIndex === session.questions.length - 1 ? (
                <button
                  type="button"
                  onClick={submitExam}
                  className="study-button rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                >
                  {timeRemainingSeconds <= 0 ? "Submitting..." : "Submit test"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setActiveQuestionIndex((current) =>
                      Math.min(session.questions.length - 1, current + 1),
                    )
                  }
                  className="rounded-full px-4 py-2.5 text-sm font-semibold"
                  style={{
                    border: "1px solid var(--study-border)",
                    color: "var(--study-text)",
                  }}
                >
                  Next
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
