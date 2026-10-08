/**
 * 真实联网工具层：给旅行实查 Agent 用的「搜索引擎查询 + 页面抓取」能力。
 *
 * 与「让大模型自己 enable_search」的本质区别：这里模型通过 function-calling
 * 显式调用 web_search / web_fetch —— web_search 真的去 Bing 发查询词、解析结果列表
 * （标题/URL/摘要），web_fetch 真的去抓取某个结果页面并提取正文，模型据此决定下一步。
 *
 * 零第三方依赖：HTML 解析用定向正则，正文提取用去标签 + 实体解码。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type SearchHit = { title: string; url: string; snippet: string };

/** HTML 实体解码（覆盖常见命名实体 + 数字实体）。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** 去掉标签、压缩空白。 */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(timer) };
}

/**
 * web_search：向 Bing 发查询词，解析自然结果（b_algo 块）。
 * 失败/被拦时返回空数组，由调用方决定是否换词重试。
 */
export async function bingSearch(query: string, limit = 10): Promise<SearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=30`;
  const { signal, clear } = withTimeout(15000);
  try {
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const blocks = html.split('class="b_algo"').slice(1);
    const hits: SearchHit[] = [];
    for (const b of blocks) {
      const m = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!m) continue;
      const link = m[1];
      if (!/^https?:\/\//.test(link)) continue;
      if (/bing\.com|microsoft\.com|msn\.com|go\.microsoft/.test(link)) continue;
      const title = stripTags(m[2]);
      const pm = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const snippet = pm ? stripTags(pm[1]).slice(0, 200) : "";
      hits.push({ title: title.slice(0, 120), url: link, snippet });
      if (hits.length >= limit) break;
    }
    return hits;
  } catch {
    return [];
  } finally {
    clear();
  }
}

/**
 * web_fetch：抓取指定 URL，提取可读正文（去脚本/样式/标签），截断到 maxChars。
 * 返回纯文本；出错返回以「抓取失败」开头的说明，供模型判断是否换源。
 */
export async function fetchPageText(url: string, maxChars = 5000): Promise<string> {
  if (!/^https?:\/\//.test(url)) return "抓取失败：非法 URL";
  const { signal, clear } = withTimeout(18000);
  try {
    const res = await fetch(url, {
      signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!res.ok) return `抓取失败：HTTP ${res.status}`;
    const ctype = res.headers.get("content-type") || "";
    if (ctype && !/text\/html|text\/plain|application\/xhtml/i.test(ctype) && !/pdf|json/i.test(ctype)) {
      return `抓取失败：非文本内容（${ctype}）`;
    }
    let html = await res.text();
    if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
    // 去噪声节点
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ");
    // 块级标签转换行，保留可读性
    html = html.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
    let text = decodeEntities(html.replace(/<[^>]+>/g, " "));
    text = text
      .split("\n")
      .map((l) => l.replace(/[ \t\u3000]+/g, " ").trim())
      .filter((l) => l.length > 0)
      .join("\n");
    if (!text) return "抓取失败：页面无可提取正文（可能是 JS 渲染或反爬）";
    return text.length > maxChars ? text.slice(0, maxChars) + "…（已截断）" : text;
  } catch (e) {
    return `抓取失败：${(e as Error).name === "AbortError" ? "超时" : (e as Error).message}`;
  } finally {
    clear();
  }
}

/** OpenAI function-calling 工具定义。 */
export const WEB_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "向搜索引擎发送查询词，返回自然结果列表（标题 + URL + 摘要）。用于发现信息来源，不返回页面全文。查时效信息（门票/天气/车次/营业时间）时务必带上目的地和年份。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索查询词，中文，尽量具体（含地点 + 主题 + 时间）" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_fetch",
      description:
        "抓取指定 URL 的页面正文（已去广告/脚本，纯文本，最多约 5000 字）。用于打开 web_search 结果里最权威的链接读取实际内容。一次只抓一个 URL。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要抓取的完整 http(s) 页面地址，通常来自 web_search 的结果" },
        },
        required: ["url"],
      },
    },
  },
];

/** 执行一次工具调用，返回给模型的字符串结果。 */
export async function runWebTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "web_search") {
    const query = String(args.query ?? "").trim();
    if (!query) return "查询词为空";
    const hits = await bingSearch(query);
    if (hits.length === 0) return `未搜到结果（可能被限流）。请换更简洁的查询词重试。查询：${query}`;
    return JSON.stringify(
      hits.map((h, i) => ({ n: i + 1, title: h.title, url: h.url, snippet: h.snippet })),
      null,
      0,
    );
  }
  if (name === "web_fetch") {
    const url = String(args.url ?? "").trim();
    if (!url) return "URL 为空";
    const text = await fetchPageText(url);
    return `【页面正文｜来源 ${url}】\n${text}`;
  }
  return `未知工具：${name}`;
}
