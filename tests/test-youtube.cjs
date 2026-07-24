"use strict";

const {
  ageHoursFromPublishedAt,
  canonicalYoutubeWatchUrl,
  extractYoutubeVideoId,
  fetchYoutubeStatistics,
  normalizeYoutubeVideoIds,
  youtubeThumbnailUrl,
} = require("../server.js");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const videoId = "dQw4w9WgXcQ";
const variants = [
  `https://www.youtube.com/watch?v=${videoId}&feature=share`,
  `https://youtube.com/shorts/${videoId}?si=abc`,
  `https://youtu.be/${videoId}`,
  `https://m.youtube.com/watch?v=${videoId}`,
  `https://www.youtube.com/embed/${videoId}`,
  `https://www.youtube.com/live/${videoId}`,
];

variants.forEach((url) => {
  assert(extractYoutubeVideoId(url) === videoId, `Could not normalize ${url}`);
});

assert(extractYoutubeVideoId("https://youtube.com.example.com/watch?v=dQw4w9WgXcQ") === null, "Lookalike hosts must be rejected");
assert(extractYoutubeVideoId("https://www.youtube.com/@channel") === null, "Channel URLs are not video URLs");
assert(canonicalYoutubeWatchUrl(videoId) === `https://www.youtube.com/watch?v=${videoId}`, "Canonical watch URL is incorrect");
assert(youtubeThumbnailUrl(videoId) === `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, "Thumbnail URL is incorrect");
assert(ageHoursFromPublishedAt("2020-01-01T00:00:00Z") > 24, "Published time should convert into an age");
assert(ageHoursFromPublishedAt("not-a-date") === null, "Invalid published time should be ignored");
assert(
  JSON.stringify(normalizeYoutubeVideoIds(`${videoId},${videoId},bad id,aqz-KE-bpKQ`))
    === JSON.stringify([videoId, "aqz-KE-bpKQ"]),
  "Statistics IDs should be valid, unique, and stable",
);

async function verifyBatchStatistics() {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.YOUTUBE_API_KEY;
  let requestedUrl = "";
  let batchViews = 0;
  process.env.YOUTUBE_API_KEY = "test-key";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        items: [{ id: videoId, statistics: { viewCount: "125000" } }],
      }),
    };
  };

  try {
    const result = await fetchYoutubeStatistics([videoId]);
    assert(result.apiKeyConfigured, "A configured key should enable live statistics");
    assert(result.items[0].videoId === videoId && result.items[0].views === 125000, "Live view counts should be normalized to numbers");
    assert(
      requestedUrl.includes("/youtube/v3/videos?")
        && requestedUrl.includes("statistics")
        && requestedUrl.includes(videoId),
      "Batch request should use videos.list with a comma-separated ID filter",
    );
    batchViews = result.items[0].views;
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalApiKey;
  }

  console.log(JSON.stringify({
    batchViews,
    normalizedVariants: variants.length,
    videoId,
    thumbnail: youtubeThumbnailUrl(videoId),
  }, null, 2));
}

verifyBatchStatistics().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
