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
const source = `${fs.readFileSync(appPath, "utf8")}\n;globalThis.__viralTest = { sourceFromUrl, youtubeVideoId, canonicalSourceId, youtubeThumbnailForUrl, growthFactor, calculateEarlyBonus, formatCompact, formatDuration, state, advanceTime, syncRealClock, elapsedMinutesAt, createPosition, sampleSources, payoutAt, positionRatio, positionSeries, viewsAt, usesLiveYoutubeStats, applyYoutubeViewSnapshot, normalizeViewSnapshots, formatSignedPercent, discovererCountAt, discoveryPercentile, harvestPosition, openCandidate, migrateState, feedViewsAt, sourceDiscovererCountAt, sourceSnapshotAt, feedMomentum, createScoutEntry, scoutViewsAt, scoutDiscovererCountAt, scoutSnapshotAt, scoutMomentum, addScoutCandidate, removeScoutCandidate, resultShareText, getPendingCandidate: () => pendingCandidate };`;
vm.createContext(context);
vm.runInContext(source, context, { filename: appPath });

const api = context.__viralTest;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(api.state.positions.length === 2, "Initial state should contain two active positions");
assert(api.sampleSources.length === 12, "Discovery feed should contain twelve signals");
assert(api.state.scoutQueue.length === 1, "Initial state should contain one freely watched signal");
const scoutCountWithActivePositions = api.state.scoutQueue.length;
assert(!api.addScoutCandidate(api.sampleSources[0]), "An active position must not return to the scout desk");
assert(api.state.scoutQueue.length === scoutCountWithActivePositions, "Rejecting an active signal must not mutate the scout desk");
assert(api.state.positions.every((position) => position.discoveryRank >= 1), "Every position needs a discovery rank");
assert(api.growthFactor("breakout", 12) > api.growthFactor("breakout", 6), "Breakout curve must increase");
assert(api.growthFactor("sleeper", 12) > api.growthFactor("sleeper", 4), "Sleeper curve must break out later");
assert(api.calculateEarlyBonus(300, 1) > api.calculateEarlyBonus(300000, 24), "Earlier discoveries need a larger bonus");
assert(api.formatDuration(390) === "6시간 30분", "Duration formatter is incorrect");
assert(api.formatCompact(2300000) === "230만", "Compact formatter is incorrect");

const parsed = api.sourceFromUrl("https://youtube.com/shorts/arbitrary-video-id");
assert(parsed.platform === "YOUTUBE SHORTS", "YouTube URL should be detected as Shorts");
assert(parsed.initialViews > 0 && parsed.ageHours > 0, "Generated source needs viable metadata");
const realYoutubeId = "dQw4w9WgXcQ";
assert(api.youtubeVideoId(`https://youtu.be/${realYoutubeId}?si=share`) === realYoutubeId, "A shared YouTube URL should expose its video ID");
assert(api.youtubeVideoId(`https://www.youtube.com/shorts/${realYoutubeId}`) === realYoutubeId, "A Shorts URL should expose its video ID");
assert(api.canonicalSourceId(`https://youtu.be/${realYoutubeId}`) === api.canonicalSourceId(`https://www.youtube.com/watch?v=${realYoutubeId}`), "YouTube URL variants should share one identity");
assert(api.youtubeThumbnailForUrl(`https://www.youtube.com/watch?v=${realYoutubeId}`).includes(realYoutubeId), "A real YouTube video should derive a thumbnail crop");
const youtubePosition = api.createPosition({
  ...parsed,
  url: `https://www.youtube.com/watch?v=${realYoutubeId}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${realYoutubeId}/hqdefault.jpg`,
  metadataMode: "youtube-oembed",
});
assert(youtubePosition.thumbnailUrl.includes(realYoutubeId), "A planted YouTube signal should retain its thumbnail crop");
assert(youtubePosition.metadataMode === "youtube-oembed", "A planted YouTube signal should retain its metadata provenance");
assert(!api.usesLiveYoutubeStats(youtubePosition), "An oEmbed position should begin in demo growth mode");
const firstActualSnapshot = api.applyYoutubeViewSnapshot(youtubePosition, 10000, "2026-07-24T00:00:00.000Z");
assert(firstActualSnapshot.started && youtubePosition.actualEntryViews === 10000, "First live sync should establish the actual view baseline");
const nextActualSnapshot = api.applyYoutubeViewSnapshot(youtubePosition, 12500, "2026-07-24T00:05:00.000Z");
assert(nextActualSnapshot.delta === 2500, "Later live sync should report the actual view increase");
assert(api.viewsAt(youtubePosition) === 12500 && api.positionRatio(youtubePosition) === 1.25, "Live positions should use actual views instead of the demo clock");
assert(api.positionSeries(youtubePosition).at(-1) === 12500, "Live charts should end at the latest actual snapshot");
assert(api.formatSignedPercent(-2.5) === "−2.5%", "Signed growth should preserve audited view decreases");
const migratedLiveClock = api.migrateState({
  balance: 1000,
  virtualMinutes: 120,
  positions: [{
    ...youtubePosition,
    plantedMinute: 120,
    plantedAt: undefined,
    elapsedOffsetMinutes: undefined,
    viewSnapshots: [{ at: "2026-07-24T00:00:00.000Z", views: 10000 }],
  }],
  harvests: [],
  harvestedSourceIds: [],
  watchlist: [],
  scoutQueue: [],
  notifications: [],
  currentView: "field",
}, Date.parse("2026-07-24T08:00:00.000Z"));
assert(api.elapsedMinutesAt(migratedLiveClock.positions[0], migratedLiveClock.virtualMinutes) === 480, "v0.6 live positions should recover wall-clock holding time from the first snapshot");
assert(migratedLiveClock.positions[0].plantedAt === "2026-07-24T00:00:00.000Z", "Migrated live positions should retain an inferred planting timestamp");
const scoutCountBefore = api.state.scoutQueue.length;
assert(api.addScoutCandidate(parsed, "surge"), "An arbitrary link should be saved as a scout candidate");
assert(api.state.scoutQueue.length === scoutCountBefore + 1, "Scout candidates should not have a separate slot cap");
assert(!api.addScoutCandidate(parsed), "The same signal should not be duplicated in the scout desk");
const customScout = api.state.scoutQueue.find((entry) => entry.url === parsed.url);
assert(customScout.alertMode === "surge", "Each scout candidate should retain its own alert mode");
assert(api.scoutMomentum(customScout, 0) > 0, "A watched candidate needs a readable momentum value");
assert(api.scoutViewsAt(customScout, 60) > api.scoutViewsAt(customScout, 0), "A watched candidate should keep moving before planting");
assert(api.scoutDiscovererCountAt(customScout, 60) >= api.scoutDiscovererCountAt(customScout, 0), "Waiting should not freeze discovery competition");
const waitedSnapshot = api.scoutSnapshotAt(customScout, 60);
assert(waitedSnapshot.initialViews === api.scoutViewsAt(customScout, 60), "Planting from the scout desk should snapshot the latest views");
assert(waitedSnapshot.baseDiscoverers === api.scoutDiscovererCountAt(customScout, 60), "Planting from the scout desk should snapshot the latest rank competition");

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
assert(api.resultShareText(harvestResult).includes("떡상농장 v0.8.0"), "Share proof text should identify the v0.8 build");
assert(api.state.harvestedSourceIds.includes(harvestedSource.sourceId), "Harvested source should be locked from re-entry");
assert(!api.addScoutCandidate(harvestedSource), "A harvested signal must not return to the scout desk");
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
assert(Array.isArray(migrated.watchlist) && Array.isArray(migrated.notifications), "Migration should backfill social feed state");
assert(Array.isArray(migrated.scoutQueue), "v0.4 migration should backfill the scout desk");
assert(migrated.currentView === "field", "Migration should open on the field");

const legacyWatchedId = `yt:${api.sampleSources[5].url.split("/").at(-1)}`;
const migratedV3 = api.migrateState({
  balance: 1000,
  virtualMinutes: 240,
  positions: [],
  harvests: [],
  watchlist: [legacyWatchedId],
  notifications: [],
  currentView: "discover",
});
assert(migratedV3.scoutQueue.length === 1, "A v0.3 watchlist signal should migrate into the scout desk");
assert(migratedV3.scoutQueue[0].sourceId === legacyWatchedId, "Migrated scout identity should remain stable");

const lockedSource = api.sampleSources[4];
const lockedPosition = api.createPosition(lockedSource, 0);
const migratedV4 = api.migrateState({
  balance: 1000,
  virtualMinutes: 0,
  positions: [lockedPosition],
  harvests: [],
  harvestedSourceIds: [],
  watchlist: [lockedPosition.sourceId],
  scoutQueue: [api.createScoutEntry(lockedSource, 0)],
  notifications: [],
  currentView: "discover",
});
assert(migratedV4.scoutQueue.length === 0, "Migration should remove active signals left in the v0.4 scout desk");

const virtualMinutesBeforeWallSync = api.state.virtualMinutes;
api.state.clockUpdatedAt = "2026-07-24T00:00:00.000Z";
const wallSync = api.syncRealClock(Date.parse("2026-07-24T08:00:00.000Z"), false);
assert(wallSync.advancedMinutes === 480, "Eight real hours should advance the game clock by 480 minutes");
assert(api.state.virtualMinutes === virtualMinutesBeforeWallSync + 480, "Wall-clock sync should mutate virtual time");
api.advanceTime(60);
assert(api.state.virtualMinutes === virtualMinutesBeforeWallSync + 540, "Test clock advance should remain additive after wall-clock sync");
assert(api.state.notifications.length > 0, "Clock advance should retain scout wire notifications");

console.log(JSON.stringify({
  activePositionsAfterHarvest: api.state.positions.length,
  generatedPlatform: parsed.platform,
  generatedCurve: parsed.curve,
  discoveryFeedSignals: api.sampleSources.length,
  savedScoutSignals: api.state.scoutQueue.length,
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
