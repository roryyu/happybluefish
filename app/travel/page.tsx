"use client";

import "../bazi.css";
import "./travel.css";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 可选偏好——对应 skill「阶段 0 · 需求采集」的关键维度，不选则由模型按默认补全。
const PREF_GROUPS: { key: string; label: string; options: string[] }[] = [
  { key: "人数", label: "人数结构", options: ["一人行", "情侣", "闺蜜局", "兄弟局", "家庭带娃", "家庭带长辈"] },
  { key: "玩法", label: "玩法取向", options: ["深度体验", "特种兵暴走", "省力慢游"] },
  { key: "交通", label: "交通方式", options: ["自驾", "高铁", "飞机"] },
  { key: "预算", label: "预算档位", options: ["穷游", "中等", "品质"] },
];

const EXAMPLES = [
  "周末想从上海出发去杭州玩两天，爱吃爱拍照",
  "五一带爸妈去西安，四天三晚，老人腿脚不太好",
  "国庆一个人去云南大理丽江，七天，想人少出片",
];

// 四个流水线阶段，与后端 stage 事件一一对应
const STAGES = [
  { key: "parse", label: "① 解析需求" },
  { key: "research", label: "② 联网实查" },
  { key: "compare", label: "③ 交叉验证" },
  { key: "write", label: "④ 生成路书" },
];

type Requirement = {
  destination: string;
  origin: string;
  days: number;
  month: number;
  people: string;
  style: string;
  budget: string;
  transport: string;
  interests: string[];
  constraints: string;
};

// Agent 实查轨迹的一步：一次 web_search 或 web_fetch
type TraceStep = {
  id: string;
  round: number;
  tool: string;
  arg: string;
  ok?: boolean;
  preview?: string;
};

export default function TravelPage() {
  const [idea, setIdea] = useState("");
  const [prefs, setPrefs] = useState<Record<string, string>>({});

  const [stage, setStage] = useState<string>("");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [dossier, setDossier] = useState("");
  const [facts, setFacts] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDossier, setShowDossier] = useState(false);
  const taskIdRef = useRef<string | null>(null);
  const stopRef = useRef(false);


  const togglePref = (key: string, value: string) => {
    setPrefs((prev) => {
      const next = { ...prev };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const buildPrefsText = () =>
    Object.entries(prefs).map(([k, v]) => `${k}=${v}`).join("，");

  const reset = () => {
    setStage("");
    setRequirement(null);
    setTrace([]);
    setDossier("");
    setFacts("");
    setText("");
    setError(null);
    setShowDossier(false);
  };

  const onGenerate = async () => {
    const trimmed = idea.trim();
    if (!trimmed || loading) return;

    stopRef.current = false;

    setLoading(true);
    reset();
    try {
      // 任务模式：POST 立即返回 taskId（部署网关 60s 会掐长连接，流水线在后台跑，前端轮询快照）
      const res = await fetch("/api/travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: trimmed, prefs: buildPrefsText() }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const { taskId } = (await res.json()) as { taskId: string };
      taskIdRef.current = taskId;

      // 轮询任务快照，整包覆盖状态，直到完成 / 出错 / 用户停止
      while (!stopRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        if (stopRef.current) break;
        const r = await fetch(`/api/travel?task=${taskId}`);
        if (!r.ok) {
          throw new Error(r.status === 404 ? "任务不存在（服务可能已重启），请重新生成" : `HTTP ${r.status}`);
        }
        const snap = await r.json();
        setStage(snap.stage || "");
        setRequirement(snap.requirement ?? null);
        setTrace(snap.trace ?? []);
        setDossier(snap.dossier || "");
        setFacts(snap.facts || "");
        setText(snap.content || "");
        if (snap.status === "done" || snap.status === "cancelled") break;
        if (snap.status === "error") throw new Error(snap.error || "生成失败");
      }
    } catch (e) {
      if (!stopRef.current) setError((e as Error).message || "生成失败");
    } finally {
      setLoading(false);
      setStage("");
    }
  };

  const onStop = () => {
    stopRef.current = true;
    const id = taskIdRef.current;
    if (id) void fetch(`/api/travel?task=${id}`, { method: "DELETE" });
  };

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="container">
      <div className="header">
        <h1>欢喜 · 旅行路书</h1>
      </div>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void onGenerate();
        }}
      >
        <h2>你的旅游想法</h2>
        <textarea
          className="travel-idea"
          value={idea}
          placeholder="例如：周末想从上海出发去杭州玩两天，爱吃爱拍照，两个人……"
          onChange={(e) => setIdea(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="btn-ghost"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => setIdea(ex)}
            >
              {ex}
            </button>
          ))}
        </div>

        {PREF_GROUPS.map((g) => (
          <div className="pref-group" key={g.key}>
            <div className="pref-label">{g.label}（可选）</div>
            <div className="chips">
              {g.options.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  className={`chip ${prefs[g.key] === opt ? "active" : ""}`}
                  onClick={() => togglePref(g.key, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="travel-actions">
          <button type="submit" className="btn" disabled={loading || !idea.trim()}>
            {loading ? "路书生成中…" : text ? "重新生成" : "生成完整路书"}
          </button>
          {loading && (
            <button type="button" className="btn-ghost" onClick={onStop}>
              停止
            </button>
          )}
        </div>
        <p className="tip" style={{ marginTop: 12 }}>
          说明：路书数据来自实时联网检索并多源交叉验证，仍可能有时效误差，标注
          <code>【未核实】</code>/<code>【冲突】</code>的项请出发前按官方信息终判。
        </p>
      </form>

      {(loading || requirement || trace.length > 0 || facts || text || error) && (
        <div className="card">
          <h2>搜寻欢喜</h2>
          <div className="pipeline">
            {STAGES.map((s, i) => {
              const cls =
                stageIndex > i || (!loading && text)
                  ? "done"
                  : stageIndex === i
                  ? "active"
                  : "";
              return (
                <span key={s.key} className={`pipe-step ${cls}`}>
                  <span className="dot" />
                  {s.label}
                </span>
              );
            })}
          </div>

          {error && (
            <div
              style={{
                color: "var(--el-huo)",
                background: "#fbeae6",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                marginTop: 14,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {requirement && (
        <div className="card">
          <h2>① 需求解析</h2>
          <div className="req-tags">
            {requirement.destination && <span className="req-item"><b>目的地</b>{requirement.destination}</span>}
            {requirement.origin && <span className="req-item"><b>出发地</b>{requirement.origin}</span>}
            <span className="req-item"><b>天数</b>{requirement.days} 天</span>
            <span className="req-item"><b>月份</b>{requirement.month} 月</span>
            <span className="req-item"><b>人数</b>{requirement.people}</span>
            <span className="req-item"><b>玩法</b>{requirement.style}</span>
            <span className="req-item"><b>交通</b>{requirement.transport}</span>
            <span className="req-item"><b>预算</b>{requirement.budget}</span>
            {requirement.interests?.map((it) => (
              <span className="req-item" key={it}><b>偏好</b>{it}</span>
            ))}
            {requirement.constraints && <span className="req-item"><b>约束</b>{requirement.constraints}</span>}
          </div>
        </div>
      )}

      {trace.length > 0 && (
        <div className="card">
          <h2>② 联网实查 Agent 轨迹（{trace.length} 步）</h2>
          <p className="tip" style={{ marginTop: -4, marginBottom: 10 }}>
            模型自主决定「搜什么词 → 抓哪个页面」，每一步都是真实的搜索引擎查询与页面抓取。
          </p>
          <div className="trace">
            {trace.map((s) => (
              <div className="trace-step" key={s.id}>
                <span
                  className={`ts-tool ${
                    s.tool === "web_search" ? "search" : s.tool === "enable_search" ? "builtin" : "fetch"
                  }`}
                >
                  {s.tool === "web_search" ? "🔍 搜索" : s.tool === "enable_search" ? "🌐 内置搜索" : "📄 抓取"}
                </span>
                <span className="ts-arg" title={s.arg}>{s.arg}</span>
                <span className="ts-status">
                  {s.ok === undefined ? (
                    <span className="ts-pending">进行中…</span>
                  ) : s.ok ? (
                    <span className="ts-ok">✓</span>
                  ) : (
                    <span className="ts-fail">✗</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {dossier && (
            <>
              <button
                type="button"
                className="btn-ghost"
                style={{ marginTop: 12, padding: "4px 12px", fontSize: 12 }}
                onClick={() => setShowDossier((v) => !v)}
              >
                {showDossier ? "收起实查档案" : "查看实查档案（含来源 URL）"}
              </button>
              {showDossier && (
                <div className="facts-box md-body" style={{ marginTop: 10 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{dossier}</ReactMarkdown>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {facts && (
        <div className="card">
          <h2>③ 数据对比 · 交叉验证事实源</h2>
          <div className="facts-box md-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{facts}</ReactMarkdown>
          </div>
        </div>
      )}

      {(text || (loading && stage === "write")) && (
        <div className="card">
          <h2>④ 旅行路书</h2>
          {text ? (
            <div className="roadbook md-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              {loading && <span style={{ color: "var(--accent)" }}>█</span>}
            </div>
          ) : (
            <p className="tip">正在基于事实源撰写路书…</p>
          )}
        </div>
      )}

      {!loading && !text && !error && !requirement && (
        <div className="card">
          <p className="roadbook-empty">输入想法后点击「生成完整路书」</p>
        </div>
      )}
      {loading && (
        <div className="loading-bar">
          <span className="loading-icon" />
        </div>
      )}
    </div>
  );
}
