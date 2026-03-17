// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/markdown.ts，用于二开定制

import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { truncateText } from "./format.ts";

const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const INLINE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const markdownCache = new Map<string, string>();

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }

  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

function renderEscapedPlainTextHtml(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  return renderToStaticMarkup(
    createElement(
      "div",
      { className: "markdown-plain-text-fallback" },
      lines.map((line, index) =>
        createElement(
          Fragment,
          { key: `${index}:${line}` },
          index > 0 ? createElement("br") : null,
          line,
        ),
      ),
    ),
  );
}

function renderMarkdownHtml(value: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          a: ({ children, ...props }) =>
            createElement(
              "a",
              {
                ...props,
                rel: "noreferrer noopener",
                target: "_blank",
              },
              children,
            ),
          img: ({ alt, src }) => {
            const resolvedSrc = typeof src === "string" ? src.trim() : "";
            if (!INLINE_DATA_IMAGE_RE.test(resolvedSrc)) {
              return createElement("span", null, alt?.trim() || "image");
            }
            return createElement("img", {
              className: "markdown-inline-image",
              src: resolvedSrc,
              alt: alt?.trim() || "image",
            });
          },
          pre: ({ children }) => createElement(Fragment, null, children),
          code: ({ children, className }) => {
            const text = (
              Array.isArray(children)
                ? children
                    .map((child) =>
                      typeof child === "string" || typeof child === "number" ? String(child) : "",
                    )
                    .join("")
                : typeof children === "string" || typeof children === "number"
                  ? String(children)
                  : ""
            ).replace(/\n$/, "");
            const language = className?.replace(/^language-/, "").trim() ?? "";
            const isBlock = Boolean(language || text.includes("\n"));

            if (!isBlock) {
              return createElement("code", { className }, text);
            }

            const copyButton = createElement(
              "button",
              {
                type: "button",
                className: "code-block-copy",
                "data-code": text,
                "aria-label": "Copy code",
              },
              createElement("span", { className: "code-block-copy__idle" }, "Copy"),
              createElement("span", { className: "code-block-copy__done" }, "Copied!"),
            );
            const header = createElement(
              "div",
              { className: "code-block-header" },
              language
                ? createElement("span", { className: "code-block-lang" }, language)
                : createElement("span", { className: "code-block-lang" }),
              copyButton,
            );
            const codeElement = createElement(
              "pre",
              null,
              createElement(
                "code",
                { className: language ? `language-${language}` : undefined },
                text,
              ),
            );

            const trimmed = text.trim();
            const isJson =
              language === "json" ||
              (!language &&
                ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                  (trimmed.startsWith("[") && trimmed.endsWith("]"))));

            if (isJson) {
              const lineCount = text.split("\n").length;
              const label = lineCount > 1 ? `JSON · ${lineCount} lines` : "JSON";
              return createElement(
                "details",
                { className: "json-collapse" },
                createElement("summary", null, label),
                createElement("div", { className: "code-block-wrapper" }, header, codeElement),
              );
            }

            return createElement("div", { className: "code-block-wrapper" }, header, codeElement);
          },
        },
      },
      value,
    ),
  );
}

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return "";
  }

  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }

  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  const source = `${truncated.text}${suffix}`;
  const rendered =
    source.length > MARKDOWN_PARSE_LIMIT
      ? renderEscapedPlainTextHtml(source)
      : renderMarkdownHtml(source);

  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, rendered);
  }

  return rendered;
}
