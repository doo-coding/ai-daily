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

# 4) 텔레그램 링크 전송 (미리보기 이미지는 클라우드 인증서 문제로 깨져서 제거 — 링크만)
curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_CHAT_ID}" \
  --data-urlencode "text=📰 AI 데일리 · ${DATE} ${SLOT} (${TIME} KST)
${URL}" >/dev/null && echo "[run] sent: link"

# 5) 오프라인 HTML(메모·즐겨찾기 없음, 폰트 내장)을 2번째 봇으로 1:1 전송(sendDocument)
#    환경변수(루틴): AI_NEWS7TO7_BOT(봇토큰), USER1·USER2(받는 사람 chat_id). 없으면 이 단계 건너뜀.
OFF_BOT="${AI_NEWS7TO7_BOT:-}"
if [ -n "$OFF_BOT" ]; then
  OFFFILE="$(node build-offline.js "$BUILT" | tail -n1)" || OFFFILE=""
  if [ -n "$OFFFILE" ] && [ -f "$OFFFILE" ]; then
    OFFNAME="AI-Daily-${DATE}-${SLOT}.html"
    # 접힌 상태 미리보기 이미지: 오프라인 파일(자기완결)을 로컬 렌더 → cert 문제 없음·한글 정상. 크로미움 없으면 이미지 생략.
    IMG=""
    CHROME="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
    [ -z "$CHROME" ] && CHROME="$(ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -n1 || true)"
    if [ -n "$CHROME" ]; then
      N="$(node -e 'const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").match(/const __B64__ = "([^"]+)"/);let n=0;if(m){const d=JSON.parse(Buffer.from(m[1],"base64").toString());(d.sections||[]).forEach(s=>n+=(s.items||[]).length);}process.stdout.write(String(n||16))' "$BUILT")" || N=16
      HGT=$((460 + N * 128))
      if timeout 80 "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
           --force-device-scale-factor=2 --window-size=470,${HGT} --virtual-time-budget=9000 \
           --screenshot=collapsed.png "file://${OFFFILE}" >/dev/null 2>&1 && [ -s collapsed.png ]; then
        IMG="collapsed.png"; echo "[run] 접힌 이미지 렌더 OK (${N}카드 ${HGT}px)"
      else
        echo "[run] 접힌 이미지 렌더 실패 — 파일만 전송"
      fi
    fi
    for UID in "${USER1:-}" "${USER2:-}"; do
      [ -n "$UID" ] || continue
      [ -n "$IMG" ] && curl -s "https://api.telegram.org/bot${OFF_BOT}/sendPhoto" \
        -F "chat_id=${UID}" -F "photo=@${IMG}" \
        -F "caption=📰 AI 데일리 · ${DATE} ${SLOT} (${TIME} KST) — 접힌 미리보기" >/dev/null && echo "[run] offline image: ${UID}"
      curl -s "https://api.telegram.org/bot${OFF_BOT}/sendDocument" \
        -F "chat_id=${UID}" \
        -F "document=@${OFFFILE};filename=${OFFNAME}" \
        -F "caption=전체 HTML(오프라인 저장용)" >/dev/null && echo "[run] offline file: ${UID}"
    done
  else
    echo "[run] 오프라인 빌드 실패 — 건너뜀"
  fi
fi
