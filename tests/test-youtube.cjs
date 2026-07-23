"use strict";

const {
  ageHoursFromPublishedAt,
  canonicalYoutubeWatchUrl,
  extractYoutubeVideoId,
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

console.log(JSON.stringify({
  normalizedVariants: variants.length,
  videoId,
  thumbnail: youtubeThumbnailUrl(videoId),
}, null, 2));
