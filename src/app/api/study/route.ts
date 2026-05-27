import { checkRateLimit, MAX_STUDY_REQUESTS } from "@/lib/rate-limit";
import OpenAI from "openai";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { CohereClient } from "cohere-ai";
import { Mistral } from "@mistralai/mistralai";
import Together from "together-ai";
import { NextResponse } from "next/server";

const actionPrompts = {
  summarize:
    "Return a clean study summary with the key ideas the student should understand first.",
  quick_revision:
    "Return fast revision points the student can quickly scan before a quiz or exam.",
  explain_like_lecturer:
    "Answer the student's latest question directly, clearly, and in a teacher-like way. Start with the direct answer first, then teach the idea smoothly with enough detail, examples when helpful, and a readable flow.",
  step_by_step:
    "Teach or solve the latest request in clear progressive steps so the student can follow without confusion. For maths or calculations, show the setup, the working, and the final answer clearly.",
  generate_questions:
    "Generate a practice-focused response with multiple-choice questions that help the student test understanding from the material.",
} as const;

const inputLabels = {
  pdf: "PDF",
  topic: "Topic",
  outline: "Outline",
  text: "Text",
} as const;

type StudyAction = keyof typeof actionPrompts;
type InputType = keyof typeof inputLabels;

type GeneratedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type QuestionType = "cbt" | "writing";

type MathSolution = {
  given: string;
  method: string;
  steps: string[];
  finalAnswer: string;
  whyItWorks: string;
};

type StudyContextPayload = {
  currentTopic?: string;
  rollingSummary?: string;
  lastAssistantSummary?: string;
  documentLesson?: {
    topics?: string[];
    currentIndex?: number;
  };
  recentMessages?: Array<{
    role?: "user" | "assistant";
    content?: string;
  }>;
};

type ConversationHistoryItem = {
  role?: "user" | "assistant";
  content?: string;
};

type StudyResponse = {
  title: string;
  summary: string;
  bullets: string[];
  questions: GeneratedQuestion[];
  mathSolution?: MathSolution;
  action: StudyAction;
  inputType: InputType;
  provider: string;
};

const MAX_CONTENT_CHARS = 10000;
const PDF_HEAD_CHARS = 7000;
const PDF_TAIL_CHARS = 2200;
const MAX_HISTORY_CHARS = 7000;
const MAX_HISTORY_ITEM_CHARS = 700;
const TUTOR_TEMPERATURE = 0.8;
const MAX_OUTPUT_TOKENS = 3200;

function getModel(envName: string, fallback: string) {
  const value = process.env[envName]?.trim();
  return value || fallback;
}

const AI_MODELS = {
  openai: getModel("OPENAI_MODEL", "gpt-4o-mini"),
  groq: getModel("GROQ_MODEL", "llama-3.1-8b-instant"),
  gemini: getModel("GEMINI_MODEL", "gemini-2.0-flash"),
  mistral: getModel("MISTRAL_MODEL", "mistral-small-latest"),
  cohere: getModel("COHERE_MODEL", "command-r-08-2024"),
  together: getModel("TOGETHER_MODEL", "meta-llama/Llama-3-8b-chat-hf"),
};

const SYSTEM_PROMPT =
  "You are Examora, an AI study assistant for university students. Always respond with valid JSON matching this exact shape: { \"title\": string, \"summary\": string, \"bullets\": string[], \"questions\": Array<{ \"prompt\": string, \"options\": string[], \"correctAnswer\": string, \"explanation\": string }> }. Keep the title short, keep the summary useful, and make every bullet practical for exam preparation. Only include questions when the action is generate_questions — for all other actions return an empty questions array.";

const STUDY_SYSTEM_PROMPT =
  "You are StudyMate, an advanced AI tutor and learning companion for university students. Always respond with valid JSON matching this exact shape: { \"title\": string, \"summary\": string, \"bullets\": string[], \"questions\": Array<{ \"prompt\": string, \"options\": string[], \"correctAnswer\": string, \"explanation\": string }>, \"mathSolution\": { \"given\": string, \"method\": string, \"steps\": string[], \"finalAnswer\": string, \"whyItWorks\": string } | null }. Your job is not merely to answer, but to teach, guide, mentor, and engage students in meaningful conversations. Understand intent even when grammar, spelling, punctuation, or wording is poor. Infer likely meaning naturally without calling attention to mistakes unless correction genuinely helps learning. Answer directly first, then teach the reasoning. Break difficult ideas into simple steps, use examples whenever useful, use analogies for hard concepts, highlight key ideas, anticipate confusion points, and encourage understanding over memorization. Keep a natural tutor voice: conversational, patient, clear, and helpful, never robotic or overly brief. Never return only a tiny summary unless the student explicitly asked for one. Maintain continuity with the conversation history and build on the student's previous question when relevant. In normal tutor answers, let summary carry the main explanation in rich paragraphs with readable structure. Use bullets only when they truly improve learning, such as key points, memory tricks, examples, mistakes to avoid, or revision lists. When appropriate, include real-world applications, common mistakes, memory tricks, or a small practice check. When useful, end the explanation with one thoughtful follow-up question that keeps learning moving. For direct follow-ups like 'give example', 'continue', 'simplify it', or 'explain more', stay on the same topic and continue naturally instead of restarting. For mathematical, scientific, coding, accounting, economics, and logical questions, show reasoning step by step, explain why each step is taken, do not skip important steps, and verify the final answer before presenting it. When math-solving is needed, fill mathSolution clearly; otherwise set mathSolution to null. Never split formulas or words character by character. Do not switch into quiz or question-generation mode unless the student explicitly asks for practice, quiz, MCQ, CBT, exam, or generated questions. For normal tutor answers, keep title minimal or empty if a heading is not needed. For CBT questions, include four options. For writing/theory questions, use an empty options array, put the model answer in correctAnswer, and put the marking guide in explanation. Only include questions when the action is generate_questions; for all other actions return an empty questions array.";

void SYSTEM_PROMPT;

function isStudyAction(value: unknown): value is StudyAction {
  return typeof value === "string" && value in actionPrompts;
}

function isInputType(value: unknown): value is InputType {
  return typeof value === "string" && value in inputLabels;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function trimStudyContent(content: string, inputType: InputType) {
  const normalized =
    inputType === "outline"
      ? content
          .replace(/\r/g, "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n")
      : compactWhitespace(content);

  if (normalized.length <= MAX_CONTENT_CHARS) {
    return { content: normalized, shortened: false };
  }

  if (inputType === "pdf") {
    const head = normalized.slice(0, PDF_HEAD_CHARS).trim();
    const tail = normalized.slice(-PDF_TAIL_CHARS).trim();
    return {
      content: `${head}\n\n[Middle section omitted to fit the model limit]\n\n${tail}`,
      shortened: true,
    };
  }

  return {
    content: `${normalized.slice(0, MAX_CONTENT_CHARS).trim()}\n\n[Content trimmed to fit the model limit]`,
    shortened: true,
  };
}

function trimHistoryText(value: string) {
  const compact = compactWhitespace(value);

  if (compact.length <= MAX_HISTORY_ITEM_CHARS) {
    return compact;
  }

  return `${compact.slice(0, MAX_HISTORY_ITEM_CHARS).trim()}...`;
}

function buildConversationHistoryText(history: ConversationHistoryItem[]) {
  if (!Array.isArray(history) || history.length === 0) {
    return "None";
  }

  const formatted = history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0,
    )
    .map((item) => ({
      role: item.role === "user" ? "Student" : "StudyMate",
      content: trimHistoryText(item.content ?? ""),
    }));

  if (formatted.length === 0) {
    return "None";
  }

  const totalLength = formatted.reduce(
    (sum, item) => sum + item.content.length + item.role.length + 4,
    0,
  );
  const selected = totalLength <= MAX_HISTORY_CHARS ? formatted : formatted.slice(-12);

  return selected.map((item) => `${item.role}: ${item.content}`).join("\n\n");
}

function getMathTopicInstruction(content: string) {
  const normalized = content.toLowerCase();

  if (normalized.includes("exact differential")) {
    return "Exact differential equation mode: for each example, explicitly write M(x,y) and N(x,y), compute ∂M/∂y and ∂N/∂x, show they are equal, integrate M with respect to x, introduce the unknown function of y, differentiate the potential with respect to y, compare with N, solve for the missing function, then state the implicit solution f(x,y)=C. Each example must be fully solved from start to finish.";
  }

  if (normalized.includes("differentiate") || normalized.includes("derivative") || normalized.includes("d/dx") || normalized.includes("dy/dx")) {
    return "Differentiation mode: identify the rule being used, show the derivative step by step, simplify the expression cleanly, and clearly state the final derivative.";
  }

  if (normalized.includes("integrate") || normalized.includes("integral")) {
    return "Integration mode: identify the integration rule or substitution method, show each algebraic step in order, simplify carefully, and include the constant of integration when appropriate.";
  }

  if (normalized.includes("matrix")) {
    return "Matrix mode: show the matrix operation clearly row by row or element by element, explain the rule being applied, and present the final matrix cleanly.";
  }

  if (normalized.includes("probability") || normalized.includes("statistics")) {
    return "Statistics mode: define the formula being used, substitute the known values, compute carefully step by step, and interpret the final answer briefly.";
  }

  return "General math mode: solve carefully, show the working, explain why each step is taken, and present the final answer clearly.";
}

function getOrderedProviders(mathMode: boolean, interactiveTeaching: boolean) {
  if (mathMode) {
    return [
      providers.find((provider) => provider.name === "openai"),
      providers.find((provider) => provider.name === "gemini"),
      providers.find((provider) => provider.name === "mistral"),
      providers.find((provider) => provider.name === "groq"),
      providers.find((provider) => provider.name === "cohere"),
      providers.find((provider) => provider.name === "together"),
    ].filter((provider): provider is (typeof providers)[number] => Boolean(provider));
  }

  if (interactiveTeaching) {
    return [
      providers.find((provider) => provider.name === "openai"),
      providers.find((provider) => provider.name === "gemini"),
      providers.find((provider) => provider.name === "groq"),
      providers.find((provider) => provider.name === "mistral"),
      providers.find((provider) => provider.name === "cohere"),
      providers.find((provider) => provider.name === "together"),
    ].filter((provider): provider is (typeof providers)[number] => Boolean(provider));
  }

  return providers;
}

function wantsDocumentLesson(prompt: string) {
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

function buildUserPrompt(
  inputType: InputType,
  action: StudyAction,
  content: string,
  shortened: boolean,
  questionCount: number,
  questionType: QuestionType,
  context: StudyContextPayload | null,
  conversationHistory: ConversationHistoryItem[],
  latestPrompt: string,
  documentTopicTarget: string,
  followUp: boolean,
  mathMode: boolean,
  interactiveTeaching: boolean,
) {
  const outlineInstruction =
    inputType === "outline"
      ? "Use all the topics listed in the outline. Spread the response or generated questions across the outline instead of focusing on only one topic."
      : "";
  const solvingInstruction =
    action === "step_by_step"
      ? "Solving mode: treat this like a tutor-led solution. If it is a maths, science, or accounting-style problem, show the method in order: what is given, what to do first, each step, then the final answer. If the student asked for another example, solve one fresh example instead of generating practice questions."
      : "";
  const explainInstruction =
    action === "explain_like_lecturer"
      ? "Teaching mode: explain naturally, follow the student's flow, and if the student says continue or give example, stay on the same topic and build from the last answer."
      : "";
  const mathInstruction = mathMode
    ? "Math mode: this is a mathematical or calculation-style request. Solve it properly instead of speaking vaguely. Show the method clearly, include the formulas used, show each necessary step in order, and end with a clear final answer. Do not skip working. If the student asks for two or more examples, separate them clearly as Example 1, Example 2, and so on. Each example must be one complete worked solution in one mathSolution.steps item. For exact differential equations, each example must include: the equation M(x,y)dx + N(x,y)dy = 0, identify M and N, compute partial derivatives, verify exactness, integrate M with respect to x, differentiate the potential with respect to y, compare with N to find the missing function, then state the implicit solution f(x,y)=C. Do not repeat the same example heading in separate steps."
    : "";
  const mathTopicInstruction = mathMode ? getMathTopicInstruction(content) : "";
  const fileInstruction =
    inputType === "pdf"
      ? "Attached-file mode: the student uploaded notes or a document. Use the attached content as the main source. Read it like lesson material, not just raw notes. Detect headings, numbered topics, sections, chapters, or natural sub-topics where possible. If the student asks to explain a topic, teach it from the file in a smooth tutor style: start with the core idea, break down the important sub-points, connect them together, give a simple example if useful, and end with a short exam-focused takeaway. Do not give a tiny answer unless the student explicitly asks for a short answer. Do not simply repeat previous answers."
      : "";
  const documentTopicInstruction =
    inputType === "pdf" && documentTopicTarget
      ? `Requested document focus: ${documentTopicTarget}. Find that exact numbered topic, section, chapter, or the closest matching heading in the uploaded material. Teach only that part first. At the end, ask whether to continue to the next topic or stay on this one for more explanation.`
      : inputType === "pdf" && interactiveTeaching
        ? "Document lesson flow: if this is the first lesson turn, identify the first natural topic or heading in the uploaded material and teach only that part first. Do not try to teach the whole file at once."
        : "";
  const documentLessonTopics = Array.isArray(context?.documentLesson?.topics)
    ? context.documentLesson.topics
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, 24)
    : [];
  const documentLessonIndex =
    typeof context?.documentLesson?.currentIndex === "number" &&
    Number.isFinite(context.documentLesson.currentIndex)
      ? Math.max(0, Math.round(context.documentLesson.currentIndex))
      : 0;
  const documentLessonStateInstruction =
    inputType === "pdf" && documentLessonTopics.length > 0
      ? `Detected document topics in order:\n${documentLessonTopics
          .map((topic, index) => `${index + 1}. ${topic}`)
          .join("\n")}\nCurrent document lesson pointer: topic ${Math.min(
          documentLessonIndex + 1,
          documentLessonTopics.length,
        )} - ${documentLessonTopics[Math.min(documentLessonIndex, documentLessonTopics.length - 1)]}. Use this pointer when the student says continue, next, or move on. Do not go back to an earlier topic unless the student explicitly asks.`
      : "";
  const interactiveInstruction = interactiveTeaching
    ? "Interactive teaching mode: the student asked to be taught step by step and checked before moving on. Do NOT summarize the whole document. If this is the first interactive teaching turn, teach only the requested topic if one was asked for; otherwise teach only the first topic or first natural section now. If the student replied yes, continue, next, or I understand, teach the next natural topic from the same material instead of repeating the previous topic. Explain clearly with enough detail, then stop and ask: 'Do you understand this part, or should I explain it another way before we continue?' Also ask whether the student wants to continue to the next topic or stay on the current topic for another example. Put the teaching in summary as smooth paragraphs. Use bullets: [] unless absolutely necessary. Wait for the student's reply before teaching another topic."
    : "";

  const recentMessages = Array.isArray(context?.recentMessages)
    ? context.recentMessages
        .filter(
          (item) =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string" &&
            item.content.trim().length > 0,
        )
        .slice(-6)
        .map(
          (item) =>
            `${item.role === "user" ? "Student" : "Examora"}: ${item.content?.trim()}`,
        )
        .join("\n\n")
    : "";
  const historyText = buildConversationHistoryText(conversationHistory);

  return `Input type: ${inputLabels[inputType]}
Action: ${action}
Instruction: ${actionPrompts[action]}
${outlineInstruction}
${solvingInstruction}
${explainInstruction}
${mathInstruction}
${mathTopicInstruction}
${fileInstruction}
${documentTopicInstruction}
${documentLessonStateInstruction}
${interactiveInstruction}
Question type: ${questionType === "writing" ? "Writing/theory questions. Do not use options. Put the model answer in correctAnswer and marking guide in explanation." : "CBT multiple-choice questions. Use four options for each question."}
Question count: ${questionCount}
${shortened ? "Note: The study material was trimmed to fit the model limit. Base your answer only on what is provided." : ""}
Current study topic: ${context?.currentTopic?.trim() || "Not set"}
Rolling memory summary: ${context?.rollingSummary?.trim() || "None"}
Last tutor answer summary: ${context?.lastAssistantSummary?.trim() || "None"}
Latest raw student prompt: ${latestPrompt.trim() || "Not provided"}
Requested document topic target: ${documentTopicTarget || "None"}
Follow-up request: ${followUp ? "Yes" : "No"}
Interactive teaching request: ${interactiveTeaching ? "Yes" : "No"}
Important behavior: Focus on the student's latest request. If older context is included only for reference and the new request is on a different topic, answer the new topic directly instead of blending them together. If the latest request is a short follow-up like 'give example', 'explain more', 'continue', or 'solve another one', continue the immediately previous topic naturally. For example follow-ups, do not repeat the whole earlier answer; give clear examples tied to the last topic. For direct questions like 'What is water?' or 'Explain inductive and deductive reasoning', make the summary a direct answer in simple educational language. For follow-up requests, act like a real tutor in the same conversation and build on the last explanation instead of starting over. If math mode is on, prefer worked solutions over general English discussion. For multiple math examples, group the solution by example, not by one long global step list. Do not switch into question-generation mode unless the student explicitly asks for questions, quiz, CBT, MCQ, practice test, or exam.

Conversation history sent with this request:
${historyText}

Recent conversation:
${recentMessages || "None"}

Latest request or study material:
${content}`;
}

function normalizeQuestions(
  payload: unknown,
  questionType: QuestionType,
): GeneratedQuestion[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item, index) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("prompt" in item) ||
        !("correctAnswer" in item) ||
        !("explanation" in item)
      ) {
        return null;
      }

      const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
      const options = Array.isArray(item.options)
        ? item.options.filter((o: unknown): o is string => typeof o === "string")
        : [];
      const correctAnswer =
        typeof item.correctAnswer === "string" ? item.correctAnswer.trim() : "";
      const explanation =
        typeof item.explanation === "string" ? item.explanation.trim() : "";

      if (
        !prompt ||
        (questionType === "cbt" && options.length < 2) ||
        !correctAnswer ||
        !explanation
      ) {
        return null;
      }

      return {
        id: `q-${index + 1}`,
        prompt,
        options: questionType === "writing" ? [] : options.slice(0, 4),
        correctAnswer,
        explanation,
      };
    })
    .filter((item): item is GeneratedQuestion => item !== null);
}

function extractJsonText(raw: string) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function buildFallbackBullets(summary: string) {
  return summary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function looksLikeMathSummary(summary: string) {
  const normalized = summary.toLowerCase();

  return (
    normalized.includes("step") ||
    normalized.includes("therefore") ||
    normalized.includes("final answer") ||
    normalized.includes("differentiate") ||
    normalized.includes("integrate") ||
    normalized.includes("equation") ||
    /[=^+\-*/]/.test(summary)
  );
}

function normalizeMathSolution(payload: unknown): MathSolution | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const value = payload as Record<string, unknown>;
  const given = typeof value.given === "string" ? value.given.trim() : "";
  const method = typeof value.method === "string" ? value.method.trim() : "";
  const steps = Array.isArray(value.steps)
    ? value.steps.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const finalAnswer =
    typeof value.finalAnswer === "string" ? value.finalAnswer.trim() : "";
  const whyItWorks =
    typeof value.whyItWorks === "string" ? value.whyItWorks.trim() : "";

  if (!given && !method && steps.length === 0 && !finalAnswer && !whyItWorks) {
    return undefined;
  }

  return {
    given,
    method,
    steps,
    finalAnswer,
    whyItWorks,
  };
}

function buildFallbackMathSolution(
  summary: string,
  bullets: string[],
): MathSolution | undefined {
  const cleanedSummary = summary.trim();
  const cleanedBullets = bullets
    .map((bullet) => bullet.trim())
    .filter(Boolean);

  if (!cleanedSummary && cleanedBullets.length === 0) {
    return undefined;
  }

  const finalAnswerMatch = cleanedSummary.match(
    /(?:final answer|therefore|thus|so)\s*[:=-]?\s*(.+)$/i,
  );
  const finalAnswer = finalAnswerMatch?.[1]?.trim() ?? "";

  return {
    given: "",
    method: "Worked solution",
    steps: cleanedBullets.length > 0 ? cleanedBullets : buildFallbackBullets(cleanedSummary),
    finalAnswer,
    whyItWorks: "",
  };
}

function parseAndNormalize(
  raw: string,
  action: StudyAction,
  inputType: InputType,
  provider: string,
  questionCount: number,
  questionType: QuestionType,
  interactiveTeaching: boolean,
  mathMode: boolean,
): StudyResponse | null {
  try {
    const cleaned = extractJsonText(raw);
    const payload = JSON.parse(cleaned);

    if (typeof payload !== "object" || payload === null) {
      return null;
    }

    const normalizedPayload = payload as Record<string, unknown>;
    const title =
      typeof normalizedPayload.title === "string"
        ? normalizedPayload.title.trim()
        : "Study response";
    let summary =
      typeof normalizedPayload.summary === "string"
        ? normalizedPayload.summary.trim()
        : typeof normalizedPayload.answer === "string"
          ? normalizedPayload.answer.trim()
          : typeof normalizedPayload.response === "string"
            ? normalizedPayload.response.trim()
            : "";
    const bullets = Array.isArray(normalizedPayload.bullets)
      ? normalizedPayload.bullets.filter((b): b is string => typeof b === "string")
      : [];
    let usableBullets =
      bullets.length > 0
        ? bullets
        : action === "step_by_step" || action === "quick_revision" || looksLikeMathSummary(summary)
          ? buildFallbackBullets(summary)
          : [];
    const questions = normalizeQuestions(normalizedPayload.questions, questionType);
    const mathSolution =
      normalizeMathSolution(normalizedPayload.mathSolution) ??
      (mathMode ? buildFallbackMathSolution(summary, usableBullets) : undefined);

    if (!summary) return null;

    if (interactiveTeaching && usableBullets.length > 0) {
      summary = [summary, ...usableBullets].join("\n\n");
      usableBullets = [];
    }

    if (interactiveTeaching) {
      summary = ensureUnderstandingCheck(summary);
    }

    return {
      title:
        action === "generate_questions" || action === "quick_revision"
          ? title
          : "",
      summary,
      bullets: usableBullets.slice(0, 5),
      questions:
        action === "generate_questions"
          ? questions.slice(0, questionCount)
          : [],
      mathSolution,
      action,
      inputType,
      provider,
    };
  } catch {
    return null;
  }
}

async function tryOpenAI(userPrompt: string, apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: AI_MODELS.openai,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    temperature: TUTOR_TEMPERATURE,
    messages: [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

async function tryGroq(userPrompt: string, apiKey: string): Promise<string> {
  const client = new Groq({ apiKey });
  const res = await client.chat.completions.create({
    model: AI_MODELS.groq,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    temperature: TUTOR_TEMPERATURE,
    messages: [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

async function tryGemini(userPrompt: string, apiKey: string): Promise<string> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: AI_MODELS.gemini,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: TUTOR_TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });
  const res = await model.generateContent(`${STUDY_SYSTEM_PROMPT}\n\n${userPrompt}`);
  return res.response.text();
}

async function tryMistral(userPrompt: string, apiKey: string): Promise<string> {
  const client = new Mistral({ apiKey });
  const res = await client.chat.complete({
    model: AI_MODELS.mistral,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: TUTOR_TEMPERATURE,
    messages: [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const content = res.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String(part.text);
        }
        return "";
      })
      .join("");
  }

  return "";
}

async function tryCohere(userPrompt: string, apiKey: string): Promise<string> {
  const client = new CohereClient({ token: apiKey });
  const res = await client.chat({
    model: AI_MODELS.cohere,
    preamble: STUDY_SYSTEM_PROMPT,
    message: userPrompt,
    temperature: TUTOR_TEMPERATURE,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  return res.text ?? "";
}

async function tryTogether(userPrompt: string, apiKey: string): Promise<string> {
  const client = new Together({ apiKey });
  const res = await client.chat.completions.create({
    model: AI_MODELS.together,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: TUTOR_TEMPERATURE,
    messages: [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  return res.choices?.[0]?.message?.content ?? "";
}

const providers: Array<{
  name: string;
  fn: (prompt: string, apiKey: string) => Promise<string>;
  key: string;
  model: string;
}> = [
  { name: "groq", fn: tryGroq, key: "GROQ_API_KEY", model: AI_MODELS.groq },
  { name: "gemini", fn: tryGemini, key: "GEMINI_API_KEY", model: AI_MODELS.gemini },
  { name: "mistral", fn: tryMistral, key: "MISTRAL_API_KEY", model: AI_MODELS.mistral },
  { name: "cohere", fn: tryCohere, key: "COHERE_API_KEY", model: AI_MODELS.cohere },
  { name: "together", fn: tryTogether, key: "TOGETHER_API_KEY", model: AI_MODELS.together },
  { name: "openai", fn: tryOpenAI, key: "OPENAI_API_KEY", model: AI_MODELS.openai },
];

function getProviderErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "provider request failed";

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]")
    .slice(0, 320);
}

function getConfiguredProviderKey(keyName: string) {
  const value = process.env[keyName]?.trim();

  if (!value) {
    return null;
  }

  const lowerValue = value.toLowerCase();

  if (
    lowerValue.includes("your_") ||
    lowerValue.includes("_key_here") ||
    lowerValue.includes("placeholder")
  ) {
    return null;
  }

  return value;
}

function isInteractiveTeachingRequest(content: string) {
  const normalized = content.toLowerCase();

  return (
    normalized.includes("after each topic") ||
    normalized.includes("before moving to the next") ||
    normalized.includes("before moving on") ||
    normalized.includes("ask if i understand") ||
    normalized.includes("ask me if i understand") ||
    normalized.includes("do you understand before") ||
    normalized.includes("one topic at a time")
  );
}

function ensureUnderstandingCheck(summary: string) {
  const normalized = summary.toLowerCase();

  if (
    normalized.includes("do you understand") ||
    normalized.includes("did you understand") ||
    normalized.includes("should i explain") ||
    normalized.includes("before we continue") ||
    normalized.includes("before moving")
  ) {
    return summary;
  }

  return `${summary.trim()}\n\nDo you understand this part, or should I explain it another way before we continue?`;
}

export async function POST(request: Request) {
  const { allowed, retryAfter } = checkRateLimit(request, MAX_STUDY_REQUESTS);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const body = await request.json();
    const action = body?.action;
    const inputType = body?.inputType;
    const rawContent =
      typeof body?.content === "string" ? body.content.trim() : "";
    const questionCount =
      typeof body?.questionCount === "number"
        ? Math.min(30, Math.max(1, Math.round(body.questionCount)))
        : 10;
    const questionType: QuestionType =
      body?.questionType === "writing" ? "writing" : "cbt";
    const context =
      typeof body?.context === "object" && body?.context !== null
        ? (body.context as StudyContextPayload)
        : null;
    const conversationHistory = Array.isArray(body?.conversationHistory)
      ? (body.conversationHistory as ConversationHistoryItem[])
      : [];
    const latestPrompt =
      typeof body?.latestPrompt === "string" ? body.latestPrompt.trim() : "";
    const documentTopicTarget =
      typeof body?.documentTopicTarget === "string"
        ? body.documentTopicTarget.trim()
        : extractDocumentTopicTarget(latestPrompt);
    const followUp = body?.followUp === true;
    const mathMode = body?.mathMode === true;
    const interactiveTeaching =
      body?.interactiveTeaching === true ||
      isInteractiveTeachingRequest(rawContent) ||
      (inputType === "pdf" && wantsDocumentLesson(latestPrompt));

    if (!isStudyAction(action)) {
      return NextResponse.json(
        { error: "A valid study action is required." },
        { status: 400 },
      );
    }

    if (!isInputType(inputType)) {
      return NextResponse.json(
        { error: "A valid input type is required." },
        { status: 400 },
      );
    }

    if (!rawContent) {
      return NextResponse.json(
        { error: "Study content is required." },
        { status: 400 },
      );
    }

    const { content, shortened } = trimStudyContent(rawContent, inputType);
    const userPrompt = buildUserPrompt(
      inputType,
      action,
      content,
      shortened,
      questionCount,
      questionType,
      context,
      conversationHistory,
      latestPrompt,
      documentTopicTarget,
      followUp,
      mathMode,
      interactiveTeaching,
    );
    const failures: string[] = [];
    const attemptedProviders: string[] = [];
    let configuredProviderCount = 0;
    const orderedProviders = getOrderedProviders(mathMode, interactiveTeaching);

    for (const provider of orderedProviders) {
      const apiKey = getConfiguredProviderKey(provider.key);

      if (!apiKey) {
        continue;
      }

      configuredProviderCount += 1;
      attemptedProviders.push(`${provider.name} (${provider.model})`);

      try {
        const raw = await provider.fn(userPrompt, apiKey);
        const parsed = parseAndNormalize(
          raw,
          action,
          inputType,
          provider.name,
          questionCount,
          questionType,
          interactiveTeaching,
          mathMode,
        );
        if (parsed) return NextResponse.json(parsed);
        failures.push(
          `${provider.name}: invalid response format from ${provider.model}`,
        );
      } catch (error) {
        failures.push(`${provider.name}: ${getProviderErrorMessage(error)}`);
        continue;
      }
    }

    if (configuredProviderCount === 0) {
      return NextResponse.json(
        {
          error:
            "No real AI provider keys are configured. Replace the placeholder values in .env.local with real API keys, then restart the dev server.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error:
          "All configured AI providers failed. Check your API keys, billing, rate limits, and model access.",
        providerErrors: failures.slice(0, 6),
        attemptedProviders,
      },
      { status: 503 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate response.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
