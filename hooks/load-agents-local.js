#!/usr/bin/env node
// load-agents-local: 在会话启动时把项目根的 AGENTS.local.md 注入上下文。
// 项目根优先取 hook 环境变量 CLAUDE_PROJECT_ROOT；缺失时从 stdin 的
// hook 输入 JSON 里解析 cwd；仍拿不到就用当前目录。文件不存在或任何
// 出错都静默退出，绝不阻塞会话启动。
'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  let root = process.env.CLAUDE_PROJECT_ROOT || '';
  if (!root) {
    try {
      const input = JSON.parse(await readStdin());
      if (typeof input.cwd === 'string') root = input.cwd;
    } catch {
      // stdin 为空或不是合法 JSON 时忽略，走当前目录兜底
    }
  }
  if (!root) root = process.cwd();

  const file = path.join(root, 'AGENTS.local.md');
  if (fs.existsSync(file)) {
    process.stdout.write(
      'The project-local overrides below come from AGENTS.local.md (git-ignored), ' +
        'injected automatically by the load-agents-local hook. Treat them as the ' +
        'highest-priority project instructions, overriding the committed AGENTS.md.\n\n'
    );
    process.stdout.write(fs.readFileSync(file, 'utf8'));
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
