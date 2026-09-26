import fs from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import DocsViewer from "./DocsViewer";
import type { DocMeta } from "./types";

export const runtime = "nodejs";
// 运行时读取目录：部署到 public/docs 的新 markdown 无需 npm run build 即可出现
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "文章 | 郁辰磊",
  description: "读书笔记与技术长文归档，支持目录检索与在线阅读",
};

/** public/docs 目录绝对路径 */
const DOCS_DIR = path.join(process.cwd(), "public", "docs");

/** 从正文中提取首个一级标题作为文章标题，缺失时回退为文件名 */
function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  if (!match) return fallback.replace(/\.md$/i, "");
  return match[1].replace(/[*_`~]/g, "").trim();
}

/** 提取首个普通段落作为摘要（跳过标题、引用、列表、表格、链接等行） */
function extractExcerpt(content: string): string {
  const skip = /^(#{1,6}\s|>|[-*+]\s|\d+[.、)]\s|\||```|!\[|\[|[-=]{3,})/;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || skip.test(line)) continue;
    const text = line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (text.length < 10) continue;
    return text.length > 88 ? `${text.slice(0, 88)}…` : text;
  }
  return "";
}

/** 扫描 public/docs 下的 markdown 文件，生成文章目录元信息 */
async function loadDocs(): Promise<DocMeta[]> {
  let entries;
  try {
    entries = await fs.readdir(DOCS_DIR, { withFileTypes: true });
  } catch {
    // 目录不存在或不可读时返回空列表，页面展示空态
    return [];
  }

  const docs = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.md$/i.test(entry.name) &&
          !entry.name.startsWith(".") &&
          !entry.name.startsWith("_"),
      )
      .map(async (entry): Promise<DocMeta> => {
        const absPath = path.join(DOCS_DIR, entry.name);
        const [content, stat] = await Promise.all([
          fs.readFile(absPath, "utf-8").catch(() => ""),
          fs.stat(absPath).catch(() => null),
        ]);
        return {
          file: entry.name,
          title: extractTitle(content, entry.name),
          excerpt: extractExcerpt(content),
          updatedAt: (stat?.mtime ?? new Date(0)).toISOString(),
          chars: content.length,
        };
      }),
  );

  // 最新修改的文章排前面，同时间按文件名排序保证稳定
  return docs.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.file.localeCompare(b.file),
  );
}

export default async function DocsPage() {
  const docs = await loadDocs();
  return <DocsViewer docs={docs} />;
}
