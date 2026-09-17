---
name: static-page-deploy
description: >-
  通过挑战-响应 HMAC 鉴权接口，把 Agent 在本地创建的静态页面安全部署到目标站点的 public 目录。
  需要上传 HTML/CSS/JS/图片等静态资源到指定服务器时使用。
metadata:
  version: "1.0.0"
---

# 静态页面安全部署指南

目标：Agent 通过一套带密钥交换（挑战-响应 HMAC）的 HTTP 接口，把本地生成的静态页面部署到远端服务器的 `public/agent/` 目录下，部署后可直接通过 HTTPS 访问。

## 何时使用

- Agent 生成了一个静态 HTML 页面（含 CSS/JS/图片），需要发布到线上供访问
- 需要列出、删除已部署的静态文件

## 核心概念

### 安全模型：挑战-响应 HMAC（预共享密钥）

密钥本身**从不经过网络传输**。流程：

1. Agent → `GET /api/deploy/challenge` 获取一次性 `challenge`（nonce，60s 有效，用后即焚）
2. Agent 用预共享密钥 `DEPLOY_SECRET` 对 `challenge` 做 `HMAC-SHA256` 得到 `signature`
3. Agent → `POST /api/deploy`，请求头携带 `X-Deploy-Challenge` 与 `X-Deploy-Signature`
4. 服务端用 `timingSafeEqual` 验签，并校验 challenge 未过期、未被重放

### ⚠️ CDN 缓存：必须加时间戳破缓存

如果站点前面有 CDN（如百度 CDN、Cloudflare 等），`/api/deploy/challenge` 的响应**会被缓存**，导致每次拿到同一个过期 challenge，部署时返回 "challenge 不存在或已失效"。

**解决**：调用 challenge 接口时，URL 必须带一个唯一时间戳参数：

```
GET /api/deploy/challenge?t=<timestamp>
```

> 即使响应头里有 `Cache-Control: no-store`，部分 CDN 仍可能缓存，加 `?t=` 是最可靠的兜底。

### 部署位置

文件写入服务器的 `public/agent/<path>`，访问 URL 为 `https://<domain>/agent/<path>`。
所有部署文件被隔离在 `agent/` 子目录下，不会覆盖 public 中已有内容。

### 允许的文件类型

仅允许：`.html .htm .css .js .mjs .json .svg .png .jpg .jpeg .gif .webp .ico .txt .xml .woff .woff2 .ttf .map`

## 接口清单

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| GET | `/api/deploy/challenge` | 获取一次性 challenge | 否 |
| POST | `/api/deploy` | 部署（写入）一个文件 | 是 |
| GET | `/api/deploy` | 列出已部署文件 | 是 |
| DELETE | `/api/deploy?path=<path>` | 删除一个已部署文件 | 是 |

### 1. 获取 challenge

```
GET /api/deploy/challenge?t=<timestamp>
```

响应：
```json
{
  "ok": true,
  "challenge": "5e8fbfe3...（64位 hex）",
  "algorithm": "HMAC-SHA256",
  "expiresIn": 60,
  "hint": "..."
}
```

### 2. 部署文件

```
POST /api/deploy
Headers:
  Content-Type: application/json
  X-Deploy-Challenge: <challenge>
  X-Deploy-Signature: <HMAC-SHA256(DEPLOY_SECRET, challenge) 的 hex>

Body:
{
  "path": "demo/index.html",          // 相对 public/agent 的路径，用 / 分隔
  "content": "<!doctype html>...",    // 文件内容
  "encoding": "utf8" | "base64"       // 可选，默认 utf8；二进制资源（图片/字体）用 base64
}
```

成功响应：
```json
{
  "ok": true,
  "url": "/agent/demo/index.html",
  "path": "demo/index.html",
  "bytes": 123
}
```

### 3. 列出文件

```
GET /api/deploy?t=<timestamp>
Headers:
  X-Deploy-Challenge: <challenge>
  X-Deploy-Signature: <signature>
```

### 4. 删除文件

```
DELETE /api/deploy?path=demo/index.html
Headers:
  X-Deploy-Challenge: <challenge>
  X-Deploy-Signature: <signature>
```

## 完整调用示例

### Node.js（推荐）

```js
import crypto from "crypto";

const SECRET = process.env.DEPLOY_SECRET;   // 与服务端一致
const BASE = "https://www.happybluefish.fun";

async function deploy(relPath, content, encoding = "utf8") {
  // 1. 取 challenge（必须带时间戳破 CDN 缓存）
  const challengeRes = await fetch(`${BASE}/api/deploy/challenge?t=${Date.now()}`);
  const { challenge } = await challengeRes.json();

  // 2. 签名
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(challenge)
    .digest("hex");

  // 3. 部署
  const res = await fetch(`${BASE}/api/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Deploy-Challenge": challenge,
      "X-Deploy-Signature": signature,
    },
    body: JSON.stringify({ path: relPath, content, encoding }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`部署失败: ${data.error}`);
  return data; // { ok, url, path, bytes }
}

// 使用
await deploy("my-page/index.html", "<!doctype html><h1>Hello</h1>");
// 部署后访问：https://www.happybluefish.fun/agent/my-page/index.html
```

### curl / shell

```bash
SECRET="your-deploy-secret"
BASE="https://www.happybluefish.fun"

# 1. 取 challenge
CH=$(curl -s "$BASE/api/deploy/challenge?t=$(date +%s%N)" | python3 -c 'import sys,json;print(json.load(sys.stdin)["challenge"])')

# 2. 计算签名
SIG=$(printf '%s' "$CH" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')

# 3. 部署
curl -s -X POST "$BASE/api/deploy" \
  -H "Content-Type: application/json" \
  -H "X-Deploy-Challenge: $CH" \
  -H "X-Deploy-Signature: $SIG" \
  -d '{"path":"demo/index.html","content":"<h1>Hello</h1>"}'
```

### 部署二进制文件（图片/字体）

用 `base64` 编码内容，`encoding` 设为 `"base64"`：

```js
import fs from "fs";
const base64 = fs.readFileSync("./logo.png").toString("base64");
await deploy("assets/logo.png", base64, "base64");
```

## 错误处理

| HTTP | 错误信息 | 原因 | 处理 |
| --- | --- | --- | --- |
| 401 | 缺少 X-Deploy-Challenge 或 X-Deploy-Signature | 未传鉴权头 | 补全两个 header |
| 401 | challenge 不存在或已失效 | challenge 过期 / 被 CDN 缓存 | 加 `?t=` 时间戳重新取 challenge |
| 401 | challenge 已被使用，禁止重放 | 同一个 challenge 用了两次 | 每次部署都重新取 challenge |
| 401 | 签名校验失败 | DEPLOY_SECRET 不一致或签名算错 | 核对密钥与 HMAC 算法 |
| 400 | path 不允许包含 .. | 路径含 `..` | 改用相对路径 |
| 400 | 不允许的文件类型 | 扩展名不在白名单 | 用允许的扩展名 |
| 500 | 服务端未配置 DEPLOY_SECRET | 服务端没配密钥 | 联系服务端配置 |

## 注意事项

1. **每次部署必须重新取 challenge**——challenge 是一次性的，用完即焚
2. **challenge 接口 URL 必须加 `?t=<timestamp>`**，否则 CDN 缓存会导致部署失败
3. **path 用相对路径**（如 `demo/index.html`），不要以 `/` 开头，不要含 `..`
4. **签名计算用原始 challenge 字符串**，不要做任何编码/解码
5. 文件会写入 `public/agent/`，访问路径是 `proxy/agent/<path>`

## 验证部署

部署成功后，直接访问返回的 `url`：

```bash
# path是demo/index.html
curl https://www.happybluefish.fun/proxy/agent/demo/index
```

如返回刚部署的 HTML 内容，则部署成功。
