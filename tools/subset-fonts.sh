#!/usr/bin/env bash
# Rebuild the WOFF2 subsets in fonts/ from the upstream OFL fonts.
# Needs: python3 -m pip install fonttools brotli
# Usage: tools/subset-fonts.sh /path/to/LXGWWenKai-Medium.ttf /path/to/ZCOOLKuaiLe-Regular.ttf
#   LXGW WenKai v1.522: https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522
#   ZCOOL KuaiLe:       https://github.com/google/fonts/tree/main/ofl/zcoolkuaile
set -euo pipefail
cd "$(dirname "$0")/.."
EXTRA='0123456789%?？!！.,，。:：、…·+-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 收藏知识库飞书看不懂长主播视频全流程走一遍条件'
TEXT="$(grep -v -E '^[0-9]+$|-->' subtitles.srt | tr -d '\r\n')${EXTRA}"
pyftsubset "$1" --text="$TEXT" --flavor=woff2 --layout-features='*' --output-file=fonts/WenKai-subset.woff2
pyftsubset "$2" --text="$TEXT" --flavor=woff2 --layout-features='*' --output-file=fonts/KuaiLe-subset.woff2
ls -la fonts
