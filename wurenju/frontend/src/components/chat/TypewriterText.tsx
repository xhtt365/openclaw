"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightReactChildren } from "@/components/chat/messageSearch";
import { cn } from "@/lib/utils";

interface TypewriterTextProps {
  content: string;
  animate?: boolean;
  speed?: number;
  className?: string;
  onComplete?: () => void;
  highlightQuery?: string;
}

export function TypewriterText({
  content,
  animate = false,
  speed = 20,
  className,
  onComplete,
  highlightQuery = "",
}: TypewriterTextProps) {
  const [typedLength, setTypedLength] = useState(0);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!animate) {
      return;
    }

    if (!content) {
      onCompleteRef.current?.();
      return;
    }

    let index = 0;

    const timer = window.setInterval(() => {
      index += 1;
      setTypedLength(index);

      if (index >= content.length) {
        window.clearInterval(timer);
        onCompleteRef.current?.();
      }
    }, speed);

    return () => {
      window.clearInterval(timer);
    };
  }, [animate, content, speed]);

  const displayedText = animate ? content.slice(0, typedLength) : content;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {highlightReactChildren(children, highlightQuery)}
            </p>
          ),
          ul: ({ ...props }) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
          ol: ({ ...props }) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {highlightReactChildren(children, highlightQuery)}
            </li>
          ),
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer noopener"
            >
              {highlightReactChildren(children, highlightQuery)}
            </a>
          ),
          pre: ({ children, ...props }) => (
            <pre
              className="my-2 overflow-x-auto rounded-md bg-[var(--color-bg-code-block)] p-2 text-[0.9em]"
              {...props}
            >
              {highlightReactChildren(children, highlightQuery)}
            </pre>
          ),
          code: ({ children, className: codeClassName, ...props }) => (
            <code
              className={cn(
                "rounded px-1 py-0.5 text-[0.9em]",
                codeClassName ? "bg-transparent px-0 py-0" : "bg-[var(--color-bg-code)]",
              )}
              {...props}
            >
              {highlightReactChildren(children, highlightQuery)}
            </code>
          ),
        }}
      >
        {displayedText}
      </ReactMarkdown>
    </div>
  );
}
