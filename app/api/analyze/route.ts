import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
// 命理分析回复较长，禁用静态化并适当延长超时
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_PROMPT =
  "你是个全球顶尖的命理大师，同时精通四柱八字与紫微斗数。你熟读融会贯通穷通宝典，三命通会，滴天髓，渊海子平，千里命稿，协纪辨方书，果老星宗，子平真诠，神峰通考，以及紫微斗数全书、紫微斗数全集、斗数宣微、斗数骨髓赋等经典。" +
  "你将根据用户给出的排盘结果（已经计算好四柱八字、地支藏干、十神关系、能量分布、组合格局，以及紫微斗数十二宫、星曜亮度、生年四化、格局与大限），" +
  "做系统、客观、可读的分析。回答使用中文 Markdown，分小标题；不要重新排盘或重算任何数据，直接基于给定结果作答；" +
  "同时对姓名也做文字上的分析和命理之间的关系，也分析八字对三魂七魄的影响，并把八字与紫微盘相互参照，"+
  "极致深入，越全面越好。";

function nd(line: object) {
  return JSON.stringify(line) + "\n";
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

  // 复用 .env 里既有的大模型配置（API_KEY / BASE_URL / MODEL_ID），与 /api/travel 共用；
  // 仍兼容 DEEPSEEK_* 前缀，便于单独指向 DeepSeek 官方端点
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.API_KEY;
  const baseURL = (
    process.env.DEEPSEEK_BASE_URL ||
    process.env.BASE_URL ||
    "https://api.deepseek.com"
  ).replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL || process.env.MODEL_ID || "deepseek-chat";
  // 仅 deepseek-v4-pro / deepseek-reasoner 之类支持思考链；通过环境变量显式开启
  const enableThinking =
    process.env.DEEPSEEK_THINKING === "1" || /v4-pro|reasoner/i.test(model);

  if (!apiKey) {
    return new Response(
      "未配置 API_KEY（或 DEEPSEEK_API_KEY），请在 .env 中设置后重启服务。",
      { status: 500 },
    );
  }

  const openai = new OpenAI({ apiKey, baseURL });

  let completion: AsyncIterable<{
    choices: { delta: { content?: string; reasoning_content?: string } }[];
  }>;
  try {
    // thinking / reasoning_effort 是 DeepSeek v4-pro 扩展字段，OpenAI SDK 类型不识别，用 cast 透传
    completion = (await openai.chat.completions.create({
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
  } catch (e) {
    const err = e as { message?: string };
    return new Response(
      `调用 DeepSeek 失败：${err.message || "unknown error"}`,
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(nd({ type: "meta", model })));
        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            controller.enqueue(encoder.encode(nd({ type: "content", text: delta.content })));
          }
          if (delta.reasoning_content) {
            controller.enqueue(
              encoder.encode(nd({ type: "reasoning", text: delta.reasoning_content })),
            );
          }
        }
        controller.enqueue(encoder.encode(nd({ type: "done" })));
      } catch (e) {
        controller.enqueue(
          encoder.encode(nd({ type: "error", text: (e as Error).message || "stream error" })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
