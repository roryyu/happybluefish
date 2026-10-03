"use client";

import "./gua.css";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HEXAGRAMS, TRIGRAMS, type Hexagram } from "./hexagrams";
import { loadYijinMap, pickReading, type YijinBlock, type YijinHexagram } from "./yijin";

/* ============ 常量 ============ */

const FONT_CSS =
  "https://miaoda.feishu.cn/fonts/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;600;700;900&family=Noto+Sans+SC:wght@300;400;500;700&display=swap";

const MUTE_KEY = "zy-muted";
const CFG_KEY = "zy-llm-cfg";
const SHAKE_MS = 980;
const TIMEOUT_MS = 90000;

const SYSTEM_PROMPT =
  "你是「周易灵签」的解签师，精通《周易》义理与象数，熟稔卦辞、象辞与卦象结构。请基于用户抽到的卦，给出庄重、清晰、有启发的中文解读：先讲卦义要点，再结合提问者的实际处境与选择给出具体建议，避免空话套话；引用卦辞象辞时自然融入，不机械翻译。回答要明确这是传统文化视角的参考，不作迷信断言。";

/** 卦谱环上八经卦的落位（顺时针：顶 → 右上 → 右 → 右下 → 底 → 左下 → 左 → 左上） */
const RING_POS: ReadonlyArray<{ key: string; x: number; y: number }> = [
  { key: "乾", x: 200, y: 30 },
  { key: "兑", x: 318, y: 78 },
  { key: "离", x: 366, y: 200 },
  { key: "震", x: 318, y: 322 },
  { key: "巽", x: 200, y: 370 },
  { key: "坎", x: 82, y: 322 },
  { key: "艮", x: 34, y: 200 },
  { key: "坤", x: 82, y: 78 },
];

interface Stick {
  /** 摇摆旋转角（度） */
  deg: number;
  /** 旋转中心 x / y（筒口下方） */
  pivotX: number;
  pivotY: number;
  /** 木签矩形 x / y / 高 */
  x: number;
  y: number;
  h: number;
  /** 彩色签头圆心 x / y */
  cx: number;
  cy: number;
  head: string;
  /** 出签动画延时（秒） */
  delay: number;
}

/** 签筒里 5 根签 */
const STICKS: readonly Stick[] = [
  { deg: -16, pivotX: 150, pivotY: 260, x: 142, y: 26, h: 150, cx: 146, cy: 26, head: "#8ab8ff", delay: 0 },
  { deg: -7, pivotX: 150, pivotY: 270, x: 158, y: 14, h: 158, cx: 162, cy: 14, head: "#e6c466", delay: 0.06 },
  { deg: 2, pivotX: 150, pivotY: 275, x: 174, y: 30, h: 146, cx: 178, cy: 30, head: "#8b6cff", delay: 0.12 },
  { deg: 12, pivotX: 150, pivotY: 260, x: 130, y: 20, h: 152, cx: 134, cy: 20, head: "#e6c466", delay: 0.18 },
  { deg: 22, pivotX: 150, pivotY: 265, x: 116, y: 38, h: 140, cx: 120, cy: 38, head: "#8ab8ff", delay: 0.24 },
];

const PARTICLE_COLORS = ["230,196,102", "138,184,255", "139,108,255"];

/* ============ 类型 ============ */

type ChatRole = "user" | "assistant" | "error";

interface ChatMsg {
  role: ChatRole;
  content: string;
}

interface LlmCfg {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  ph: number;
  tw: number;
  c: string;
}

type AudioContextCtor = new () => AudioContext;

/* ============ 纯工具 ============ */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

function prefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function apiUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(b) ? b : `${b}/chat/completions`;
}

/** 读取 localStorage，失败再退回 sessionStorage（隐私模式 / SSR 都不抛） */
function storageGet(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v != null) return v;
  } catch {
    /* 忽略：本地存储不可用 */
  }
  try {
    const v = window.sessionStorage.getItem(key);
    if (v != null) return v;
  } catch {
    /* 忽略：会话存储不可用 */
  }
  return null;
}

/** 写入 localStorage，失败再退回 sessionStorage；返回是否落到浏览器存储 */
function storageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    /* 忽略：本地存储不可用 */
  }
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    /* 忽略：会话存储不可用 */
  }
  return false;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 忽略：本地存储不可用 */
  }
}

function readCfg(): LlmCfg | null {
  const raw = storageGet(CFG_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const o = parsed as { baseUrl?: unknown; apiKey?: unknown; model?: unknown };
      if (typeof o.baseUrl === "string" && typeof o.apiKey === "string" && typeof o.model === "string") {
        return { baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model };
      }
    }
  } catch {
    /* 忽略：配置损坏，按未配置处理 */
  }
  return null;
}

function errName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === "object" && "name" in err) {
    const n = (err as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return "";
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "未知错误";
}

/** 从 OpenAI 兼容返回体里取 choices[0].message.content，全程用 unknown 收窄 */
function readContent(data: unknown): string {
  if (!data || typeof data !== "object" || !("choices" in data)) return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first: unknown = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function autoQuestion(h: Hexagram, reading?: YijinHexagram | null): string {
  const base =
    `我抽到了「第${h.n}签 ${h.name}（${h.aka}）」，上卦${TRIGRAMS[h.up].nat}、下卦${TRIGRAMS[h.lo].nat}。\n` +
    `卦辞：「${h.guaci}」\n` +
    `象曰：「${h.xiang}」\n`;
  // 若已有 yijin.json 的解签文书，附上判曰与卦象，供模型在此基础上深化
  let extra = "";
  if (reading) {
    const find = (t: string): string =>
      reading.content.find((b) => b.type === t)?.text?.replace(/\*\*/g, "").trim() ?? "";
    const panyue = find("panyue");
    const guaxiang = find("guaxiang");
    if (panyue) extra += `古人判曰：「${panyue}」\n`;
    if (guaxiang) extra += `卦象典故：「${guaxiang}」\n`;
  }
  return base + extra + "\n请为我进一步解读这一卦的卦义与启示，并针对我的处境给出具体建议。";
}

const ROLE_LABEL: Record<ChatRole, string> = { user: "你", assistant: "灵签师", error: "提示" };
const MSG_CLASS: Record<ChatRole, string> = { user: "msg user", assistant: "msg ai", error: "msg err" };

/* ---- 解签文书渲染（yijin.json content） ---- */

/** 去掉源文里的 markdown 粗体标记（此处按纯文本渲染，不走 markdown 解析） */
const stripBold = (s: string): string => s.replace(/\*\*/g, "");

/** 跨卦导航条目，本页不展示 */
const RD_SKIP: ReadonlySet<string> = new Set(["nav"]);
/** 小节标题类 */
const RD_HEAD: ReadonlySet<string> = new Set(["label", "renjiandao", "shen", "guatuxiangjie"]);
/** 韵文 / 断语类（自带判曰、卦象、《彖》曰等前缀，另配语义标签） */
const RD_VERSE: ReadonlySet<string> = new Set([
  "panyue",
  "guaxiang",
  "tuzhong",
  "guaci",
  "tuanyue",
  "daxiang",
  "yaoci",
  "tixiang",
]);

const RD_HEAD_TEXT: Record<string, string> = {
  label: "本 卦",
  renjiandao: "人 间 道",
  shen: "引 申",
  guatuxiangjie: "卦 圖 象 解",
};

const RD_VERSE_TAG: Record<string, string> = {
  panyue: "判曰",
  guaxiang: "卦象",
  tuzhong: "圖中",
  guaci: "卦辞",
  tuanyue: "彖曰",
  daxiang: "象曰",
  yaoci: "爻辞",
  tixiang: "象解",
};

/** 把一条 content 渲染成对应版式的块 */
function ReadingBlock({ block }: { block: YijinBlock }) {
  if (RD_SKIP.has(block.type)) return null;

  if (block.type === "yao") {
    return (
      <div className="rd najia">
        <span className="rd-tag">纳甲六爻</span>
        <p className="rd-pre">{block.text}</p>
      </div>
    );
  }

  if (RD_HEAD.has(block.type)) {
    return <h4 className="rd-head">{RD_HEAD_TEXT[block.type] ?? stripBold(block.text)}</h4>;
  }

  if (RD_VERSE.has(block.type)) {
    const tag = RD_VERSE_TAG[block.type];
    return (
      <div className="rd verse">
        {tag ? <span className="rd-tag">{tag}</span> : null}
        <p className="rd-body">{block.text}</p>
      </div>
    );
  }

  return <p className="rd prose">{stripBold(block.text)}</p>;
}

/* ============ 页面 ============ */

export default function GuaPage() {
  const [current, setCurrent] = useState<Hexagram | null>(null);
  const [revealSeq, setRevealSeq] = useState(0);
  const [history, setHistory] = useState<Hexagram[]>([]);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [muted, setMuted] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);

  const [yijinMap, setYijinMap] = useState<Map<string, YijinHexagram> | null>(null);
  const [readingErr, setReadingErr] = useState("");

  const [cfg, setCfg] = useState<LlmCfg | null>(null);
  const [cfgUrl, setCfgUrl] = useState("");
  const [cfgKey, setCfgKey] = useState("");
  const [cfgModel, setCfgModel] = useState("");
  const [cfgErr, setCfgErr] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");

  const fxRef = useRef<HTMLCanvasElement | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const actxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const lastIdxRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  /* ---- 音效（WebAudio 合成） ---- */
  const audio = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const existing = actxRef.current;
    if (existing) {
      if (existing.state === "suspended") void existing.resume();
      return existing;
    }
    const scope = window as Window & { webkitAudioContext?: AudioContextCtor };
    const Ctor: AudioContextCtor | undefined =
      typeof window.AudioContext === "function" ? window.AudioContext : scope.webkitAudioContext;
    if (!Ctor) return null;
    try {
      const created = new Ctor();
      actxRef.current = created;
      if (created.state === "suspended") void created.resume();
      return created;
    } catch {
      return null;
    }
  };

  const playShake = (): void => {
    if (muted) return;
    const ctx = audio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const dur = 0.09 + Math.random() * 0.06;
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 500 + Math.random() * 900;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      src.connect(bp);
      bp.connect(g);
      g.connect(ctx.destination);
      src.start(t0 + i * 0.17);
      src.stop(t0 + i * 0.17 + dur);
    }
  };

  const playReveal = (): void => {
    if (muted) return;
    const ctx = audio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const scale: ReadonlyArray<readonly [number, number]> = [
      [523.25, 0.5],
      [659.25, 0.28],
      [783.99, 0.2],
      [1046.5, 0.12],
    ];
    scale.forEach((pair, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = pair[0];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(pair[1], t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4 + i * 0.08);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + 1.7 + i * 0.1);
    });
    const bass = ctx.createOscillator();
    bass.type = "sine";
    bass.frequency.value = 130.8;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    bass.connect(bg);
    bg.connect(master);
    bass.start(t0);
    bass.stop(t0 + 1);
  };

  /* ---- 挂载：读本地设置 / 粒子氛围 / 键盘关闭 / 卸载清理 ---- */

  useEffect(() => {
    aliveRef.current = true;
    setMuted(readMuted());
    setCfg(readCfg());
  }, []);

  /* ---- 拉取解签文书（yijin.json，整页仅一次） ---- */
  useEffect(() => {
    let cancelled = false;
    loadYijinMap()
      .then((m) => {
        if (!cancelled && aliveRef.current) setYijinMap(m);
      })
      .catch((err: unknown) => {
        if (!cancelled && aliveRef.current) setReadingErr(errMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cvs = fxRef.current;
    if (!cvs) return;
    const cctx = cvs.getContext("2d");
    if (!cctx) return;
    const reduce = prefersReduced();

    let w = 0;
    let h = 0;
    let parts: Particle[] = [];

    const sizeCanvas = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      cvs.width = w;
      cvs.height = h;
    };
    const seed = () => {
      const n = reduce ? 0 : Math.min(46, Math.max(16, Math.round(window.innerWidth / 28)));
      parts = [];
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.6 + Math.random() * 1.9,
          vy: -(0.12 + Math.random() * 0.35),
          vx: (Math.random() - 0.5) * 0.12,
          ph: Math.random() * Math.PI * 2,
          tw: 0.02 + Math.random() * 0.04,
          c: PARTICLE_COLORS[i % 3],
        });
      }
    };

    sizeCanvas();
    seed();

    let raf = 0;
    const tick = () => {
      cctx.clearRect(0, 0, w, h);
      cctx.globalCompositeOperation = "lighter";
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.ph += p.tw;
        if (p.y < -12) {
          p.y = h + 12;
          p.x = Math.random() * w;
        }
        if (p.x < -12) p.x = w + 12;
        else if (p.x > w + 12) p.x = -12;
        const a = 0.13 + 0.17 * (0.5 + 0.5 * Math.sin(p.ph));
        const g = cctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(${p.c},${a})`);
        g.addColorStop(1, `rgba(${p.c},0)`);
        cctx.fillStyle = g;
        cctx.beginPath();
        cctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        cctx.fill();
      }
      raf = window.requestAnimationFrame(tick);
    };
    if (!reduce) raf = window.requestAnimationFrame(tick);

    const onResize = () => {
      sizeCanvas();
      seed();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheetOpen(false);
      setChatOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const el = chatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, cfgOpen, chatOpen]);

  useEffect(() => {
    if (chatOpen && !cfgOpen) chatInputRef.current?.focus();
  }, [chatOpen, cfgOpen]);

  useEffect(
    () => () => {
      aliveRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      const ctx = actxRef.current;
      actxRef.current = null;
      if (ctx) void ctx.close().catch(() => undefined);
    },
    [],
  );

  /* ---- 抽签 / 看卦 ---- */

  const addHistory = (h: Hexagram) => {
    // 同一卦重复查看时先移除旧项：否则 chips 会出现重复 key（React 报警且渲染错乱）
    setHistory((prev) => [h, ...prev.filter((x) => x.n !== h.n)].slice(0, 6));
  };

  const reveal = (h: Hexagram) => {
    setCurrent(h);
    setRevealSeq((n) => n + 1);
    setMessages([]);
    setCfgErr("");
    window.scrollTo({ top: document.body.scrollHeight, behavior: prefersReduced() ? "auto" : "smooth" });
  };

  const drawOne = () => {
    if (busyRef.current) return;
    let i = 0;
    do {
      i = Math.floor(Math.random() * HEXAGRAMS.length);
    } while (HEXAGRAMS.length > 1 && i === lastIdxRef.current);
    lastIdxRef.current = i;
    const h = HEXAGRAMS[i];
    busyRef.current = true;
    setBusy(true);
    setShaking(true);
    playShake();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setShaking(false);
      addHistory(h);
      reveal(h);
      playReveal();
      busyRef.current = false;
      setBusy(false);
    }, SHAKE_MS);
  };

  const viewHex = (h: Hexagram) => {
    if (busyRef.current) return;
    addHistory(h);
    reveal(h);
    playReveal();
  };

  const clearHistory = () => {
    setHistory([]);
  };

  /* 解签文书加载失败时重试（loadYijinMap 已在失败时清缓存） */
  const reloadReading = () => {
    setReadingErr("");
    loadYijinMap()
      .then((m) => {
        if (aliveRef.current) setYijinMap(m);
      })
      .catch((err: unknown) => {
        if (aliveRef.current) setReadingErr(errMessage(err));
      });
  };

  const toggleMute = () => {
    const next = !muted;
    writeMuted(next);
    setMuted(next);
  };

  /* ---- 解签 ---- */

  const openCfgPanel = () => {
    setCfgUrl(cfg ? cfg.baseUrl : "");
    setCfgKey(cfg ? cfg.apiKey : "");
    setCfgModel(cfg ? cfg.model : "");
    setCfgErr("");
    setCfgOpen(true);
  };

  const openChat = () => {
    setChatOpen(true);
    if (cfg) setCfgOpen(false);
    else openCfgPanel();
  };

  const saveCfg = () => {
    const baseUrl = cfgUrl.trim();
    const apiKey = cfgKey.trim();
    const model = cfgModel.trim();
    if (!baseUrl || !apiKey || !model) {
      setCfgErr("请完整填写 Base URL、API Key 与模型名称。");
      return;
    }
    const next: LlmCfg = { baseUrl, apiKey, model };
    const persisted = storageSet(CFG_KEY, JSON.stringify(next));
    setCfg(next);
    setCfgErr("");
    setCfgOpen(false);
    setMessages([
      {
        role: "assistant",
        content: persisted
          ? "配置已保存（仅存于本机浏览器）。点击「解此卦」自动解读当前卦，或直接输入问题追问。"
          : "当前环境不支持本地存储，配置仅在本次页面会话内有效。点击「解此卦」自动解读当前卦，或直接输入问题追问。",
      },
    ]);
  };

  const sendChat = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    const conf = cfg;
    if (!conf) {
      openCfgPanel();
      return;
    }
    const outbound: ChatMsg[] = [...messages, { role: "user", content: text }];
    setDraft("");
    // textarea 是自增高高的，清空后必须把高度收回单行，否则输入框会一直撑高
    if (chatInputRef.current) chatInputRef.current.style.height = "auto";
    setMessages(outbound);
    setLoading(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const timer = window.setTimeout(() => ac.abort(), TIMEOUT_MS);

    let answer: ChatMsg = { role: "error", content: "请求失败：未知错误" };
    try {
      const outboundHistory = outbound.map((m) =>
        m.role === "error" ? { role: "user" as const, content: m.content } : { role: m.role, content: m.content },
      );
      const res = await fetch(apiUrl(conf.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${conf.apiKey}` },
        body: JSON.stringify({
          model: conf.model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...outboundHistory],
          temperature: 0.8,
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 160);
        } catch {
          detail = "";
        }
        throw new Error(`HTTP ${res.status}${detail ? `：${detail}` : ""}`);
      }
      const data: unknown = await res.json();
      const content = readContent(data);
      if (!content) throw new Error("返回数据中没有可用内容");
      answer = { role: "assistant", content };
    } catch (err) {
      const name = errName(err);
      let tag = errMessage(err);
      if (name === "AbortError") tag = "请求超时（90 秒）";
      else if (name === "TypeError") tag = "网络错误：可能被 CORS 拦截，或地址、密钥有误";
      answer = { role: "error", content: `请求失败：${tag}` };
    } finally {
      window.clearTimeout(timer);
      abortRef.current = null;
    }

    if (!aliveRef.current) return;
    setMessages((prev) => [...prev, answer]);
    setLoading(false);
    chatInputRef.current?.focus();
  };

  const doSend = () => {
    if (!draft.trim()) return;
    void sendChat(draft);
  };

  const askThisHex = () => {
    if (!current) {
      setMessages((prev) => [...prev, { role: "error", content: "请先摇一签，再开始解签。" }]);
      return;
    }
    void sendChat(autoQuestion(current, reading));
  };

  /* ---- 当前卦的派生数据 ---- */

  const trUp = current ? TRIGRAMS[current.up] : null;
  const trLo = current ? TRIGRAMS[current.lo] : null;
  /* 当前卦对应的解签文书（按上下卦命中 yijin.json） */
  const reading = current ? pickReading(yijinMap, current.up, current.lo) : null;
  const readingLoading = !!current && !yijinMap && !readingErr;
  const upItems = HEXAGRAMS.filter((h) => h.part === "上经");
  const loItems = HEXAGRAMS.filter((h) => h.part === "下经");

  return (
    <div className="gua-root">
      {/* 字体外链照契约 D5 原样保留；React 19 会把 <link> 提升到 <head> */}
      <link rel="preconnect" href="https://miaoda.feishu.cn" />
      <link rel="stylesheet" href={FONT_CSS} />

      <div className="bg" aria-hidden="true">
        <div className="bg-img" />
        <div className="veil" />
        <div className="glowline" />
      </div>
      <canvas className="fx" ref={fxRef} aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <span className="mark">周易灵签</span>
          <span className="sub">六十四卦 · 通行本</span>
        </div>
        <div className="top-actions">
          <button className="icon-btn" type="button" aria-label="打开卦谱" onClick={() => setSheetOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            卦谱
          </button>
          <button className="icon-btn" type="button" aria-label="切换音效" onClick={toggleMute}>
            {muted ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="m22 9-6 6M16 9l6 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            )}
            音效
          </button>
        </div>
      </header>

      <main className="stage">
        <section className="altar" aria-label="签坛">
          <div className="ring-stage">
            <div className="halo" />
            <svg className="ring-svg" viewBox="0 0 400 400" fill="none" aria-hidden="true">
              <circle cx="200" cy="200" r="188" stroke="rgba(230,196,102,.20)" strokeWidth="1" strokeDasharray="3 10" />
              <circle cx="200" cy="200" r="160" stroke="rgba(138,184,255,.16)" strokeWidth="1" strokeDasharray="1 8" />
              <g fontSize="26" fill="rgba(230,196,102,.55)" textAnchor="middle" dominantBaseline="central">
                {RING_POS.map((p) => (
                  <text key={p.key} x={p.x} y={p.y}>
                    {TRIGRAMS[p.key].sym}
                  </text>
                ))}
              </g>
            </svg>
            <div className={`tube-wrap${shaking ? " shaking" : ""}`}>
              <svg viewBox="0 0 300 350" aria-hidden="true" style={{ width: "100%", height: "auto" }}>
                <defs>
                  <linearGradient id="gua-bronze" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#4a3416" />
                    <stop offset=".28" stopColor="#7a5426" />
                    <stop offset=".5" stopColor="#8f6f2e" />
                    <stop offset=".74" stopColor="#6d4c20" />
                    <stop offset="1" stopColor="#3c2a12" />
                  </linearGradient>
                  <linearGradient id="gua-bronzeV" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#8f6f2e" />
                    <stop offset=".5" stopColor="#5d441c" />
                    <stop offset="1" stopColor="#3a2a10" />
                  </linearGradient>
                </defs>
                {STICKS.map((s, i) => (
                  <g
                    key={i}
                    className="stick"
                    transform={`rotate(${s.deg} ${s.pivotX} ${s.pivotY})`}
                    style={{ animationDelay: `${s.delay}s` }}
                  >
                    <rect x={s.x} y={s.y} width="8" height={s.h} rx="4" fill="#c99c45" opacity=".92" />
                    <circle cx={s.cx} cy={s.cy} r="6" fill={s.head} opacity=".95" />
                  </g>
                ))}
                <ellipse cx="150" cy="78" rx="74" ry="17" fill="#3a2a10" stroke="#c9a45a" strokeWidth="2.5" />
                <ellipse cx="150" cy="78" rx="60" ry="12" fill="#0c0818" />
                <path
                  d="M78,84 C80,150 62,190 64,252 Q65,318 150,318 Q235,318 236,252 C238,190 220,150 222,84 Z"
                  fill="url(#gua-bronze)"
                  stroke="#c9a45a"
                  strokeWidth="2.2"
                />
                <path
                  d="M108,120 C108,180 94,215 96,258 Q97,290 122,296"
                  stroke="rgba(255,255,255,.14)"
                  strokeWidth="10"
                  fill="none"
                  strokeLinecap="round"
                />
                <path d="M78,132 Q150,146 222,132" stroke="#c9a45a" strokeWidth="3" fill="none" opacity=".8" />
                <path d="M68,262 Q150,284 232,262" stroke="#c9a45a" strokeWidth="3" fill="none" opacity=".8" />
                <g transform="translate(150,202)">
                  <rect x="-26" y="-26" width="52" height="52" rx="5" fill="#2b1f0d" stroke="#c9a45a" strokeWidth="2" />
                  <text x="0" y="9" fontSize="30" textAnchor="middle" dominantBaseline="middle" fill="#e6c466" opacity=".9">
                    ☵
                  </text>
                </g>
                <ellipse cx="150" cy="318" rx="84" ry="13" fill="url(#gua-bronzeV)" stroke="#c9a45a" strokeWidth="2.2" />
                <ellipse cx="150" cy="330" rx="60" ry="8" fill="rgba(0,0,0,.4)" />
              </svg>
            </div>
          </div>
          <button className="draw-btn" type="button" disabled={busy} onClick={drawOne}>
            摇 签
          </button>
          <p className="hint">默念所问 · 轻叩灵签</p>
        </section>

        <section key={`card-${revealSeq}`} className={`card${current ? " show" : ""}`} aria-live="polite">
          <div className="card-frame">
            <div className="card-head">
              <span className="part-tag">{current ? `${current.part} · 第${pad2(current.n)}签` : ""}</span>
              <h2 className="gua-name">{current ? current.name : ""}</h2>
              <p className="gua-aka">
                {current && trUp && trLo ? (
                  <>
                    <span className="trg">{trUp.sym}</span>
                    {current.aka}
                    <span className="trg">{trLo.sym}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="gua-symbol" aria-label="卦象">
              {current
                ? [5, 4, 3, 2, 1, 0].map((i) => (
                    <div
                      key={i}
                      className={`yao ${current.lines[i] === "1" ? "yang" : "yin"}`}
                      style={{ animationDelay: `${((5 - i) * 0.12).toFixed(2)}s` }}
                    />
                  ))
                : null}
            </div>
            <p className="gua-upper">
              {current && trUp && trLo ? (
                <>
                  {"上卦 "}
                  <b>{`${current.up} · ${trUp.nat}`}</b>
                  {"　　下卦 "}
                  <b>{`${current.lo} · ${trLo.nat}`}</b>
                </>
              ) : null}
            </p>
            <div className="divider">
              <span className="dia" />
            </div>
            <div className="text-block">
              <h3 className="block-label">卦 辞</h3>
              <p className="block-text">{current ? current.guaci : ""}</p>
            </div>
            <div className="text-block">
              <h3 className="block-label">象 曰</h3>
              <p className="block-text">{current ? current.xiang : ""}</p>
            </div>
            <p className="card-note">卦辞 · 象辞 依通行本《周易》· 下方解签依《京氏易传》卦解</p>
            <div className="card-actions">
              <button className="again" type="button" onClick={drawOne}>
                再 摇 一 签
              </button>
              <button className="solve-btn" type="button" onClick={openChat}>
                进一步解读
              </button>
            </div>
          </div>
        </section>

        <section className={`reading${current ? " show" : ""}`} key={`reading-${revealSeq}`} aria-label="解签">
          <div className="reading-frame">
            <div className="reading-head">
              <h3 className="reading-title">解 签</h3>
              <span className="reading-src">《京氏易传》卦解 · 判曰 / 卦象 / 象解 / 彖象爻辞</span>
            </div>
            {current ? null : <p className="rd-empty">诚心默念所问，摇一签即得此卦详解。</p>}
            {readingLoading ? <p className="rd-loading">解签文书加载中……</p> : null}
            {readingErr ? (
              <p className="rd-error">
                {readingErr}
                <button className="rd-retry" type="button" onClick={reloadReading}>
                  重试
                </button>
              </p>
            ) : null}
            {reading ? (
              <div className="reading-body">
                <p className="rd-meta">{reading.raw}</p>
                {reading.content.map((b, i) => (
                  <ReadingBlock key={i} block={b} />
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className={`history${history.length > 0 ? " show" : ""}`} aria-label="今番所得">
          <div className="history-label">
            今番所得
            <span className="chip-actions">
              <button className="chip-clear" type="button" aria-label="清空今番所得" onClick={clearHistory}>
                清空
              </button>
            </span>
          </div>
          <div className="chips">
            {history.map((h) => (
              <button
                key={h.n}
                className="chip"
                type="button"
                aria-label={`重看第${pad2(h.n)}签 ${h.name}`}
                onClick={() => viewHex(h)}
              >
                <span className="no">{pad2(h.n)}</span>
                <span className="nm">{h.name}</span>
                <span className="ak">{h.aka}</span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="rule" />
        通行本《周易》六十四卦 · 上经三十 · 下经三十四
        <br />
        灵签仅供文化趣味 · 不构成任何现实建议
      </footer>

      {sheetOpen ? (
        <div
          className="sheet open"
          role="dialog"
          aria-modal="true"
          aria-label="六十四卦谱"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="sheet-panel">
            <div className="sheet-head">
              <h2>六十四卦谱</h2>
              <span className="desc">通行本序 · 点击查看卦象</span>
              <button className="sheet-close" type="button" aria-label="关闭卦谱" onClick={() => setSheetOpen(false)}>
                ✕
              </button>
            </div>
            <div className="sheet-cols">
              <div className="sheet-col">
                <h3>上 经 · 三十卦</h3>
                <div className="gua-grid">
                  {upItems.map((h) => (
                    <button
                      key={h.n}
                      className="gua-item"
                      type="button"
                      aria-label={`查看第${pad2(h.n)}签 ${h.name} ${h.aka}`}
                      onClick={() => {
                        setSheetOpen(false);
                        viewHex(h);
                      }}
                    >
                      <span className="no">{pad2(h.n)}</span>
                      <span className="nm">{h.name}</span>
                      <span className="ak">{h.aka}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="sheet-col">
                <h3>下 经 · 三十四卦</h3>
                <div className="gua-grid">
                  {loItems.map((h) => (
                    <button
                      key={h.n}
                      className="gua-item"
                      type="button"
                      aria-label={`查看第${pad2(h.n)}签 ${h.name} ${h.aka}`}
                      onClick={() => {
                        setSheetOpen(false);
                        viewHex(h);
                      }}
                    >
                      <span className="no">{pad2(h.n)}</span>
                      <span className="nm">{h.name}</span>
                      <span className="ak">{h.aka}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {chatOpen ? (
        <div
          className="chat open"
          role="dialog"
          aria-modal="true"
          aria-label="解签"
          onClick={(e) => {
            if (e.target === e.currentTarget) setChatOpen(false);
          }}
        >
          <div className="chat-panel">
            <div className="chat-head">
              <h2>解签</h2>
              <span className="ctx">
                {current ? `第${current.n}签 · ${current.name}（${current.aka}）` : "请先摇一签"}
              </span>
              <span className="sp" />
              <button className="icon-btn2" type="button" aria-label="设置接口" title="设置接口" onClick={openCfgPanel}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <button className="icon-btn2" type="button" aria-label="关闭解签" onClick={() => setChatOpen(false)}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {cfgOpen ? (
              <div className="chat-config open">
                <h3>接入大模型</h3>
                <p className="cfg-note">
                  填写 OpenAI 兼容接口的配置（OpenAI、DeepSeek、通义、智谱等官方或兼容地址）。配置仅保存在本机浏览器
                  localStorage，不会上传。
                </p>
                <div className="cfg-field">
                  <label htmlFor="gua-cfg-url">BASE URL</label>
                  <input
                    id="gua-cfg-url"
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    autoComplete="off"
                    spellCheck={false}
                    value={cfgUrl}
                    onChange={(e) => setCfgUrl(e.target.value)}
                  />
                </div>
                <div className="cfg-field">
                  <label htmlFor="gua-cfg-key">API KEY</label>
                  <input
                    id="gua-cfg-key"
                    type="password"
                    placeholder="sk-..."
                    autoComplete="new-password"
                    spellCheck={false}
                    value={cfgKey}
                    onChange={(e) => setCfgKey(e.target.value)}
                  />
                </div>
                <div className="cfg-field">
                  <label htmlFor="gua-cfg-model">MODEL</label>
                  <input
                    id="gua-cfg-model"
                    type="text"
                    placeholder="gpt-4o-mini"
                    autoComplete="off"
                    spellCheck={false}
                    value={cfgModel}
                    onChange={(e) => setCfgModel(e.target.value)}
                  />
                </div>
                <button className="cfg-save" type="button" onClick={saveCfg}>
                  保存并开始解签
                </button>
                <p className="cfg-sec" role="alert">
                  {cfgErr}
                </p>
                <p className="cfg-sec">提示：浏览器直连接口需该地址允许跨域（CORS）；如被拦截，请更换支持浏览器访问的接口地址。</p>
              </div>
            ) : (
              <>
                <div className="chat-body" ref={chatBodyRef}>
                  {messages.map((m, i) => (
                    <div key={i} className={MSG_CLASS[m.role]}>
                      <span className="role">{ROLE_LABEL[m.role]}</span>
                      {m.role === "assistant" ? (
                        <div className="md-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="plain">{m.content}</span>
                      )}
                    </div>
                  ))}
                  {loading ? <div className="msg ai typing">灵签师 正在推演卦象……</div> : null}
                </div>
                <div className="chat-foot">
                  <button className="chat-quick" type="button" onClick={askThisHex}>
                    解此卦
                  </button>
                  <div className="chat-input-row">
                    {/* textarea 而非 input：契约要求 Shift+Enter 换行，<input> 做不到。
                        高度随内容自增，超过 CSS max-height 后内部滚动。 */}
                    <textarea
                      className="chat-input"
                      rows={1}
                      placeholder="继续追问，如：此事应如何把握时机？"
                      value={draft}
                      ref={chatInputRef}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          doSend();
                        }
                      }}
                    />
                    <button className="chat-send" type="button" disabled={loading} onClick={doSend}>
                      发送
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}