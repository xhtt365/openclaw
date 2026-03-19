"use client";

export type ArchiveTitleSeed = {
  title?: string | null;
  sourceName: string;
  archivedAt: string;
};

type HydrateArchiveTitlesOptions<T> = {
  getTitle: (archive: T) => string | null | undefined;
  getSourceName: (archive: T) => string;
  getArchivedAt: (archive: T) => string;
  setTitle: (archive: T, title: string) => T;
};

const ARCHIVE_TITLE_MAX_LENGTH = 50;
const DEFAULT_ARCHIVE_EDITABLE_TITLE = "归档";

function truncateText(value: string, maxLength = ARCHIVE_TITLE_MAX_LENGTH) {
  return Array.from(value.trim()).slice(0, maxLength).join("");
}

function resolveSafeDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date(0);
}

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeArchiveTitle(value: string | null | undefined) {
  return truncateText(value ?? "");
}

export function formatArchiveTitleDate(value: string) {
  const date = resolveSafeDate(value);
  return `${date.getFullYear()}.${padDatePart(date.getMonth() + 1)}.${padDatePart(date.getDate())}`;
}

export function formatArchiveListDate(value: string) {
  const date = resolveSafeDate(value);
  return `${padDatePart(date.getFullYear() % 100)}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
}

export function formatArchiveFileDate(value: string) {
  const date = resolveSafeDate(value);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function buildDefaultArchiveTitle(sourceName: string, archivedAt: string) {
  const safeSourceName = truncateText(sourceName) || "未命名归档";
  return `${safeSourceName} - ${formatArchiveTitleDate(archivedAt)}`;
}

export function extractArchiveEditableTitle({ title, sourceName, archivedAt }: ArchiveTitleSeed) {
  const normalizedTitle = sanitizeArchiveTitle(title);
  const safeSourceName = truncateText(sourceName) || "未命名归档";
  const listDate = formatArchiveListDate(archivedAt);
  const compositeMatcher = new RegExp(
    `^${escapeRegExp(safeSourceName)}\\s*-\\s*(.+?)\\s*-\\s*${escapeRegExp(listDate)}$`,
  );
  const compositeMatch = normalizedTitle.match(compositeMatcher);
  if (compositeMatch?.[1]) {
    return sanitizeArchiveTitle(compositeMatch[1]) || DEFAULT_ARCHIVE_EDITABLE_TITLE;
  }

  const legacyDefaultTitle = buildDefaultArchiveTitle(safeSourceName, archivedAt);
  if (normalizedTitle === legacyDefaultTitle) {
    return DEFAULT_ARCHIVE_EDITABLE_TITLE;
  }

  const legacySequenceMatch = normalizedTitle.match(
    new RegExp(`^${escapeRegExp(legacyDefaultTitle)}\\s*\\((\\d+)\\)$`),
  );
  if (legacySequenceMatch?.[1]) {
    return `${DEFAULT_ARCHIVE_EDITABLE_TITLE} (${legacySequenceMatch[1]})`;
  }

  return normalizedTitle || DEFAULT_ARCHIVE_EDITABLE_TITLE;
}

export function buildArchiveDisplayTitle({ title, sourceName, archivedAt }: ArchiveTitleSeed) {
  const safeSourceName = truncateText(sourceName) || "未命名归档";
  const editableTitle = extractArchiveEditableTitle({
    title,
    sourceName: safeSourceName,
    archivedAt,
  });
  return `${safeSourceName} - ${editableTitle} - ${formatArchiveListDate(archivedAt)}`;
}

export function resolveArchiveTitle({
  title,
  sourceName,
  archivedAt,
  siblingArchives = [],
}: ArchiveTitleSeed & {
  siblingArchives?: ArchiveTitleSeed[];
}) {
  const manualTitle = sanitizeArchiveTitle(title);
  if (manualTitle) {
    return manualTitle;
  }

  const baseTitle = buildDefaultArchiveTitle(sourceName, archivedAt);
  const sourceKey = truncateText(sourceName) || "未命名归档";
  const dateKey = formatArchiveTitleDate(archivedAt);
  const occupiedTitles = new Set(
    siblingArchives
      .filter(
        (archive) =>
          (truncateText(archive.sourceName) || "未命名归档") === sourceKey &&
          formatArchiveTitleDate(archive.archivedAt) === dateKey,
      )
      .map((archive) => sanitizeArchiveTitle(archive.title))
      .filter(Boolean),
  );

  if (!occupiedTitles.has(baseTitle)) {
    return baseTitle;
  }

  let sequence = 2;
  let nextTitle = `${baseTitle} (${sequence})`;
  while (occupiedTitles.has(nextTitle)) {
    sequence += 1;
    nextTitle = `${baseTitle} (${sequence})`;
  }

  return nextTitle;
}

export function hydrateArchiveTitles<T>(
  archives: T[],
  { getTitle, getSourceName, getArchivedAt, setTitle }: HydrateArchiveTitlesOptions<T>,
) {
  const nextTitles = new Map<number, string>();
  const processedSeeds: ArchiveTitleSeed[] = [];

  archives
    .map((archive, index) => ({
      archive,
      index,
      archivedAt: getArchivedAt(archive),
    }))
    .toSorted((left, right) => {
      const leftTimestamp = resolveSafeDate(left.archivedAt).getTime();
      const rightTimestamp = resolveSafeDate(right.archivedAt).getTime();
      if (leftTimestamp === rightTimestamp) {
        return left.index - right.index;
      }

      return leftTimestamp - rightTimestamp;
    })
    .forEach(({ archive, index, archivedAt }) => {
      const sourceName = getSourceName(archive);
      const resolvedTitle = resolveArchiveTitle({
        title: getTitle(archive),
        sourceName,
        archivedAt,
        siblingArchives: processedSeeds,
      });

      processedSeeds.push({
        title: resolvedTitle,
        sourceName,
        archivedAt,
      });
      nextTitles.set(index, resolvedTitle);
    });

  return archives.map((archive, index) =>
    setTitle(
      archive,
      nextTitles.get(index) ??
        resolveArchiveTitle({
          title: getTitle(archive),
          sourceName: getSourceName(archive),
          archivedAt: getArchivedAt(archive),
        }),
    ),
  );
}
