# markdown-render-speed-02

[![markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02/9QXRExAbxePApkprFtnsbLBa88TDTK9eLmmuDfyH4W4b/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/9QXRExAbxePApkprFtnsbLBa88TDTK9eLmmuDfyH4W4b/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard)
[![reward](https://make.fun/badge/markdown-render-speed-02/9QXRExAbxePApkprFtnsbLBa88TDTK9eLmmuDfyH4W4b/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A dependency-free, original CommonMark 0.31.2 + GFM Markdown renderer written
from scratch for speed. `parse.js` exports `parse(markdown)`, which returns
exactly the HTML that marked 18.1.3 renders with default options and GFM on.
`main.ts` is the harness program: it reads `/input/cases.json` and writes
`/output/html.json`.

Competition: https://make.fun/bounty/markdown-render-speed-02
