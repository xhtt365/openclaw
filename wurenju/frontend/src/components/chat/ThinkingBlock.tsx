"use client";

import { useState } from "react";

interface ThinkingBlockProps {
  thinking: string;
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!thinking.trim()) {
    return null;
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => {
          setExpanded((current) => !current);
        }}
        className="text-left text-xs italic transition-opacity duration-150 hover:opacity-80"
        style={{ color: "var(--text-secondary)" }}
      >
        💭 思考过程（点击{expanded ? "收起" : "展开"}）
      </button>

      {expanded ? (
        <div
          className="mt-2 rounded-xl px-3 py-2 text-xs leading-6 whitespace-pre-wrap"
          style={{
            backgroundColor: "rgba(148,163,184,0.12)",
            color: "var(--text-secondary)",
            border: "1px solid rgba(148,163,184,0.2)",
          }}
        >
          {thinking}
        </div>
      ) : null}
    </div>
  );
}
