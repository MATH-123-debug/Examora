import { checkRateLimit, MAX_PDF_REQUESTS } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE_SIZE = 12 * 1024 * 1024;

GlobalWorkerOptions.workerSrc = pathToFileURL(
  join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
).href;

async function extractPdfText(arrayBuffer: ArrayBuffer) {
  const documentParams = {
    data: new Uint8Array(arrayBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  } as unknown as Parameters<typeof getDocument>[0];

  const loadingTask = getDocument(documentParams);

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => {
        if ("str" in item && typeof item.str === "string") {
          return item.str;
        }

        return "";
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
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(arrayBuffer),
  });

  return {
    text: result.value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function getFileKind(file: File) {
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
  const isDocx =
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx");

  return { isPdf, isDocx };
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
      return NextResponse.json(
        { error: "A file is required." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "This file is too large. Upload a PDF or DOCX under 12MB." },
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
              "This PDF has little or no selectable text. It is likely scanned or image-heavy, and this version of Examora does not run OCR yet. Try a text-based PDF or convert it to DOCX first.",
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
          {
            error:
              "This Word document did not return readable text. Try another .docx file.",
          },
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
      { error: "Only PDF and DOCX files are supported right now." },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process the file.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
