import { checkRateLimit, MAX_PDF_REQUESTS } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function extractPdfText(arrayBuffer: ArrayBuffer) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const workerPath = join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => {
        const it = item as Record<string, unknown>;
        return typeof it.str === "string" ? it.str : "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageText) {
      pages.push(pageText);
    }
  }

  return {
    pageCount: pdf.numPages,
    text: pages.join("\n\n").trim(),
  };
}

async function extractDocxText(arrayBuffer: ArrayBuffer) {
  const mammoth = await import("mammoth");
  const mod = mammoth as unknown as {
    extractRawText?: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
    default?: { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
  };
  const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;

  if (!extractRawText) {
    throw new Error("DOCX extraction is not available.");
  }

  const result = await extractRawText({ buffer: Buffer.from(arrayBuffer) });
  return {
    text: result.value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function getFileKind(file: File) {
  const lowerName = file.name.toLowerCase();
  return {
    isPdf: file.type === "application/pdf" || lowerName.endsWith(".pdf"),
    isDocx:
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx"),
  };
}

export async function POST(request: Request) {
  const { allowed, retryAfter } = checkRateLimit(request, MAX_PDF_REQUESTS);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File must be under 10MB." },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const { isPdf, isDocx } = getFileKind(file);

    if (isPdf) {
      const extracted = await extractPdfText(arrayBuffer);

      if (!extracted.text) {
        return NextResponse.json(
          {
            error:
              "This PDF has no selectable text. It may be scanned or image-based. Try a text-based PDF or convert to DOCX.",
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        fileName: file.name,
        fileType: "pdf",
        pageCount: extracted.pageCount,
        text: extracted.text,
      });
    }

    if (isDocx) {
      const extracted = await extractDocxText(arrayBuffer);

      if (!extracted.text) {
        return NextResponse.json(
          { error: "This Word document returned no readable text. Try another .docx file." },
          { status: 422 },
        );
      }

      return NextResponse.json({
        fileName: file.name,
        fileType: "docx",
        text: extracted.text,
      });
    }

    return NextResponse.json(
      { error: "Only PDF and DOCX files are supported." },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process the file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
