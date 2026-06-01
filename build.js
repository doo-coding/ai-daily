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

  // --- 날짜/슬롯으로 파일명 결정 ---
  const date = data.date || new Date().toISOString().slice(0, 10);
  const slot = (data.slot || "am").replace(/[^a-z0-9]/gi, "");
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `ai-daily-${date}-${slot}.html`);

  // --- base64(UTF-8)로 주입 (따옴표/유니코드 이스케이프 문제 회피) ---
  const tpl = fs.readFileSync(TEMPLATE, "utf8");
  const b64 = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  if (!tpl.includes("__DIGEST_DATA_B64__")) throw new Error("템플릿에 주입 지점(__DIGEST_DATA_B64__)이 없습니다.");

  // 즐겨찾기 중계 URL: 환경변수 FAV_API_URL > 파일 output/worker.url > 빈값(localStorage만)
  let favApi = process.env.FAV_API_URL || "";
  const urlFile = path.join(ROOT, "output", "worker.url");
  if (!favApi && fs.existsSync(urlFile)) favApi = fs.readFileSync(urlFile, "utf8").trim();
  if (favApi) log("즐겨찾기 중계 연결:", favApi); else log("중계 URL 없음 → localStorage 모드");

  const html = tpl
    .replace("__DIGEST_DATA_B64__", b64)
    .replace("__FAV_API_URL__", favApi);

  fs.writeFileSync(outFile, html, "utf8");
  log("생성 완료:", outFile);

  // run.sh가 이 경로를 받아 텔레그램으로 보냄 → stdout에는 경로만
  process.stdout.write(outFile + "\n");
} catch (e) {
  log("오류:", e.message);
  process.exit(1);
}
