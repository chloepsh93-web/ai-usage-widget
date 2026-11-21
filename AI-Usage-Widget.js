// AI 사용량 위젯 v2 (Scriptable, Medium)
// - 숫자만 담긴 JSON을 읽어 그리기만 한다. 토큰/세션 키 없음.
// - 소스가 2개다: ① 끌로이 PC 수집분 (Codex·Claude Code)
//   ② Muse 수집분 (Muse). 위젯이 id 기준으로 합쳐서 그린다.
// - 한쪽 가져오기가 실패하면 성공한 쪽 + 캐시로 메우고,
//   전부 실패하면 기기 내 캐시를 보여주고 "캐시" 표시를 남긴다.
// - 아래 두 줄의 주소만 본인 JSON 주소로 바꾸면 된다.

const JSON_URL_PC = "https://raw.githubusercontent.com/chloepsh93-web/ai-usage-widget/main/ai-usage-pc.json";     // PC 수집분 (Codex·Claude Code)
const JSON_URL_MUSE = "https://raw.githubusercontent.com/chloepsh93-web/ai-usage-widget/main/ai-usage.json"; // Muse 수집분 (Muse)

const SERVICE_ORDER = ["muse", "codex", "claude-code"];

const CACHE_NAME = "ai-usage-cache.json";
const STALE_HOURS = 6; // 이보다 오래된 데이터면 "오래됨" 표시

const C = {
  bg: new Color("#101014"),
  text: new Color("#F2F2F7"),
  sub: new Color("#9A9AA3"),
  track: new Color("#2C2C31"),
  ok: new Color("#30D158"),
  warn: new Color("#FFD60A"),
  danger: new Color("#FF453A"),
};

function colorFor(pct) {
  if (pct <= 10) return C.danger;
  if (pct <= 25) return C.warn;
  return C.ok;
}

// 첫 실행(호스팅 연결 전)에도 모양을 확인할 수 있게 넣어둔 실제 스냅샷.
// 두 URL이 모두 설정돼서 실데이터가 오면 이 값은 쓰이지 않고,
// 시간이 지나면 "오래됨"으로 표시된다.
const EMBEDDED_SNAPSHOT = {
  updatedAt: "2026-11-12T02:45+09:00",
  services: [
    {
      id: "muse", name: "Muse", status: "ok",
      weeklyRemainingPct: 100, weeklyResetAt: "2026-11-19T02:06:00+09:00",
      fiveHourRemainingPct: null, fiveHourResetAt: null,
      subLimit: { label: "추가 토큰", remainingPct: 9, resetAt: null, note: "89M" },
    },
    { id: "codex", name: "Codex", status: "unavailable" },
    { id: "claude-code", name: "Claude Code", status: "unavailable" },
  ],
};

// ---------- 데이터 ----------
function mergeServices(sources) {
  // sources: [{data, fetchedAt}] — id별로 가장 좋은 항목을 고른다.
  // ok > error > unavailable 순, 같은 등급이면 더 최신 소스 우선.
  const rank = (s) => (s.status === "ok" ? 3 : s.status === "error" ? 2 : 1);
  const byId = {};
  for (const src of sources) {
    for (const s of src.data.services || []) {
      const cur = byId[s.id];
      if (!cur || rank(s) > rank(cur.s) ||
          (rank(s) === rank(cur.s) && new Date(src.data.updatedAt) > new Date(cur.at))) {
        byId[s.id] = { s, at: src.data.updatedAt };
      }
    }
  }
  const services = SERVICE_ORDER.filter((id) => byId[id]).map((id) => byId[id].s);
  for (const id of Object.keys(byId)) {
    if (!SERVICE_ORDER.includes(id)) services.push(byId[id].s);
  }
  // 전체 신선도는 실제로 표시되는 항목 중 가장 오래된 소스 기준
  // (캐시·내장 스냅샷은 실제로 쓰일 때만 시점에 반영된다)
  const used = SERVICE_ORDER.filter((id) => byId[id]).map((id) => byId[id].at);
  const oldest = (used.length ? used : sources.map((x) => x.data.updatedAt))
    .sort((a, b) => new Date(a) - new Date(b))[0];
  return { updatedAt: oldest, services };
}

async function loadData() {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_NAME);

  const urls = [JSON_URL_PC, JSON_URL_MUSE].filter((u) => u.startsWith("http"));
  const fetched = [];
  for (const url of urls) {
    try {
      const req = new Request(url);
      req.timeoutInterval = 10;
      const data = await req.loadJSON();
      if (data && data.services) fetched.push({ data });
    } catch (e) { /* 이 소스는 건너뛰고 나머지로 메운다 */ }
  }

  let cached = null;
  if (fm.fileExists(cachePath)) {
    try { cached = JSON.parse(fm.readString(cachePath)); } catch (e) { /* 무시 */ }
  }

  if (fetched.length > 0) {
    // 성공한 소스 + (없는 서비스를 메울) 캐시/내장 스냅샷을 함께 합친다.
    const fillers = [];
    if (cached) fillers.push({ data: cached });
    fillers.push({ data: EMBEDDED_SNAPSHOT });
    const merged = mergeServices([...fetched, ...fillers]);
    fm.writeString(cachePath, JSON.stringify(merged));
    // 일부 소스라도 실패했으면 캐시 취급 (시점 표시에 드러난다)
    return { data: merged, fromCache: fetched.length < urls.length };
  }
  if (cached) return { data: cached, fromCache: true };
  return { data: EMBEDDED_SNAPSHOT, fromCache: true };
}

// ---------- 날짜 ----------
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
function fmtTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function fmtReset(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;
}
function daysUntil(iso) {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const r = new Date(iso);
  const b = new Date(r.getFullYear(), r.getMonth(), r.getDate());
  return Math.round((b - a) / 86400000);
}
function resetText(iso) {
  const n = daysUntil(iso);
  if (n <= 0) return "오늘 리셋";
  return `${n}일 남음`;
}
function ageHours(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// ---------- 잔여 바 (이미지로 그려서 넣는다) ----------
function barImage(pct, color) {
  const W = 92, H = 7;
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, W, H), H / 2, H / 2);
  ctx.setFillColor(C.track);
  ctx.addPath(track);
  ctx.fillPath();
  const w = Math.max(H, Math.round(W * Math.min(100, Math.max(0, pct)) / 100));
  const fill = new Path();
  fill.addRoundedRect(new Rect(0, 0, w, H), H / 2, H / 2);
  ctx.setFillColor(color);
  ctx.addPath(fill);
  ctx.fillPath();
  return ctx.getImage();
}

// ---------- 위젯 ----------
function buildWidget(data, fromCache) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 10, 14);

  // 헤더: 제목 + 데이터 시점
  const head = w.addStack();
  head.layoutHorizontally();
  const title = head.addText("AI 사용량");
  title.font = Font.boldSystemFont(13);
  title.textColor = C.text;
  head.addSpacer();
  const stale = ageHours(data.updatedAt) > STALE_HOURS;
  const stamp = head.addText(
    `${fmtTime(data.updatedAt)} 기준` + (fromCache ? " · 캐시" : "") + (stale ? " · 오래됨" : "")
  );
  stamp.font = Font.systemFont(10);
  stamp.textColor = (fromCache || stale) ? C.warn : C.sub;
  w.addSpacer(8);

  for (const s of data.services) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const name = row.addText(s.name);
    name.font = Font.semiboldSystemFont(12);
    name.textColor = C.text;
    name.lineLimit = 1;
    row.addSpacer(8);

    if (s.status !== "ok") {
      const t = row.addText("자동 수집 불가");
      t.font = Font.systemFont(11);
      t.textColor = C.sub;
      row.addSpacer();
    } else {
      const pct = s.weeklyRemainingPct;
      const col = colorFor(pct);
      const bar = row.addImage(barImage(pct, col));
      bar.imageSize = new Size(92, 7);
      row.addSpacer(8);
      const pt = row.addText(`${pct}%`);
      pt.font = Font.boldSystemFont(12);
      pt.textColor = col;
      row.addSpacer(8);
      const rt = row.addText(`${fmtReset(s.weeklyResetAt)} 리셋 · ${resetText(s.weeklyResetAt)}`);
      rt.font = Font.systemFont(10);
      rt.textColor = C.sub;
      rt.lineLimit = 1;
      row.addSpacer();
    }
    w.addSpacer(5);

    // 작은 병기: 5시간 제한 또는 별도 풀(subLimit)
    let subTxt = null;
    if (s.status === "ok" && s.fiveHourRemainingPct != null) {
      subTxt = { pct: s.fiveHourRemainingPct, full: `5시간 ${s.fiveHourRemainingPct}% 남음` };
    } else if (s.status === "ok" && s.subLimit) {
      const p = s.subLimit.remainingPct;
      subTxt = {
        pct: p,
        full: `${s.subLimit.label} ${p}% 남음` + (s.subLimit.note ? ` · ${s.subLimit.note} 남음` : ""),
      };
    }
    if (subTxt) {
      const subRow = w.addStack();
      subRow.layoutHorizontally();
      subRow.addSpacer(2);
      const t = subRow.addText(subTxt.full);
      t.font = Font.systemFont(9);
      t.textColor = colorFor(subTxt.pct);
      w.addSpacer(5);
    }
  }

  w.addSpacer();
  const foot = w.addText("수집 주기 약 3시간 · 위젯 새로고침은 iOS가 결정");
  foot.font = Font.systemFont(8);
  foot.textColor = C.sub;

  // iOS가 허용하면 30분 뒤 갱신 요청 (보장 아님)
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  return w;
}

const { data, fromCache } = await loadData();
const widget = buildWidget(data, fromCache);
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
