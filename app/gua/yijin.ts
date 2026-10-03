/**
 * 《易经》解签数据接入。
 *
 * 数据源：public/gua/yijin.json —— 京房八宫结构，八宫 × 每宫八卦 = 六十四卦，
 * 每卦携带 content 数组（判曰 / 卦象 / 圖中 / 象解 / 人间道 / 卦辞 / 彖 / 象 / 爻辞 …）。
 *
 * 与本页 hexagrams.ts（通行本序）的对齐方式：以「上卦+下卦」经卦组合为键。
 * 六十四卦的 (上,下) 组合唯一，且两套数据都用同样的八个经卦字，故可做双射映射。
 * 源数据里有两处解析瑕疵，读取时在此修正，不改动手上的 json：
 *   - 山雷颐：upper 被识别成「良」，应为「艮」；
 *   - 水地比：upper / lower 均为空，按 raw「坎上坤下」补为 坎 / 坤。
 */

/** content 条目的类型 */
export type YijinBlockType =
  | "label"
  | "yao"
  | "text"
  | "panyue"
  | "guaxiang"
  | "tuzhong"
  | "guatuxiangjie"
  | "tixiang"
  | "renjiandao"
  | "nav"
  | "shen"
  | "guaci"
  | "tuanyue"
  | "daxiang"
  | "yaoci";

export interface YijinBlock {
  type: YijinBlockType;
  text: string;
}

export interface YijinHexagram {
  name: string;
  raw: string;
  stage: string;
  upper: string;
  lower: string;
  special: string;
  content: YijinBlock[];
}

interface YijinPalace {
  name: string;
  element: string;
  hexagrams: YijinHexagram[];
}

interface YijinDoc {
  title: string;
  frontMatter: unknown[];
  palaces: YijinPalace[];
}

/** 键：上卦 + 下卦 */
const keyOf = (upper: string, lower: string): string => `${upper}${lower}`;

/** 归一化上卦（修「良」→「艮」的手误） */
const normTrigram = (t: string): string => (t === "良" ? "艮" : t);

/** 按卦名修正两处解析瑕疵，返回可信的 (上,下) */
function resolvePair(h: YijinHexagram): { upper: string; lower: string } {
  if (h.name === "山雷颐") return { upper: "艮", lower: "震" };
  if (h.name === "水地比") return { upper: "坎", lower: "坤" };
  return { upper: normTrigram(h.upper), lower: normTrigram(h.lower) };
}

let mapPromise: Promise<Map<string, YijinHexagram>> | null = null;

/** 懒加载并缓存：整个页面生命周期只真正拉取一次 */
export function loadYijinMap(): Promise<Map<string, YijinHexagram>> {
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    const res = await fetch("/gua/yijin.json", { cache: "force-cache" });
    if (!res.ok) throw new Error(`解签数据加载失败：HTTP ${res.status}`);
    const doc = (await res.json()) as YijinDoc;
    const map = new Map<string, YijinHexagram>();
    for (const palace of doc.palaces ?? []) {
      for (const h of palace.hexagrams ?? []) {
        const { upper, lower } = resolvePair(h);
        if (upper && lower) map.set(keyOf(upper, lower), h);
      }
    }
    return map;
  })().catch((err: unknown) => {
    // 失败时清掉缓存，允许后续重试
    mapPromise = null;
    throw err;
  });
  return mapPromise;
}

/** 从映射表中按上下卦取解签内容 */
export function pickReading(
  map: Map<string, YijinHexagram> | null,
  upper: string,
  lower: string,
): YijinHexagram | null {
  if (!map) return null;
  return map.get(keyOf(upper, lower)) ?? null;
}
