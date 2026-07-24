"use strict";

const {
  ENGINE_VERSION,
  percentileRanks,
  rawMeasurement,
  scoreCandidates,
  selectDiverseFeed,
} = require("../lib/discovery-engine");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const now = Date.parse("2026-07-24T03:00:00.000Z");
const snapshots = (values) => values.map((views, index) => ({
  at: new Date(now - (values.length - 1 - index) * 15 * 60_000).toISOString(),
  views,
  likes: Math.round(views * 0.04),
  comments: Math.round(views * 0.003),
}));

const candidates = [
  {
    videoId: "fast",
    lane: "게임·엔터",
    publishedAt: "2026-07-24T00:00:00.000Z",
    snapshots: snapshots([100, 130, 190, 300, 520, 900, 1500, 2500]),
  },
  {
    videoId: "steady",
    lane: "게임·엔터",
    publishedAt: "2026-07-24T00:00:00.000Z",
    snapshots: snapshots([100, 150, 210, 280, 360, 450, 550, 660]),
  },
  {
    videoId: "flat",
    lane: "게임·엔터",
    publishedAt: "2026-07-24T00:00:00.000Z",
    snapshots: snapshots([100, 100, 100, 100, 100, 100, 100, 100]),
  },
  {
    videoId: "food-fast",
    lane: "푸드",
    publishedAt: "2026-07-24T00:00:00.000Z",
    snapshots: snapshots([80, 100, 140, 220, 390, 700, 1200, 2100]),
  },
];
const scores = scoreCandidates(candidates, now);
const fast = scores.find((item) => item.videoId === "fast");
const flat = scores.find((item) => item.videoId === "flat");
assert(fast.score > flat.score, "Accelerating candidates should outrank flat candidates");
assert(fast.engineVersion === ENGINE_VERSION, "Scores should identify the v0.8 engine");
assert(
  fast.metrics.snapshotCount === 8
    && fast.metrics.viewsPerHour > 0
    && fast.metrics.confidence === 1,
  "The engine should expose multi-window metrics and confidence",
);
assert(fast.reason.length > 0, "Every ranked signal should explain why it surfaced");

const bounce = rawMeasurement({
  publishedAt: "2026-07-24T00:00:00.000Z",
  snapshots: snapshots([1126, 979, 1126]),
}, now);
assert(
  bounce.viewsPerHour === 0 && bounce.growthRatePerHour === 0,
  "A corrected view-count bounce must not look like new growth",
);

const ties = percentileRanks([0, 0, 0, 1]);
assert(ties[0] === ties[1] && ties[1] === ties[2], "Tied inputs need equal ranks");

const feedItems = [
  { youtube_id: "a", channel_id: "same", lane: "게임", signal_score: 99, confidence: 1, status: "breakout" },
  { youtube_id: "b", channel_id: "same", lane: "게임", signal_score: 98, confidence: 1, status: "breakout" },
  { youtube_id: "c", channel_id: "same", lane: "게임", signal_score: 97, confidence: 1, status: "rising" },
  { youtube_id: "d", channel_id: "dog", lane: "동물", signal_score: 92, confidence: 1, status: "rising" },
  { youtube_id: "e", channel_id: "food", lane: "푸드", signal_score: 90, confidence: 1, status: "ranked" },
];
const diversified = selectDiverseFeed(feedItems, { sort: "signal", limit: 5 });
assert(
  diversified.filter((item) => item.channel_id === "same").length === 2,
  "A feed should cap repeated channels",
);
assert(
  new Set(diversified.map((item) => item.lane)).size >= 3,
  "A feed should preserve lane diversity",
);
const rising = selectDiverseFeed(feedItems, { sort: "rising", limit: 10 });
assert(
  rising.every((item) => ["breakout", "rising"].includes(item.status)),
  "The rising feed should only contain active breakout signals",
);

console.log(JSON.stringify({
  engineVersion: ENGINE_VERSION,
  fastScore: fast.score,
  flatScore: flat.score,
  confidence: fast.metrics.confidence,
  diversifiedLanes: new Set(diversified.map((item) => item.lane)).size,
  risingSignals: rising.length,
}, null, 2));
