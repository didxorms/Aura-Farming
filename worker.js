"use strict";

const crypto = require("node:crypto");
const { loadConfig } = require("./lib/config");
const {
  percentileRanks,
  rawMeasurement,
  scoreCandidates,
} = require("./lib/discovery-engine");
const { createStore } = require("./lib/store");
const { createYoutubeClient } = require("./lib/youtube");

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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
          query: lane.query,
          publishedAfter,
          regionCode: config.searchRegion,
          relevanceLanguage: config.searchLanguage,
        });
        requestsUsed += 1;
        itemsSeen += videos.length;
        videos.forEach((video) => store.upsertVideo(
          video,
          { lane: lane.label, candidate: true },
          now,
        ));
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
