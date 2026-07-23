const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function dummyElement() {
  return {
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    querySelector() { return dummyElement(); },
    focus() {},
    scrollIntoView() {},
  };
}

const store = new Map();
const context = {
  console,
  URL,
  Math,
  JSON,
  Date,
  Number,
  String,
  Array,
  Map,
  Error,
  Promise,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => `test-${Math.random().toString(16).slice(2)}` },
  localStorage: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  },
  navigator: {},
  document: {
    body: { style: {} },
    querySelector: () => dummyElement(),
    querySelectorAll: () => [dummyElement(), dummyElement(), dummyElement()],
    addEventListener() {},
  },
  window: {
    setTimeout,
    clearTimeout,
    confirm: () => true,
    open() {},
  },
};
context.globalThis = context;

const appPath = path.resolve(__dirname, "../app.js");
const source = `${fs.readFileSync(appPath, "utf8")}\n;globalThis.__viralTest = { sourceFromUrl, growthFactor, calculateEarlyBonus, formatCompact, formatDuration, state, advanceTime, createPosition, sampleSources, payoutAt, positionRatio, discovererCountAt, discoveryPercentile, harvestPosition, openCandidate, migrateState, feedViewsAt, sourceDiscovererCountAt, sourceSnapshotAt, feedMomentum, getPendingCandidate: () => pendingCandidate };`;
vm.createContext(context);
vm.runInContext(source, context, { filename: appPath });

const api = context.__viralTest;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(api.state.positions.length === 2, "Initial state should contain two active positions");
assert(api.sampleSources.length === 12, "Discovery feed should contain twelve signals");
assert(api.state.positions.every((position) => position.discoveryRank >= 1), "Every position needs a discovery rank");
assert(api.growthFactor("breakout", 12) > api.growthFactor("breakout", 6), "Breakout curve must increase");
assert(api.growthFactor("sleeper", 12) > api.growthFactor("sleeper", 4), "Sleeper curve must break out later");
assert(api.calculateEarlyBonus(300, 1) > api.calculateEarlyBonus(300000, 24), "Earlier discoveries need a larger bonus");
assert(api.formatDuration(390) === "6시간 30분", "Duration formatter is incorrect");
assert(api.formatCompact(2300000) === "230만", "Compact formatter is incorrect");

const parsed = api.sourceFromUrl("https://youtube.com/shorts/arbitrary-video-id");
assert(parsed.platform === "YOUTUBE SHORTS", "YouTube URL should be detected as Shorts");
assert(parsed.initialViews > 0 && parsed.ageHours > 0, "Generated source needs viable metadata");

let unsafeRejected = false;
try {
  api.sourceFromUrl("javascript:alert(1)");
} catch {
  unsafeRejected = true;
}
assert(unsafeRejected, "Unsafe URL protocol must be rejected");

const position = api.createPosition(api.sampleSources[2], 0);
const ratioBefore = api.positionRatio(position, 0);
const ratioAfter = api.positionRatio(position, 12 * 60);
assert(ratioAfter > ratioBefore, "Position ratio should grow with simulated time");
assert(api.payoutAt(position, 0) === 1000, "A zero-growth harvest must return the full seed cost");
assert(api.payoutAt(position, 12 * 60) >= 1000, "Payout must never fall below the seed cost");
assert(api.discovererCountAt(position, 12 * 60) > position.discoveryRank, "Discoverer count should grow after planting");

const feedSource = api.sampleSources[7];
assert(api.feedViewsAt(feedSource, 6 * 60) > feedSource.initialViews, "Feed views should move with the prototype clock");
assert(api.sourceDiscovererCountAt(feedSource, 6 * 60) > feedSource.baseDiscoverers, "Competing discoverers should enter feed signals");
assert(api.feedMomentum(feedSource, 0) > 0, "Feed signals need a readable momentum value");
const feedSnapshot = api.sourceSnapshotAt(feedSource, 6 * 60);
assert(feedSnapshot.initialViews === api.feedViewsAt(feedSource, 6 * 60), "Planting should snapshot current feed views");
assert(feedSnapshot.baseDiscoverers === api.sourceDiscovererCountAt(feedSource, 6 * 60), "Planting should snapshot current discovery competition");
const feedPosition = api.createPosition(feedSnapshot, 6 * 60);
const underlyingNextHourRatio = api.feedViewsAt(feedSource, 7 * 60) / api.feedViewsAt(feedSource, 6 * 60);
assert(Math.abs(api.positionRatio(feedPosition, 7 * 60) - underlyingNextHourRatio) < 0.02, "A planted feed signal should keep its existing growth phase");

const harvestedSource = api.state.positions[0];
const harvestResult = api.harvestPosition(harvestedSource.id, false);
assert(harvestResult.payout >= 1000 && harvestResult.profit >= 0, "Harvest result must be lossless");
assert(api.state.harvestedSourceIds.includes(harvestedSource.sourceId), "Harvested source should be locked from re-entry");
api.openCandidate({ ...api.sampleSources[0], url: harvestedSource.url });
assert(api.getPendingCandidate() === null, "A harvested link must not become a new candidate");

const migrated = api.migrateState({
  balance: 100,
  virtualMinutes: 0,
  positions: [],
  harvests: [{ sourceId: "yt:legacy", url: "https://youtube.com/shorts/legacy", title: "legacy", payout: 550 }],
});
assert(migrated.balance === 550, "v0.1 loss should be reimbursed during migration");
assert(migrated.harvests[0].payout === 1000 && migrated.harvests[0].profit === 0, "Legacy harvest should migrate to a lossless record");
assert(migrated.harvestedSourceIds.includes("yt:legacy"), "Migrated harvest should lock the source ID");
assert(Array.isArray(migrated.watchlist) && Array.isArray(migrated.notifications), "v0.3 migration should backfill social feed state");
assert(migrated.currentView === "field", "v0.3 migration should open on the field");

api.advanceTime(60);
assert(api.state.virtualMinutes === 60, "Clock advance should mutate virtual time");
assert(api.state.notifications.length > 0, "Clock advance should retain scout wire notifications");

console.log(JSON.stringify({
  activePositionsAfterHarvest: api.state.positions.length,
  generatedPlatform: parsed.platform,
  generatedCurve: parsed.curve,
  discoveryFeedSignals: api.sampleSources.length,
  feedViewsAfter6h: api.feedViewsAt(feedSource, 6 * 60),
  feedDiscoverersAfter6h: api.sourceDiscovererCountAt(feedSource, 6 * 60),
  sleeperGrowth12h: Number(ratioAfter.toFixed(2)),
  discoveryRank: position.discoveryRank,
  discoverersAfter12h: api.discovererCountAt(position, 12 * 60),
  losslessPayout: api.payoutAt(position, 0),
  reentryBlocked: api.getPendingCandidate() === null,
  legacyRefundedBalance: migrated.balance,
  virtualMinutes: api.state.virtualMinutes,
  unsafeUrlRejected: unsafeRejected,
}, null, 2));
