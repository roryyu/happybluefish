/**
 * 紫微斗数排盘核心库
 *
 * 基于 iztro 开源排盘引擎（https://github.com/SylarLong/iztro），
 * 引擎口径参考 https://github.com/Renhuai123/ziwei-doushu（MIT License）：
 *  - 年干支按农历正月初一换年（iztro 默认 yearDivide: 'normal'，与文墨/测测等主流派一致）
 *  - 晚子时 23:00-23:59 归次日早子时，与八字日柱换日规则保持一致
 *  - 1990 年前的夏令时、真太阳时经度差本库不处理，出生时间按北京时间输入
 *
 * 与 lib/bazi.ts 共用同一份出生信息（公历年月日 + 0-23 小时 + 性别）。
 */

import { astro } from "iztro";

// 十天干：0=甲 ... 9=癸
export const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;

// 十二地支：0=子 ... 11=亥
export const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;

export type SiHua = "禄" | "权" | "科" | "忌";

/** 星曜亮度（粗粒度，格局判定与配色用） */
export type StarBrightness = "bright" | "normal" | "dim";

export interface Star {
  name: string;
  type: "major" | "lucky" | "sha" | "minor";
  brightness?: StarBrightness;
  /** 原始 7 档亮度：庙 / 旺 / 得 / 利 / 平 / 不 / 陷 */
  brightnessRaw?: string;
  siHua?: SiHua;
}

export interface Palace {
  /** 地支索引 0=子 ... 11=亥 */
  branch: number;
  /** 天干索引 0=甲 ... 9=癸 */
  stem: number;
  /** 宫名（命宫、兄弟宫……） */
  name: string;
  stars: Star[];
  majorStars: Star[];
  luckyStars: Star[];
  shaStars: Star[];
  /** 杂耀（天刑、天哭、红鸾等） */
  adjectiveStars: Star[];
  /** 大限年龄段 */
  daXianAge?: [number, number];
  isMingGong: boolean;
  isShenGong: boolean;
  isCurrentDaXian: boolean;
  isEmpty: boolean;
  oppositeBranch: number;
  oppositeName: string;
  /** 空宫借对宫主星 */
  borrowedStars: string[];
  /** 小限年龄列表 */
  ages: number[];
  /** 长生十二神 */
  changsheng12: string;
  /** 博士十二神 */
  boshi12: string;
  /** 将前十二神 */
  jiangqian12: string;
  /** 岁前十二神 */
  suiqian12: string;
}

export interface DaXian {
  startAge: number;
  endAge: number;
  palaceName: string;
  branch: number;
  yearRange?: [number, number];
}

export interface ZiweiChart {
  /** 排盘用的公历日期（已做晚子时换日） */
  solarDate: string;
  /** 农历日期（中文） */
  lunarDate: string;
  /** 干支四柱 */
  chineseDate: string;
  timeName: string;
  timeRange: string;
  zodiac: string;
  sign: string;
  /** 命主 */
  soul: string;
  /** 身主 */
  body: string;
  /** 五行局，如「水二局」 */
  fiveElementsClass: string;
  /** 阳男 / 阴男 / 阳女 / 阴女 */
  yinYangGender: string;
  mingGongBranch: number;
  shenGongBranch: number;
  palaces: Palace[];
  daXians: DaXian[];
  currentAge: number;
  currentDaXian?: DaXian;
  /** 生年四化：禄 / 权 / 科 / 忌 对应的星曜 */
  siHua: Record<SiHua, string[]>;
  /** 23:00 后出生已按次日早子时排盘 */
  shiftedFromLateZi: boolean;
}

/** 六煞 */
const SHA_STARS = new Set(["擎羊", "陀罗", "火星", "铃星", "地空", "地劫"]);
/** 六吉 + 禄存天马 */
const LUCKY_STARS = new Set(["文昌", "文曲", "左辅", "右弼", "天魁", "天钺", "禄存", "天马"]);

/** 宫名统一为常见叫法 */
const PALACE_NAME_MAP: Record<string, string> = {
  仆役: "交友",
};

/** iztro 亮度 → 粗粒度三档 */
function mapBrightness(b?: string): StarBrightness | undefined {
  if (!b) return undefined;
  if (b.includes("庙") || b.includes("旺")) return "bright";
  if (b.includes("陷") || b.includes("不") || b.includes("闲")) return "dim";
  return "normal";
}

function mapStarType(name: string, iztroType: string): Star["type"] {
  if (SHA_STARS.has(name)) return "sha";
  if (LUCKY_STARS.has(name)) return "lucky";
  const t = (iztroType ?? "").toLowerCase();
  if (t === "major" || t === "主星") return "major";
  if (t === "tough" || t === "煞星") return "sha";
  if (t === "soft" || t === "吉星" || t === "lucun" || t === "tianma") return "lucky";
  return "minor";
}

/** 公历日期必须真实存在，否则 iztro 会把 2 月 30 日顺延成 3 月初 */
function assertValidSolarDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError("出生日期必须是整数");
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`公历日期不存在：${year}-${month}-${day}`);
  }
  if (year < 1900 || year > 2100) {
    throw new RangeError("出生年份需在 1900-2100 之间");
  }
}

/**
 * 主入口：根据出生公历年、月（1-12）、日、时（0-23）排紫微斗数命盘。
 *
 * 时辰映射：0-23 点 → 时辰地支索引 0-11；
 * 23 点后按次日排盘并取早子时，与 lib/bazi.ts 的日柱换日逻辑一致。
 */
export function calcZiwei(
  year: number,
  month: number,
  day: number,
  hour: number,
  gender: "male" | "female",
  /** 参照日期（用于虚岁/当前大限）；不传则不算当前运限，避免 SSR 与客户端日期不一致 */
  today?: Date,
): ZiweiChart {
  assertValidSolarDate(year, month, day);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("出生小时需为 0-23 的整数");
  }

  // 晚子时换日：23:00-23:59 归入次日子时
  let y = year;
  let m = month;
  let d = day;
  let timeIndex = Math.floor((hour + 1) / 2) % 12;
  const shiftedFromLateZi = hour === 23;
  if (shiftedFromLateZi) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
    timeIndex = 0;
  }

  const astrolabe = astro.bySolar(
    `${y}-${m}-${d}`,
    timeIndex,
    gender === "male" ? "男" : "女",
    true,
    "zh-CN",
  );

  // 当前虚岁与大限（以参照日期为准，未传时不算）
  let currentAge = 0;
  if (today) {
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    try {
      currentAge = astrolabe.horoscope(todayStr).age.nominalAge;
    } catch {
      // 运限接口异常时退回虚岁推导
      currentAge = today.getFullYear() - y + 1;
    }
  }

  const palaces: Palace[] = astrolabe.palaces.map((p) => {
    const branch = BRANCHES.indexOf(p.earthlyBranch as (typeof BRANCHES)[number]);
    const stem = STEMS.indexOf(p.heavenlyStem as (typeof STEMS)[number]);
    const rawName = p.name as string;
    // iztro 的命宫返回「命宫」，其余宫位返回「田宅」「父母」这类不带后缀的名称
    const baseName = PALACE_NAME_MAP[rawName] ?? rawName;
    const name = baseName.endsWith("宫") ? baseName : `${baseName}宫`;

    const allStars: Star[] = [
      ...p.majorStars.map((s) => ({
        name: s.name as string,
        type: "major" as const,
        brightness: mapBrightness(s.brightness as string | undefined),
        brightnessRaw: (s.brightness as string | undefined) || undefined,
        siHua: (s.mutagen || undefined) as SiHua | undefined,
      })),
      ...p.minorStars.map((s) => ({
        name: s.name as string,
        type: mapStarType(s.name as string, s.type as string),
        brightness: mapBrightness(s.brightness as string | undefined),
        brightnessRaw: (s.brightness as string | undefined) || undefined,
        siHua: (s.mutagen || undefined) as SiHua | undefined,
      })),
      ...p.adjectiveStars.map((s) => ({
        name: s.name as string,
        type: mapStarType(s.name as string, s.type as string),
        brightness: mapBrightness(s.brightness as string | undefined),
        brightnessRaw: (s.brightness as string | undefined) || undefined,
      })),
    ];

    const majorStars = allStars.filter((s) => s.type === "major");
    const daXianAge = p.decadal?.range
      ? ([p.decadal.range[0], p.decadal.range[1]] as [number, number])
      : undefined;

    return {
      branch: branch >= 0 ? branch : 0,
      stem: stem >= 0 ? stem : 0,
      name,
      stars: allStars,
      majorStars,
      luckyStars: allStars.filter((s) => s.type === "lucky"),
      shaStars: allStars.filter((s) => s.type === "sha"),
      adjectiveStars: allStars.filter((s) => s.type === "minor"),
      daXianAge,
      isMingGong: name === "命宫",
      isShenGong: p.isBodyPalace,
      isCurrentDaXian: false,
      isEmpty: majorStars.length === 0,
      oppositeBranch: (branch + 6) % 12,
      oppositeName: "",
      borrowedStars: [],
      ages: (p.ages as number[]) ?? [],
      changsheng12: (p.changsheng12 as string) ?? "",
      boshi12: (p.boshi12 as string) ?? "",
      jiangqian12: (p.jiangqian12 as string) ?? "",
      suiqian12: (p.suiqian12 as string) ?? "",
    };
  });

  // 对宫信息、空宫借星、当前大限高亮
  for (const p of palaces) {
    const opposite = palaces.find((q) => q.branch === p.oppositeBranch);
    p.oppositeName = opposite?.name ?? "";
    if (p.isEmpty && opposite) {
      p.borrowedStars = opposite.majorStars.map((s) => s.name);
    }
    if (p.daXianAge && currentAge > 0 && currentAge >= p.daXianAge[0] && currentAge <= p.daXianAge[1]) {
      p.isCurrentDaXian = true;
    }
  }

  const daXians: DaXian[] = palaces
    .filter((p) => p.daXianAge)
    .sort((a, b) => a.daXianAge![0] - b.daXianAge![0])
    .map((p) => ({
      startAge: p.daXianAge![0],
      endAge: p.daXianAge![1],
      palaceName: p.name,
      branch: p.branch,
    }));

  // 大限对应年份区间（用于展示）
  try {
    for (const item of astrolabe.decadalList()) {
      const target = daXians.find(
        (dx) => dx.startAge === item.ageRange[0] && dx.endAge === item.ageRange[1],
      );
      if (target) target.yearRange = [item.yearRange[0], item.yearRange[1]];
    }
  } catch {
    // 运限接口异常时忽略年份区间
  }

  const currentDaXian = currentAge > 0
    ? daXians.find((dx) => currentAge >= dx.startAge && currentAge <= dx.endAge)
    : undefined;

  // 生年四化：从星曜 mutagen 汇总
  const siHua: Record<SiHua, string[]> = { 禄: [], 权: [], 科: [], 忌: [] };
  for (const p of palaces) {
    for (const s of p.stars) {
      if (s.siHua && !siHua[s.siHua].includes(s.name)) {
        siHua[s.siHua].push(s.name);
      }
    }
  }

  const yearStem = (astrolabe.chineseDate as string).split(" ")[0]?.[0] ?? "";
  const yangStem = ["甲", "丙", "戊", "庚", "壬"].includes(yearStem);
  const yinYangGender = `${yangStem ? "阳" : "阴"}${gender === "male" ? "男" : "女"}`;

  const mingGongBranch = BRANCHES.indexOf(
    astrolabe.earthlyBranchOfSoulPalace as (typeof BRANCHES)[number],
  );
  const shenGongBranch = BRANCHES.indexOf(
    astrolabe.earthlyBranchOfBodyPalace as (typeof BRANCHES)[number],
  );

  return {
    solarDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    lunarDate: astrolabe.lunarDate as string,
    chineseDate: astrolabe.chineseDate as string,
    timeName: astrolabe.time as string,
    timeRange: astrolabe.timeRange as string,
    zodiac: astrolabe.zodiac as string,
    sign: astrolabe.sign as string,
    soul: astrolabe.soul as string,
    body: astrolabe.body as string,
    fiveElementsClass: astrolabe.fiveElementsClass as string,
    yinYangGender,
    mingGongBranch: mingGongBranch >= 0 ? mingGongBranch : 0,
    shenGongBranch: shenGongBranch >= 0 ? shenGongBranch : 0,
    palaces,
    daXians,
    currentAge,
    currentDaXian,
    siHua,
    shiftedFromLateZi,
  };
}
