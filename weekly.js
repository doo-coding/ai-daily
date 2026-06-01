#!/usr/bin/env node
/*
 * weekly.js — 즐겨찾기 모아보기 페이지 생성
 * favorites.json(중계가 GitHub에 기록한 별표 맵)을 읽어, 기간 내 항목만 같은 디자인으로 묶음.
 *
 * 사용법:
 *   node weekly.js                          # 최근 7일
 *   node weekly.js --since 2026-05-01 --until 2026-05-31   # 기간 수동 지정
 *   FAV_FILE=/경로/favorites.json node weekly.js
 *
 * 입력: output/favorites.json (없으면 중계 GET으로 먼저 받아둘 것 — run-weekly가 처리)
 * 출력: output/weekly-<until>.html  (경로를 stdout 출력)
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, "templates", "template.html");
const FAV_FILE = process.env.FAV_FILE || path.join(ROOT, "output", "favorites.json");

function log(...a){ console.error("[weekly]", ...a); }
function arg(name){ const i = process.argv.indexOf(name); return i > -1 ? process.argv[i+1] : null; }
function ymd(d){ return d.toISOString().slice(0,10); }

try {
  const until = arg("--until") || ymd(new Date());
  const since = arg("--since") || ymd(new Date(Date.now() - 6*864e5));
  if (!fs.existsSync(TEMPLATE)) throw new Error("템플릿 없음: " + TEMPLATE);
  if (!fs.existsSync(FAV_FILE)) throw new Error("favorites.json 없음: " + FAV_FILE + "  (중계 GET으로 먼저 받아두세요)");

  const map = JSON.parse(fs.readFileSync(FAV_FILE, "utf8"));
  let records = Object.values(map || {});
  // 기간 필터 (record.date 또는 item.date 기준)
  records = records.filter(r => {
    const d = r.date || (r.item && r.item.date) || null;
    return d && d >= since && d <= until;
  });
  // 최신순 정렬
  records.sort((a,b) => String(b.ts||"").localeCompare(String(a.ts||"")));

  // 원래 섹션(카테고리)별로 그룹 — 아이콘/색 유지
  const order = [];
  const groups = {};
  for (const r of records) {
    const it = r.item || { id: r.id, title: r.id, bullets: ["(상세 정보 없음)"] };
    const secName = it._section || "즐겨찾기";
    const icon = it._icon || "★";
    if (!groups[secName]) { groups[secName] = { icon, name: secName, items: [] }; order.push(secName); }
    groups[secName].items.push(it);
  }
  const sections = order.map(n => groups[n]);
  const n = records.length;

  const DIGEST = {
    date: until,
    slot: "fav",
    date_line: `★ 즐겨찾기 모아보기 · ${since} ~ ${until} · ${n}건`,
    kicker: "AI 데일리 · 즐겨찾기 모음",
    footer_tag: "★ 즐겨찾기 모아보기",
    oneline: n ? `${since} ~ ${until} 동안 ★ 표시한 ${n}건 모음` : `이 기간에 ★ 표시한 항목 없음`,
    sections,
  };

  // 템플릿 주입 (build.js와 동일 방식)
  const tpl = fs.readFileSync(TEMPLATE, "utf8");
  const b64 = Buffer.from(JSON.stringify(DIGEST), "utf8").toString("base64");
  let favApi = process.env.FAV_API_URL || "";
  const urlFile = path.join(ROOT, "output", "worker.url");
  if (!favApi && fs.existsSync(urlFile)) favApi = fs.readFileSync(urlFile, "utf8").trim();
  const html = tpl.replace("__DIGEST_DATA_B64__", b64).replace("__FAV_API_URL__", favApi);

  const outFile = path.join(ROOT, "output", `weekly-${until}.html`);
  fs.writeFileSync(outFile, html, "utf8");
  log(`생성: ${outFile} (${n}건, ${since}~${until})`);
  process.stdout.write(outFile + "\n");
} catch (e) {
  log("오류:", e.message);
  process.exit(1);
}
