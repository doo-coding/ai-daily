// 오프라인 HTML 생성 (AI 데일리)
// 온라인 빌드 결과 HTML을 받아 → (1) 메모·즐겨찾기 숨김 (2) Worker 연결 제거
// (3) 폰트를 '그날 쓰는 글자만' 구글 서브셋으로 받아 base64 내장 → 인터넷 없이도 글꼴 유지.
// 기존 build.js/온라인 파이프라인은 건드리지 않는다.
// 사용: node build-offline.js <online.html>   → 같은 위치에 *-offline.html 생성(경로를 stdout 마지막 줄에)
const fs = require("fs"), https = require("https");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const inPath = process.argv[2];
if (!inPath || !fs.existsSync(inPath)) { console.error("[offline] 입력 HTML 없음:", inPath); process.exit(1); }
let html = fs.readFileSync(inPath, "utf8");

// 실제 표시되는 글자 모집: b64 데이터(카드 텍스트) + 정적 UI 텍스트 + 흔한 기호
function usedChars(h) {
  const set = new Set();
  const m = h.match(/const __B64__ = "([^"]+)"/);
  if (m) { try { const j = Buffer.from(m[1], "base64").toString("utf8"); for (const c of j) set.add(c); } catch (e) {} }
  const noScript = h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
  for (const c of noScript) set.add(c);
  for (const c of " 0123456789.,%·—–-()[]:;/+~→★☆▼▲✓") set.add(c);
  return Array.from(set).filter(c => c.charCodeAt(0) >= 32).join("");
}

function get(url, binary) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error("HTTP " + r.statusCode)); }
      if (binary) { const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => res(Buffer.concat(ch))); }
      else { let d = ""; r.setEncoding("utf8"); r.on("data", c => d += c); r.on("end", () => res(d)); }
    });
    req.on("error", rej);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
  });
}

async function embedFamily(family, weights, chars) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&text=${encodeURIComponent(chars)}`;
  let css = await get(url, false);
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(x => x[1]))];
  for (const u of urls) {
    const buf = await get(u, true);
    css = css.split(u).join("data:font/woff2;base64," + buf.toString("base64"));
  }
  return css;
}

(async () => {
  const chars = usedChars(html);
  let fontCss = "";
  try {
    fontCss += await embedFamily("IBM+Plex+Sans+KR", "400;500;600;700", chars) + "\n";
    fontCss += await embedFamily("JetBrains+Mono", "400;500;700", chars) + "\n";
    console.error("[offline] 폰트 내장 완료 (글자 " + chars.length + "자, CSS " + fontCss.length + "B)");
  } catch (e) {
    console.error("[offline] 폰트 내장 실패 → 시스템 폰트 폴백:", e.message);
    fontCss = "";
  }

  // 구글 폰트 외부 참조 제거(진짜 오프라인)
  html = html.replace(/\s*<link rel="preconnect"[^>]*>/g, "");
  html = html.replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "");

  // 임베드 폰트 + 메모·즐겨찾기 숨김 CSS 주입
  const off = `<style id="offline">${fontCss}.star,.memo-wrap,.favbtn{display:none!important;}</style>`;
  html = html.replace("</head>", off + "\n</head>");

  // 즐겨찾기 중계(Worker) 연결 끊기
  html = html.replace(/const FAV_API = "[^"]*";/, 'const FAV_API = "";');

  const outPath = inPath.replace(/\.html$/i, "") + "-offline.html";
  fs.writeFileSync(outPath, html, "utf8");
  process.stdout.write(outPath + "\n");
})().catch(e => { console.error("[offline] 실패:", e.message); process.exit(1); });
