// 출처 URL 수치 소프트 검증 (AI 데일리)
// 각 항목 title+bullets의 4자리+ 숫자가 출처 페이지 본문에 실제로 있는지 확인.
// 소프트: 불일치는 로그만, 발송을 막지 않음(항상 exit 0). 운영 신호(환각 조기 감지)용.
// 사용: node verify.js [output/items.json]
const fs = require("fs"), https = require("https"), http = require("http");

const itemsPath = process.argv[2] || "output/items.json";
let data;
try { data = JSON.parse(fs.readFileSync(itemsPath, "utf8")); }
catch (e) { console.log("[VERIFY] items.json 읽기 실패 — 건너뜀:", e.message); process.exit(0); }

const norm = s => String(s).replace(/[,\s ]/g, "");
// 4자리 이상 숫자(콤마 포함)만 본다 — 연도·소액은 노이즈라 제외하지 않되 3자리 이하는 흔해서 스킵
const numsOf = s => (String(s).match(/\d[\d,]{3,}/g) || []).map(n => n.replace(/,/g, ""));

function fetchText(url, depth) {
  depth = depth || 0;
  return new Promise(res => {
    if (depth > 4) return res({ ok: false, code: -2, text: "" });
    let lib;
    try { lib = url.startsWith("https") ? https : http; } catch (e) { return res({ ok: false, code: 0, text: "" }); }
    let req;
    try {
      req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AIDailyVerify/1.0)" }, timeout: 12000 }, r => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          try { return fetchText(new URL(r.headers.location, url).href, depth + 1).then(res); }
          catch (e) { return res({ ok: false, code: r.statusCode, text: "" }); }
        }
        if (r.statusCode !== 200) { r.resume(); return res({ ok: false, code: r.statusCode, text: "" }); }
        let buf = "";
        r.setEncoding("utf8");
        r.on("data", c => { buf += c; if (buf.length > 3_000_000) { req.destroy(); } });
        r.on("end", () => res({ ok: true, code: 200, text: buf.replace(/<[^>]+>/g, " ") }));
      });
    } catch (e) { return res({ ok: false, code: 0, text: "" }); }
    req.on("error", () => res({ ok: false, code: 0, text: "" }));
    req.on("timeout", () => { req.destroy(); res({ ok: false, code: -1, text: "" }); });
  });
}

(async () => {
  let checked = 0, flagged = 0, dead = 0;
  for (const s of data.sections || []) for (const it of s.items || []) {
    if (!it.url) continue;
    const want = [...new Set([...(it.bullets || []).flatMap(numsOf), ...numsOf(it.title || "")])];
    if (!want.length) continue;
    checked++;
    const r = await fetchText(it.url);
    if (!r.ok) { dead++; console.log(`[VERIFY] 출처 도달 실패(${r.code}) — ${String(it.title).slice(0, 40)}`); continue; }
    const body = norm(r.text);
    const miss = want.filter(n => !body.includes(n));
    if (miss.length) { flagged++; console.log(`[VERIFY] 수치 출처에 없음 [${miss.join(", ")}] — ${String(it.title).slice(0, 40)}`); }
  }
  console.log(`[VERIFY] 검사 ${checked}건 / 수치불일치 ${flagged}건 / 출처불통 ${dead}건 (소프트 — 발송 계속)`);
  process.exit(0);
})();
