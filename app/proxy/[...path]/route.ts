import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 运行时 /proxy 静态文件代理
 *
 * 将 /proxy/* 请求映射到 public 目录下的静态文件，直接从磁盘读取。
 * 这样部署到 public 的新文件无需 npm run build 即可通过 /proxy/* 访问。
 *
 * 规则：
 *   1. 带扩展名的路径：去掉 /proxy 前缀，直接从 public 读取
 *      例如 /proxy/agent/test/style.css -> public/agent/test/style.css
 *   2. 不带扩展名的路径：去掉 /proxy 前缀并自动追加 .html
 *      例如 /proxy/agent/test/hello -> public/agent/test/hello.html
 */

/** public 目录绝对路径 */
const PUBLIC_DIR = path.join(process.cwd(), "public");

/** 扩展名 -> Content-Type 映射 */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/** 安全地把请求路径解析到 public 目录下，拒绝路径穿越 */
function safeResolvePublic(urlPath: string): string | null {
  // 拒绝空字节和 .. 穿越
  if (urlPath.includes("\0") || urlPath.includes("..")) {
    return null;
  }
  const normalized = path.normalize(urlPath).replace(/^[/\\]+/, "");
  const resolved = path.resolve(PUBLIC_DIR, normalized);
  const root = path.resolve(PUBLIC_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const urlPath = pathSegments.join("/");

  // 不带扩展名的路径自动追加 .html
  let target = urlPath;
  if (!/\.[a-zA-Z0-9]+$/.test(target)) {
    target = target + ".html";
  }

  const absPath = safeResolvePublic(target);
  if (!absPath) {
    return new Response("Forbidden", { status: 403 });
  }

  let content: ArrayBuffer;
  try {
    const buf = await fs.readFile(absPath);
    // 从 Buffer 中提取独立的 ArrayBuffer，匹配 Response 的 BodyInit 类型
    content = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(`Internal Server Error: ${e.message}`, { status: 500 });
  }

  const ext = path.extname(absPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": content.byteLength.toString(),
      // 部署页面不缓存，确保更新后立即生效
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}

// HEAD 请求复用 GET 逻辑但不返回 body
export async function HEAD(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const res = await GET(req, { params });
  return new Response(null, {
    status: res.status,
    headers: res.headers,
  });
}
