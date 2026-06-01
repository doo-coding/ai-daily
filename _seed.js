// 일회성: 이미 발행된 d/*.html 의 기사 url/제목을 seen.json 에 시드 (과거 기사 재노출 방지)
const fs = require("fs"), path = require("path");
const D = path.join(__dirname, "d"), OUT = path.join(__dirname, "output", "seen.json");
const keys = new Set();
for (const f of fs.readdirSync(D).filter(x => x.endsWith(".html"))) {
  const h = fs.readFileSync(path.join(D, f), "utf8");
  const m = h.match(/const __B64__ = "([^"]+)"/);
  if (!m) continue;
  try {
    const d = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    (d.sections || []).forEach(s => (s.items || []).forEach(it => {
      keys.add((it.url && String(it.url).trim()) ? String(it.url).trim() : ("t:" + String(it.title || "").trim()));
    }));
  } catch (e) {}
}
fs.writeFileSync(OUT, JSON.stringify([...keys]));
console.log("seeded " + keys.size + " keys from published digests");
