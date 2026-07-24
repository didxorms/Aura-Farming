"use strict";

const SEED_COST = 1000;
const MAX_SLOTS = 4;
const AUTO_HARVEST_MINUTES = 24 * 60;
const RULES_VERSION = "0.7.0";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function calculateEarlyBonus(views, ageHours) {
  const viewPenalty = Math.log10(Math.max(Number(views) || 0, 10)) * 0.115;
  const agePenalty = Math.max(0, Number(ageHours) || 0) * 0.004;
  return clamp(1.66 - viewPenalty - agePenalty, 0.78, 1.32);
}

function calculatePayout(entryViews, currentViews, earlyBonus) {
  const ratio = Math.max(1, Number(currentViews) || 0) / Math.max(1, Number(entryViews) || 0);
  const multiplier = clamp(1 + Math.log2(ratio) * 0.28 * (Number(earlyBonus) || 1), 1, 4.2);
  return Math.round(SEED_COST * multiplier);
}

function gradeForRatio(ratio) {
  if (ratio >= 50) return { grade: "X", label: "INTERNET ANOMALY" };
  if (ratio >= 15) return { grade: "S", label: "VIRAL MASTERPIECE" };
  if (ratio >= 5) return { grade: "A", label: "EARLY CATCH" };
  if (ratio >= 2) return { grade: "B", label: "SOLID SIGNAL" };
  if (ratio >= 1.3) return { grade: "C", label: "SMALL WIN" };
  return { grade: "F", label: "ALGORITHM SAID NO" };
}

module.exports = {
  AUTO_HARVEST_MINUTES,
  MAX_SLOTS,
  RULES_VERSION,
  SEED_COST,
  calculateEarlyBonus,
  calculatePayout,
  clamp,
  gradeForRatio,
};
