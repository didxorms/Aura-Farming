"use strict";

const { clamp } = require("./game-rules");

const ENGINE_VERSION = "0.8.1";
const RECENT_WINDOW_POINTS = 4;

function percentileRanks(values) {
  const finite = values
    .map((value, index) => ({ value: Number(value), index }))
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

function auditedSnapshots(snapshots) {
  let auditedHigh = 0;
  return (snapshots || [])
    .filter((snapshot) => (
      Number.isFinite(Date.parse(snapshot.at))
      && Number.isFinite(Number(snapshot.views))
    ))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((snapshot) => {
      auditedHigh = Math.max(auditedHigh, Number(snapshot.views));
      return {
        ...snapshot,
        views: auditedHigh,
        likes: Number.isFinite(Number(snapshot.likes)) ? Number(snapshot.likes) : 0,
        comments: Number.isFinite(Number(snapshot.comments)) ? Number(snapshot.comments) : 0,
      };
    });
}

function velocityBetween(start, end) {
  const hours = (Date.parse(end.at) - Date.parse(start.at)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.max(0, end.views - start.views) / hours;
}

function rawMeasurement(candidate, now = Date.now()) {
  const snapshots = auditedSnapshots(candidate.snapshots);
  if (snapshots.length < 2) return null;

  const latest = snapshots.at(-1);
  const recentStartIndex = Math.max(0, snapshots.length - RECENT_WINDOW_POINTS);
  const recentStart = snapshots[recentStartIndex];
  const viewsPerHour = velocityBetween(recentStart, latest);
  if (!Number.isFinite(viewsPerHour)) return null;

  let previousViewsPerHour = null;
  if (recentStartIndex > 0) {
    const previousStartIndex = Math.max(
      0,
      recentStartIndex - (RECENT_WINDOW_POINTS - 1),
    );
    previousViewsPerHour = velocityBetween(
      snapshots[previousStartIndex],
      snapshots[recentStartIndex],
    );
  }

  const growthRatePerHour = viewsPerHour / Math.max(100, recentStart.views);
  const accelerationRatio = Number.isFinite(previousViewsPerHour)
    ? clamp((viewsPerHour + 1) / (previousViewsPerHour + 1), 0, 99)
    : 1;
  const acceleration = clamp(Math.log2(accelerationRatio), -3, 3);
  const publishedTime = Date.parse(candidate.publishedAt);
  const ageHours = Number.isFinite(publishedTime)
    ? Math.max(0, (Number(now) - publishedTime) / 3_600_000)
    : 36;
  const observedHours = Math.max(
    0,
    (Date.parse(latest.at) - Date.parse(snapshots[0].at)) / 3_600_000,
  );
  const confidence = clamp(
    clamp(observedHours / 1.5, 0, 1) * 0.65
      + clamp((snapshots.length - 1) / 6, 0, 1) * 0.35,
    0,
    1,
  );
  const engagementRate = (
    Math.max(0, latest.likes) + Math.max(0, latest.comments) * 2
  ) / Math.max(1, latest.views);

  return {
    acceleration,
    accelerationRatio,
    ageHours,
    confidence,
    engagementRate,
    freshness: clamp(1 - ageHours / 36, 0, 1),
    growthRatePerHour,
    latestViews: latest.views,
    previousViewsPerHour,
    snapshotCount: snapshots.length,
    viewsPerHour,
  };
}

function blendedPercentileRanks(candidates, measurements, metric) {
  const globalRanks = percentileRanks(measurements.map((item) => item?.[metric]));
  const laneRanks = new Array(candidates.length).fill(0);
  const laneIndexes = new Map();
  candidates.forEach((candidate, index) => {
    const lane = candidate.lane || "기타";
    if (!laneIndexes.has(lane)) laneIndexes.set(lane, []);
    laneIndexes.get(lane).push(index);
  });
  laneIndexes.forEach((indexes) => {
    const ranks = percentileRanks(indexes.map((index) => measurements[index]?.[metric]));
    indexes.forEach((candidateIndex, rankIndex) => {
      laneRanks[candidateIndex] = ranks[rankIndex];
    });
  });
  return globalRanks.map((rank, index) => rank * 0.4 + laneRanks[index] * 0.6);
}

function formatCompactMetric(value) {
  const rounded = Math.max(0, Math.round(Number(value) || 0));
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (rounded >= 1_000) return `${(rounded / 1_000).toFixed(1)}K`;
  return String(rounded);
}

function reasonForSignal(measurement, components) {
  if (measurement.confidence < 0.35) {
    return `스냅샷 ${measurement.snapshotCount}개 · 신뢰도 확보 중`;
  }
  const strongest = Object.entries(components)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (strongest === "relative") {
    return `시간당 +${formatCompactMetric(measurement.viewsPerHour)}뷰 · 성장률 우세`;
  }
  if (strongest === "absolute") {
    return `시간당 +${formatCompactMetric(measurement.viewsPerHour)}뷰 유입`;
  }
  if (strongest === "acceleration") {
    return measurement.accelerationRatio >= 1
      ? `직전 구간 대비 ×${measurement.accelerationRatio.toFixed(1)} 가속`
      : "감속 후 재점화 가능성 관측";
  }
  if (strongest === "engagement") {
    return `좋아요·댓글 반응률 ${(measurement.engagementRate * 100).toFixed(1)}%`;
  }
  if (strongest === "opportunity") {
    return `${formatCompactMetric(measurement.latestViews)}뷰 초기 구간`;
  }
  return `${Math.round(measurement.ageHours)}시간 이내 신규 업로드`;
}

function signalState(score, scoreDelta, confidence) {
  if (confidence < 0.35) {
    return { status: "observing", label: "◌ 데이터 축적 중" };
  }
  if (score >= 85) return { status: "breakout", label: "✹ 돌파 신호" };
  if (score >= 70) {
    return scoreDelta >= 5
      ? { status: "rising", label: "↗ 급점화" }
      : { status: "rising", label: "▲ 강한 상승" };
  }
  if (scoreDelta <= -8) return { status: "cooling", label: "↓ 열기 감소" };
  if (score >= 50) return { status: "ranked", label: "↑ 성장 관측" };
  return { status: "ranked", label: "· 아직 조용함" };
}

function scoreCandidates(candidates, now = Date.now()) {
  const measurements = candidates.map((candidate) => rawMeasurement(candidate, now));
  const relativeRanks = blendedPercentileRanks(
    candidates,
    measurements,
    "growthRatePerHour",
  );
  const absoluteRanks = blendedPercentileRanks(candidates, measurements, "viewsPerHour");
  const accelerationRanks = blendedPercentileRanks(candidates, measurements, "acceleration");
  const engagementRanks = blendedPercentileRanks(
    candidates,
    measurements,
    "engagementRate",
  );
  const opportunityMeasurements = measurements.map((measurement) => (
    measurement ? { opportunity: -measurement.latestViews } : null
  ));
  const opportunityRanks = blendedPercentileRanks(
    candidates,
    opportunityMeasurements,
    "opportunity",
  );

  return candidates.map((candidate, index) => {
    const measurement = measurements[index];
    if (!measurement) {
      return {
        videoId: candidate.videoId,
        score: null,
        scoreDelta: 0,
        status: "observing",
        label: "NEW · 관측 중",
        reason: "첫 통계 스냅샷 대기 중",
        engineVersion: ENGINE_VERSION,
        metrics: {
          confidence: 0,
          snapshotCount: candidate.snapshots?.length || 0,
        },
      };
    }

    const components = {
      relative: relativeRanks[index] * 0.30,
      absolute: absoluteRanks[index] * 0.20,
      acceleration: accelerationRanks[index] * 0.15,
      engagement: engagementRanks[index] * 0.10,
      opportunity: opportunityRanks[index] * 0.15,
      freshness: measurement.freshness * 0.10,
    };
    const rawScore = Object.values(components).reduce((sum, value) => sum + value, 0);
    const score = Math.round(
      100 * rawScore * (0.7 + measurement.confidence * 0.3),
    );
    const comparablePrevious = candidate.engineVersion === ENGINE_VERSION
      && Number.isFinite(Number(candidate.previousScore));
    const scoreDelta = comparablePrevious
      ? score - Number(candidate.previousScore)
      : 0;
    const state = signalState(score, scoreDelta, measurement.confidence);
    return {
      videoId: candidate.videoId,
      score,
      scoreDelta,
      status: state.status,
      label: state.label,
      reason: reasonForSignal(measurement, components),
      engineVersion: ENGINE_VERSION,
      metrics: {
        acceleration: measurement.accelerationRatio,
        confidence: measurement.confidence,
        engagementRate: measurement.engagementRate,
        growthRatePerHour: measurement.growthRatePerHour,
        opportunityScore: opportunityRanks[index],
        snapshotCount: measurement.snapshotCount,
        viewsPerHour: measurement.viewsPerHour,
      },
    };
  });
}

function baseFeedScore(item, sort) {
  if (sort === "new") return Date.parse(item.published_at || item.first_seen_at) / 1e10;
  if (sort === "early") {
    return Number(item.opportunity_score || 0) * 80
      + Number(item.signal_score || 0) * 0.2
      + Number(item.confidence || 0) * 5;
  }
  if (sort === "rising") {
    const status = item.status || item.candidate_status;
    const stateBonus = status === "breakout" ? 25 : status === "rising" ? 12 : 0;
    return Number(item.signal_score || 0)
      + Math.max(0, Number(item.score_delta || 0)) * 0.5
      + stateBonus;
  }
  return Number(item.signal_score || 0)
    + Math.max(0, Number(item.score_delta || 0)) * 0.25
    + Number(item.confidence || 0) * 5;
}

function selectDiverseFeed(items, { sort = "signal", limit = 30 } = {}) {
  const remaining = items.filter((item) => (
    sort !== "rising" || ["breakout", "rising"].includes(item.status || item.candidate_status)
  ));
  const selected = [];
  const laneCounts = new Map();
  const channelCounts = new Map();

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    remaining.forEach((item, index) => {
      const laneCount = laneCounts.get(item.lane || "기타") || 0;
      const channelCount = channelCounts.get(item.channel_id || item.youtube_id) || 0;
      if (channelCount >= 2) return;
      const diversityPenalty = laneCount * (sort === "new" ? 1.5 : 3.5)
        + channelCount * 14;
      const score = baseFeedScore(item, sort) - diversityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) break;
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push({ ...picked, feed_rank: selected.length + 1 });
    laneCounts.set(picked.lane || "기타", (laneCounts.get(picked.lane || "기타") || 0) + 1);
    const channelKey = picked.channel_id || picked.youtube_id;
    channelCounts.set(channelKey, (channelCounts.get(channelKey) || 0) + 1);
  }
  return selected;
}

module.exports = {
  ENGINE_VERSION,
  auditedSnapshots,
  percentileRanks,
  rawMeasurement,
  scoreCandidates,
  selectDiverseFeed,
  signalState,
};
