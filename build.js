#!/usr/bin/env node
/*
 * build.js — templates/template.html + items.json → output/ai-daily-<date>-<slot>.html
 * 사용법:  node build.js [items.json 경로]
 * 출력:    완성된 HTML 파일 경로를 stdout으로 한 줄 출력 (run.sh가 이걸 받아 텔레그램 전송)
 * 의존성:  없음 (Node 18+ 권장)
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, "templates", "template.html");
const itemsPath = process.argv[2] || path.join(ROOT, "output", "items.json");

function log(...a){ console.error("[build]", ...a); }   // 로그는 stderr로 (stdout은 경로 전용)

try {
  if (!fs.existsSync(TEMPLATE)) throw new Error("템플릿 없음: " + TEMPLATE);
  if (!fs.existsSync(itemsPath)) throw new Error("데이터 없음: " + itemsPath);

  const raw = fs.readFileSync(itemsPath, "utf8");
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error("items.json이 올바른 JSON이 아닙니다: " + e.message); }

  // --- 최소 형식 검증 ---
  if (!Array.isArray(data.sections) || data.sections.length === 0)
    throw new Error("sections 배열이 비어 있습니다.");
  let itemCount = 0;
  data.sections.forEach((s, i) => {
    if (!Array.isArray(s.items)) throw new Error(`sections[${i}].items 누락`);
    s.items.forEach((it, j) => {
      if (!it.id || !it.title) throw new Error(`sections[${i}].items[${j}] id/title 누락`);
      if (!Array.isArray(it.bullets) || it.bullets.length === 0)
        throw new Error(`'${it.title}' 의 bullets 가 비어 있습니다.`);
      itemCount++;
    });
  });
  log(`검증 통과 — 섹션 ${data.sections.length}개 · 항목 ${itemCount}개`);

  // --- 중복 제거: 이미 보낸 기사(output/seen.json) 제외 (한 번 나온 건 다시 안 나옴) ---
  const seenPath = path.join(ROOT, "output", "seen.json");
  let seen = [];
  try { if (fs.existsSync(seenPath)) { const s = JSON.parse(fs.readFileSync(seenPath, "utf8")); if (Array.isArray(s)) seen = s; } } catch (e) { seen = []; }
  const keyOf = it => (it && it.url && String(it.url).trim()) ? String(it.url).trim() : ("t:" + String((it && it.title) || "").trim());
  const seenSet = new Set(seen);
  // 이미 즐겨찾기한 기사도 제외 (favorites.json) — 저장한 건 새 다이제스트에 다시 안 띄움
  try {
    const fav = JSON.parse(fs.readFileSync(path.join(ROOT, "favorites.json"), "utf8"));
    Object.values(fav || {}).forEach(r => { if (r && r.item) seenSet.add(keyOf(r.item)); });
  } catch (e) {}
  // 최근 3일 이내(발행일 date_local 기준)만 — 모델이 오래된 기사로 채워도 빌드에서 강제 제외(모델 무관)
  const _today = data.date || new Date().toISOString().slice(0, 10);
  const _cutoffMs = Date.parse(_today) - 3 * 864e5;  // 오늘 -3일
  const _itemDateMs = it => { const m = String((it && it.date_local) || "").match(/\d{4}-\d{2}-\d{2}/); return m ? Date.parse(m[0]) : NaN; };
  let _staleDropped = 0, keptCount = 0;
  data.sections.forEach(s => {
    s.items = (s.items || []).filter(it => {
      if (seenSet.has(keyOf(it))) return false;               // 중복/즐겨찾기 제외
      const d = _itemDateMs(it);
      if (!Number.isNaN(d) && d < _cutoffMs) { _staleDropped++; return false; }  // 발행일이 3일보다 오래됨 → 제외
      return true;
    });
    keptCount += s.items.length;
  });
  data.sections = data.sections.filter(s => s.items.length > 0);
  log(`중복·즐겨찾기 + 3일 컷오프(오래된 ${_staleDropped}개 제외) 후 ${keptCount}개 (총 ${itemCount}개 중)`);
  if (keptCount === 0) throw new Error("최근 3일 내 새 기사 없음 — 발송 생략");
  // 즐겨찾기 id 충돌 방지: 기사별 고유(url 기반) id. m1/d2 재사용 때문에 새 글이 ★처럼 보이던 버그 수정
  const _crypto = require("crypto");
  data.sections.forEach(s => s.items.forEach(it => { it.id = "x" + _crypto.createHash("md5").update(keyOf(it)).digest("hex").slice(0, 12); }));

  // 퀴즈 가공: ①②③ 보기번호 제거 + 정답 위치를 idx%4로 순환(요약기 정답 편향 보정) + 범위검증. 불량은 제거
  let _qi = 0;
  data.sections.forEach(s => s.items.forEach(it => {
    const q = it.quiz;
    const valid = q && Array.isArray(q.opts) && q.opts.length === 4 && Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4 && String(q.q || "").trim();
    if (!valid) { it.quiz = null; return; }
    // 보기 앞 번호 라벨만 제거(①② 또는 "1. " "2) "처럼 구두점+공백). '8.2%' 같은 실제 숫자 답은 건드리지 않음(공백 필수)
    const opts = q.opts.map(o => String(o).replace(/^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]\s*|\d{1,2}[.)、]\s+)/, "").trim());
    // 보기 4개가 서로 다르고 비어있지 않아야 함(중복/빈칸이면 불량 퀴즈 → 제거)
    if (new Set(opts).size !== 4 || opts.some(o => !o)) { it.quiz = null; return; }
    const correct = opts[q.ans];
    const distract = opts.filter((_, i) => i !== q.ans);
    const target = _qi % 4;
    const newOpts = []; let di = 0;
    for (let p = 0; p < 4; p++) newOpts[p] = (p === target) ? correct : distract[di++];
    it.quiz = { q: String(q.q).trim(), opts: newOpts, ans: target };
    _qi++;
  }));

  // --- 날짜/슬롯/생성시각으로 파일명 결정 (매 실행 고유 URL → 덮어쓰기 방지) ---
  const date = data.date || new Date().toISOString().slice(0, 10);
  const slot = (data.slot || "am").replace(/[^a-z0-9]/gi, "");
  const nowKST = new Date(Date.now() + 9*60*60*1000).toISOString().slice(11, 16);  // KST HH:MM
  // 헤더(date_line)에 실제 생성시각 주입 — 모델이 넣는 시각은 부정확하므로 강제 (기존 'HH:MM 생성' 있으면 교체)
  if (typeof data.date_line === "string" && data.date_line.trim()) {
    data.date_line = data.date_line.replace(/\s*·?\s*\d{1,2}:\d{2}\s*생성\s*$/, "").trim() + ` · ${nowKST} 생성`;
  }
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `ai-daily-${date}-${slot}-${nowKST.replace(":", "")}.html`);

  // --- base64(UTF-8)로 주입 (따옴표/유니코드 이스케이프 문제 회피) ---
  const tpl = fs.readFileSync(TEMPLATE, "utf8");
  const b64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  if (!tpl.includes("__DIGEST_DATA_B64__")) throw new Error("템플릿에 주입 지점(__DIGEST_DATA_B64__)이 없습니다.");

  // 즐겨찾기 중계 URL: 환경변수 FAV_API_URL > 파일 output/worker.url > 빈값(localStorage만)
  let favApi = process.env.FAV_API_URL || "";
  const urlFile = path.join(ROOT, "output", "worker.url");
  if (!favApi && fs.existsSync(urlFile)) favApi = fs.readFileSync(urlFile, "utf8").trim();
  if (favApi) log("즐겨찾기 중계 연결:", favApi); else log("중계 URL 없음 → localStorage 모드");

  // 요일별 강조색 — 앱 카테고리 색 재사용(비슷한 톤). --gold/--gold-soft/--gold-rgb만 바꾸면 모든 강조요소가 같이 바뀜
  const ACCENTS = [
    { n: "일", g: "#6FA8E0", s: "#9cc3ec", rgb: "111,168,224" },  // 0 일 = 블루
    { n: "월", g: "#EBA940", s: "#f3c373", rgb: "235,169,64" },   // 1 월 = 골드(기존)
    { n: "화", g: "#E08A5B", s: "#ecae8c", rgb: "224,138,91" },   // 2 화 = 코랄
    { n: "수", g: "#E07A9B", s: "#ec9fba", rgb: "224,122,155" },  // 3 수 = 로즈
    { n: "목", g: "#A593E0", s: "#c2b4ec", rgb: "165,147,224" },  // 4 목 = 바이올렛
    { n: "금", g: "#4FC4BC", s: "#84d6d0", rgb: "79,196,188" },   // 5 금 = 틸
    { n: "토", g: "#7DBE7D", s: "#a4d4a4", rgb: "125,190,125" },  // 6 토 = 그린
  ];
  const wd = new Date(Date.parse(date)).getUTCDay();  // date=YYYY-MM-DD(KST) → UTC 자정 파싱, 0=일
  const ac = ACCENTS[Number.isNaN(wd) ? 1 : wd];
  const accentStyle = `<style id="accent">:root{--gold:${ac.g};--gold-soft:${ac.s};--gold-rgb:${ac.rgb};}</style>`;
  log(`요일 강조색: ${ac.n}요일 → ${ac.g}`);

  const escAttr = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pageTitle = `AI 데일리 · ${date} ${slot} (${nowKST})`;
  const ogTitle = escAttr(`AI 데일리 · ${date} ${slot}`);
  const ogDesc = escAttr((data.oneline || "오늘의 AI·기술 뉴스 브리핑").replace(/<\/?b>/g, "").slice(0, 200));
  const html = tpl
    .replace("__PAGE_TITLE__", pageTitle)
    .replace("__DIGEST_DATA_B64__", b64)
    .replace("__FAV_API_URL__", favApi)
    .replace("__OG_TITLE__", () => ogTitle)
    .replace("__OG_DESC__", () => ogDesc)
    .replace("__ACCENT_OVERRIDE__", () => accentStyle);

  fs.writeFileSync(outFile, html, "utf8");
  log("생성 완료:", outFile);

  // 이번에 낸 기사 url(없으면 제목)을 seen.json 에 기록 → 다음부턴 제외
  const newKeys = [];
  data.sections.forEach(s => s.items.forEach(it => newKeys.push(keyOf(it))));
  const merged = Array.from(new Set([...seen, ...newKeys]));
  fs.writeFileSync(seenPath, JSON.stringify(merged), "utf8");
  log(`seen.json 갱신 — 누적 ${merged.length}건`);

  // run.sh가 이 경로를 받아 텔레그램으로 보냄 → stdout에는 경로만
  process.stdout.write(outFile + "\n");
} catch (e) {
  log("오류:", e.message);
  process.exit(1);
}
