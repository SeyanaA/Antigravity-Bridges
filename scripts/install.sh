#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command -v node >/dev/null || { echo '请先安装 Node.js 24 或更新版本'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || { echo '需要 Node.js 24 或更新版本'; exit 1; }
[ -f config/local.json ] || { echo '请先按 README 创建 Antigravity 专用项目并运行 configure.mjs'; exit 1; }
npm ci --omit=dev
flavor="${1:-$(node -e 'const fs=require("fs");console.log(fs.existsSync("flavor.json")?JSON.parse(fs.readFileSync("flavor.json")).flavor:"all")')}"
node scripts/install.mjs "$flavor"
if [ "$flavor" != all ] && [ "$flavor" != native ]; then node scripts/install.mjs native; fi
node scripts/control.mjs start
