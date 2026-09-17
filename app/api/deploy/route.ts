import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  DEPLOY_ROOT,
  DEPLOY_SECRET,
  safeResolve,
  toUrlPath,
  verifyChallengeAndSignature,
} from "@/lib/deploy-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 禁止 CDN/浏览器缓存的响应头，challenge 必须每次回源生成 */
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

/** 带 no-store 头的 JSON 响应，确保部署接口不被 CDN 缓存 */
function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_CACHE_HEADERS, ...(init?.headers as Record<string, string>) },
  });
}

/** 从请求头提取鉴权信息并校验 */
function auth(req: NextRequest) {
  return verifyChallengeAndSignature(
    req.headers.get("x-deploy-challenge"),
    req.headers.get("x-deploy-signature"),
  );
}

/**
 * POST /api/deploy
 * 部署一个静态文件到 public 下。
 *
 * Headers:
 *   X-Deploy-Challenge:  <从 /api/deploy/challenge 拿到的 nonce>
 *   X-Deploy-Signature:  HMAC-SHA256(DEPLOY_SECRET, challenge) 的 hex
 *
 * Body (JSON):
 *   {
 *     "path": "demo/index.html",          // 相对 public/agent 的路径
 *     "content": "<html>...</html>",      // 文件内容
 *     "encoding": "utf8" | "base64"       // 可选，默认 utf8；二进制用 base64
 *   }
 */
export async function POST(req: NextRequest) {
  const authRes = auth(req);
  if (!authRes.ok) {
    return json({ ok: false, error: authRes.error }, { status: authRes.status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "非法 JSON" }, { status: 400 });
  }

  const targetPath: string = body?.path ?? "";
  const content: string = body?.content ?? "";
  const encoding: "utf8" | "base64" = body?.encoding === "base64" ? "base64" : "utf8";

  if (!targetPath || content === undefined || content === null) {
    return json(
      { ok: false, error: "缺少 path 或 content 字段" },
      { status: 400 },
    );
  }

  let absPath: string;
  try {
    absPath = safeResolve(targetPath);
  } catch (e: any) {
    return json({ ok: false, error: e.message }, { status: 400 });
  }

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const buf = Buffer.from(content as string, encoding);
    await fs.writeFile(absPath, buf);
  } catch (e: any) {
    return json(
      { ok: false, error: `写入失败: ${e.message}` },
      { status: 500 },
    );
  }

  return json({
    ok: true,
    url: toUrlPath(absPath),
    path: targetPath,
    bytes: Buffer.byteLength(content as string, encoding),
  });
}

/**
 * GET /api/deploy
 * 列出已部署的文件（鉴权保护，避免泄露目录结构）。
 */
export async function GET(req: NextRequest) {
  const authRes = auth(req);
  if (!authRes.ok) {
    return json({ ok: false, error: authRes.error }, { status: authRes.status });
  }

  const files: { path: string; url: string; size: number; mtime: string }[] = [];

  // 手动递归遍历，避免依赖 recursive 选项下 ent.path 在不同 Node 版本的差异
  async function walk(dir: string, relDir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = relDir ? path.join(relDir, ent.name) : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, rel);
      } else if (ent.isFile()) {
        const stat = await fs.stat(abs);
        files.push({
          path: rel.split(path.sep).join("/"),
          url: toUrlPath(abs),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  }

  try {
    await walk(DEPLOY_ROOT, "");
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return json({ ok: true, files: [] });
    }
    return json({ ok: false, error: e.message }, { status: 500 });
  }

  return json({ ok: true, files });
}

/**
 * DELETE /api/deploy?path=demo/index.html
 * 删除一个已部署文件。
 */
export async function DELETE(req: NextRequest) {
  const authRes = auth(req);
  if (!authRes.ok) {
    return json({ ok: false, error: authRes.error }, { status: authRes.status });
  }

  const url = new URL(req.url);
  const targetPath = url.searchParams.get("path") || "";
  if (!targetPath) {
    return json({ ok: false, error: "缺少 path 查询参数" }, { status: 400 });
  }

  let absPath: string;
  try {
    absPath = safeResolve(targetPath);
  } catch (e: any) {
    return json({ ok: false, error: e.message }, { status: 400 });
  }

  try {
    await fs.unlink(absPath);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return json({ ok: false, error: "文件不存在" }, { status: 404 });
    }
    return json({ ok: false, error: e.message }, { status: 500 });
  }

  return json({ ok: true, path: targetPath });
}
