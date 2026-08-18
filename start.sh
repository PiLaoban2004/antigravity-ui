#!/bin/bash
# Antigravity 反代配置管理 UI —— 一键启动（开发模式）
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"

echo "[start] 后端  http://127.0.0.1:4310"
echo "[start] 前端  http://127.0.0.1:4321"
echo "[start] 按 Ctrl+C 全部退出"

trap 'echo "[stop] 停止所有服务"; kill 0' INT TERM

(cd apps/server && bun --watch src/index.ts) &
(cd apps/web && bun run dev) &

wait
