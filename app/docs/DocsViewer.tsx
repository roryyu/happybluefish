"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Clock,
  FileText,
  RefreshCw,
} from "lucide-react";
import type { DocMeta } from "./types";

/** 将 ISO 时间格式化为「2026年9月26日」 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 字符数展示：超过 1 万显示为「x.x 万字」 */
function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`;
  return `${n} 字`;
}

/** 递归取出 React 子节点中的纯文本，用于生成标题锚点 id */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

/** 生成标题锚点 id：保留中英文与数字，空格转连字符 */
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "");
}

/** 去掉正文首个一级标题（标题已由页面头部单独展示） */
function stripFirstHeading(content: string): string {
  return content.replace(/^#\s+.*$/m, "");
}

/** react-markdown 自定义渲染：按站点浅色设计语言排版正文 */
const markdownComponents: Components = {
  h1: ({ node, children, ...props }) => (
    <h1
      id={slugify(textOf(children))}
      className="mt-10 mb-6 scroll-mt-24 border-b border-border pb-3 text-2xl font-bold text-foreground"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ node, children, ...props }) => (
    <h2
      id={slugify(textOf(children))}
      className="mt-10 mb-4 scroll-mt-24 border-l-4 border-primary pl-3 text-xl font-bold text-foreground"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3
      id={slugify(textOf(children))}
      className="mt-8 mb-3 scroll-mt-24 text-lg font-semibold text-foreground"
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ node, children, ...props }) => (
    <h4
      id={slugify(textOf(children))}
      className="mt-6 mb-2 scroll-mt-24 text-base font-semibold text-foreground"
      {...props}
    >
      {children}
    </h4>
  ),
  p: ({ node, ...props }) => (
    <p className="my-4 text-[15px] leading-8 text-foreground/90" {...props} />
  ),
  a: ({ node, ...props }) => (
    <a
      className="break-all text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent/50"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  ul: ({ node, ...props }) => (
    <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-muted" {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-muted" {...props} />
  ),
  li: ({ node, ...props }) => (
    <li className="text-[15px] leading-8 text-foreground/90" {...props} />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-5 rounded-r-lg border-l-4 border-primary/40 bg-surface px-4 py-1.5 text-foreground/75 [&>p]:my-2"
      {...props}
    />
  ),
  strong: ({ node, ...props }) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  del: ({ node, ...props }) => (
    <del className="text-muted line-through" {...props} />
  ),
  hr: ({ node, ...props }) => (
    <hr className="my-10 border-t border-border" {...props} />
  ),
  img: ({ node, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="my-4 max-w-full rounded-lg border border-border"
      alt={props.alt ?? ""}
      {...props}
    />
  ),
  code: ({ node, ...props }) => (
    <code
      className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[0.85em] text-accent"
      {...props}
    />
  ),
  pre: ({ node, children, ...props }) => (
    <pre
      className="my-5 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-[13px] leading-6 text-slate-100 [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[13px] [&>code]:text-inherit"
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ node, children, ...props }) => (
    <div className="my-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-surface" {...props} />,
  tr: ({ node, ...props }) => (
    <tr className="border-b border-border last:border-0" {...props} />
  ),
  th: ({ node, ...props }) => (
    <th
      className="px-4 py-2.5 text-left font-semibold whitespace-nowrap text-foreground"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td className="px-4 py-2.5 align-top leading-7 text-foreground/90" {...props} />
  ),
};

interface DocsViewerProps {
  docs: DocMeta[];
}

export default function DocsViewer({ docs }: DocsViewerProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const cacheRef = useRef<Map<string, string>>(new Map());

  const activeDoc = useMemo(
    () => docs.find((doc) => doc.file === activeFile) ?? null,
    [docs, activeFile],
  );

  // 初次进入：优先使用 ?file= 指定的文章，否则默认选中最新一篇
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("file");
    const initial = docs.find((doc) => doc.file === wanted)?.file ?? docs[0]?.file ?? null;
    setActiveFile(initial);
  }, [docs]);

  // 选中文章同步到地址栏，刷新 / 分享后仍能定位到同一篇
  useEffect(() => {
    if (!activeFile) return;
    const url = new URL(window.location.href);
    url.searchParams.set("file", activeFile);
    window.history.replaceState(null, "", url);
  }, [activeFile]);

  // 拉取并缓存 markdown 原文（走 public 静态路径，文件更新后无需重新构建）
  useEffect(() => {
    if (!activeFile) {
      setContent("");
      setError(null);
      setLoading(false);
      return;
    }
    const cached = cacheRef.current.get(activeFile);
    if (cached !== undefined) {
      setContent(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/docs/${encodeURIComponent(activeFile)}`, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        cacheRef.current.set(activeFile, text);
        setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError("文章加载失败，请检查文件是否存在后重试");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, reloadKey]);

  const selectDoc = useCallback((file: string) => {
    setActiveFile(file);
    setListOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const retry = useCallback(() => {
    if (activeFile) cacheRef.current.delete(activeFile);
    setReloadKey((key) => key + 1);
  }, [activeFile]);

  const docList = (
    <div className="space-y-2">
      {docs.map((doc) => {
        const active = doc.file === activeFile;
        return (
          <button
            key={doc.file}
            type="button"
            onClick={() => selectDoc(doc.file)}
            className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
              active
                ? "border-primary/30 bg-primary/5 shadow-sm"
                : "border-transparent hover:border-border hover:bg-surface"
            }`}
          >
            <p
              className={`line-clamp-2 text-sm font-medium ${
                active ? "text-primary" : "text-foreground"
              }`}
            >
              {doc.title}
            </p>
            {doc.excerpt && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{doc.excerpt}</p>
            )}
            <p className="mt-1.5 text-[11px] text-muted/80">
              {formatDate(doc.updatedAt)} · {formatChars(doc.chars)}
            </p>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="/" className="group flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
              <span className="text-sm font-bold text-white">Rory</span>
            </div>
            <span className="font-semibold text-foreground transition-colors group-hover:text-primary">
              郁辰磊
            </span>
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-primary/5 hover:text-primary"
          >
            <ArrowLeft size={16} />
            返回首页
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">文章归档</h1>
          <p className="mt-2 text-sm text-muted">
            收录 public/docs 目录下的 markdown 长文，点击目录即可在线阅读。
          </p>
        </div>

        {/* 不设 items-start：让侧栏跟随内容区域拉伸，内部 sticky 才能正常吸附 */}
        <div className="flex gap-8">
          {/* 桌面端：左侧文章目录 */}
          <aside className="hidden w-72 shrink-0 md:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <BookOpen size={16} className="text-primary" />
                文章目录
                <span className="ml-auto text-xs font-normal text-muted">
                  {docs.length} 篇
                </span>
              </div>
              {docs.length > 0 ? (
                docList
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                  暂无文章
                </p>
              )}
            </div>
          </aside>

          {/* 内容区 */}
          <main className="min-w-0 flex-1">
            {/* 移动端：目录折叠面板 */}
            <div className="mb-5 md:hidden">
              <button
                type="button"
                onClick={() => setListOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-white px-4 py-3 text-sm shadow-sm"
              >
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <BookOpen size={16} className="text-primary" />
                  文章目录（{docs.length}）
                </span>
                <ChevronDown
                  size={16}
                  className={`text-muted transition-transform ${listOpen ? "rotate-180" : ""}`}
                />
              </button>
              {listOpen && <div className="mt-3">{docList}</div>}
            </div>

            {docs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-16 text-center">
                <p className="text-sm text-muted">
                  还没有文章，把 markdown 文件放进 public/docs 目录即可自动出现。
                </p>
              </div>
            ) : loading ? (
              <div className="animate-pulse space-y-4 rounded-2xl border border-border bg-white p-6 md:p-10">
                <div className="h-7 w-2/3 rounded-lg bg-surface-alt" />
                <div className="h-4 w-1/3 rounded-lg bg-surface-alt" />
                <div className="h-px w-full bg-border" />
                {[100, 92, 96, 84, 90, 76].map((width, index) => (
                  <div
                    key={index}
                    className="h-4 rounded-lg bg-surface-alt"
                    style={{ width: `${width}%` }}
                  />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-border bg-white px-6 py-16 text-center">
                <p className="text-sm text-muted">{error}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <RefreshCw size={14} />
                  重新加载
                </button>
              </div>
            ) : activeDoc ? (
              <div className="rounded-2xl border border-border bg-white p-6 shadow-sm md:p-10">
                <div className="border-b border-border pb-6">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                    {activeDoc.title}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={14} />
                      {formatDate(activeDoc.updatedAt)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock size={14} />
                      约 {formatChars(activeDoc.chars)}
                    </span>
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <FileText size={14} className="shrink-0" />
                      <span className="truncate">{activeDoc.file}</span>
                    </span>
                  </div>
                </div>
                <article className="pt-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {stripFirstHeading(content)}
                  </ReactMarkdown>
                </article>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
