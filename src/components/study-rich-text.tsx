"use client";

import katex from "katex";

type StudyRichTextProps = {
  className?: string;
  theme: "light" | "dark";
  value: string;
};

type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string };

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

function compactForComparison(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function normalizeBrokenBlock(block: string) {
  const rawLines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return block.trim();
  }

  const singleCharacterLines = rawLines.filter(
    (line) => line.length === 1 || (line.length === 2 && /[.,:;!?]/.test(line[1] ?? "")),
  );

  if (singleCharacterLines.length < 8 || singleCharacterLines.length < rawLines.length * 0.6) {
    return rawLines.join("\n");
  }

  const rebuilt = singleCharacterLines.join("");
  const uniqueLines: string[] = [];

  for (const line of rawLines) {
    const normalizedLine = compactForComparison(line);

    if (!normalizedLine) {
      continue;
    }

    const duplicatesExisting = uniqueLines.some(
      (existing) => compactForComparison(existing) === normalizedLine,
    );

    if (!duplicatesExisting) {
      uniqueLines.push(line);
    }
  }

  const hasEquivalentReadableLine = uniqueLines.some(
    (line) => compactForComparison(line) === compactForComparison(rebuilt),
  );

  if (hasEquivalentReadableLine) {
    return uniqueLines.join("\n");
  }

  return [rebuilt, ...uniqueLines].join("\n");
}

function hasDisplayMathDelimiters(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("$$") && trimmed.endsWith("$$");
}

function looksLikeFormulaOnlyLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  const wordGroups = trimmed.match(/[A-Za-z]{3,}/g) ?? [];
  const equationLikeCharacters = /^[A-Za-z0-9\s\\^_{}()+\-*/=.,:;∂π√≤≥∞[\]|]+$/;
  const hasEquationSignal =
    trimmed.includes("=") ||
    trimmed.includes("^") ||
    trimmed.includes("∫") ||
    trimmed.includes("√") ||
    trimmed.includes("π") ||
    trimmed.includes("dy/dx") ||
    trimmed.includes("d/dx") ||
    trimmed.includes("\\frac") ||
    trimmed.includes("\\sqrt") ||
    trimmed.includes("\\int") ||
    /[a-z]\([^)]+\)/i.test(trimmed);

  return hasEquationSignal && equationLikeCharacters.test(trimmed) && wordGroups.length <= 2;
}

function renderMath(latex: string, displayMode: boolean) {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch {
    return null;
  }
}

function parseInlineMath(value: string) {
  const segments: InlineSegment[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+\$)/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    const token = match[0];

    if (index > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, index) });
    }

    if (token.startsWith("$$") && token.endsWith("$$")) {
      segments.push({ kind: "math", value: token.slice(2, -2).trim() });
    } else if (token.startsWith("$") && token.endsWith("$")) {
      segments.push({ kind: "math", value: token.slice(1, -1).trim() });
    }

    cursor = index + token.length;
  }

  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) });
  }

  return segments;
}

function renderInlineSegments(value: string, keyPrefix: string) {
  return parseInlineMath(value).map((segment, index) => {
    if (segment.kind === "text") {
      return (
        <span key={`${keyPrefix}-text-${index}`} className="whitespace-pre-wrap">
          {segment.value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1")}
        </span>
      );
    }

    const mathMarkup = renderMath(segment.value, false);

    if (!mathMarkup) {
      return (
        <span key={`${keyPrefix}-fallback-${index}`} className="whitespace-pre-wrap">
          {segment.value}
        </span>
      );
    }

    return (
      <span
        key={`${keyPrefix}-math-${index}`}
        className="mx-0.5 inline-block max-w-full align-middle"
        dangerouslySetInnerHTML={{ __html: mathMarkup }}
      />
    );
  });
}

function isHeadingLine(line: string) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s+/.test(trimmed) ||
    /^\*\*[^*]+:\*\*$/.test(trimmed) ||
    /^[A-Z][A-Za-z0-9\s/&()-]{2,}:$/.test(trimmed)
  );
}

function isBulletLine(line: string) {
  return /^[-*]\s+/.test(line.trim());
}

function renderBulletLine(line: string, key: string) {
  const content = stripMarkdown(line.trim().replace(/^[-*]\s+/, ""));
  const labelMatch = content.match(/^([^:]{2,48}):\s*(.+)$/);

  return (
    <li key={key} className="flex gap-3 leading-7">
      <span
        className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: "var(--study-text-soft)" }}
      />
      <span>
        {labelMatch ? (
          <>
            <span style={{ color: "var(--study-text)" }} className="font-semibold">
              {labelMatch[1]}:
            </span>{" "}
            {renderInlineSegments(labelMatch[2], `${key}-inline`)}
          </>
        ) : (
          renderInlineSegments(content, `${key}-inline`)
        )}
      </span>
    </li>
  );
}

export function StudyRichText({
  className = "",
  theme,
  value,
}: StudyRichTextProps) {
  const blocks = value
    .split(/\n{2,}/)
    .map((block) => normalizeBrokenBlock(block))
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.trim().length > 0);

        const isDisplayMathBlock =
          lines.length > 0 && lines.every((line) => hasDisplayMathDelimiters(line));

        if (isDisplayMathBlock) {
          return (
            <div
              key={`display-${blockIndex}`}
              className="space-y-2 overflow-x-auto rounded-[1.2rem] px-4 py-3"
              style={{
                background:
                  theme === "dark"
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(79,70,229,0.08)",
                color: "var(--study-text)",
              }}
            >
              {lines.map((line, lineIndex) => {
                const latex = line.trim().slice(2, -2).trim();
                const mathMarkup = renderMath(latex, true);

                if (!mathMarkup) {
                  return (
                    <div
                      key={`display-fallback-${blockIndex}-${lineIndex}`}
                      className="font-mono text-[13px] leading-7 sm:text-sm"
                    >
                      {line}
                    </div>
                  );
                }

                return (
                  <div
                    key={`display-math-${blockIndex}-${lineIndex}`}
                    className="overflow-x-auto"
                    dangerouslySetInnerHTML={{ __html: mathMarkup }}
                  />
                );
              })}
            </div>
          );
        }

        const isFormulaOnlyBlock =
          lines.length > 0 && lines.every((line) => looksLikeFormulaOnlyLine(line));

        if (isFormulaOnlyBlock) {
          return (
            <div
              key={`formula-${blockIndex}`}
              className="space-y-2 overflow-x-auto rounded-[1.2rem] px-4 py-3 font-mono text-[13px] leading-7 sm:text-sm"
              style={{
                background:
                  theme === "dark"
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(79,70,229,0.08)",
                color: "var(--study-text)",
              }}
            >
              {lines.map((line, lineIndex) => (
                <div key={`formula-line-${blockIndex}-${lineIndex}`}>{line}</div>
              ))}
            </div>
          );
        }

        if (lines.length > 1 && lines.every((line) => isBulletLine(line))) {
          return (
            <ul key={`bullets-${blockIndex}`} className="space-y-2">
              {lines.map((line, lineIndex) =>
                renderBulletLine(line, `bullet-${blockIndex}-${lineIndex}`),
              )}
            </ul>
          );
        }

        if (lines.length > 1 && isHeadingLine(lines[0])) {
          const heading = stripMarkdown(lines[0]).replace(/:$/, "");
          const bodyLines = lines.slice(1);
          const bulletLines = bodyLines.filter(isBulletLine);
          const nonBulletLines = bodyLines.filter((line) => !isBulletLine(line));

          return (
            <section
              key={`section-${blockIndex}`}
              className="rounded-[1.2rem] px-4 py-3"
              style={{ background: "var(--study-math-surface)" }}
            >
              <h3
                className="text-sm font-semibold tracking-[-0.01em]"
                style={{ color: "var(--study-text)" }}
              >
                {heading}
              </h3>
              {nonBulletLines.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {nonBulletLines.map((line, lineIndex) => (
                    <p key={`section-p-${blockIndex}-${lineIndex}`} className="leading-7">
                      {renderInlineSegments(stripMarkdown(line), `section-${blockIndex}-${lineIndex}`)}
                    </p>
                  ))}
                </div>
              ) : null}
              {bulletLines.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {bulletLines.map((line, lineIndex) =>
                    renderBulletLine(line, `section-bullet-${blockIndex}-${lineIndex}`),
                  )}
                </ul>
              ) : null}
            </section>
          );
        }

        if (lines.length === 1 && isHeadingLine(lines[0])) {
          return (
            <h3
              key={`heading-${blockIndex}`}
              className="text-sm font-semibold tracking-[-0.01em]"
              style={{ color: "var(--study-text)" }}
            >
              {stripMarkdown(lines[0]).replace(/:$/, "")}
            </h3>
          );
        }

        return (
          <p key={`paragraph-${blockIndex}`} className="leading-7">
            {renderInlineSegments(stripMarkdown(block), `inline-${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}
