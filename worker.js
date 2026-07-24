"use strict";

const crypto = require("node:crypto");
const { loadConfig } = require("./lib/config");
const { createStore } = require("./lib/store");
const { clamp } = require("./lib/game-rules");
const { createYoutubeClient } = require("./lib/youtube");

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function percentileRanks(values) {
  const finite = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length).fill(0);
  if (finite.length <= 1) {
    finite.forEach((item) => {
      ranks[item.index] = 1;
    });
    return ranks;
  }
  for (let start = 0; start < finite.length;) {
    let end = start;
    while (end + 1 < finite.length && finite[end + 1].value === finite[start].value) {
      end += 1;
    }
    const rank = ((start + end) / 2) / (finite.length - 1);
    for (let index = start; index <= end; index += 1) {
      ranks[finite[index].index] = rank;
    }
    start = end + 1;
  }
  return ranks;
}

function rawMeasurement(candidate, now = Date.now()) {
  const snapshots = candidate.snapshots || [];
  if (snapshots.length < 2) return null;
  let auditedHigh = 0;
  const auditedSnapshots = snapshots.map((snapshot) => {
    auditedHigh = Math.max(auditedHigh, Number(snapshot.views) || 0);
    return { ...snapshot, views: auditedHigh };
  });
  const latest = auditedSnapshots.at(-1);
  const previous = auditedSnapshots.at(-2);
  const hours = Math.max(1 / 60, (Date.parse(latest.at) - Date.parse(previous.at)) / 3_600_000);
  const delta = Math.max(0, latest.views - previous.views);
  const relativeVelocity = delta / Math.max(100, previous.views) / hours;
  const absoluteVelocity = Math.log1p(delta / hours);

  let acceleration = 1;
  if (auditedSnapshots.length >= 3) {
    const older = auditedSnapshots.at(-3);
    const olderHours = Math.max(
      1 / 60,
      (Date.parse(previous.at) - Date.parse(older.at)) / 3_600_000,
    );
    const olderVelocity = Math.max(0, previous.views - older.views) / olderHours;
    acceleration = (delta / hours + 1) / (olderVelocity + 1);
  }

  const ageHours = candidate.publishedAt
    ? Math.max(0, (Number(now) - Date.parse(candidate.publishedAt)) / 3_600_000)
    : 24;
  return {
    relativeVelocity,
    absoluteVelocity,
    acceleration: Math.log1p(Math.max(0, acceleration)),
    freshness: clamp(1 - ageHours / 24, 0, 1),
  };
}

function scoreCandidates(candidates, now = Date.now()) {
  const measurements = candidates.map((candidate) => rawMeasurement(candidate, now));
  const relativeRanks = percentileRanks(measurements.map((item) => item?.relativeVelocity));
  const absoluteRanks = percentileRanks(measurements.map((item) => item?.absoluteVelocity));
  const accelerationRanks = percentileRanks(measurements.map((item) => item?.acceleration));

  return candidates.map((candidate, index) => {
    const measurement = measurements[index];
    if (!measurement) {
      return {
        videoId: candidate.videoId,
        score: null,
        label: "NEW · 관측 중",
      };
    }
    const score = Math.round(100 * (
      relativeRanks[index] * 0.4
      + absoluteRanks[index] * 0.25
      + accelerationRanks[index] * 0.2
      + measurement.freshness * 0.15
    ));
    const label = score >= 85
      ? "✹ 과열 직전"
      : score >= 70
        ? "↗ 빠른 점화"
        : score >= 50
          ? "↑ 온도 상승"
          : "· 아직 조용함";
    return { videoId: candidate.videoId, score, label };
  });
}

function createCollector(options = {}) {
  const config = options.config || loadConfig();
  const store = options.store || createStore(config);
  const youtube = options.youtube || createYoutubeClient({
    apiKey: config.youtubeApiKey,
    appVersion: config.appVersion,
  });

  async function recordRun(kind, work) {
    const startedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      const result = await work();
      store.recordCollectorRun({
        id,
        kind,
        status: "success",
        requestsUsed: result.requestsUsed,
        itemsSeen: result.itemsSeen,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      store.recordCollectorRun({
        id,
        kind,
        status: "error",
        errorMessage: error.message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async function collectSearch(now = Date.now()) {
    const publishedAfter = new Date(Number(now) - 24 * 3_600_000).toISOString();
    return recordRun("search", async () => {
      let itemsSeen = 0;
      let requestsUsed = 0;
      for (const lane of config.searchLanes) {
        const videos = await youtube.searchRecent({
          query: lane,
          publishedAfter,
          regionCode: config.searchRegion,
          relevanceLanguage: config.searchLanguage,
        });
        requestsUsed += 1;
        itemsSeen += videos.length;
        videos.forEach((video) => store.upsertVideo(video, { lane, candidate: true }, now));
      }
      return { requestsUsed, itemsSeen };
    });
  }

  async function collectStats(now = Date.now()) {
    return recordRun("stats", async () => {
      const ids = store.listTrackableYoutubeIds(config.feedCandidateLimit, now);
      let requestsUsed = 0;
      let itemsSeen = 0;
      for (const idsChunk of chunk(ids, 50)) {
        const items = await youtube.batchGetStats(idsChunk);
        requestsUsed += 1;
        itemsSeen += items.length;
        items.forEach((item) => store.addSnapshotByYoutubeId(item.youtubeId, item));
      }
      return { requestsUsed, itemsSeen };
    });
  }

  function evaluateSignals(now = Date.now()) {
    const candidates = store.candidateMeasurements(now);
    const scores = scoreCandidates(candidates, now);
    scores.forEach((score) => store.updateCandidateSignal(score.videoId, score, now));
    return scores;
  }

  async function tick(now = Date.now()) {
    if (!youtube.apiKeyConfigured) {
      throw new Error("YOUTUBE_API_KEY is required for the live discovery worker.");
    }
    const lastSearch = store.lastSuccessfulRun("search");
    const searchDue = !lastSearch
      || Number(now) - Date.parse(lastSearch.finished_at) >= config.searchIntervalMinutes * 60_000;
    const search = searchDue ? await collectSearch(now) : null;
    const stats = await collectStats(now);
    const scores = evaluateSignals(now);
    const harvests = store.autoHarvestDue(now);
    return { search, stats, scored: scores.length, autoHarvested: harvests.length };
  }

  function close() {
    if (!options.store) store.close();
  }

  return {
    close,
    collectSearch,
    collectStats,
    evaluateSignals,
    tick,
  };
}

async function main() {
  const collector = createCollector();
  const watch = process.argv.includes("--watch");
  const config = loadConfig();
  const run = async () => {
    const result = await collector.tick();
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      ...result,
    }));
  };

  if (!watch) {
    try {
      await run();
    } finally {
      collector.close();
    }
    return;
  }

  let stopped = false;
  let wakeWait = null;
  const stop = () => {
    stopped = true;
    wakeWait?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopped) {
    const started = Date.now();
    try {
      await run();
    } catch (error) {
      console.error("[collector]", error.stack || error.message);
    }
    if (stopped) break;
    const waitMs = Math.max(
      1000,
      config.collectorIntervalMinutes * 60_000 - (Date.now() - started),
    );
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        wakeWait = null;
        resolve();
      }, waitMs);
      wakeWait = () => {
        clearTimeout(timeout);
        wakeWait = null;
        resolve();
      };
    });
  }
  collector.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createCollector,
  percentileRanks,
  rawMeasurement,
  scoreCandidates,
};
