import { NextRequest } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 命理分析回复很长（大模型深度推理 + 长正文），同步流式接口在部署网关（tengine/Byte-nginx 等，
 * 通常 60s 掐断长连接）后必然 504 超时。因此与 /api/travel 一致，改为「任务」模式：
 *   POST 立即返回 taskId（秒级），大模型流式推理在服务器后台跑，边收边累积到任务快照；
 *   GET ?task=id 轮询任务快照（秒级，含渐进的 reasoning / content）；
 *   DELETE ?task=id 取消后台任务。
 * 每个请求都是短请求，不再占用长连接，网关不会超时。
 */

const SYSTEM_PROMPT =
  "你是个全球顶尖的命理大师，同时精通四柱八字与紫微斗数。你熟读融会贯通穷通宝典，三命通会，滴天髓，渊海子平，千里命稿，协纪辨方书，果老星宗，子平真诠，神峰通考，以及紫微斗数全书、紫微斗数全集、斗数宣微、斗数骨髓赋等经典。" +
  "你将根据用户给出的排盘结果（已经计算好四柱八字、地支藏干、十神关系、能量分布、组合格局，以及紫微斗数十二宫、星曜亮度、生年四化、格局与大限），" +
  "做系统、客观、可读的分析。回答使用中文 Markdown，分小标题；不要重新排盘或重算任何数据，直接基于给定结果作答；" +
  "同时对姓名也做文字上的分析和命理之间的关系，也分析八字对三魂七魄的影响，并把八字与紫微盘相互参照，" +
  "极致深入，越全面越好。";

type JobStatus = "running" | "done" | "error" | "cancelled";

type Job = {
  id: string;
  createdAt: number;
  cancelled: boolean;
  status: JobStatus;
  model: string;
  reasoning: string; // 思考链（reasoning_content）渐进累积
  content: string; // 正文（content）渐进累积
  error: string | null;
};

// 内存任务表：单实例 next start 足够；重启即丢任务（客户端会收到 404 并提示重试）
const jobs = new Map<string, Job>();

function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > 60 * 60 * 1000) jobs.delete(id); // 1 小时后过期
  }
  while (jobs.size > 20) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest || oldest.status === "running") break;
    jobs.delete(oldest.id);
  }
}

/** 复用 .env 里既有的大模型配置（与 /api/travel 共用），仍兼容 DEEPSEEK_* 前缀。 */
function resolveModelConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.API_KEY || "";
  const baseURL = (
    process.env.DEEPSEEK_BASE_URL ||
    process.env.BASE_URL ||
    "https://api.deepseek.com"
  ).replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL || process.env.MODEL_ID || "deepseek-chat";
  // 仅 deepseek-v4-pro / deepseek-reasoner 之类支持思考链；通过环境变量显式开启
  const enableThinking =
    process.env.DEEPSEEK_THINKING === "1" || /v4-pro|reasoner/i.test(model);
  return { apiKey, baseURL, model, enableThinking };
}

export async function POST(req: NextRequest) {
  let promptText: string;
  try {
    const body = await req.json();
    promptText = String(body?.promptText ?? "").trim();
  } catch {
    return new Response("invalid json body", { status: 400 });
  }
  if (!promptText) {
    return new Response("missing promptText", { status: 400 });
  }

  const { apiKey, model } = resolveModelConfig();
  if (!apiKey) {
    return new Response(
      "未配置 API_KEY（或 DEEPSEEK_API_KEY），请在 .env 中设置后重启服务。",
      { status: 500 },
    );
  }

  const job: Job = {
    id: randomUUID(),
    createdAt: Date.now(),
    cancelled: false,
    status: "running",
    model,
    reasoning: "",
    content: "",
    error: null,
  };
  jobs.set(job.id, job);
  pruneJobs();

  // 后台执行，不等待完成 —— POST 立即返回，网关连接保持秒级
  void runAnalyzeJob(job, promptText);

  return Response.json({ taskId: job.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("task");
  const job = id ? jobs.get(id) : undefined;
  if (!job) {
    return Response.json({ error: "task not found" }, { status: 404 });
  }
  // 不回传内部 cancelled 标记，其余字段作为快照供前端渐进渲染
  const { cancelled, ...snapshot } = job;
  return Response.json(snapshot);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("task");
  const job = id ? jobs.get(id) : undefined;
  if (job && job.status === "running") {
    job.cancelled = true; // 后台流式循环在收到分片的边界检查该标记并自行退出
  }
  return Response.json({ ok: true });
}

async function runAnalyzeJob(job: Job, promptText: string) {
  const { apiKey, baseURL, model, enableThinking } = resolveModelConfig();
  // 收紧单次调用超时与重试：SDK 默认 10 分钟超时 × 2 次重试，出网被拦时会永远卡在 running。
  // 命理分析较长，给 5 分钟上限；后台执行不受网关长连接限制。
  const openai = new OpenAI({ apiKey, baseURL, timeout: 300_000, maxRetries: 1 });

  const finish = (status: JobStatus, error: string | null = null) => {
    job.status = status;
    job.error = error;
  };

  try {
    // thinking / reasoning_effort 是 DeepSeek v4-pro 扩展字段，OpenAI SDK 类型不识别，用 cast 透传
    const completion = (await openai.chat.completions.create({
      model,
      stream: true,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: promptText },
      ],
      ...(enableThinking
        ? { thinking: { type: "enabled" }, reasoning_effort: "high" }
        : {}),
    } as Parameters<typeof openai.chat.completions.create>[0])) as unknown as AsyncIterable<{
      choices: { delta: { content?: string; reasoning_content?: string } }[];
    }>;

    for await (const part of completion) {
      if (job.cancelled) return finish("cancelled");
      const delta = part.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning_content) job.reasoning += delta.reasoning_content;
      if (delta.content) job.content += delta.content;
    }

    if (job.cancelled) return finish("cancelled");
    finish("done");
  } catch (e) {
    if (job.cancelled) return finish("cancelled");
    const msg = (e as Error).message || "stream error";
    finish(
      "error",
      `调用大模型失败：${msg}。模型端点 ${baseURL} —— 若为超时/连接错误，说明服务器出网被拦或模型不可用。`,
    );
  }
}
