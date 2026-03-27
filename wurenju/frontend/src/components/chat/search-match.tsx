// 复制自 openclaw 原版 ui/src/ui/chat/search-match.ts，用于二开定制

import { Fragment, cloneElement, isValidElement, type ReactNode } from "react";

const SEARCH_MARK_CLASSNAME = "chat-search-mark";

function splitHighlightedText(text: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return text;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  if (!lowerText.includes(lowerQuery)) {
    return text;
  }

  const parts: ReactNode[] = [];
  let startIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex >= 0) {
    if (matchIndex > startIndex) {
      parts.push(text.slice(startIndex, matchIndex));
    }

    const matchedText = text.slice(matchIndex, matchIndex + normalizedQuery.length);
    parts.push(
      <mark key={`${matchIndex}-${matchedText}`} className={SEARCH_MARK_CLASSNAME}>
        {matchedText}
      </mark>,
    );

    startIndex = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, startIndex);
  }

  if (startIndex < text.length) {
    parts.push(text.slice(startIndex));
  }

  return parts;
}

export function messageMatchesSearchQuery(text: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  return text.toLowerCase().includes(normalizedQuery);
}

export function highlightPlainText(text: string, query: string) {
  const highlighted = splitHighlightedText(text, query);
  if (typeof highlighted === "string") {
    return highlighted;
  }

  return highlighted.map((part, index) => {
    if (typeof part === "string") {
      return <Fragment key={`text-${index}`}>{part}</Fragment>;
    }

    return part;
  });
}

export function highlightReactChildren(children: ReactNode, query: string): ReactNode {
  if (!query.trim()) {
    return children;
  }

  if (typeof children === "string") {
    return highlightPlainText(children, query);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => {
      const nextChild = highlightReactChildren(child, query);
      if (typeof nextChild === "string") {
        return <Fragment key={`child-${index}`}>{nextChild}</Fragment>;
      }

      if (Array.isArray(nextChild)) {
        return <Fragment key={`child-array-${index}`}>{nextChild}</Fragment>;
      }

      return <Fragment key={`child-node-${index}`}>{nextChild}</Fragment>;
    });
  }

  if (isValidElement<{ children?: ReactNode }>(children)) {
    const nextChildren = highlightReactChildren(children.props.children, query);
    return cloneElement(children, undefined, nextChildren);
  }

  return children;
}
