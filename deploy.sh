#!/usr/bin/env bash
#
# bazi 部署脚本
#
# 流程：
#   1. 侦测 GitHub 远端是否有更新，有则 git pull；无更新直接结束
#   2. 若本次更新改动了 package.json，则删除 node_modules / package-lock.json 并 npm i
#   3. npm run build
#   4. pm2 restart 0
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
log "步骤 1/4：侦测远端更新"

command -v git >/dev/null 2>&1 || die "未找到 git 命令"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "当前目录不是 git 仓库"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ] || die "当前不在有效分支上（可能是 detached HEAD）"

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -n "$UPSTREAM" ] || die "分支 $BRANCH 没有配置上游分支，无法侦测远端更新"

# 工作区必须干净，否则 pull 可能产生冲突或覆盖本地改动
if [ -n "$(git status --porcelain)" ]; then
  die "工作区存在未提交改动，请先处理后再部署：$(git status --porcelain | head -n 5 | tr '\n' ';')"
fi

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
log "步骤 2/4：检查 package.json 是否变化"

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

# ---------- 步骤 3：构建 ----------
log "步骤 3/4：npm run build"
npm run build || die "npm run build 构建失败，已中止部署（未重启 pm2）"
log "步骤 3 完成：构建成功"

# ---------- 步骤 4：重启 pm2 ----------
log "步骤 4/4：pm2 restart 0"
command -v pm2 >/dev/null 2>&1 || die "未找到 pm2 命令"
pm2 restart 0 || die "pm2 restart 0 失败"
log "步骤 4 完成：pm2 已重启，部署成功（版本 ${NEW_REV:0:8}）"
