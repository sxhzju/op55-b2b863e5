# 10月8日 (1)-副本(1) — 一页会动的速写本

1080×1440（3:4）· 30fps · 22.9 秒 · 手绘风。分镜和构思见 [TREATMENT.md](TREATMENT.md)。

## 构思
整部片发生在**同一张速写纸**上，一镜到底。开头那个问号是“装置”：它的**线**被拉直成一条路，它的**点**成了主角：沿路滚动打勾，变成播放键，折成纸飞机发出去，又兜回来展开成评论气泡。之后“飞书”两个字长出翅膀飞到新的视频框上。视频框被拉长成胶片，在“收藏”这个重拍上收窄、染红，变成一条书签。镜头最后拉远，整页走过的路都在这一页上。

用到的手绘规则：线条每 2 帧抖动一次（line boil）；按笔顺画出，笔压随位置变化，两端收细；角色一拍二；镜头逐帧平滑并带视差；每帧做 3–16 个子帧的运动模糊（按镜头速度自适应）；纸纹、铅笔齿痕、水彩晕染和颗粒。字幕用手写字体“写”在纸上，按语速逐字出现，用完后被擦掉，留下一道铅笔涂痕。

## 重新渲染
需要 Node 18+、FFmpeg（libx264 + aac）和本机 Google Chrome。

```bash
npm ci
# 把原音 original.mp3 放在仓库根目录（不入库）
node render.mjs                 # -> op55-hd.mp4（H.264 yuv420p + AAC，原音从 0 秒开始）
node render.mjs --frames 90-130 --step 3 --out build/frames   # 只导出若干帧 PNG 用于检查
```
Chrome 不在 macOS 默认位置时，设置 `CHROME_PATH=/path/to/chrome`；FFmpeg 不在 PATH 中时，设置 `FFMPEG=/path/to/ffmpeg`。

每一帧都只由帧号决定（`window.renderFrame(f)`），所以重新渲染的结果是确定的。整片渲染在 M 系列 Mac 上大约需要 3.5 分钟。

## 文件
- `src/film.js`：全部动画，包括时间轴、镜头、笔触、水彩、文字和调色
- `src/index.html`：页面外壳和字体声明
- `render.mjs`：用 Puppeteer 逐帧截图，经管道送入 FFmpeg，再混入原音
- `fonts/`：字体子集（WOFF2）及其许可证
- `tools/subset-fonts.sh`：从上游字体重新生成子集

## 素材与许可
- **霞鹜文楷 LXGW WenKai Medium** v1.522，SIL OFL 1.1，见 `fonts/LICENSE-LXGW-WenKai-OFL.txt`。按其附加许可，仅以网页字体子集（WOFF2）的形式使用。
- **站酷快乐体 ZCOOL KuaiLe**，SIL OFL 1.1，见 `fonts/LICENSE-ZCOOL-KuaiLe-OFL.txt`。
- 其余画面（纸纹、笔触、水彩、颗粒）都由代码程序化生成，没有使用外部图片或音乐。原音 `original.mp3` 和成片不入库。
- 代码：MIT。
