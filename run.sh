#!/usr/bin/env bash
# AI 데일리 — 클라우드 루틴용 (리눅스/bash). run.ps1 의 리눅스 포팅.
# 전제: 루틴 세션의 Claude 가 먼저 prompt.md 대로 웹검색해 output/items.json 작성.
# 비밀/설정은 루틴 환경변수: AIDAILY_BOT_TOKEN, AIDAILY_CHAT_ID, PAGES_BASEURL, FAV_API_URL (TG_* 이름도 호환)
# 사용: bash run.sh am   (또는 pm)
set -euo pipefail
SLOT="${1:-am}"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
# 공유 환경 호환: AIDAILY_* 또는 TG_* 둘 다 허용
TG_BOT_TOKEN="${TG_BOT_TOKEN:-${AIDAILY_BOT_TOKEN:-}}"
TG_CHAT_ID="${TG_CHAT_ID:-${AIDAILY_CHAT_ID:-}}"
DATE="$(TZ=Asia/Seoul date +%Y-%m-%d)"

ITEMS="output/items.json"
[ -f "$ITEMS" ] || { echo "[run] items.json 없음 — Claude가 먼저 생성해야 함"; exit 1; }

# 1) 빌드 (build.js 가 FAV_API_URL 을 페이지에 주입)
export FAV_API_URL="${FAV_API_URL:-}"
BUILT="$(node build.js "$ITEMS" | tail -n1)"
FN="$(basename "$BUILT")"
echo "[run] built: $FN"

# 2) 발행: d/ 에 복사 후 main 에 push (favorites.json 충돌 대비 pull --rebase)
mkdir -p d
cp -f "$BUILT" "d/$FN"
git add "d/$FN"
git -c user.email=ai-daily@local -c user.name=ai-daily commit -m "publish $FN" || true
git pull --rebase origin main || true
git push origin HEAD:main
URL="${PAGES_BASEURL%/}/d/$FN"
echo "[run] url: $URL"

# 3) Pages 라이브(200) 대기 — 최대 ~3분
for i in $(seq 1 24); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || echo 000)"
  [ "$code" = "200" ] && { echo "[run] live"; break; }
  sleep 8
done

# 4) 텔레그램 링크 전송
curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_CHAT_ID}" \
  --data-urlencode "text=AI 데일리 · ${DATE} ${SLOT}
${URL}" >/dev/null && echo "[run] sent: link"
