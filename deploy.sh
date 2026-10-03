#!/usr/bin/env bash
#
# bazi 部署脚本
#
# 流程：
#   1. 侦测 GitHub 远端是否有更新，有则 git pull；无更新直接结束
#   2. 若本次更新改动了 package.json，则删除 node_modules / package-lock.json 并 npm i
#   3. 若本次更新改动了 prisma schema / 迁移，则应用数据库迁移并重新生成 Client
#   4. npm run build
#   5. pm2 restart 0
#
# 任意一步出现异常（命令失败、前置条件不满足）立即退出，不再执行后续步骤。

set -euo pipefail

# 切到脚本所在目录，保证在仓库根目录执行
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

# ---------- 步骤 1：侦测远端更新并拉取 ----------
log "步骤 1/5：侦测远端更新"

command -v git >/dev/null 2>&1 || die "未找到 git 命令"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "当前目录不是 git 仓库"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ] || die "当前不在有效分支上（可能是 detached HEAD）"

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -n "$UPSTREAM" ] || die "分支 $BRANCH 没有配置上游分支，无法侦测远端更新"

# 工作区必须干净，否则 pull 可能产生冲突或覆盖本地改动。
# 排除项说明：
#   --untracked-files=no  未追踪文件（如 deploy.sh 本身、logs/）不影响 pull，不算脏
#   :!package-lock.json   步骤 2 会删除并重新生成 lock，属生成物，不算脏，
#                         否则第二次定时部署会被自己的产物卡死
DIRTY="$(git status --porcelain --untracked-files=no -- ':!package-lock.json')"
if [ -n "$DIRTY" ]; then
  die "工作区存在未提交的已追踪改动，请先处理后再部署：$(echo "$DIRTY" | head -n 5 | tr '\n' ';')"
fi

# lock 是生成物，pull 前丢弃其本地改动，避免与远端版本冲突导致 --ff-only 失败
git checkout -- package-lock.json 2>/dev/null || true

log "当前分支：$BRANCH，上游：$UPSTREAM，开始 fetch..."
git fetch --quiet origin "$BRANCH" || die "git fetch 失败，请检查网络或远端仓库权限"

LOCAL_REV="$(git rev-parse '@')"
REMOTE_REV="$(git rev-parse '@{u}')"
MERGE_BASE="$(git merge-base '@' '@{u}')"

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  log "远端无更新（$BRANCH 已是最新 ${LOCAL_REV:0:8}），无需部署，脚本结束"
  exit 0
fi

if [ "$LOCAL_REV" != "$MERGE_BASE" ]; then
  die "本地与远端已分叉（本地存在未推送提交），需人工处理后再部署"
fi

log "检测到更新：${LOCAL_REV:0:8} -> ${REMOTE_REV:0:8}，开始 git pull"
git pull --ff-only origin "$BRANCH" || die "git pull 失败"

NEW_REV="$(git rev-parse HEAD)"
log "步骤 1 完成，当前版本：${NEW_REV:0:8}"

# ---------- 步骤 2：依赖是否变化 ----------
log "步骤 2/5：检查 package.json 是否变化"

CHANGED_FILES="$(git diff --name-only "$LOCAL_REV" "$NEW_REV")"
if [ -z "$CHANGED_FILES" ]; then
  die "git pull 后未取到变更文件列表，状态异常"
fi

if echo "$CHANGED_FILES" | grep -qx 'package.json'; then
  log "package.json 已变化，清理 node_modules / package-lock.json 并重新安装依赖"
  rm -rf node_modules package-lock.json || die "删除 node_modules / package-lock.json 失败"
  command -v npm >/dev/null 2>&1 || die "未找到 npm 命令"
  npm i || die "npm i 安装依赖失败"
  log "步骤 2 完成：依赖已重新安装"
else
  # package.json 未变化属于正常分支：跳过安装，继续构建部署
  log "package.json 未变化，跳过依赖安装，继续后续步骤"
fi

# ---------- 步骤 3：数据库 schema 是否变化 ----------
log "步骤 3/5：检查 prisma schema / 迁移是否变化"

# 匹配 prisma/schema.prisma 或 prisma/migrations/ 下任意文件的变更
if echo "$CHANGED_FILES" | grep -qE '^prisma/(schema\.prisma|migrations/)'; then
  log "prisma schema / 迁移已变化，应用数据库迁移"
  command -v npx >/dev/null 2>&1 || die "未找到 npx 命令"
  # migrate deploy 只应用已提交的迁移，不需要 shadow database，生产/开发通用
  npx prisma migrate deploy || die "prisma migrate deploy 失败，已中止部署"
  # schema 变化时 package.json 可能未变（步骤 2 跳过了 npm i，postinstall 未触发），
  # 这里显式重新生成 Client，保证步骤 4 构建时类型最新
  npx prisma generate || die "prisma generate 失败，已中止部署"
  log "步骤 3 完成：数据库迁移已应用，Prisma Client 已重新生成"
else
  log "prisma schema 未变化，跳过数据库迁移"
fi

# ---------- 步骤 4：构建 ----------
log "步骤 4/5：npm run build"
npm run build || die "npm run build 构建失败，已中止部署（未重启 pm2）"
log "步骤 4 完成：构建成功"

# ---------- 步骤 5：重启 pm2 ----------
log "步骤 5/5：pm2 restart 0"
command -v pm2 >/dev/null 2>&1 || die "未找到 pm2 命令"
pm2 restart 0 || die "pm2 restart 0 失败"
log "步骤 5 完成：pm2 已重启，部署成功（版本 ${NEW_REV:0:8}）"
