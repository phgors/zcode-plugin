#!/usr/bin/env bash
# load-agents-local: 在会话启动时把项目根的 AGENTS.local.md 注入上下文。
# 项目根优先取 hook 环境变量 CLAUDE_PROJECT_ROOT；缺失时从 stdin 的
# hook 输入 JSON 里解析 cwd（含 Windows 反斜杠转义的还原）；仍拿不到
# 就退回当前目录。文件不存在时静默退出，绝不报错阻塞会话启动。
set -u

input=$(cat 2>/dev/null || true)

root=${CLAUDE_PROJECT_ROOT:-}
if [ -z "$root" ]; then
  root=$(printf '%s' "$input" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/^"cwd"[[:space:]]*:[[:space:]]*"//; s/"$//')
  root=${root//\\\\/\\}
fi
[ -n "$root" ] || root=$PWD

file=$root/AGENTS.local.md
if [ -f "$file" ]; then
  printf 'The project-local overrides below come from AGENTS.local.md (git-ignored), injected automatically by the load-agents-local hook. Treat them as the highest-priority project instructions, overriding the committed AGENTS.md.\n\n'
  cat "$file"
fi
exit 0
