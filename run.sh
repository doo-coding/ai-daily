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
TIME="$(TZ=Asia/Seoul date +%H:%M)"

ITEMS="output/items.json"
[ -f "$ITEMS" ] || { echo "[run] items.json 없음 — Claude가 먼저 생성해야 함"; exit 1; }

# 1) 빌드 (build.js 가 FAV_API_URL 을 페이지에 주입)
export FAV_API_URL="${FAV_API_URL:-}"
BUILT="$(node build.js "$ITEMS" | tail -n1)"
FN="$(basename "$BUILT")"
echo "[run] built: $FN"

# 1.5) 소프트 검증 — 출처 URL에 항목 수치가 있는지 로그만(발송 막지 않음). 봇차단/형식차로 오탐 가능 → 참고 신호.
node verify.js "$ITEMS" || true

# 2) 발행: d/ 에 복사 후 main 에 push (favorites.json 충돌 대비 pull --rebase)
mkdir -p d
cp -f "$BUILT" "d/$FN"
git add "d/$FN" output/seen.json
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

# 4) 텔레그램 전송 — 미리보기 이미지(헤드리스 크로미움으로 라이브 URL 캡처)+링크.
#    크로미움 없거나 캡처 실패하면 링크만 전송(절대 발송 자체는 안 깨지게 fail-safe).
CAP="📰 AI 데일리 · ${DATE} ${SLOT} (${TIME} KST)
${URL}"
CHROME="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[ -z "$CHROME" ] && CHROME="$(ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -n1 || true)"
PHOTO_SENT=0
if [ -n "$CHROME" ]; then
  if timeout 70 "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
       --force-device-scale-factor=2 --window-size=480,1700 --virtual-time-budget=9000 \
       --screenshot=preview.png "$URL" >/dev/null 2>&1 && [ -s preview.png ]; then
    if curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto" \
         -F "chat_id=${TG_CHAT_ID}" -F "photo=@preview.png" -F "caption=${CAP}" >/dev/null; then
      PHOTO_SENT=1; echo "[run] sent: photo+link"
    fi
  else
    echo "[run] 미리보기 캡처 실패 → 링크만"
  fi
else
  echo "[run] 크로미움 없음 → 링크만"
fi
if [ "$PHOTO_SENT" = "0" ]; then
  curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" \
    --data-urlencode "text=${CAP}" >/dev/null && echo "[run] sent: link"
fi
