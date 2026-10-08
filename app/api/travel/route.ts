import { NextRequest } from "next/server";
import OpenAI from "openai";
import {
  PARSE_SYSTEM,
  RESEARCH_AGENT_SYSTEM,
  BUILTIN_SEARCH_SYSTEM,
  COMPARE_SYSTEM,
  ROADBOOK_SYSTEM,
  type ParsedRequirement,
} from "@/lib/travel-prompts";
import { WEB_TOOLS, runWebTool } from "@/lib/web-tools";

export const runtime = "nodejs";
// 多阶段流水线（实查 + 对比 + 生成）耗时较长，禁用静态化并延长超时
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown;
};

function nd(line: object) {
  return JSON.stringify(line) + "\n";
}

export async function POST(req: NextRequest) {
  let idea: string;
  let prefs: string;
  try {
    const body = await req.json();
    idea = String(body?.idea ?? "").trim();
    prefs = String(body?.prefs ?? "").trim();
  } catch {
    return new Response("invalid json body", { status: 400 });
  }
  if (!idea) {
    return new Response("missing idea", { status: 400 });
  }

  // 复用 .env 里既有的大模型配置（API_KEY / BASE_URL / MODEL_ID），与项目其它接口共用
  const apiKey = process.env.API_KEY;
  const baseURL = (process.env.BASE_URL || "").replace(/\/+$/, "");
  const model = process.env.MODEL_ID || "qwen3.8-max";

  if (!apiKey || !baseURL) {
    return new Response(
      "未配置 API_KEY / BASE_URL，请在 .env 中设置后重启服务。",
      { status: 500 },
    );
  }

  const openai = new OpenAI({ apiKey, baseURL });

  // enable_search / enable_thinking 是阿里云 qwen 的 provider 专属字段，OpenAI SDK 类型不含，用 cast 透传。
  // enable_thinking:false 时响应从数十秒降到 ~2s，用于结构化的实查/对比阶段；search 阶段务必联网。
  const extra = (o: { search?: boolean; thinking?: boolean }) =>
    ({ enable_search: !!o.search, enable_thinking: !!o.thinking }) as Record<string, unknown>;

  /** 非流式调用，返回完整文本。 */
  async function chatOnce(messages: ChatMsg[], o: { search?: boolean; thinking?: boolean }): Promise<string> {
    // provider 专属字段导致 SDK 重载无法精确匹配，参数与结果均按宽松类型处理
    const res: any = await openai.chat.completions.create({
      model,
      temperature: 0.5,
      messages,
      stream: false,
      ...extra(o),
    } as any);
    return res?.choices?.[0]?.message?.content ?? "";
  }

  /** 流式调用，逐段 yield 正文。 */
  async function* chatStream(messages: ChatMsg[], o: { search?: boolean; thinking?: boolean }): AsyncGenerator<string> {
    const stream: any = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      messages,
      stream: true,
      ...extra(o),
    } as any);
    for await (const part of stream) {
      const c = part?.choices?.[0]?.delta?.content;
      if (c) yield c;
    }
  }

  const userContent = prefs ? `旅游想法：${idea}\n补充偏好：${prefs}` : `旅游想法：${idea}`;

  const encoder = new TextEncoder();
  const streamOut = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: object) => controller.enqueue(encoder.encode(nd(obj)));
      try {
        emit({ type: "meta", model });

        // ===== 阶段 1 · 需求解析 =====
        emit({ type: "stage", stage: "parse", label: "解析需求" });
        const rawReq = await chatOnce(
          [
            { role: "system", content: PARSE_SYSTEM },
            { role: "user", content: userContent },
          ],
          { search: false, thinking: false },
        );
        const requirement = parseRequirement(rawReq);
        emit({ type: "requirement", data: requirement });

        // ===== 阶段 2 · 实查 Agent（function-calling 多轮循环）=====
        // 双通道互补：① web_search/web_fetch 工具给出可见、可追溯的真实检索轨迹（Bing 查询 + 抓页面正文）；
        //            ② enable_search 保留阿里云内置联网搜索作兜底，补 Bing 对机器人客户端相关性降级的短板。
        emit({ type: "stage", stage: "research", label: "联网实查收集资料" });

        // 通道 B：enable_search 内置联网搜索（黑盒），与工具循环并行跑，作互补兜底源。
        // 关键：绝不放进多轮工具循环里（enable_search+tools+thinking 叠加会使单轮暴涨到分钟级），只作单次有界调用。
        emit({ type: "tool_call", round: 0, tool: "enable_search", arg: "内置联网搜索兜底" });
        const channelBPromise = chatOnce(
          [
            { role: "system", content: BUILTIN_SEARCH_SYSTEM },
            { role: "user", content: userContent },
          ],
          { search: true, thinking: false },
        ).catch(() => "");

        // 通道 A：function-calling 工具循环（web_search / web_fetch），产出可见、可追溯的检索轨迹
        const agentMsgs: ChatMsg[] = [
          { role: "system", content: RESEARCH_AGENT_SYSTEM },
          {
            role: "user",
            content: `为下面这趟旅行收集可核验事实：\n${userContent}\n解析出的需求：${JSON.stringify(requirement)}`,
          },
        ];
        const MAX_ROUNDS = 8;
        let dossier = "";
        let toolRounds = 0;
        for (let round = 1; round <= MAX_ROUNDS; round++) {
          const resp: any = await openai.chat.completions.create({
            model,
            temperature: 0.3,
            messages: agentMsgs,
            stream: false,
            tools: WEB_TOOLS,
            tool_choice: "auto",
            enable_thinking: true, // 思考模式下工具规划质量更高
          } as any);
          const msg: any = resp?.choices?.[0]?.message;
          if (!msg) break;
          agentMsgs.push({
            role: "assistant",
            content: msg.content ?? "",
            ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
          } as ChatMsg);

          const calls: any[] = msg.tool_calls ?? [];
          if (calls.length === 0) {
            dossier = (msg.content ?? "").trim();
            break;
          }
          toolRounds = round;
          // 并行执行本轮所有工具调用，逐个把真实结果回填给模型
          await Promise.all(
            calls.map(async (tc) => {
              const name = tc?.function?.name ?? "";
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc?.function?.arguments || "{}");
              } catch {
                args = {};
              }
              const arg = name === "web_search" ? String(args.query ?? "") : String(args.url ?? "");
              emit({ type: "tool_call", round, tool: name, arg });
              const result = await runWebTool(name, args);
              const ok = !result.startsWith("抓取失败") && !result.startsWith("未搜到");
              emit({ type: "tool_result", round, tool: name, arg, ok, preview: result.slice(0, 180) });
              agentMsgs.push({ role: "tool", tool_call_id: tc.id, content: result } as ChatMsg);
            }),
          );
        }
        // 轮次用尽仍在调工具 → 强制基于已收集资料总结成档案
        if (!dossier) {
          const final: any = await openai.chat.completions.create({
            model,
            temperature: 0.3,
            messages: [
              ...agentMsgs,
              {
                role: "user",
                content: "已达到检索轮次上限。请停止调用工具，基于以上工具返回的资料，直接输出结构化 Markdown 实查档案（每条带来源 URL 与可信度标记）。",
              } as ChatMsg,
            ],
            stream: false,
            enable_thinking: false,
          } as any);
          dossier = (final?.choices?.[0]?.message?.content ?? "").trim();
        }
        // 合并两条通道：工具循环档案（通道 A） + 内置联网搜索（通道 B），互为交叉验证的独立来源
        const channelB = await channelBPromise;
        emit({
          type: "tool_result",
          round: 0,
          tool: "enable_search",
          arg: "内置联网搜索兜底",
          ok: !!channelB,
          preview: channelB.slice(0, 180),
        });
        const mergedDossier = channelB
          ? `${dossier}\n\n### 内置联网搜索补充（enable_search 通道）\n${channelB}`
          : dossier;
        emit({ type: "research_done", rounds: toolRounds, dossier: mergedDossier });

        // ===== 阶段 3 · 数据对比 / 交叉验证 → 事实源 =====
        emit({ type: "stage", stage: "compare", label: "多源交叉验证" });
        const facts = await chatOnce(
          [
            { role: "system", content: COMPARE_SYSTEM },
            {
              role: "user",
              content: `旅行需求：${JSON.stringify(requirement)}\n\n以下是两条独立通道联网检索到的资料（工具抓取 + 内置搜索），请交叉验证：\n\n${mergedDossier}`,
            },
          ],
          { search: false, thinking: false },
        );
        emit({ type: "facts", markdown: facts.trim() });


        // ===== 阶段 4 · 基于事实源生成路书（流式） =====
        emit({ type: "stage", stage: "write", label: "生成旅行路书" });
        for await (const delta of chatStream(
          [
            { role: "system", content: ROADBOOK_SYSTEM },
            {
              role: "user",
              content: `旅行需求：${JSON.stringify(requirement)}\n\n已交叉验证的事实源：\n\n${facts.trim()}\n\n请据此产出完整路书。`,
            },
          ],
          { search: false, thinking: false },
        )) {
          emit({ type: "content", text: delta });
        }

        emit({ type: "done" });
      } catch (e) {
        emit({ type: "error", text: (e as Error).message || "pipeline error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(streamOut, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** 容错解析需求 JSON：剥掉可能的代码块包裹，字段缺失给默认值。 */
function parseRequirement(raw: string): ParsedRequirement {
  const fallback: ParsedRequirement = {
    destination: "",
    origin: "",
    days: 2,
    month: new Date().getMonth() + 1,
    people: "未知",
    style: "深度体验",
    budget: "中等",
    transport: "高铁",
    interests: [],
    constraints: "",
  };
  try {
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end < 0) return fallback;
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ParsedRequirement>;
    return {
      ...fallback,
      ...obj,
      days: Number(obj.days) > 0 ? Number(obj.days) : fallback.days,
      month: Number(obj.month) >= 1 && Number(obj.month) <= 12 ? Number(obj.month) : fallback.month,
      interests: Array.isArray(obj.interests) ? obj.interests : [],
    };
  } catch {
    return fallback;
  }
}
