import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArchiveDisplayTitle,
  buildDefaultArchiveTitle,
  extractArchiveEditableTitle,
  formatArchiveListDate,
  hydrateArchiveTitles,
  resolveArchiveTitle,
} from "./archiveTitle";

void test("resolveArchiveTitle 会为同来源同日期的默认标题自动追加序号", () => {
  const title = resolveArchiveTitle({
    sourceName: "产品讨论组",
    archivedAt: "2026-03-18T12:00:00.000Z",
    siblingArchives: [
      {
        sourceName: "产品讨论组",
        archivedAt: "2026-03-18T08:00:00.000Z",
        title: "产品讨论组 - 2026.03.18",
      },
    ],
  });

  assert.equal(title, "产品讨论组 - 2026.03.18 (2)");
});

void test("hydrateArchiveTitles 会补齐缺少 title 的旧归档并保留手动标题", () => {
  const archives = hydrateArchiveTitles(
    [
      {
        id: "a1",
        sourceName: "小明",
        archivedAt: "2026-03-18T08:00:00.000Z",
        title: "",
      },
      {
        id: "a2",
        sourceName: "小明",
        archivedAt: "2026-03-18T09:00:00.000Z",
        title: "手动命名",
      },
      {
        id: "a3",
        sourceName: "小明",
        archivedAt: "2026-03-18T10:00:00.000Z",
        title: "",
      },
    ],
    {
      getTitle: (archive) => archive.title,
      getSourceName: (archive) => archive.sourceName,
      getArchivedAt: (archive) => archive.archivedAt,
      setTitle: (archive, title) => ({
        ...archive,
        title,
      }),
    },
  );

  assert.equal(archives[0]?.title, buildDefaultArchiveTitle("小明", "2026-03-18T08:00:00.000Z"));
  assert.equal(archives[1]?.title, "手动命名");
  assert.equal(archives[2]?.title, "小明 - 2026.03.18 (2)");
});

void test("extractArchiveEditableTitle 会把旧默认标题映射成可编辑标题部分", () => {
  assert.equal(
    extractArchiveEditableTitle({
      title: "周杰伦 - 2026.03.19",
      sourceName: "周杰伦",
      archivedAt: "2026-03-19T08:00:00.000Z",
    }),
    "归档",
  );

  assert.equal(
    extractArchiveEditableTitle({
      title: "周杰伦 - 2026.03.19 (2)",
      sourceName: "周杰伦",
      archivedAt: "2026-03-19T09:00:00.000Z",
    }),
    "归档 (2)",
  );
});

void test("buildArchiveDisplayTitle 会输出 来源-标题-短日期 格式", () => {
  assert.equal(formatArchiveListDate("2026-03-19T09:00:00.000Z"), "26/03/19");
  assert.equal(
    buildArchiveDisplayTitle({
      title: "需求复盘",
      sourceName: "产品组",
      archivedAt: "2026-03-19T09:00:00.000Z",
    }),
    "产品组 - 需求复盘 - 26/03/19",
  );
});
