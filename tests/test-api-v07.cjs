"use strict";

const path = require("node:path");
const { loadConfig } = require("../lib/config");
const { createStore } = require("../lib/store");
const { createServer } = require("../server");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function main() {
  const config = loadConfig({
    DATABASE_URL: "sqlite::memory:",
    CORS_ORIGINS: "https://app.example.com",
    COOKIE_SECURE: "true",
    COOKIE_SAME_SITE: "None",
  }, path.resolve(__dirname, ".."));
  const store = createStore(config);
  const youtube = {
    apiKeyConfigured: true,
    async resolveVideo() {
      return {
        youtubeId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "External API candidate",
        channelId: "channel-one",
        channelTitle: "Channel One",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
        durationSeconds: 45,
        views: 1000,
        likes: 20,
        comments: 3,
        capturedAt: new Date().toISOString(),
        metadataMode: "youtube-api",
        statsMode: "youtube-api",
      };
    },
    async batchGetStats(ids) {
      return ids.map((youtubeId) => ({
        youtubeId,
        views: 1800,
        likes: 40,
        comments: 5,
        capturedAt: new Date(Date.now() + 1000).toISOString(),
      }));
    },
  };
  const server = createServer({ config, store, youtube });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const origin = "https://app.example.com";

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/session/anonymous`, {
      method: "POST",
      headers: { Origin: origin },
    });
    const session = await sessionResponse.json();
    assert(sessionResponse.status === 201, "Anonymous session should be created");
    assert(session.token, "External clients should receive a bearer token");
    assert(
      sessionResponse.headers.get("access-control-allow-origin") === origin,
      "Configured external frontend should receive CORS access",
    );
    assert(
      sessionResponse.headers.get("set-cookie").includes("SameSite=None"),
      "Cross-site cookie policy should be configurable",
    );

    const headers = {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Origin: origin,
    };
    const resolvedResponse = await fetch(`${baseUrl}/api/videos/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: youtube.resolveVideo.url }),
    });
    const resolved = await resolvedResponse.json();
    assert(resolved.videoId === "dQw4w9WgXcQ", "Video resolver should use the server adapter");

    const plantResponse = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: resolved.url }),
    });
    const planted = await plantResponse.json();
    assert(plantResponse.status === 201, "Plant endpoint should create a server position");
    assert(planted.positions.length === 1, "Bootstrap response should contain the active position");
    assert(planted.positions[0].entryViews === 1800, "Planting should refresh the entry snapshot");
    assert(planted.player.balance === 2200, "Server should authoritatively deduct the seed cost");
    assert(
      planted.player.fieldValue === 3200,
      "Bootstrap should expose the persisted player field value",
    );

    const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, { headers });
    const bootstrap = await bootstrapResponse.json();
    assert(bootstrap.positions[0].discoveryRank === 1, "Bearer session should restore server state");

    const blockedResponse = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Origin: "https://blocked.example.com" },
    });
    assert(blockedResponse.status === 403, "Unknown origins should be rejected");

    const privateFileResponse = await fetch(`${baseUrl}/server.js`);
    assert(privateFileResponse.status === 404, "Server source and database files must not be public");

    console.log(JSON.stringify({
      bearerSession: Boolean(session.token),
      corsOrigin: sessionResponse.headers.get("access-control-allow-origin"),
      activePositions: bootstrap.positions.length,
      serverBalance: bootstrap.player.balance,
      serverFieldValue: bootstrap.player.fieldValue,
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
