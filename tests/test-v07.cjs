"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { loadConfig } = require("../lib/config");
const { createStore } = require("../lib/store");
const { percentileRanks, rawMeasurement, scoreCandidates } = require("../worker");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const config = loadConfig({
  DATABASE_URL: "sqlite::memory:",
  HOST: "0.0.0.0",
  PORT: "8080",
  PUBLIC_API_BASE_URL: "https://api.example.com/",
  CORS_ORIGINS: "https://app.example.com,https://preview.example.com",
}, path.resolve(__dirname, ".."));

assert(config.host === "0.0.0.0" && config.port === 8080, "External host settings should be configurable");
assert(config.publicApiBaseUrl === "https://api.example.com", "Public API base URL should be normalized");
assert(config.allowedOrigins.length === 2, "Multiple external frontends should be allowed explicitly");
assert(
  config.searchLanes[0].label === "유머·밈" && config.searchLanes[0].query.includes("챌린지"),
  "Discovery search lanes should expose separate labels and YouTube queries",
);

const store = createStore(config);
const now = Date.parse("2026-07-24T00:00:00.000Z");
const expiresAt = "2026-10-24T00:00:00.000Z";
const sessionHash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const playerOne = store.createAnonymousSession({ tokenHash: sessionHash("one"), expiresAt }, now);
const playerTwo = store.createAnonymousSession({ tokenHash: sessionHash("two"), expiresAt }, now);

store.upsertVideo({
  youtubeId: "pending1234",
  url: "https://www.youtube.com/watch?v=pending1234",
  title: "Pending candidate",
  channelTitle: "Channel Pending",
  publishedAt: "2026-07-23T23:00:00.000Z",
  durationSeconds: null,
  views: null,
  likes: null,
  comments: null,
  capturedAt: "2026-07-24T00:00:00.000Z",
  metadataMode: "youtube-search",
  statsMode: "pending",
}, { lane: "test", candidate: true }, now);

let pendingRejected = false;
try {
  store.plantPosition(playerOne.id, "pending1234", {}, now);
} catch (error) {
  pendingRejected = error.statusCode === 409;
}
assert(pendingRejected, "Candidates without a real statistics snapshot must not be plantable");

store.upsertVideo({
  youtubeId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Live candidate",
  channelId: "channel-one",
  channelTitle: "Channel One",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2026-07-23T22:00:00.000Z",
  durationSeconds: 45,
  views: 1000,
  likes: 20,
  comments: 3,
  capturedAt: "2026-07-24T00:00:00.000Z",
  metadataMode: "youtube-api",
  statsMode: "youtube-api",
}, { lane: "test", candidate: true }, now);

const firstPlant = store.plantPosition(playerOne.id, "dQw4w9WgXcQ", {}, now);
const secondPlant = store.plantPosition(playerTwo.id, "dQw4w9WgXcQ", {}, now + 1000);
assert(firstPlant.discoveryRank === 1, "The first server discovery should receive rank #1");
assert(secondPlant.discoveryRank === 2, "Concurrent players should receive unique ordered ranks");
assert(store.getBootstrap(playerOne.id, now).player.balance === 2200, "Planting should spend seed coins on the server");
assert(
  store.getBootstrap(playerOne.id, now).player.fieldValue === 3200,
  "Planting should preserve total field value in the player row",
);

let duplicateRejected = false;
try {
  store.plantPosition(playerOne.id, "dQw4w9WgXcQ", {}, now + 2000);
} catch (error) {
  duplicateRejected = error.statusCode === 409;
}
assert(duplicateRejected, "The same player must not rediscover a video");

store.addSnapshotByYoutubeId("dQw4w9WgXcQ", {
  views: 2500,
  likes: 60,
  comments: 8,
  capturedAt: "2026-07-24T01:00:00.000Z",
});
store.addSnapshotByYoutubeId("dQw4w9WgXcQ", {
  views: 1500,
  likes: 40,
  comments: 5,
  capturedAt: "2026-07-24T00:30:00.000Z",
});
assert(
  store.getBootstrap(playerOne.id, now + 3_600_000).player.fieldValue > 3200,
  "A live snapshot should refresh the persisted player field value",
);
assert(
  store.getBootstrap(playerOne.id, now + 3_600_000).positions[0].liveViews === 2500,
  "An older snapshot must not replace the latest video statistics",
);
const harvested = store.harvestPosition(playerOne.id, firstPlant.positionId, now + 3_600_000);
assert(harvested.payout >= 1000, "Server harvest should preserve the seed value");
assert(store.getBootstrap(playerOne.id, now + 3_600_000).positions.length === 0, "Harvested positions should leave the active field");
assert(
  store.getBootstrap(playerOne.id, now + 3_600_000).player.fieldValue
    === store.getBootstrap(playerOne.id, now + 3_600_000).player.balance,
  "A player without active positions should have field value equal to balance",
);

let secondHarvestRejected = false;
try {
  store.harvestPosition(playerOne.id, firstPlant.positionId, now + 3_600_100);
} catch (error) {
  secondHarvestRejected = error.statusCode === 404;
}
assert(secondHarvestRejected, "A server position must only be harvested once");

const scores = scoreCandidates([{
  videoId: "video-one",
  publishedAt: "2026-07-23T23:00:00.000Z",
  snapshots: [
    { at: "2026-07-24T00:00:00.000Z", views: 100 },
    { at: "2026-07-24T00:30:00.000Z", views: 500 },
    { at: "2026-07-24T01:00:00.000Z", views: 2000 },
  ],
}], Date.parse("2026-07-24T01:00:00.000Z"));
assert(Number.isFinite(scores[0].score) && scores[0].score >= 85, "Accelerating candidates should receive a hot signal");

const tiedRanks = percentileRanks([0, 0, 0, 1]);
assert(
  tiedRanks[0] === tiedRanks[1] && tiedRanks[1] === tiedRanks[2],
  "Equal measurements must receive the same percentile rank",
);
const correctedMeasurement = rawMeasurement({
  publishedAt: "2026-07-23T23:00:00.000Z",
  snapshots: [
    { at: "2026-07-24T00:00:00.000Z", views: 1126 },
    { at: "2026-07-24T00:15:00.000Z", views: 979 },
    { at: "2026-07-24T00:30:00.000Z", views: 1126 },
  ],
}, Date.parse("2026-07-24T00:30:00.000Z"));
assert(
  correctedMeasurement.growthRatePerHour === 0 && correctedMeasurement.viewsPerHour === 0,
  "A view-count audit bounce must not be scored as fresh growth",
);

const status = store.systemStatus();
assert(status.players === 2 && status.videos === 2 && status.snapshots === 3, "Server status should audit persisted resources");
store.close();

console.log(JSON.stringify({
  firstRank: firstPlant.discoveryRank,
  secondRank: secondPlant.discoveryRank,
  harvestedPayout: harvested.payout,
  signalScore: scores[0].score,
  apiBaseUrl: config.publicApiBaseUrl,
  allowedOrigins: config.allowedOrigins.length,
}, null, 2));
