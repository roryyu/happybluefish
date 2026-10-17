"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BRANCHES,
  STEMS,
  calcZiwei,
  type Palace,
  type Star,
  type ZiweiChart,
} from "@/lib/ziwei";
import { detectPatterns, getMingGongSummary, type Pattern } from "@/lib/ziwei-patterns";

type GenderType = "male" | "female";

export type ZiweiInput = {
  y: number;
  m: number;
  d: number;
  h: number;
  name?: string;
  gender?: GenderType;
};

/** 十二宫在 4x4 盘面的位置：上排巳午未申，下排寅丑子亥 */
const BRANCH_GRID_POS: Record<number, [number, number]> = {
  5: [1, 1], 6: [1, 2], 7: [1, 3], 8: [1, 4],
  4: [2, 1], 9: [2, 4],
  3: [3, 1], 10: [3, 4],
  2: [4, 1], 1: [4, 2], 0: [4, 3], 11: [4, 4],
};

/** 按盘面顺时针顺序渲染，动画与视觉阅读一致 */
const RENDER_ORDER = [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];

const PATTERN_LEVEL_LABEL: Record<Pattern["level"], string> = {
  excellent: "上格",
  good: "吉格",
  neutral: "中格",
  caution: "破格",
};

export default function ZiweiView({ input }: { input: ZiweiInput }) {
  // 虚岁/当前大限依赖「今天」，挂载后再算，避免静态预渲染与客户端日期不一致
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    setToday(new Date());
  }, []);

  const chart = useMemo<ZiweiChart | null>(() => {
    try {
      return calcZiwei(input.y, input.m, input.d, input.h, input.gender ?? "male", today ?? undefined);
    } catch {
      return null;
    }
  }, [input, today]);

  const patterns = useMemo(() => (chart ? detectPatterns(chart) : []), [chart]);
  const summary = useMemo(
    () => (chart ? getMingGongSummary(chart) : { stars: [], keywords: [], nature: "" }),
    [chart],
  );

  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);

  // 重新排盘后收起旧的宫位详情
  useEffect(() => {
    setSelectedBranch(null);
  }, [input]);

  if (!chart) {
    return (
      <div className="card">
        <h2>紫微斗数命盘</h2>
        <p className="tip">出生日期无效，无法排紫微斗数命盘。</p>
      </div>
    );
  }

  const selected = chart.palaces.find((p) => p.branch === selectedBranch) ?? null;
  const palaceMap: Record<number, Palace> = {};
  chart.palaces.forEach((p) => {
    palaceMap[p.branch] = p;
  });

  return (
    <>
      <div className="card">
        <h2>紫微斗数命盘</h2>
        <p className="tip" style={{ marginBottom: 14 }}>
          以农历正月初一换年、23:00 后晚子时归次日排盘，与上方八字同源同一出生信息。
          {chart.shiftedFromLateZi && (
            <span className="tag" style={{ marginLeft: 6 }}>
              已按晚子时归入次日
            </span>
          )}
        </p>

        <div className="zw-summary">
          <div>
            <span>公历</span>
            <strong>{chart.solarDate}</strong>
          </div>
          <div>
            <span>农历</span>
            <strong>{chart.lunarDate}</strong>
          </div>
          <div>
            <span>四柱</span>
            <strong>{chart.chineseDate}</strong>
          </div>
          <div>
            <span>时辰</span>
            <strong>{chart.timeName}（{chart.timeRange}）</strong>
          </div>
          <div>
            <span>生肖 / 星座</span>
            <strong>{chart.zodiac} / {chart.sign}</strong>
          </div>
          <div>
            <span>五行局</span>
            <strong>{chart.fiveElementsClass}</strong>
          </div>
          <div>
            <span>命主 / 身主</span>
            <strong>{chart.soul} / {chart.body}</strong>
          </div>
          <div>
            <span>阴阳性别</span>
            <strong>{chart.yinYangGender}</strong>
          </div>
        </div>

        <div className="zw-sihua">
          <span className="zw-sihua-title">生年四化</span>
          {(["禄", "权", "科", "忌"] as const).map((k) => (
            <span key={k} className="zw-sihua-item">
              <em className={`zw-sihua-badge sihua-${k}`}>{k}</em>
              {chart.siHua[k].length ? chart.siHua[k].join("、") : "—"}
            </span>
          ))}
        </div>

        <div className="zw-board-wrap">
          <div className="zw-board">
            {RENDER_ORDER.map((branch) => {
              const palace = palaceMap[branch];
              if (!palace) return null;
              const [row, col] = BRANCH_GRID_POS[branch];
              return (
                <div
                  key={branch}
                  className="zw-cell-slot"
                  style={{ gridRow: row, gridColumn: col }}
                >
                  <PalaceCell
                    palace={palace}
                    selected={selectedBranch === branch}
                    onSelect={() =>
                      setSelectedBranch((prev) => (prev === branch ? null : branch))
                    }
                  />
                </div>
              );
            })}

            <div className="zw-center">
              <div className="zw-center-mark">☯</div>
              <div className="zw-center-title">紫微斗数</div>
              <div className="zw-center-line">
                命宫 <strong>{BRANCHES[chart.mingGongBranch]}</strong>
                <span className="zw-dot" />
                身宫 <strong>{BRANCHES[chart.shenGongBranch]}</strong>
              </div>
              <div className="zw-center-line">{chart.fiveElementsClass}</div>
              <div className="zw-center-line zw-center-sub">
                命主 {chart.soul} · 身主 {chart.body}
              </div>
              {summary.nature && (
                <div className="zw-center-line zw-center-sub">
                  命宫主星：{summary.stars.length ? summary.stars.join("、") : "空宫"}
                  {summary.nature ? `（${summary.nature}）` : ""}
                </div>
              )}
              {summary.keywords.length > 0 && (
                <div className="zw-center-keywords">
                  {summary.keywords.map((k) => (
                    <span key={k}>{k}</span>
                  ))}
                </div>
              )}
              {chart.currentDaXian && (
                <div className="zw-center-daxian">
                  <span>当前大限</span>
                  <strong>
                    {chart.currentDaXian.startAge}–{chart.currentDaXian.endAge} 岁
                  </strong>
                  <span>{chart.currentDaXian.palaceName}</span>
                  <span className="zw-center-sub">虚岁 {chart.currentAge}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="tip" style={{ marginTop: 10 }}>
          点击宫位可查看该宫星曜与神煞详情；空宫借对宫主星参看。
        </p>
      </div>

      {selected && <PalaceDetail palace={selected} chart={chart} />}

      {patterns.length > 0 && (
        <div className="card">
          <h2>格局</h2>
          <p className="tip" style={{ marginBottom: 10 }}>
            依据《紫微斗数全书》《骨髓赋》与倪海厦《天纪》讲义识别，共 {patterns.length} 条。
          </p>
          <ul className="zw-patterns">
            {patterns.map((p) => (
              <li key={p.name} className={`zw-pattern level-${p.level}`}>
                <div className="zw-pattern-head">
                  <strong>{p.name}</strong>
                  <span className={`zw-pattern-level level-${p.level}`}>
                    {PATTERN_LEVEL_LABEL[p.level]}
                  </span>
                  {p.palaces.length > 0 && (
                    <span className="zw-pattern-palaces">{p.palaces.join(" · ")}</span>
                  )}
                </div>
                <p className="zw-pattern-desc">{p.description}</p>
                {p.conditions && (
                  <div className="zw-pattern-cond">
                    {p.conditions.required.length > 0 && (
                      <span className="cond required">成立：{p.conditions.required.join("；")}</span>
                    )}
                    {p.conditions.bonus && p.conditions.bonus.length > 0 && (
                      <span className="cond bonus">加分：{p.conditions.bonus.join("；")}</span>
                    )}
                    {p.conditions.breaking && p.conditions.breaking.length > 0 && (
                      <span className="cond breaking">破格：{p.conditions.breaking.join("；")}</span>
                    )}
                  </div>
                )}
                {p.source && <div className="zw-pattern-source">出处：{p.source}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>大限</h2>
        <ul className="zw-daxian-list">
          {chart.daXians.map((dx) => {
            const isCurrent =
              chart.currentDaXian?.startAge === dx.startAge &&
              chart.currentDaXian?.endAge === dx.endAge;
            return (
              <li key={`${dx.startAge}-${dx.endAge}`} className={isCurrent ? "is-current" : ""}>
                <strong>
                  {dx.startAge}–{dx.endAge} 岁
                </strong>
                <span>{dx.palaceName}</span>
                <span className="zw-daxian-branch">{BRANCHES[dx.branch]}宫</span>
                {dx.yearRange && (
                  <span className="zw-daxian-years">
                    {dx.yearRange[0]}–{dx.yearRange[1]}
                  </span>
                )}
                {isCurrent && <span className="zw-daxian-now">当前</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function StarChip({ star, kind }: { star: Star; kind: "major" | "lucky" | "sha" | "minor" }) {
  const brightClass =
    kind === "major"
      ? star.brightness === "bright"
        ? "is-bright"
        : star.brightness === "dim"
        ? "is-dim"
        : ""
      : "";
  return (
    <span className={`zw-star zw-star-${kind} ${brightClass}`}>
      {star.name}
      {star.brightnessRaw && kind === "major" && (
        <i className="zw-brightness">{star.brightnessRaw}</i>
      )}
      {star.siHua && <em className={`zw-sihua-badge sihua-${star.siHua}`}>{star.siHua}</em>}
    </span>
  );
}

function PalaceCell({
  palace,
  selected,
  onSelect,
}: {
  palace: Palace;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${palace.name}${palace.majorStars.length ? "，主星" + palace.majorStars.map((s) => s.name).join("、") : "，空宫"}`}
      className={[
        "zw-cell",
        selected ? "is-selected" : "",
        palace.isMingGong ? "is-ming" : "",
        palace.isShenGong ? "is-shen" : "",
        palace.isCurrentDaXian ? "is-current-daxian" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="zw-cell-top">
        <span className="zw-palace-name">{palace.name}</span>
        <span className="zw-cell-tags">
          {palace.isMingGong && <i className="zw-tag ming">命</i>}
          {palace.isShenGong && <i className="zw-tag shen">身</i>}
          {palace.daXianAge && (
            <i className="zw-age">
              {palace.daXianAge[0]}–{palace.daXianAge[1]}
            </i>
          )}
        </span>
      </div>

      <div className="zw-ganzhi">
        {STEMS[palace.stem]}
        {BRANCHES[palace.branch]}
      </div>

      <div className="zw-major-row">
        {palace.majorStars.length === 0 ? (
          <span className="zw-empty">空宫</span>
        ) : (
          palace.majorStars.map((s) => <StarChip key={s.name} star={s} kind="major" />)
        )}
      </div>

      {palace.luckyStars.length > 0 && (
        <div className="zw-star-row">
          {palace.luckyStars.map((s) => (
            <StarChip key={s.name} star={s} kind="lucky" />
          ))}
        </div>
      )}

      {palace.shaStars.length > 0 && (
        <div className="zw-star-row">
          {palace.shaStars.map((s) => (
            <StarChip key={s.name} star={s} kind="sha" />
          ))}
        </div>
      )}

      {palace.isEmpty && palace.borrowedStars.length > 0 && (
        <div className="zw-borrow">借：{palace.borrowedStars.join("、")}</div>
      )}
    </div>
  );
}

function PalaceDetail({ palace, chart }: { palace: Palace; chart: ZiweiChart }) {
  return (
    <div className="card">
      <h2>
        {palace.name} · {STEMS[palace.stem]}
        {BRANCHES[palace.branch]}
      </h2>
      <div className="zw-detail-meta">
        {palace.isMingGong && <span className="tag">命宫</span>}
        {palace.isShenGong && <span className="tag">身宫</span>}
        {palace.daXianAge && (
          <span className="tag">
            大限 {palace.daXianAge[0]}–{palace.daXianAge[1]} 岁
          </span>
        )}
        <span className="tag">对宫 {palace.oppositeName || "—"}</span>
        {chart.currentAge > 0 && <span className="tag">虚岁 {chart.currentAge}</span>}
      </div>

      <DetailRow
        label="主星"
        stars={palace.majorStars}
        empty={palace.isEmpty ? `空宫，借对宫 ${palace.borrowedStars.join("、") || "—"}` : "无"}
      />
      <DetailRow label="六吉 / 禄马" stars={palace.luckyStars} empty="无" />
      <DetailRow label="六煞" stars={palace.shaStars} empty="无" />
      <DetailRow label="杂耀" stars={palace.adjectiveStars} empty="无" />

      <div className="zw-detail-gods">
        <div>
          <span>长生十二神</span>
          <strong>{palace.changsheng12 || "—"}</strong>
        </div>
        <div>
          <span>博士十二神</span>
          <strong>{palace.boshi12 || "—"}</strong>
        </div>
        <div>
          <span>将前十二神</span>
          <strong>{palace.jiangqian12 || "—"}</strong>
        </div>
        <div>
          <span>岁前十二神</span>
          <strong>{palace.suiqian12 || "—"}</strong>
        </div>
      </div>

      <p className="tip" style={{ marginTop: 10 }}>
        小限年龄：{palace.ages.length ? palace.ages.join("、") : "—"}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  stars,
  empty,
}: {
  label: string;
  stars: Star[];
  empty: string;
}) {
  return (
    <div className="zw-detail-row">
      <span className="zw-detail-label">{label}</span>
      <div className="zw-detail-stars">
        {stars.length === 0 ? (
          <span className="zw-detail-empty">{empty}</span>
        ) : (
          stars.map((s) => (
            <StarChip
              key={s.name}
              star={s}
              kind={
                s.type === "major"
                  ? "major"
                  : s.type === "lucky"
                  ? "lucky"
                  : s.type === "sha"
                  ? "sha"
                  : "minor"
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
