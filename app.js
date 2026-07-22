"use strict";

const APP_VERSION = "0.2.0";
const STORAGE_KEY = "viral-field-prototype-v2";
const LEGACY_STORAGE_KEY = "viral-field-prototype-v1";
const MAX_SLOTS = 4;
const SEED_COST = 1000;
const AUTO_HARVEST_MINUTES = 24 * 60;

const palette = [
  { color: "#c8ff3d", ink: "#171a15" },
  { color: "#5bd5ff", ink: "#171a15" },
  { color: "#ff8158", ink: "#171a15" },
  { color: "#aa91ff", ink: "#171a15" },
  { color: "#ffd93d", ink: "#171a15" },
  { color: "#ff79b0", ink: "#171a15" },
];

const titlePartsA = [
  "이 타이밍에 갑자기",
  "아무도 예상 못 한",
  "댓글창이 뒤집힌",
  "새벽 세 시에 발견한",
  "끝까지 보면 이상한",
  "알고리즘이 주운",
  "친구가 보내준",
  "소리 켜면 더 위험한",
];

const titlePartsB = [
  "비둘기의 출근 루틴",
  "편의점 알바생의 반격",
  "강아지 면접 대참사",
  "3초 만에 끝난 댄스",
  "라면 물 맞추는 장인",
  "헬스장 최후의 생존자",
  "할머니의 비밀 개인기",
  "엘리베이터 안 작은 기적",
];

const handles = [
  "@zero_context", "@daily_crash", "@lowbattery99", "@hidden_clip",
  "@scroll_damage", "@tiny_signal", "@oddly_locked", "@after_3am",
];

const sampleSources = [
  {
    url: "https://youtube.com/shorts/demo-pigeon-001",
    title: "비둘기가 지하철에서 내리는 법",
    handle: "@zero_context",
    platform: "YOUTUBE SHORTS",
    initialViews: 842,
    ageHours: 2,
    curve: "breakout",
    paletteIndex: 0,
    baseDiscoverers: 3,
  },
  {
    url: "https://youtube.com/shorts/demo-ramen-002",
    title: "라면 물을 눈빛으로 맞추는 사람",
    handle: "@after_3am",
    platform: "YOUTUBE SHORTS",
    initialViews: 12800,
    ageHours: 11,
    curve: "steady",
    paletteIndex: 1,
    baseDiscoverers: 42,
  },
  {
    url: "https://youtube.com/shorts/demo-dog-003",
    title: "강아지 면접 2차에서 벌어진 일",
    handle: "@daily_crash",
    platform: "YOUTUBE SHORTS",
    initialViews: 237,
    ageHours: 1,
    curve: "sleeper",
    paletteIndex: 2,
    baseDiscoverers: 0,
  },
  {
    url: "https://youtube.com/shorts/demo-dance-004",
    title: "3초 만에 모든 걸 보여준 댄스",
    handle: "@lowbattery99",
    platform: "YOUTUBE SHORTS",
    initialViews: 38200,
    ageHours: 17,
    curve: "earlySpike",
    paletteIndex: 3,
    baseDiscoverers: 128,
  },
  {
    url: "https://youtube.com/shorts/demo-lift-005",
    title: "엘리베이터 문이 열리자 모두 조용해짐",
    handle: "@hidden_clip",
    platform: "YOUTUBE SHORTS",
    initialViews: 1640,
    ageHours: 5,
    curve: "comeback",
    paletteIndex: 4,
    baseDiscoverers: 8,
  },
  {
    url: "https://youtube.com/shorts/demo-gym-006",
    title: "헬스장 최후의 생존자가 한 행동",
    handle: "@oddly_locked",
    platform: "YOUTUBE SHORTS",
    initialViews: 7200,
    ageHours: 7,
    curve: "flop",
    paletteIndex: 5,
    baseDiscoverers: 19,
  },
];

const elements = {
  portfolioValue: document.querySelector("#portfolioValue"),
  portfolioDelta: document.querySelector("#portfolioDelta"),
  heroChart: document.querySelector("#heroChart"),
  balanceValue: document.querySelector("#balanceValue"),
  slotUsage: document.querySelector("#slotUsage"),
  scoutLevel: document.querySelector("#scoutLevel"),
  clockLabel: document.querySelector("#clockLabel"),
  fieldGrid: document.querySelector("#fieldGrid"),
  activityList: document.querySelector("#activityList"),
  rankValue: document.querySelector("#rankValue"),
  linkForm: document.querySelector("#linkForm"),
  linkInput: document.querySelector("#linkInput"),
  sampleButton: document.querySelector("#sampleButton"),
  pasteButton: document.querySelector("#pasteButton"),
  advanceOneButton: document.querySelector("#advanceOneButton"),
  advanceSixButton: document.querySelector("#advanceSixButton"),
  harvestAllButton: document.querySelector("#harvestAllButton"),
  resetButton: document.querySelector("#resetButton"),
  navPlantButton: document.querySelector("#navPlantButton"),
  modalBackdrop: document.querySelector("#modalBackdrop"),
  candidateSheet: document.querySelector("#candidateSheet"),
  candidateContent: document.querySelector("#candidateContent"),
  positionSheet: document.querySelector("#positionSheet"),
  positionContent: document.querySelector("#positionContent"),
  resultSheet: document.querySelector("#resultSheet"),
  resultContent: document.querySelector("#resultContent"),
  changelogButton: document.querySelector("#changelogButton"),
  changelogSheet: document.querySelector("#changelogSheet"),
  toast: document.querySelector("#toast"),
};

let state = loadState();
let pendingCandidate = null;
let selectedReplacementId = null;
let sampleIndex = 2;
let toastTimer = null;

function buildInitialState() {
  const initial = {
    version: APP_VERSION,
    balance: 3200,
    virtualMinutes: 0,
    positions: [],
    harvests: [],
    harvestedSourceIds: [],
  };

  initial.positions.push(createPosition(sampleSources[0], -150));
  initial.positions.push(createPosition(sampleSources[1], -330));
  return initial;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return buildInitialState();
    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.positions) || !Array.isArray(parsed.harvests)) {
      return buildInitialState();
    }
    return migrateState(parsed);
  } catch {
    return buildInitialState();
  }
}

function migrateState(savedState) {
  const legacyRefund = savedState.harvests.reduce((sum, harvest) => {
    return sum + Math.max(0, SEED_COST - (harvest.payout || 0));
  }, 0);
  const migrated = {
    ...savedState,
    version: APP_VERSION,
    balance: (savedState.balance || 0) + legacyRefund,
    positions: savedState.positions.map((position) => ({
      ...position,
      discoveryRank: position.discoveryRank || discoveryRankFor(position),
      discoverersAtPlant: position.discoverersAtPlant || discoveryRankFor(position),
    })),
    harvests: savedState.harvests.map((harvest) => {
      const discoveryRank = harvest.discoveryRank || 1 + (hashString(harvest.sourceId || harvest.url || harvest.title) % 120);
      return {
        ...harvest,
        payout: Math.max(SEED_COST, harvest.payout || SEED_COST),
        profit: Math.max(0, (harvest.payout || SEED_COST) - SEED_COST),
        discoveryRank,
        discoverersAtHarvest: Math.max(discoveryRank, harvest.discoverersAtHarvest || discoveryRank),
      };
    }),
    harvestedSourceIds: Array.from(new Set([
      ...(savedState.harvestedSourceIds || []),
      ...savedState.harvests.map((harvest) => harvest.sourceId).filter(Boolean),
    ])),
  };

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Migration still succeeds when legacy cleanup is unavailable.
  }
  return migrated;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The prototype remains playable even when local storage is unavailable.
  }
}

function createPosition(source, plantedMinute = state.virtualMinutes) {
  const discoveryRank = discoveryRankFor(source);
  return {
    id: createId(),
    sourceId: canonicalSourceId(source.url),
    url: source.url,
    title: source.title,
    handle: source.handle,
    platform: source.platform,
    initialViews: source.initialViews,
    entryViews: source.initialViews,
    ageHours: source.ageHours,
    curve: source.curve,
    paletteIndex: source.paletteIndex,
    plantedMinute,
    earlyBonus: calculateEarlyBonus(source.initialViews, source.ageHours),
    seed: hashString(source.url),
    discoveryRank,
    discoverersAtPlant: discoveryRank,
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function canonicalSourceId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);

    if (host.includes("youtube.com")) {
      return `yt:${url.searchParams.get("v") || segments.at(-1) || hashString(rawUrl)}`;
    }
    if (host === "youtu.be") return `yt:${segments[0] || hashString(rawUrl)}`;
    if (host.includes("instagram.com")) return `ig:${segments.at(-1) || hashString(rawUrl)}`;
    if (host.includes("tiktok.com")) return `tt:${segments.at(-1) || hashString(rawUrl)}`;
    return `${host}:${segments.at(-1) || hashString(rawUrl)}`;
  } catch {
    return `url:${hashString(rawUrl)}`;
  }
}

function sourceFromUrl(rawUrl) {
  const normalized = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("http 또는 https 링크를 입력해 주세요.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("http 또는 https 링크만 사용할 수 있어요.");
  }

  const sample = sampleSources.find((item) => canonicalSourceId(item.url) === canonicalSourceId(normalized));
  if (sample) return { ...sample, url: normalized };

  const seed = hashString(normalized);
  const curves = ["breakout", "steady", "earlySpike", "sleeper", "flop", "comeback"];
  const platform = detectPlatform(parsed.hostname);
  const lowViewRoll = seed % 5 === 0;
  const initialViews = lowViewRoll ? 120 + (seed % 1200) : 900 + (seed % 42000);
  const ageHours = 1 + ((seed >>> 4) % 42);

  return {
    url: normalized,
    title: `${titlePartsA[seed % titlePartsA.length]} ${titlePartsB[(seed >>> 3) % titlePartsB.length]}`,
    handle: handles[(seed >>> 6) % handles.length],
    platform,
    initialViews,
    ageHours,
    curve: curves[(seed >>> 8) % curves.length],
    paletteIndex: (seed >>> 11) % palette.length,
    baseDiscoverers: Math.max(0, Math.floor((Math.log10(initialViews + 10) - 2) * 7 + ageHours * 0.35 + (seed % 5))),
  };
}

function detectPlatform(hostname) {
  const host = hostname.toLowerCase();
  if (host.includes("youtube") || host.includes("youtu.be")) return "YOUTUBE SHORTS";
  if (host.includes("instagram")) return "INSTAGRAM REELS";
  if (host.includes("tiktok")) return "TIKTOK";
  return "EXTERNAL SIGNAL";
}

function calculateEarlyBonus(views, ageHours) {
  const viewPenalty = Math.log10(Math.max(views, 10)) * 0.115;
  const agePenalty = ageHours * 0.004;
  return clamp(1.66 - viewPenalty - agePenalty, 0.78, 1.32);
}

function baseDiscovererCount(source) {
  if (Number.isFinite(source.baseDiscoverers)) return Math.max(0, Math.floor(source.baseDiscoverers));
  const seed = source.seed || hashString(source.url || source.sourceId || source.title || "unknown");
  const views = source.initialViews || source.entryViews || 100;
  const ageHours = source.ageHours || 1;
  return Math.max(0, Math.floor((Math.log10(views + 10) - 2) * 7 + ageHours * 0.35 + (seed % 5)));
}

function discoveryRankFor(source) {
  return baseDiscovererCount(source) + 1;
}

function discovererCountAt(position, virtualMinute = state.virtualMinutes) {
  const elapsedHours = Math.max(0, (virtualMinute - position.plantedMinute) / 60);
  const ratio = positionRatio(position, virtualMinute);
  const seedRate = 7 + (position.seed % 13);
  const viralFollowers = Math.floor(Math.max(0, ratio - 1) * seedRate);
  const backgroundFollowers = Math.floor(elapsedHours * (0.35 + (position.seed % 7) * 0.08));
  return Math.max(position.discoverersAtPlant || position.discoveryRank || 1, (position.discoverersAtPlant || 1) + viralFollowers + backgroundFollowers);
}

function discoveryPercentile(rank, total) {
  if (total <= 1) return 100;
  return clamp(Math.ceil((rank / total) * 100), 1, 100);
}

function growthFactor(curve, hours) {
  const h = Math.max(0, hours);
  switch (curve) {
    case "breakout":
      return 1 + 0.09 * h + 0.095 * h ** 2 + 0.0022 * h ** 3;
    case "steady":
      return 1 + 0.145 * h + 0.006 * h ** 1.65;
    case "earlySpike":
      return 1 + 2.15 * (1 - Math.exp(-1.05 * h)) + 0.016 * h;
    case "sleeper":
      return h <= 4 ? 1 + 0.026 * h : 1.104 + 0.115 * (h - 4) ** 2;
    case "comeback":
      return h <= 8 ? 1 + 0.013 * h : 1.104 + 0.12 * (h - 8) ** 1.72;
    case "flop":
    default:
      return 1 + 0.012 * h + 0.004 * Math.sqrt(h);
  }
}

function viewsAt(position, virtualMinute = state.virtualMinutes) {
  const elapsedHours = Math.max(0, (virtualMinute - position.plantedMinute) / 60);
  const factor = growthFactor(position.curve, elapsedHours);
  return Math.max(position.entryViews, Math.round(position.entryViews * factor));
}

function positionRatio(position, virtualMinute = state.virtualMinutes) {
  return viewsAt(position, virtualMinute) / position.entryViews;
}

function payoutAt(position, virtualMinute = state.virtualMinutes) {
  const ratio = positionRatio(position, virtualMinute);
  const multiplier = clamp(1 + Math.log2(Math.max(ratio, 1)) * 0.28 * position.earlyBonus, 1, 4.2);
  return Math.round(SEED_COST * multiplier);
}

function elapsedMinutes(position) {
  return Math.max(0, state.virtualMinutes - position.plantedMinute);
}

function getStatus(position) {
  const ratio = positionRatio(position);
  const elapsed = elapsedMinutes(position) / 60;
  if (ratio >= 25) return { label: "폭발 중", icon: "✹", hot: true };
  if (ratio >= 7) return { label: "급상승", icon: "↗", hot: true };
  if (ratio >= 2.2) return { label: "상승 중", icon: "↑", hot: true };
  if (position.curve === "sleeper" && elapsed < 5) return { label: "잠복 중", icon: "…", hot: false };
  if (position.curve === "comeback" && elapsed < 9) return { label: "숨 고르기", icon: "·", hot: false };
  if (ratio >= 1.15) return { label: "미세 상승", icon: "+", hot: false };
  return { label: "정체", icon: "—", hot: false };
}

function render() {
  renderSummary();
  renderField();
  renderActivity();
  saveState();
}

function renderSummary() {
  const positionValue = state.positions.reduce((sum, position) => sum + payoutAt(position), 0);
  const totalValue = state.balance + positionValue;
  const investedBase = state.balance + state.positions.length * SEED_COST;
  const delta = investedBase > 0 ? ((totalValue - investedBase) / investedBase) * 100 : 0;
  const level = 1 + Math.floor((state.harvests.length + state.positions.length) / 5);

  elements.portfolioValue.textContent = `${formatNumber(totalValue)} C`;
  elements.portfolioDelta.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% 현재`;
  elements.portfolioDelta.classList.toggle("is-negative", delta < 0);
  elements.balanceValue.textContent = `${formatNumber(state.balance)} C`;
  elements.slotUsage.textContent = `${state.positions.length} / ${MAX_SLOTS}`;
  elements.scoutLevel.textContent = `LV. ${String(level).padStart(2, "0")}`;

  const absoluteMinutes = 9 * 60 + state.virtualMinutes;
  const day = 1 + Math.floor(absoluteMinutes / (24 * 60));
  const minuteOfDay = absoluteMinutes % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  elements.clockLabel.textContent = `DAY ${String(day).padStart(2, "0")} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  elements.heroChart.innerHTML = sparklineSvg(portfolioSeries(), "#c8ff3d", "rgba(200,255,61,0.13)", 3, true);

  if (state.positions.length === 0) {
    elements.rankValue.textContent = "#—";
  } else {
    const bestScore = Math.max(...state.positions.map((position) => positionRatio(position) * position.earlyBonus));
    elements.rankValue.textContent = `#${Math.max(1, Math.round(740 / Math.max(bestScore, 0.7)))}`;
  }
}

function portfolioSeries() {
  const points = [];
  for (let i = 10; i >= 0; i -= 1) {
    const minute = state.virtualMinutes - i * 60;
    const value = state.balance + state.positions.reduce((sum, position) => {
      if (minute < position.plantedMinute) return sum;
      return sum + payoutAt(position, minute);
    }, 0);
    points.push(value);
  }
  return points;
}

function renderField() {
  const cards = state.positions.map((position) => plotCardMarkup(position));
  for (let i = state.positions.length; i < MAX_SLOTS; i += 1) {
    cards.push(`
      <button class="plot-card plot-card--empty" type="button" data-empty-plot>
        <span class="empty-plot-icon" aria-hidden="true">+</span>
        <strong>빈 슬롯</strong>
        <span>새 링크를 심을 수 있어요</span>
      </button>
    `);
  }
  elements.fieldGrid.innerHTML = cards.join("");
  elements.harvestAllButton.disabled = state.positions.length === 0;
}

function plotCardMarkup(position) {
  const currentViews = viewsAt(position);
  const ratio = currentViews / position.entryViews;
  const growth = (ratio - 1) * 100;
  const status = getStatus(position);
  const colors = palette[position.paletteIndex % palette.length];
  const values = positionSeries(position, 8);
  const scale = clamp(0.62 + Math.log2(Math.max(ratio, 1)) * 0.1, 0.62, 1.28);

  return `
    <button
      class="plot-card"
      type="button"
      data-position-id="${position.id}"
      aria-label="${escapeHtml(position.title)} 포지션 상세 보기"
    >
      <div class="plot-visual" style="--plot-color:${colors.color};--plot-ink:${colors.ink};--signal-scale:${scale}">
        <span class="platform-badge">${shortPlatform(position.platform)}</span>
        <span class="discovery-badge">#${formatNumber(position.discoveryRank)} 발견</span>
        <span class="signal-orb" aria-hidden="true"></span>
        <div class="plot-spark" aria-hidden="true">${sparklineSvg(values, colors.ink, "rgba(255,255,255,0.28)", 2)}</div>
      </div>
      <div class="plot-body">
        <div class="plot-title-row">
          <h3 class="plot-title">${escapeHtml(position.title)}</h3>
          <span class="plot-menu" aria-hidden="true">···</span>
        </div>
        <p class="plot-handle">${escapeHtml(position.handle)} · 내 뒤로 +${formatCompact(discovererCountAt(position) - position.discoveryRank)}명</p>
        <div class="plot-metrics">
          <div>
            <span>현재 조회</span>
            <strong>${formatCompact(currentViews)}</strong>
          </div>
          <div class="plot-growth ${status.hot ? "" : "is-cold"}">
            <span>${status.icon} ${status.label}</span>
            <strong>+${formatPercent(growth)}</strong>
          </div>
        </div>
      </div>
    </button>
  `;
}

function positionSeries(position, count = 10) {
  const elapsed = Math.max(1, elapsedMinutes(position));
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = i / (count - 1);
    values.push(viewsAt(position, position.plantedMinute + elapsed * fraction));
  }
  return values;
}

function sparklineSvg(values, stroke, fill, strokeWidth = 2, wide = false) {
  const width = wide ? 600 : 200;
  const height = wide ? 130 : 50;
  const pad = wide ? 4 : 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2 - 8);
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)[0].toFixed(1)} ${height} L${points[0][0].toFixed(1)} ${height} Z`;
  const last = points.at(-1);

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d="${area}" fill="${fill}" />
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke" />
      ${wide ? `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${stroke}" />` : ""}
    </svg>
  `;
}

function renderActivity() {
  const items = [];
  const sorted = [...state.positions].sort((a, b) => positionRatio(b) - positionRatio(a));

  sorted.slice(0, 3).forEach((position, index) => {
    const status = getStatus(position);
    const ratio = positionRatio(position);
    const followersAfter = Math.max(0, discovererCountAt(position) - position.discoveryRank);
    const messages = ratio >= 7
      ? `<strong>${escapeHtml(shortTitle(position.title))}</strong> 신호가 피드를 뚫고 급상승 중입니다.`
      : followersAfter >= 5
        ? `<strong>${escapeHtml(shortTitle(position.title))}</strong>를 당신 이후 ${formatCompact(followersAfter)}명이 발견했습니다.`
        : ratio >= 2
          ? `<strong>${escapeHtml(shortTitle(position.title))}</strong>가 진입가 대비 ${ratio.toFixed(1)}배 성장했습니다.`
        : `<strong>${escapeHtml(shortTitle(position.title))}</strong>는 아직 알고리즘을 기다리는 중입니다.`;
    items.push({
      icon: status.icon,
      message: messages,
      time: index === 0 ? "방금" : `${index * 7 + 3}분 전`,
      color: palette[position.paletteIndex % palette.length].color,
    });
  });

  if (state.harvests.length > 0 && items.length < 3) {
    const last = state.harvests.at(-1);
    items.push({
      icon: "✓",
      message: `<strong>${escapeHtml(shortTitle(last.title))}</strong> 수확으로 ${formatNumber(last.payout)} C를 확보했습니다.`,
      time: "기록",
      color: "#5bd5ff",
    });
  }

  if (items.length === 0) {
    items.push({ icon: "+", message: "링크를 심으면 실시간 밭 소식이 여기에 표시됩니다.", time: "대기", color: "#e8e4d1" });
  }

  elements.activityList.innerHTML = items.slice(0, 3).map((item) => `
    <li class="activity-item">
      <span class="activity-icon" style="--activity-color:${item.color}" aria-hidden="true">${item.icon}</span>
      <p>${item.message}</p>
      <time>${item.time}</time>
    </li>
  `).join("");
}

function openCandidate(source) {
  const sourceId = canonicalSourceId(source.url);
  const duplicate = state.positions.find((position) => position.sourceId === sourceId);
  if (duplicate) {
    showToast("이미 내 밭에 심어둔 링크예요. 해당 포지션을 열었습니다.");
    openPosition(duplicate.id);
    return;
  }
  if (state.harvestedSourceIds.includes(sourceId)) {
    showToast("이미 수확을 마친 링크예요. 같은 링크에는 다시 진입할 수 없습니다.");
    return;
  }

  pendingCandidate = source;
  selectedReplacementId = null;
  renderCandidateSheet();
  openSheet(elements.candidateSheet);
}

function renderCandidateSheet() {
  if (!pendingCandidate) return;
  const source = pendingCandidate;
  const colors = palette[source.paletteIndex % palette.length];
  const earlyBonus = calculateEarlyBonus(source.initialViews, source.ageHours);
  const prospectiveRank = discoveryRankFor(source);
  const isFull = state.positions.length >= MAX_SLOTS;
  const affordability = state.balance >= SEED_COST;

  const replacementMarkup = isFull ? `
    <div class="replace-heading">
      <h3>밭이 꽉 찼어. 하나를 뽑아야 해</h3>
      <span>예상 수확가</span>
    </div>
    <div class="replace-list">
      ${state.positions.map((position) => {
        const selected = position.id === selectedReplacementId;
        return `
          <button class="replace-option ${selected ? "is-selected" : ""}" type="button" data-replace-id="${position.id}">
            <span class="radio-dot" aria-hidden="true"></span>
            <span>
              <strong>${escapeHtml(position.title)}</strong>
              <small>${formatCompact(viewsAt(position))} · ${getStatus(position).label}</small>
            </span>
            <span class="replace-value">${formatNumber(payoutAt(position))} C</span>
          </button>
        `;
      }).join("")}
    </div>
  ` : "";

  const buttonLabel = isFull ? "선택한 포지션을 뽑고 심기" : "이 링크 심기";
  const needsMoney = !isFull && !affordability;

  elements.candidateContent.innerHTML = `
    <div class="candidate-card">
      <div class="candidate-cover" style="--candidate-color:${colors.color}">
        <span class="cover-platform">${shortPlatform(source.platform)}</span>
      </div>
      <div class="candidate-info">
        <h3>${escapeHtml(source.title)}</h3>
        <p>${escapeHtml(source.handle)}</p>
        <div class="sheet-stats">
          <div class="sheet-stat"><span>현재 조회</span><strong>${formatCompact(source.initialViews)}</strong></div>
          <div class="sheet-stat"><span>업로드</span><strong>${source.ageHours}시간 전</strong></div>
          <div class="sheet-stat"><span>지금 심으면</span><strong>${prospectiveRank === 1 ? "최초 발견자" : `#${formatNumber(prospectiveRank)} 발견자`}</strong></div>
          <div class="sheet-stat"><span>조기 배수</span><strong>×${earlyBonus.toFixed(2)}</strong></div>
        </div>
        <div class="signal-verdict">${prospectiveRank === 1 ? "아직 아무도 심지 않았습니다. 최초 발견 기록을 선점할 수 있어요." : `현재 ${formatNumber(prospectiveRank - 1)}명이 먼저 발견했습니다. 결과는 아직 미확인입니다.`}</div>
      </div>
    </div>
    ${replacementMarkup}
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-close-sheet>취소</button>
      <button class="primary-button" id="confirmPlantButton" type="button" ${needsMoney ? "disabled" : ""}>
        ${needsMoney ? "코인이 부족해" : buttonLabel}
      </button>
    </div>
  `;
}

function plantPendingCandidate() {
  if (!pendingCandidate) return;
  const isFull = state.positions.length >= MAX_SLOTS;
  let replacedTitle = null;

  if (isFull) {
    if (!selectedReplacementId) {
      showToast("먼저 뽑을 포지션을 선택해 주세요.");
      return;
    }
    const result = harvestPosition(selectedReplacementId, false);
    replacedTitle = result?.title || null;
  }

  if (state.balance < SEED_COST) {
    showToast("씨앗을 살 코인이 부족합니다. 기존 포지션을 먼저 수확해 보세요.");
    return;
  }

  state.balance -= SEED_COST;
  state.positions.push(createPosition(pendingCandidate));
  const plantedTitle = pendingCandidate.title;
  pendingCandidate = null;
  selectedReplacementId = null;
  closeSheets();
  render();
  elements.linkInput.value = "";
  showToast(replacedTitle
    ? `“${shortTitle(replacedTitle)}”를 수확하고 새 링크를 심었습니다.`
    : `“${shortTitle(plantedTitle)}” 신호를 심었습니다.`);
}

function openPosition(positionId) {
  const position = state.positions.find((item) => item.id === positionId);
  if (!position) return;
  const colors = palette[position.paletteIndex % palette.length];
  const current = viewsAt(position);
  const ratio = current / position.entryViews;
  const growth = (ratio - 1) * 100;
  const payout = payoutAt(position);
  const profit = payout - SEED_COST;
  const discoverers = discovererCountAt(position);

  elements.positionContent.innerHTML = `
    <div class="position-hero">
      <div class="position-cover" style="--candidate-color:${colors.color}">
        <span class="cover-platform">${shortPlatform(position.platform)}</span>
      </div>
      <div class="position-info">
        <h3>${escapeHtml(position.title)}</h3>
        <p>${escapeHtml(position.handle)}</p>
        <div class="sheet-stats">
          <div class="sheet-stat"><span>현재 조회</span><strong>${formatCompact(current)}</strong></div>
          <div class="sheet-stat"><span>상승률</span><strong>+${formatPercent(growth)}</strong></div>
          <div class="sheet-stat"><span>발견 순번</span><strong>${position.discoveryRank === 1 ? "최초" : `#${formatNumber(position.discoveryRank)}`}</strong></div>
          <div class="sheet-stat"><span>자동 수확</span><strong>${formatRemaining(position)}</strong></div>
        </div>
      </div>
    </div>
    <div class="detail-chart">
      <span class="detail-chart-label">VIEW GROWTH / DEMO</span>
      ${sparklineSvg(positionSeries(position, 16), colors.ink, `${hexToRgba(colors.color, 0.42)}`, 3, true)}
    </div>
    <div class="position-meta">
      <div class="sheet-stat"><span>진입 조회</span><strong>${formatCompact(position.entryViews)}</strong></div>
      <div class="sheet-stat"><span>보유 시간</span><strong>${formatDuration(elapsedMinutes(position))}</strong></div>
      <div class="sheet-stat"><span>현재 발견자</span><strong>${formatCompact(discoverers)}명</strong></div>
    </div>
    <div class="harvest-preview">
      <span>씨앗값 100% 반환 + 현재 성장 보너스</span>
      <strong>+${formatNumber(profit)} C</strong>
    </div>
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-open-source="${position.id}">원본 링크 열기</button>
      <button class="danger-button" type="button" data-harvest-id="${position.id}">지금 수확 · ${formatNumber(payout)} C</button>
    </div>
  `;
  openSheet(elements.positionSheet);
}

function harvestPosition(positionId, showResult = true) {
  const index = state.positions.findIndex((item) => item.id === positionId);
  if (index === -1) return null;

  const position = state.positions[index];
  const currentViews = viewsAt(position);
  const payout = payoutAt(position);
  const ratio = currentViews / position.entryViews;
  const discoverersAtHarvest = discovererCountAt(position);
  const result = {
    id: createId(),
    sourceId: position.sourceId,
    url: position.url,
    title: position.title,
    handle: position.handle,
    platform: position.platform,
    entryViews: position.entryViews,
    currentViews,
    payout,
    profit: payout - SEED_COST,
    ratio,
    earlyBonus: position.earlyBonus,
    discoveryRank: position.discoveryRank,
    discoverersAtHarvest,
    elapsed: elapsedMinutes(position),
    paletteIndex: position.paletteIndex,
    harvestedAt: state.virtualMinutes,
  };

  state.positions.splice(index, 1);
  state.balance += payout;
  state.harvests.push(result);
  if (!state.harvestedSourceIds.includes(position.sourceId)) {
    state.harvestedSourceIds.push(position.sourceId);
  }
  render();

  if (showResult) openResult(result);
  return result;
}

function openResult(result) {
  const grade = resultGrade(result.ratio);
  const colors = palette[result.paletteIndex % palette.length];
  const growth = (result.ratio - 1) * 100;
  const percentile = discoveryPercentile(result.discoveryRank, result.discoverersAtHarvest);

  elements.resultContent.innerHTML = `
    <div class="result-burst" style="--result-color:${colors.color}">
      <div class="result-discovery">${result.discoveryRank === 1 ? "최초 발견자" : `#${formatNumber(result.discoveryRank)} 발견자 · 상위 ${percentile}%`}</div>
      <div class="result-grade">
        <span>${grade.label}</span>
        <strong>${grade.grade}</strong>
      </div>
    </div>
    <div class="result-copy">
      <strong>${escapeHtml(result.title)}</strong>
      <p>${formatCompact(result.entryViews)}뷰에서 심었고, 내 뒤로 ${formatCompact(Math.max(0, result.discoverersAtHarvest - result.discoveryRank))}명이 발견했습니다.</p>
    </div>
    <div class="result-stats">
      <div class="result-stat"><span>성장률</span><strong>+${formatPercent(growth)}</strong></div>
      <div class="result-stat"><span>보유 시간</span><strong>${formatDuration(result.elapsed)}</strong></div>
      <div class="result-stat"><span>성장 보너스</span><strong>+${formatNumber(result.profit)} C</strong></div>
    </div>
    <div class="result-actions">
      <button class="secondary-button" type="button" data-close-sheet>밭으로</button>
      <button class="primary-button" type="button" data-share-result="${result.id}">결과 공유</button>
    </div>
  `;
  closeSheets(false);
  openSheet(elements.resultSheet);
}

function resultGrade(ratio) {
  if (ratio >= 50) return { grade: "X", label: "INTERNET ANOMALY" };
  if (ratio >= 15) return { grade: "S", label: "VIRAL MASTERPIECE" };
  if (ratio >= 5) return { grade: "A", label: "EARLY CATCH" };
  if (ratio >= 2) return { grade: "B", label: "SOLID SIGNAL" };
  if (ratio >= 1.3) return { grade: "C", label: "SMALL WIN" };
  return { grade: "F", label: "ALGORITHM SAID NO" };
}

async function shareResult(resultId) {
  const result = state.harvests.find((item) => item.id === resultId);
  if (!result) return;
  const percentile = discoveryPercentile(result.discoveryRank, result.discoverersAtHarvest);
  const discoveryText = result.discoveryRank === 1 ? "최초 발견자" : `${formatNumber(result.discoveryRank)}번째 발견 · 상위 ${percentile}%`;
  const text = `나는 “${result.title}”을 ${formatCompact(result.entryViews)}뷰에서 발견했다. ${discoveryText} · 현재 ${formatCompact(result.currentViews)}뷰 · 떡상농장 v0.2`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "떡상농장 수확 결과", text, url: result.url });
      showToast("수확 결과를 공유했습니다.");
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${text}\n${result.url}`);
      showToast("공유 문구를 클립보드에 복사했습니다.");
    } else {
      showToast("이 브라우저에서는 공유 기능을 지원하지 않아요.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("공유를 완료하지 못했습니다.");
  }
}

function advanceTime(minutes) {
  if (state.positions.length === 0) {
    state.virtualMinutes += minutes;
    render();
    showToast("시간은 흘렀지만 아직 심어둔 링크가 없어요.");
    return;
  }

  const before = new Map(state.positions.map((position) => [position.id, positionRatio(position)]));
  state.virtualMinutes += minutes;
  const expired = state.positions.filter((position) => elapsedMinutes(position) >= AUTO_HARVEST_MINUTES);
  const results = expired.map((position) => harvestPosition(position.id, false)).filter(Boolean);
  render();

  if (results.length === 1) {
    openResult(results[0]);
    return;
  }
  if (results.length > 1) {
    showToast(`${results.length}개 포지션이 24시간을 채워 자동 수확됐습니다.`);
    return;
  }

  const topMover = [...state.positions].sort((a, b) => {
    const aMove = positionRatio(a) / (before.get(a.id) || 1);
    const bMove = positionRatio(b) / (before.get(b.id) || 1);
    return bMove - aMove;
  })[0];
  const move = positionRatio(topMover) / (before.get(topMover.id) || 1);
  showToast(`+${minutes / 60}시간 · “${shortTitle(topMover.title)}” 신호가 ${(move).toFixed(1)}배 움직였습니다.`);
}

function openSheet(sheet) {
  document.querySelectorAll(".bottom-sheet").forEach((item) => { item.hidden = true; });
  elements.modalBackdrop.hidden = false;
  sheet.hidden = false;
  document.body.style.overflow = "hidden";
  const focusable = sheet.querySelector("button, input");
  window.setTimeout(() => focusable?.focus(), 10);
}

function closeSheets(clearCandidate = true) {
  document.querySelectorAll(".bottom-sheet").forEach((item) => { item.hidden = true; });
  elements.modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  if (clearCandidate) {
    pendingCandidate = null;
    selectedReplacementId = null;
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
}

function scrollToPlant() {
  closeSheets();
  document.querySelector(".plant-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => elements.linkInput.focus(), 350);
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatCompact(value) {
  const number = Math.round(value);
  if (number >= 100000000) return `${(number / 100000000).toFixed(number >= 1000000000 ? 0 : 1)}억`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}만`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}천`;
  return number.toLocaleString("ko-KR");
}

function formatPercent(value) {
  if (value >= 10000) return `${Math.round(value / 100) / 10}K%`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K%`;
  return `${Math.max(0, value).toFixed(value >= 100 ? 0 : 1)}%`;
}

function formatDuration(minutes) {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}분`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins === 0 ? `${hours}시간` : `${hours}시간 ${mins}분`;
}

function formatRemaining(position) {
  return formatDuration(Math.max(0, AUTO_HARVEST_MINUTES - elapsedMinutes(position)));
}

function shortPlatform(platform) {
  if (platform.includes("YOUTUBE")) return "YT SHORTS";
  if (platform.includes("INSTAGRAM")) return "REELS";
  if (platform.includes("TIKTOK")) return "TIKTOK";
  return "LINK";
}

function shortTitle(title) {
  return title.length > 20 ? `${title.slice(0, 20)}…` : title;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  const r = (number >> 16) & 255;
  const g = (number >> 8) & 255;
  const b = number & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

elements.linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    openCandidate(sourceFromUrl(elements.linkInput.value));
  } catch (error) {
    showToast(error.message || "링크를 읽지 못했습니다.");
  }
});

elements.sampleButton.addEventListener("click", () => {
  const source = sampleSources[sampleIndex % sampleSources.length];
  sampleIndex += 1;
  elements.linkInput.value = source.url;
  openCandidate(source);
});

elements.pasteButton.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.readText) throw new Error("unsupported");
    const text = await navigator.clipboard.readText();
    elements.linkInput.value = text;
    showToast("클립보드의 링크를 붙여넣었습니다.");
  } catch {
    elements.linkInput.focus();
    showToast("브라우저 권한 때문에 자동 붙여넣기가 안 돼요. 입력창을 길게 눌러 붙여넣어 주세요.");
  }
});

elements.advanceOneButton.addEventListener("click", () => advanceTime(60));
elements.advanceSixButton.addEventListener("click", () => advanceTime(360));
elements.navPlantButton.addEventListener("click", scrollToPlant);
elements.changelogButton.addEventListener("click", () => openSheet(elements.changelogSheet));

elements.fieldGrid.addEventListener("click", (event) => {
  const positionCard = event.target.closest("[data-position-id]");
  if (positionCard) {
    openPosition(positionCard.dataset.positionId);
    return;
  }
  if (event.target.closest("[data-empty-plot]")) scrollToPlant();
});

elements.candidateContent.addEventListener("click", (event) => {
  const replace = event.target.closest("[data-replace-id]");
  if (replace) {
    selectedReplacementId = replace.dataset.replaceId;
    renderCandidateSheet();
    return;
  }
  if (event.target.closest("#confirmPlantButton")) plantPendingCandidate();
});

elements.positionContent.addEventListener("click", (event) => {
  const harvest = event.target.closest("[data-harvest-id]");
  if (harvest) {
    harvestPosition(harvest.dataset.harvestId, true);
    return;
  }
  const source = event.target.closest("[data-open-source]");
  if (source) {
    const position = state.positions.find((item) => item.id === source.dataset.openSource);
    if (position) window.open(position.url, "_blank", "noopener,noreferrer");
  }
});

elements.resultContent.addEventListener("click", (event) => {
  const share = event.target.closest("[data-share-result]");
  if (share) shareResult(share.dataset.shareResult);
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-sheet]")) closeSheets();
  const nav = event.target.closest("[data-nav]");
  if (nav && nav.dataset.nav !== "field") {
    showToast("이번 프로토타입에서는 ‘내 밭’ 핵심 루프만 열어뒀어요.");
  }
});

elements.modalBackdrop.addEventListener("click", () => closeSheets());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.modalBackdrop.hidden) closeSheets();
});

elements.harvestAllButton.addEventListener("click", () => {
  if (state.positions.length === 0) return;
  const confirmed = window.confirm("보유 중인 모든 포지션을 현재 가치로 수확할까요?");
  if (!confirmed) return;
  const ids = state.positions.map((position) => position.id);
  const results = ids.map((id) => harvestPosition(id, false)).filter(Boolean);
  const total = results.reduce((sum, result) => sum + result.payout, 0);
  render();
  showToast(`${results.length}개 포지션을 수확해 ${formatNumber(total)} C를 확보했습니다.`);
});

elements.resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("프로토타입을 처음 상태로 되돌릴까요?");
  if (!confirmed) return;
  state = buildInitialState();
  saveState();
  closeSheets();
  render();
  showToast("처음 상태로 초기화했습니다.");
});

render();
