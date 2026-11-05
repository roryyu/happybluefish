// 独立大模型调用测试：与 /api/analyze 相同的配置解析与流式调用方式
// 用法（Node >= 20.6，在 bazi 目录下执行，复用项目 node_modules 里的 openai）：
//   node --env-file=.env test-llm.mjs            # 用 .env 里的模型
//   node --env-file=.env test-llm.mjs qwen3.8-max # 临时指定模型，不改 .env
import OpenAI from "openai";

// ---- 与 app/api/analyze/route.ts 的 resolveModelConfig() 保持一致 ----
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.API_KEY || "";
const baseURL = (
  process.env.DEEPSEEK_BASE_URL ||
  process.env.BASE_URL ||
  "https://api.deepseek.com"
).replace(/\/+$/, "");
const model = process.argv[2] || process.env.DEEPSEEK_MODEL || process.env.MODEL_ID || "deepseek-chat";
const enableThinking =
  process.env.DEEPSEEK_THINKING === "1" || /v4-pro|reasoner/i.test(model);

// Key 只打印前 8 位 + 后 4 位，避免泄露
const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}（长度 ${apiKey.length}）` : "（未配置）";
console.log("=== 解析到的配置 ===");
console.log("model   :", model);
console.log("baseURL :", baseURL);
console.log("apiKey  :", maskedKey);
console.log("thinking:", enableThinking);

if (!apiKey) {
  console.error("\n❌ 没有读到 API Key。确认用 --env-file=.env 启动，且 .env 里有 API_KEY / DEEPSEEK_API_KEY。");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL,
  timeout: 60_000, // 测试给 60s 足够；线上 route 是 300s
  maxRetries: 0, // 不重试，失败立刻暴露原始错误
});

const t0 = Date.now();
let firstChunkMs = null;
let reasoningChars = 0;
let contentChars = 0;

try {
  console.log("\n=== 发起流式请求（与线上一致的 stream: true）===");
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    temperature: 0.7,
    messages: [
      { role: "system", content: "你是一个测试助手，回答尽量简短。" },
      { role: "user", content: "只回复两个字：收到" },
    ],
    ...(enableThinking ? { thinking: { type: "enabled" }, reasoning_effort: "high" } : {}),
  });

  for await (const part of stream) {
    if (firstChunkMs === null) {
      firstChunkMs = Date.now() - t0;
      console.log(`首个分片到达：${firstChunkMs}ms`);
    }
    const delta = part.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.reasoning_content) {
      reasoningChars += delta.reasoning_content.length;
      process.stdout.write(delta.reasoning_content);
    }
    if (delta.content) {
      contentChars += delta.content.length;
      process.stdout.write(delta.content);
    }
  }

  console.log(`\n\n=== 结果 ===`);
  console.log(`✅ 调用成功：总耗时 ${Date.now() - t0}ms，首分片 ${firstChunkMs}ms`);
  console.log(`reasoning ${reasoningChars} 字符，content ${contentChars} 字符`);
  if (contentChars === 0 && reasoningChars === 0) {
    console.log("⚠️ 流正常结束但没有任何内容，检查模型名是否被服务端静默接受后返回空。");
  }
} catch (e) {
  console.error(`\n❌ 调用失败（耗时 ${Date.now() - t0}ms）`);
  console.error("message :", e.message);
  if (e.status) console.error("status  :", e.status); // 401=Key错 404=模型/路径错 429=限流
  if (e.code) console.error("code    :", e.code); // ECONNREFUSED/ETIMEDOUT/ENOTFOUND=出网/DNS问题
  if (e.error) console.error("error   :", JSON.stringify(e.error));
  if (e.cause) console.error("cause   :", e.cause?.message || e.cause);
  process.exit(1);
}