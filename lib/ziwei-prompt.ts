/**
 * 紫微斗数命盘 → AI 分析提示词格式化
 *
 * 纯文本序列化，不依赖 React/DOM，可被客户端页面直接调用。
 * 输出覆盖：基本盘信息、生年四化、十二宫星曜、格局、大限。
 */

import { BRANCHES, STEMS, type Palace, type Star, type ZiweiChart } from "./ziwei";
import { detectPatterns, getMingGongSummary, type Pattern } from "./ziwei-patterns";

const PATTERN_LEVEL_LABEL: Record<Pattern["level"], string> = {
  excellent: "上格",
  good: "吉格",
  neutral: "中格",
  caution: "破格",
};

/** 十二宫按传统阅读顺序输出，不跟随 iztro 内部顺序 */
const PALACE_ORDER = [
  "命宫",
  "兄弟宫",
  "夫妻宫",
  "子女宫",
  "财帛宫",
  "疾厄宫",
  "迁移宫",
  "交友宫",
  "官禄宫",
  "田宅宫",
  "福德宫",
  "父母宫",
];

/** iztro 个别星名/宫名带空格或全角空格，输出前清掉 */
function cleanLabel(text: string): string {
  return text.replace(/\s+/g, "");
}

function palaceRank(name: string): number {
  const idx = PALACE_ORDER.indexOf(name);
  return idx >= 0 ? idx : PALACE_ORDER.length;
}

function starLabel(star: Star): string {
  let text = cleanLabel(star.name);
  if (star.brightnessRaw) text += `（${star.brightnessRaw}）`;
  if (star.siHua) text += `[化${star.siHua}]`;
  return text;
}

function starList(stars: Star[]): string {
  return stars.length ? stars.map(starLabel).join("、") : "无";
}

function palaceOfStar(chart: ZiweiChart, starName: string): string {
  const palace = chart.palaces.find((p) => p.stars.some((s) => s.name === starName));
  return palace ? palace.name : "";
}

function siHuaLine(chart: ZiweiChart): string {
  return (["禄", "权", "科", "忌"] as const)
    .map((hua) => {
      const stars = chart.siHua[hua] ?? [];
      if (stars.length === 0) return `${hua}：无`;
      const named = stars.map((star) => {
        const palace = palaceOfStar(chart, star);
        return palace ? `${star}（${palace}）` : star;
      });
      return `${hua}：${named.join("、")}`;
    })
    .join("；");
}

function formatPalace(p: Palace): string {
  const tags: string[] = [];
  if (p.isMingGong) tags.push("命宫");
  if (p.isShenGong) tags.push("身宫");
  if (p.isCurrentDaXian) tags.push("当前大限");
  const tag = tags.length ? `【${tags.join("·")}】` : "";

  const segments: string[] = [];
  if (p.majorStars.length > 0) {
    segments.push(`主星：${starList(p.majorStars)}`);
  } else {
    const borrowed = p.borrowedStars.length
      ? `（借对宫${cleanLabel(p.oppositeName)}：${p.borrowedStars.map(cleanLabel).join("、")}）`
      : "";
    segments.push(`主星：空宫${borrowed}`);
  }
  if (p.luckyStars.length > 0) segments.push(`六吉：${starList(p.luckyStars)}`);
  if (p.shaStars.length > 0) segments.push(`六煞：${starList(p.shaStars)}`);
  if (p.adjectiveStars.length > 0) {
    segments.push(`杂耀：${p.adjectiveStars.map((s) => cleanLabel(s.name)).join("、")}`);
  }
  if (p.daXianAge) segments.push(`大限：${p.daXianAge[0]}-${p.daXianAge[1]} 岁`);

  return `- ${cleanLabel(p.name)}${tag}（${STEMS[p.stem]}${BRANCHES[p.branch]}）：${segments.join("；")}`;
}

function formatPattern(pattern: Pattern): string[] {
  const scope = pattern.palaces.length ? `；涉及：${pattern.palaces.join("、")}` : "";
  const lines = [
    `- ${pattern.name}（${PATTERN_LEVEL_LABEL[pattern.level]}${scope}）：${pattern.description}`,
  ];
  const detail: string[] = [];
  if (pattern.conditions?.required.length) {
    detail.push(`成格：${pattern.conditions.required.join("、")}`);
  }
  if (pattern.conditions?.bonus?.length) {
    detail.push(`加分：${pattern.conditions.bonus.join("、")}`);
  }
  if (pattern.conditions?.breaking?.length) {
    detail.push(`破格：${pattern.conditions.breaking.join("、")}`);
  }
  if (detail.length) lines.push(`  ${detail.join("；")}`);
  if (pattern.source) lines.push(`  出处：${pattern.source}`);
  return lines;
}

/**
 * 序列化为提示词片段；未传 today 排出的命盘不含虚岁与当前大限。
 */
export function buildZiweiPromptSection(chart: ZiweiChart): string {
  const lines: string[] = [];
  lines.push("【紫微斗数命盘】");
  lines.push(
    "口径：农历正月初一换年；23:00 后晚子时归次日早子时；出生时间按北京时间。",
  );
  lines.push(
    `- 公历：${chart.solarDate}；农历：${chart.lunarDate}；四柱：${chart.chineseDate}；时辰：${cleanLabel(chart.timeName)}（${cleanLabel(chart.timeRange)}）`,
  );
  lines.push(
    `- 生肖/星座：${chart.zodiac} / ${chart.sign}；五行局：${chart.fiveElementsClass}；阴阳男女：${chart.yinYangGender}`,
  );
  lines.push(`- 命主：${chart.soul}；身主：${chart.body}`);
  lines.push(
    `- 命宫：${BRANCHES[chart.mingGongBranch]}宫；身宫：${BRANCHES[chart.shenGongBranch]}宫`,
  );
  lines.push(`- 生年四化：${siHuaLine(chart)}`);

  const mingSummary = getMingGongSummary(chart);
  lines.push(
    `- 命宫摘要：主星${mingSummary.stars.length ? mingSummary.stars.join("、") : "无（空宫）"}；关键词：${mingSummary.keywords.join("、") || "—"}；气质：${mingSummary.nature || "—"}`,
  );
  if (chart.shiftedFromLateZi) {
    lines.push("- 说明：出生时间在 23:00 后，已按次日早子时排盘。");
  }
  if (chart.currentAge > 0) {
    lines.push(`- 当前虚岁：${chart.currentAge}`);
  }
  if (chart.currentDaXian) {
    const d = chart.currentDaXian;
    lines.push(
      `- 当前大限：${d.startAge}-${d.endAge} 岁，${cleanLabel(d.palaceName)}（${BRANCHES[d.branch]}宫）`,
    );
  }

  lines.push("");
  lines.push("【紫微十二宫】");
  const palaces = [...chart.palaces].sort((a, b) => palaceRank(a.name) - palaceRank(b.name));
  for (const p of palaces) lines.push(formatPalace(p));

  lines.push("");
  lines.push("【紫微格局】");
  const patterns = detectPatterns(chart);
  if (patterns.length === 0) {
    lines.push("- 未识别到经典紫微格局。");
  } else {
    for (const pattern of patterns) lines.push(...formatPattern(pattern));
  }

  if (chart.daXians.length > 0) {
    lines.push("");
    lines.push("【紫微大限】");
    const parts = chart.daXians.map((d) => {
      const current =
        chart.currentDaXian?.startAge === d.startAge &&
        chart.currentDaXian?.endAge === d.endAge
          ? "（当前）"
          : "";
      const years = d.yearRange ? `，${d.yearRange[0]}-${d.yearRange[1]} 年` : "";
      return `${d.startAge}-${d.endAge} 岁${current}：${cleanLabel(d.palaceName)}${years}`;
    });
    lines.push(`- ${parts.join("；")}`);
  }

  return lines.join("\n");
}
