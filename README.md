# 八字 · 紫微斗数排盘 + AI 命理分析

基于 Next.js 15 的本地命理排盘 Web 应用，先在浏览器/服务端用纯 TS 算出四柱八字、十神与格局，再把结构化结果拼成提示词调用 OpenAI 兼容大模型生成深度命理解读，前端流式展示。同一份出生信息同时起紫微斗数命盘（十二宫、星曜四化、大限与经典格局），AI 报告同时覆盖八字与紫微并做互参。同时集成了幻灯片展示、AI 应用需求收集和 GitHub Webhook 自动部署等功能 。

## ✨ 功能

- **本地排盘**：输入阳历出生时间（年/月/日/时），自动推算四柱、藏干与十神。
  - 年柱以**立春**为界，月柱以**节气**为界（21 世纪寿星算法）。
  - 日柱按 1900-01-01 为甲戌日的差值法推算。
  - 时柱按**五鼠遁**起时；23:00 后归入次日子时。
- **十神可视化**：天干十神 + 地支藏干十神，按比劫/食伤/财/官杀/印能量分布。
- **格局识别**：识别常见组合格局（如杀印相生、伤官配印、财官印俱全等）。
- **AI 深入分析**：点「排盘」按钮自动触发，以流式方式生成 Markdown 报告；提示词同时包含四柱、十神能量、八字格局、三魂七魄，以及紫微十二宫星曜、生年四化、紫微格局与大限，报告含《八字与紫微互参》与《大限与阶段建议》等章节。
- **基本信息**：姓名 + 性别一并送入 prompt，男女断法差异由模型处理。
- **幻灯片展示** (`/slide`)：30 页 Claude Code 主题幻灯片，支持键盘方向键、箭头按钮和触摸滑动切换，使用 Framer Motion 实现平滑过渡动画。
- **AI 应用需求收集** (`/ideas`)：Claude 风格深色主题页面，收集"没有商业价值但有用的 AI 应用"创意，包含表单提交和需求卡片展示，数据存储到 JSON 文件。
- **GitHub Webhook 自动部署** (`/api/webhook`)：监听 main 分支 push 事件，自动执行 `git pull` → `npm install` → `pm2 reload` 完成部署，支持签名验证。

## 🛠️ 技术栈

| 框架 | Next.js 15（App Router）+ React 19 |
| 大模型 | OpenAI 兼容网关（默认 DeepSeek 端点，可配百炼等；`stream: true`） |
| 流式协议 | NDJSON（`application/x-ndjson`） |
| Markdown | react-markdown + remark-gfm |
| 动画 | Framer Motion（幻灯片切换） |
| 图标 | Lucide React |
| 样式 | Tailwind CSS 4 |
| 算法 | 纯 TypeScript（无后端依赖） |
| 部署 | PM2 + GitHub Webhook 自动更新 |

## 🚀 快速开始

### 1. 安装依赖

```bash
cd chance
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`（Next.js 会按 `.env` → `.env.local` 的优先级加载）：

```bash
cp .env.example .env
```

填入（`/api/analyze` 与 `/api/travel` 共用，任意 OpenAI 兼容网关均可）：

```env
API_KEY=sk-xxxxxxxxxxxxxxxx
BASE_URL=https://api.deepseek.com
MODEL_ID=deepseek-chat
```

`/api/analyze` 也兼容 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`，优先级更高，可用于单独指向 DeepSeek；`DEEPSEEK_THINKING=1`（或模型名匹配 `reasoner` / `v4-pro`）会启用思考链。

> ⚠️ `.env*` 已在 `.gitignore`，**切勿提交**包含 API Key 的文件。

### 3. 启动

```bash
npm run dev
```

打开 <http://localhost:3000>。

## 📁 项目结构

```
bazi/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts   # DeepSeek 流式代理（OpenAI SDK + NDJSON）
│   │   ├── ideas/route.ts     # AI 应用需求收集 API（GET/POST）
│   │   └── webhook/route.ts   # GitHub Webhook 自动部署接口
│   ├── ideas/page.tsx         # "无用之用" AI 应用需求收集页
│   ├── bazi/
│   │   ├── page.tsx            # 出生信息表单 + 八字排盘 + AI 分析
│   │   └── ZiweiView.tsx       # 紫微斗数命盘、宫位详情、格局与大限
│   ├── slide/page.tsx         # 幻灯片展示页（30 页）
│   ├── globals.css            # 全局样式 + Markdown 主题
│   ├── layout.tsx
│   └── page.tsx               # 表单 + 排盘视图 + AI 分析视图
├── components/
│   └── Navbar.tsx             # 导航栏组件
├── data/
│   └── ideas.json             # 需求收集数据存储
├── lib/
│   ├── bazi.ts                # 八字算法核心：calcBazi / 十神 / 格局 / buildAnalysisPrompt
│   ├── ziwei.ts               # 紫微斗数排盘：calcZiwei（基于 iztro）
│   ├── ziwei-patterns.ts      # 紫微格局识别（移植自 Renhuai123/ziwei-doushu，MIT）
│   └── ziwei-prompt.ts        # 紫微命盘序列化为 AI 提示词片段
├── public/
│   └── slide.html             # 原始幻灯片 HTML
├── ecosystem.config.js        # PM2 部署配置
├── WEBHOOK_DEPLOY.md          # Webhook 部署说明
├── 命理.md                    # 排盘算法依据
├── 十神.md                    # 十神/格局规则
├── .env.example
└── package.json
```

## 🔌 API

### `POST /api/analyze`

**请求体**

```json
{ "promptText": "【基本信息】\n- 姓名：...\n- 性别：...\n..." }
```

**响应**：`Content-Type: application/x-ndjson`，逐行 JSON：

| type | 说明 |
|---|---|
| `meta` | `{ type, model }` 首行返回模型名 |
| `content` | `{ type, text }` 正文增量 |
| `reasoning` | `{ type, text }` 思考链增量（仅思考型模型） |
| `done` | 结束标记 |
| `error` | 出错信息 |

前端按 `\n` 切行解析，函数式累加 `setText(prev => prev + text)`。

### `POST /api/webhook`

GitHub Webhook 自动部署接口，监听 main 分支 push 事件，自动拉取代码、安装依赖并重启应用。

- **触发条件**：`X-GitHub-Event: push` + `ref: refs/heads/main`
- **签名验证**：`X-Hub-Signature-256`（HMAC-SHA256）
- **执行步骤**：`git pull` → `npm install` → `pm2 reload`
- **环境变量**：`GITHUB_WEBHOOK_SECRET`、`PROJECT_DIR`、`PM2_APP_NAME`

详细配置见 [`WEBHOOK_DEPLOY.md`](./WEBHOOK_DEPLOY.md)。

### `GET /api/ideas` / `POST /api/ideas`

AI 应用需求收集接口，支持提交和查询创意，数据存储在 `data/ideas.json`。

## 🎬 幻灯片

访问 `/slide` 查看 30 页 Claude Code 主题幻灯片。

- 键盘 `←` / `→` 或点击两侧箭头切换
- 移动端支持左右滑动
- Framer Motion 实现淡入淡出 + 位移动画

## 💡 无用之用

访问 `/ideas` 提交和浏览"没有商业价值但有用的 AI 应用"创意。

- Claude 风格深色主题
- 表单提交（邮箱 + 需求描述，200 字以内）
- 卡片式展示所有提交

## 📝 算法说明

详细规则见 [`命理.md`](./命理.md) 与 [`十神.md`](./十神.md)。
关键函数定义在 [`lib/bazi.ts`](./lib/bazi.ts)：

- `calcBazi(y, m, d, h)` → 返回 `{ year, month, day, hour, dayMaster, solarTerm, ... }`
- `analyzePatterns(result)` → 返回识别到的格局数组
- `summarizeTenGodEnergy(result)` → 返回十神五大类能量分布
- `buildAnalysisPrompt(input, result, ziweiSection?)` → 拼接送入大模型的纯文本 prompt（传入第三参时附带紫微章节）
- `calcZiwei(y, m, d, h, gender, today?)` → 返回紫微斗数命盘（十二宫、星曜亮度与四化、大限、生年四化）
- `detectPatterns(chart)` → 返回识别到的紫微经典格局（机月同梁、杀破狼等）
- `getMingGongSummary(chart)` → 命宫主星关键词与星性
- `buildZiweiPromptSection(chart)` → 把命盘、十二宫、格局与大限序列化为提示词片段

紫微斗数口径：年干支按农历正月初一换年（iztro 默认），23:00-23:59 晚子时归次日早子时，与八字日柱换日规则一致；不处理真太阳时经度差与 1986-1991 夏令时。

## ⚠️ 注意事项

- 本应用仅供命理学爱好者参考，**不构成任何决策建议**。
- DeepSeek `stream: true` 时单次会话最长 5 分钟（`maxDuration: 300`）。
- 若使用 `deepseek-reasoner` / `deepseek-v4-pro`，会自动开启 `thinking: { type: "enabled" }` + `reasoning_effort: "high"`，思考链单独返回。
- 如遇 npm `ERESOLVE`，请确认 `react@^19.0.0` 已升至稳定版（非 RC）。

## 📜 License

MIT

## 🙏 致谢

- [iztro](https://github.com/SylarLong/iztro)：紫微斗数排盘引擎（MIT）
- [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)：紫微格局识别规则（MIT）；古籍原文属公有领域
