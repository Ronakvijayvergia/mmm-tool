import { useState, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter,
  Cell, PieChart, Pie, ComposedChart, ReferenceLine
} from "recharts";
import {
  Upload, Settings, ChevronRight, ChevronLeft, Check,
  AlertTriangle, Play, DollarSign, Eye, RefreshCw
} from "lucide-react";

/* ================================================================
   MATH UTILITIES
   ================================================================ */

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(",");
    const row = {};
    headers.forEach((h, j) => {
      const val = (values[j] || "").trim().replace(/^"|"$/g, "");
      const num = Number(val);
      row[h] = val === "" ? null : isNaN(num) ? val : num;
    });
    rows.push(row);
  }
  return { data: rows, columns: headers };
}

function generateSampleData(nWeeks) {
  if (!nWeeks) nWeeks = 208;
  const data = [];
  const base = new Date("2022-01-03");
  let s = 42;
  const random = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const rn = () => random();
  const rng = (lo, hi) => lo + random() * (hi - lo);

  var prevSpend = {};
  var chNames = ["tv_linear_spend","tv_streaming_spend","digital_display_spend","digital_video_spend","digital_programmatic_spend","social_facebook_spend","social_instagram_spend","social_tiktok_spend","search_google_spend","search_bing_spend","print_newspaper_spend","print_magazine_spend","radio_traditional_spend","radio_podcast_spend"];
  var chBase =  [25000, 12000, 14000, 9000, 4500, 6000, 5500, 3500, 11000, 2800, 3500, 2500, 2800, 1800];
  var chVol =   [6000,  3000,  3500,  2500, 1200, 1500, 1400, 1000, 3000,  800,  900,  700,  700,  500];
  var chROI =   [4.2,   3.8,   3.0,   2.5,  2.0,  3.5,  3.2,  2.8,  5.5,  4.0,  1.5,  1.2,  1.8,  1.4];
  var chDecay = [0.65,  0.50,  0.35,  0.30, 0.25, 0.20, 0.22, 0.18, 0.15, 0.12, 0.55, 0.50, 0.60, 0.40];

  chNames.forEach(function(c, i) { prevSpend[c] = chBase[i]; });
  var prevAdstocked = {};
  chNames.forEach(function(c) { prevAdstocked[c] = 0; });

  for (var w = 0; w < nWeeks; w++) {
    var d = new Date(base);
    d.setDate(d.getDate() + w * 7);
    var dateStr = d.toISOString().slice(0, 10);
    var month = d.getMonth() + 1;
    var seasonMult = 1 + 0.18 * Math.sin(2 * Math.PI * (month - 3) / 12);
    var s52 = Math.sin(2 * Math.PI * w / 52);
    var s26 = Math.sin(2 * Math.PI * w / 26);

    var row = { date: dateStr };
    var totalMediaEffect = 0;

    chNames.forEach(function(c, i) {
      var spend = Math.max(100, Math.round((0.65 * prevSpend[c] + 0.35 * (chBase[i] + rng(-chVol[i], chVol[i]))) * seasonMult));
      row[c] = spend;
      prevSpend[c] = spend;
      var adstocked = spend + chDecay[i] * prevAdstocked[c];
      prevAdstocked[c] = adstocked;
      var maxAd = chBase[i] * 3;
      var norm = Math.min(adstocked / maxAd, 3.0);
      var sat = 1 - 1 / (1 + Math.pow(norm / 0.5, 2.0));
      totalMediaEffect += chROI[i] * spend * sat;
    });

    var organic = Math.max(0, Math.round(5000 + 15 * w + 800 * s52 + rng(-400, 400)));
    var wom = Math.max(0, Math.round(1200 + rng(-200, 200)));
    var confidence = Math.round((100 + 4 * Math.sin(2 * Math.PI * w / 104) + rng(-1.5, 1.5)) * 100) / 100;
    var competitor = Math.max(0, Math.round(35000 + 8000 * Math.sin(2 * Math.PI * w / 52 + 0.8) + rng(-3000, 3000)));
    var isHoliday = ([11, 12, 1, 7].indexOf(month) >= 0 && rn() < 0.3) ? 1 : 0;

    var baseRev = 150000 + 200 * w + 20000 * s52 + 8000 * s26 + 35000 * isHoliday;
    var orgEffect = 1.2 * organic + 4.0 * wom;
    var extEffect = 500 * confidence - 0.1 * competitor;
    var noise = rng(-8000, 8000);
    var revenue = Math.max(50000, Math.round(baseRev + totalMediaEffect + orgEffect + extEffect + noise));

    row.organic_traffic = organic;
    row.word_of_mouth = wom;
    row.consumer_confidence = confidence;
    row.competitor_spend = competitor;
    row.is_holiday = isHoliday;
    row.revenue = revenue;
    data.push(row);
  }

  return data;
}

function geometricAdstock(x, theta) {
  var result = new Array(x.length).fill(0);
  result[0] = x[0];
  for (var t = 1; t < x.length; t++) result[t] = x[t] + theta * result[t - 1];
  return result;
}

function hillSaturation(x, alpha, gamma) {
  var maxVal = Math.max.apply(null, x) || 1;
  return x.map(function(v) {
    var norm = v / maxVal;
    if (norm <= 0) return 0;
    return 1 - 1 / (1 + Math.pow(norm / gamma, alpha));
  });
}

function negExponentialSaturation(x, alpha, beta) {
  var maxVal = Math.max.apply(null, x) || 1;
  return x.map(function(v) {
    var norm = v / maxVal;
    return alpha * (1 - Math.exp(-beta * norm));
  });
}

function logarithmicSaturation(x, alpha) {
  var maxVal = Math.max.apply(null, x) || 1;
  return x.map(function(v) { return alpha * Math.log(1 + v / maxVal); });
}

function powerSaturation(x, alpha) {
  var maxVal = Math.max.apply(null, x) || 1;
  return x.map(function(v) {
    var norm = v / maxVal;
    return norm > 0 ? Math.pow(norm, alpha) : 0;
  });
}

function weibullCDF(x, shape, scale) {
  return 1 - Math.exp(-Math.pow(x / scale, shape));
}

function weibullCdfAdstock(x, shape, scale) {
  var n = x.length;
  var maxLag = Math.min(n, 13);
  var scaleTrans = Math.max(1, Math.round(scale * maxLag));
  /* Weibull CDF weights: w(lag) = CDF(lag+1) - CDF(lag)
     where CDF(t) = 1 - exp(-(t/scale)^shape) */
  var weights = [];
  for (var lag = 0; lag < maxLag; lag++) {
    var cdfLo = lag === 0 ? 0 : 1 - Math.exp(-Math.pow(lag / scaleTrans, shape));
    var cdfHi = 1 - Math.exp(-Math.pow((lag + 1) / scaleTrans, shape));
    weights.push(Math.max(0, cdfHi - cdfLo));
  }
  var wSum = 0;
  for (var i = 0; i < weights.length; i++) wSum += weights[i];
  if (wSum > 0) for (var i = 0; i < weights.length; i++) weights[i] /= wSum;
  var result = new Array(n).fill(0);
  for (var t = 0; t < n; t++) {
    for (var lag = 0; lag < Math.min(maxLag, t + 1); lag++) {
      result[t] += x[t - lag] * weights[lag];
    }
  }
  return result;
}

function weibullPdfAdstock(x, shape, scale) {
  var n = x.length;
  var maxLag = Math.min(n, 13);
  var scaleTrans = Math.max(1, Math.round(scale * maxLag));
  var weights = [];
  for (var lag = 0; lag < maxLag; lag++) {
    var t = lag + 0.5;
    var w = (shape / scaleTrans) * Math.pow(t / scaleTrans, shape - 1) * Math.exp(-Math.pow(t / scaleTrans, shape));
    weights.push(Math.max(0, w));
  }
  var wSum = 0;
  for (var i = 0; i < weights.length; i++) wSum += weights[i];
  if (wSum > 0) for (var i = 0; i < weights.length; i++) weights[i] /= wSum;
  var result = new Array(n).fill(0);
  for (var t2 = 0; t2 < n; t2++) {
    for (var lag = 0; lag < Math.min(maxLag, t2 + 1); lag++) {
      result[t2] += x[t2 - lag] * weights[lag];
    }
  }
  return result;
}

/* Binomial adstock from Google Meridian:
   w(s; alpha, L) = C(L,s) * alpha^s * (1-alpha)^(L-s)
   where L = max_lag, alpha controls peak position.
   alpha near 0 → peak at lag 0 (immediate), alpha near 1 → peak at lag L.
   Recommended: alpha ∈ [0, 1], max_lag 4-20. */
function binomialAdstock(x, alpha, maxLag) {
  var n = x.length;
  if (!maxLag || maxLag < 1) maxLag = 8;
  maxLag = Math.min(maxLag, Math.min(n, 20));
  var safeAlpha = Math.max(0.001, Math.min(0.999, alpha));

  /* Compute binomial weights: w(s) = C(L,s) * alpha^s * (1-alpha)^(L-s) */
  var weights = [];
  for (var s = 0; s <= maxLag; s++) {
    /* log C(L,s) = sum(log(L-i+1) - log(i)) for i=1..s */
    var logC = 0;
    for (var i = 1; i <= s; i++) {
      logC += Math.log(maxLag - i + 1) - Math.log(i);
    }
    var logW = logC + s * Math.log(safeAlpha) + (maxLag - s) * Math.log(1 - safeAlpha);
    weights.push(Math.exp(logW));
  }
  var wSum = 0;
  for (var i2 = 0; i2 < weights.length; i2++) wSum += weights[i2];
  if (wSum > 0) for (var i3 = 0; i3 < weights.length; i3++) weights[i3] /= wSum;

  var result = new Array(n).fill(0);
  for (var t = 0; t < n; t++) {
    for (var lag = 0; lag < Math.min(weights.length, t + 1); lag++) {
      result[t] += x[t - lag] * weights[lag];
    }
  }
  return result;
}

/* Meridian-style Hill saturation: 1 / (1 + (x/ec)^(-slope))
   ec = half-saturation point (effective concentration)
   slope = steepness (default 1) */
function meridianHillSaturation(x, ec, slope) {
  var maxVal = Math.max.apply(null, x) || 1;
  if (!slope) slope = 1;
  return x.map(function(v) {
    var norm = v / maxVal;
    if (norm <= 0) return 0;
    return 1 / (1 + Math.pow(norm / ec, -slope));
  });
}

/* ── Bayesian MAP Estimation ──
   Maximum A Posteriori with informative priors.
   Mimics Google Meridian's approach:
   - HalfNormal(sigma) priors on media coefficients (positive constraint)
   - Normal(0, sigma) priors on non-media coefficients
   - Iterative reweighted least squares to find MAP estimate */
function bayesianMAP(X, y, mediaCols, priorConfig) {
  var n = X.length, p = X[0].length;
  var nMedia = mediaCols.length;
  var cfg = priorConfig || {};
  var defaultMediaSigma = cfg.mediaSigma || 5.0;     /* HalfNormal(5) like Meridian */
  var nonMediaSigma = cfg.nonMediaSigma || 10.0;
  var channelPriors = cfg.channelPriors || {};

  /* ── Normalize y to mean=0, std=1 for proper prior conditioning ── */
  var yMean = 0;
  for (var iy = 0; iy < n; iy++) yMean += y[iy];
  yMean /= n;
  var yVar = 0;
  for (var iy2 = 0; iy2 < n; iy2++) yVar += (y[iy2] - yMean) * (y[iy2] - yMean);
  yVar /= n;
  var yStd = Math.sqrt(yVar);
  if (yStd < 1e-10) yStd = 1;
  var yNorm = [];
  for (var iy3 = 0; iy3 < n; iy3++) yNorm.push((y[iy3] - yMean) / yStd);

  /* Prior precision (1/sigma^2) — now meaningful because y is standardized */
  var priorPrec = [];
  for (var j = 0; j < p; j++) {
    if (j < nMedia) {
      var chName = mediaCols[j] || "";
      var chPrior = channelPriors[chName] || {};
      var sigma = chPrior.sigma !== undefined ? chPrior.sigma : defaultMediaSigma;
      priorPrec.push(1.0 / (sigma * sigma));
    } else {
      priorPrec.push(1.0 / (nonMediaSigma * nonMediaSigma));
    }
  }

  /* ── Single MAP solve: beta = (X'X + diag(priorPrec))^-1 X'y_norm ── */
  var XtX = [];
  for (var i = 0; i < p; i++) { XtX[i] = []; for (var j3 = 0; j3 < p; j3++) XtX[i][j3] = 0; }
  for (var i2 = 0; i2 < p; i2++)
    for (var j4 = 0; j4 < p; j4++)
      for (var k = 0; k < n; k++) XtX[i2][j4] += X[k][i2] * X[k][j4];

  /* Add prior precision to diagonal */
  for (var i3 = 0; i3 < p; i3++) XtX[i3][i3] += priorPrec[i3];

  var Xty = new Array(p).fill(0);
  for (var i4 = 0; i4 < p; i4++)
    for (var k2 = 0; k2 < n; k2++) Xty[i4] += X[k2][i4] * yNorm[k2];

  var betaNorm = solveSystem(XtX, Xty);

  /* ── Denormalize: beta_raw = beta_norm * yStd ── */
  var beta = [];
  for (var jd = 0; jd < p; jd++) beta.push(betaNorm[jd] * yStd);

  /* Enforce positive media coefficients (HalfNormal prior) */
  for (var j5 = 0; j5 < nMedia; j5++) beta[j5] = Math.max(0, beta[j5]);

  return beta;
}

/* ── Bootstrap Resampling for Confidence Intervals ──
   Resamples the training data B times, re-fits the model each time,
   and returns percentile-based confidence intervals on betas. */
function bootstrapCI(X, y, nMedia, method, priorConfig, nBoot, alpha) {
  if (!nBoot) nBoot = 200;
  if (!alpha) alpha = 0.05; /* 95% CI */
  var n = X.length, p = X[0].length;
  var betaSamples = [];

  for (var b = 0; b < nBoot; b++) {
    /* Resample with replacement */
    var Xb = [], yb = [];
    for (var i = 0; i < n; i++) {
      var idx = Math.floor(Math.random() * n);
      Xb.push(X[idx]);
      yb.push(y[idx]);
    }

    var betaB;
    if (method === "bayesian") {
      betaB = bayesianMAP(Xb, yb, Array.from({length: nMedia}, function(_, i) { return "media_" + i; }), priorConfig);
    } else {
      /* Try multiple lambdas, pick best */
      var lambdas = [0.01, 0.1, 1.0, 10.0];
      var bestBeta = null, bestSSE = Infinity;
      lambdas.forEach(function(lam) {
        var bTry = ridgeRegression(Xb, yb, lam);
        for (var j = 0; j < nMedia; j++) bTry[j] = Math.max(0, bTry[j]);
        var sse = 0;
        for (var k = 0; k < n; k++) {
          var pred = 0;
          for (var j2 = 0; j2 < p; j2++) pred += Xb[k][j2] * bTry[j2];
          sse += Math.pow(yb[k] - pred, 2);
        }
        if (sse < bestSSE) { bestSSE = sse; bestBeta = bTry; }
      });
      betaB = bestBeta;
    }

    betaSamples.push(betaB);
  }

  /* Compute percentiles */
  var lower = new Array(p).fill(0);
  var upper = new Array(p).fill(0);
  var median = new Array(p).fill(0);

  for (var j = 0; j < p; j++) {
    var vals = betaSamples.map(function(b) { return b[j]; }).sort(function(a, b) { return a - b; });
    var loIdx = Math.max(0, Math.floor(vals.length * (alpha / 2)));
    var hiIdx = Math.min(vals.length - 1, Math.floor(vals.length * (1 - alpha / 2)));
    var medIdx = Math.floor(vals.length * 0.5);
    lower[j] = vals[loIdx];
    upper[j] = vals[hiIdx];
    median[j] = vals[medIdx];
  }

  return { lower: lower, upper: upper, median: median, samples: betaSamples };
}

/* ── Expanding Window Time-Series Cross-Validation ──
   Trains on expanding windows and tests on the next fold.
   Returns per-fold metrics + average. */
function expandingWindowCV(X, y, nMedia, nFolds, method, priorConfig, regAlpha) {
  if (!nFolds) nFolds = 5;
  var n = X.length, p = X[0].length;
  var minTrainSize = Math.max(20, Math.floor(n * 0.3));
  var foldSize = Math.floor((n - minTrainSize) / nFolds);
  if (foldSize < 5) return null;

  var foldResults = [];
  for (var fold = 0; fold < nFolds; fold++) {
    var trainEnd = minTrainSize + fold * foldSize;
    var testEnd = Math.min(n, trainEnd + foldSize);
    if (trainEnd >= n || testEnd <= trainEnd) break;

    var Xtr = X.slice(0, trainEnd);
    var ytr = y.slice(0, trainEnd);
    var Xte = X.slice(trainEnd, testEnd);
    var yte = y.slice(trainEnd, testEnd);

    var beta;
    if (method === "bayesian") {
      beta = bayesianMAP(Xtr, ytr, Array.from({length: nMedia}, function(_, i) { return "media_" + i; }), priorConfig);
    } else {
      beta = ridgeRegression(Xtr, ytr, regAlpha || 1.0);
      for (var j = 0; j < nMedia; j++) beta[j] = Math.max(0, beta[j]);
    }

    /* Compute intercept */
    var yMean = 0; for (var i = 0; i < ytr.length; i++) yMean += ytr[i]; yMean /= ytr.length;
    var xMeans = new Array(p).fill(0);
    for (var j2 = 0; j2 < p; j2++) {
      for (var k = 0; k < Xtr.length; k++) xMeans[j2] += Xtr[k][j2];
      xMeans[j2] /= Xtr.length;
    }
    var intcpt = yMean;
    for (var j3 = 0; j3 < p; j3++) intcpt -= beta[j3] * xMeans[j3];

    /* Predict test */
    var preds = Xte.map(function(row) {
      var s = intcpt;
      for (var j4 = 0; j4 < row.length; j4++) s += row[j4] * beta[j4];
      return s;
    });

    var metrics = computeMetrics(yte, preds);
    foldResults.push({ fold: fold + 1, trainSize: trainEnd, testSize: testEnd - trainEnd, r2: metrics.r2, mape: metrics.mape, rmse: metrics.rmse, nrmse: metrics.nrmse });
  }

  /* Compute averages */
  var avgR2 = 0, avgMape = 0, avgNrmse = 0;
  foldResults.forEach(function(f) { avgR2 += f.r2; avgMape += f.mape; avgNrmse += f.nrmse; });
  if (foldResults.length > 0) {
    avgR2 /= foldResults.length;
    avgMape /= foldResults.length;
    avgNrmse /= foldResults.length;
  }

  return { folds: foldResults, avgR2: avgR2, avgMape: avgMape, avgNrmse: avgNrmse, nFolds: foldResults.length };
}

function solveSystem(A, b) {
  var n = A.length;
  var aug = A.map(function(row, i) { return row.concat([b[i]]); });
  for (var col = 0; col < n; col++) {
    var maxRow = col;
    for (var row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    var tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp;
    var pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) { aug[col][col] = 1e-12; continue; }
    for (var row2 = col + 1; row2 < n; row2++) {
      var f = aug[row2][col] / pivot;
      for (var j = col; j <= n; j++) aug[row2][j] -= f * aug[col][j];
    }
  }
  var x = new Array(n).fill(0);
  for (var i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (var j2 = i + 1; j2 < n; j2++) x[i] -= aug[i][j2] * x[j2];
    x[i] = Math.abs(aug[i][i]) > 1e-14 ? x[i] / aug[i][i] : 0;
  }
  return x;
}

function ridgeRegression(X, y, alpha) {
  var n = X.length, p = X[0].length;
  var XtX = [];
  for (var i = 0; i < p; i++) { XtX[i] = []; for (var j = 0; j < p; j++) XtX[i][j] = 0; }
  for (var i2 = 0; i2 < p; i2++)
    for (var j2 = 0; j2 < p; j2++)
      for (var k = 0; k < n; k++) XtX[i2][j2] += X[k][i2] * X[k][j2];
  for (var i3 = 0; i3 < p; i3++) XtX[i3][i3] += alpha * n;
  var Xty = new Array(p).fill(0);
  for (var i4 = 0; i4 < p; i4++)
    for (var k2 = 0; k2 < n; k2++) Xty[i4] += X[k2][i4] * y[k2];
  return solveSystem(XtX, Xty);
}

function computeMetrics(actual, predicted) {
  var n = actual.length;
  if (n === 0) return { r2: 0, mape: 0, rmse: 0, mae: 0, nrmse: 1 };
  var meanA = 0; for (var i = 0; i < n; i++) meanA += actual[i]; meanA /= n;
  var ssTot = 0, ssRes = 0, mapeSum = 0, maeSum = 0;
  for (var i2 = 0; i2 < n; i2++) {
    ssTot += Math.pow(actual[i2] - meanA, 2);
    ssRes += Math.pow(actual[i2] - predicted[i2], 2);
    if (Math.abs(actual[i2]) > 0) mapeSum += Math.abs((actual[i2] - predicted[i2]) / actual[i2]);
    maeSum += Math.abs(actual[i2] - predicted[i2]);
  }
  var rmse = Math.sqrt(ssRes / n);
  var nrmse = meanA > 0 ? rmse / meanA : 1;
  return { r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, mape: mapeSum / n, rmse: rmse, mae: maeSum / n, nrmse: nrmse };
}

/* DECOMP.RSSD: Root Sum of Squared Distances between model-implied
   spend share and contribution share. Low = model allocations match
   actual spend patterns. Robyn uses this as a key Pareto criterion. */
function computeDecompRSSD(mediaSharePct, mediaCols, contributions, filteredData) {
  if (!mediaCols || !mediaCols.length) return 1;
  var totalSpend = 0;
  var spendShare = {};
  mediaCols.forEach(function(col) {
    var sum = 0; filteredData.forEach(function(r) { sum += (r[col] || 0); });
    spendShare[col] = sum;
    totalSpend += sum;
  });
  var totalContrib = 0;
  mediaCols.forEach(function(col) { totalContrib += (contributions[col] || 0); });

  var ssq = 0;
  mediaCols.forEach(function(col) {
    var sPct = totalSpend > 0 ? spendShare[col] / totalSpend : 0;
    var cPct = totalContrib > 0 ? (contributions[col] || 0) / totalContrib : 0;
    ssq += Math.pow(sPct - cPct, 2);
  });
  return Math.sqrt(ssq);
}

/* Composite model score: combines NRMSE and DECOMP.RSSD into
   a single score for Pareto-like ranking. Lower = better.
   Robyn optimizes on these two axes. */
function computeModelScore(nrmse, decompRssd) {
  /* Weight: 60% fit quality (nrmse), 40% business sense (decomp) */
  return 0.6 * nrmse + 0.4 * decompRssd;
}

function computeCorrelation(data, cols) {
  var n = data.length;
  var matrix = [];
  for (var i = 0; i < cols.length; i++) {
    matrix[i] = [];
    for (var j = 0; j < cols.length; j++) {
      var xi = data.map(function(r) { return r[cols[i]] || 0; });
      var xj = data.map(function(r) { return r[cols[j]] || 0; });
      var mi = 0, mj = 0;
      for (var k = 0; k < n; k++) { mi += xi[k]; mj += xj[k]; }
      mi /= n; mj /= n;
      var num = 0, d1 = 0, d2 = 0;
      for (var k2 = 0; k2 < n; k2++) {
        num += (xi[k2] - mi) * (xj[k2] - mj);
        d1 += Math.pow(xi[k2] - mi, 2);
        d2 += Math.pow(xj[k2] - mj, 2);
      }
      matrix[i][j] = d1 && d2 ? num / Math.sqrt(d1 * d2) : i === j ? 1 : 0;
    }
  }
  return matrix;
}

function linspace(a, b, n) {
  var result = [];
  if (n <= 1) return [a];
  var step = (b - a) / (n - 1);
  for (var i = 0; i < n; i++) result.push(a + step * i);
  return result;
}

var COLORS = ["#2563eb", "#f97316", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#ca8a04", "#e11d48"];

function fmt(v, prefix) {
  var p = prefix !== undefined ? prefix : "$";
  if (typeof v !== "number") return v;
  if (Math.abs(v) >= 1e6) return p + (v/1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return p + (v/1e3).toFixed(0) + "K";
  return p + v.toFixed(0);
}

function downloadCSV(filename, headers, rows) {
  var csv = headers.join(",") + "\n";
  rows.forEach(function(row) {
    csv += row.map(function(cell) {
      var s = String(cell == null ? "" : cell);
      if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(",") + "\n";
  });
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ================================================================
   SIMPLE UI COMPONENTS (no hooks)
   ================================================================ */

function Card(props) {
  return (
    <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 20, marginBottom: 16 }}>
      {props.title && <h3 style={{ fontSize: 18, fontWeight: 600, color: "#1e293b", marginBottom: 12, marginTop: 0 }}>{props.title}</h3>}
      {props.children}
    </div>
  );
}

function MetricBox(props) {
  var bg = props.color === "green" ? "#f0fdf4" : props.color === "red" ? "#fef2f2" : "#eff6ff";
  var fg = props.color === "green" ? "#15803d" : props.color === "red" ? "#b91c1c" : "#1d4ed8";
  return (
    <div style={{ background: bg, borderRadius: 8, padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: fg }}>{props.value}</div>
      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{props.label}</div>
    </div>
  );
}

function TabBar(props) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#f3f4f6", borderRadius: 8, padding: 4, overflowX: "auto" }}>
      {props.tabs.map(function(t) {
        return (
          <button key={t.key} onClick={function() { props.onChange(t.key); }}
            style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer",
              background: props.active === t.key ? "white" : "transparent",
              color: props.active === t.key ? "#1d4ed8" : "#6b7280",
              boxShadow: props.active === t.key ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
              whiteSpace: "nowrap"
            }}>{t.label}</button>
        );
      })}
    </div>
  );
}

/* ================================================================
   MAIN APP
   ================================================================ */

export default function MMMTool() {
  var _step = useState(0);
  var step = _step[0], setStep = _step[1];
  var _data = useState(null);
  var data = _data[0], setData = _data[1];
  var _columns = useState([]);
  var columns = _columns[0], setColumns = _columns[1];
  var _dateCol = useState("");
  var dateCol = _dateCol[0], setDateCol = _dateCol[1];
  var _targetCol = useState("");
  var targetCol = _targetCol[0], setTargetCol = _targetCol[1];
  var _dmaCol = useState("");
  var dmaCol = _dmaCol[0], setDmaCol = _dmaCol[1];
  var _selectedDMA = useState("All");
  var selectedDMA = _selectedDMA[0], setSelectedDMA = _selectedDMA[1];
  var _availableDMAs = useState([]);
  var availableDMAs = _availableDMAs[0], setAvailableDMAs = _availableDMAs[1];
  var _mediaCols = useState([]);
  var mediaCols = _mediaCols[0], setMediaCols = _mediaCols[1];
  var _organicCols = useState([]);
  var organicCols = _organicCols[0], setOrganicCols = _organicCols[1];
  var _contextCols = useState([]);
  var contextCols = _contextCols[0], setContextCols = _contextCols[1];
  var _adstockParams = useState({});
  var adstockParams = _adstockParams[0], setAdstockParams = _adstockParams[1];
  var _satParams = useState({});
  var satParams = _satParams[0], setSatParams = _satParams[1];
  var _regAlpha = useState(1.0);
  var regAlpha = _regAlpha[0], setRegAlpha = _regAlpha[1];
  var _testPct = useState(20);
  var testPct = _testPct[0], setTestPct = _testPct[1];
  var _gridSteps = useState(3);
  var gridSteps = _gridSteps[0], setGridSteps = _gridSteps[1];
  var _maxIterations = useState(100);
  var maxIterations = _maxIterations[0], setMaxIterations = _maxIterations[1];
  var _searchMode = useState("both");
  var searchMode = _searchMode[0], setSearchMode = _searchMode[1];
  var _modelResult = useState(null);
  var modelResult = _modelResult[0], setModelResult = _modelResult[1];
  var _gridResults = useState([]);
  var gridResults = _gridResults[0], setGridResults = _gridResults[1];
  var _selectedModelIdx = useState(null);
  var selectedModelIdx = _selectedModelIdx[0], setSelectedModelIdx = _selectedModelIdx[1];
  var _showModelHint = useState(false);
  var showModelHint = _showModelHint[0], setShowModelHint = _showModelHint[1];
  var _gridProgress = useState({ current: 0, total: 0 });
  var gridProgress = _gridProgress[0], setGridProgress = _gridProgress[1];
  var _trainError = useState(null);
  var trainError = _trainError[0], setTrainError = _trainError[1];
  var _isTraining = useState(false);
  var isTraining = _isTraining[0], setIsTraining = _isTraining[1];
  var _budgetAlloc = useState({});
  var budgetAlloc = _budgetAlloc[0], setBudgetAlloc = _budgetAlloc[1];
  var _targetBudget = useState(0);
  var targetBudget = _targetBudget[0], setTargetBudget = _targetBudget[1];
  var _optScenarios = useState([]);
  var optScenarios = _optScenarios[0], setOptScenarios = _optScenarios[1];
  var _channelBounds = useState({});
  var channelBounds = _channelBounds[0], setChannelBounds = _channelBounds[1];
  var _optMode = useState("maximize");
  var optMode = _optMode[0], setOptMode = _optMode[1];
  var _revenueTarget = useState(0);
  var revenueTarget = _revenueTarget[0], setRevenueTarget = _revenueTarget[1];
  var _optResult = useState(null);
  var optResult = _optResult[0], setOptResult = _optResult[1];
  var _edaTab = useState("ts");
  var edaTab = _edaTab[0], setEdaTab = _edaTab[1];
  var _configTab = useState("adstock");
  var configTab = _configTab[0], setConfigTab = _configTab[1];
  var _resultTab = useState("leaderboard");
  var resultTab = _resultTab[0], setResultTab = _resultTab[1];
  var _adstockType = useState("geometric");
  var adstockType = _adstockType[0], setAdstockType = _adstockType[1];
  var _satFunction = useState("hill");
  var satFunction = _satFunction[0], setSatFunction = _satFunction[1];
  var _previewChannel = useState("");
  var previewChannel = _previewChannel[0], setPreviewChannel = _previewChannel[1];
  /* V2: Modeling method selection */
  var _modelingMethod = useState("ridge");  /* "ridge" (Robyn-style) or "bayesian" (Meridian-style) */
  var modelingMethod = _modelingMethod[0], setModelingMethod = _modelingMethod[1];
  var _priorConfig = useState({ mediaSigma: 5.0, nonMediaSigma: 10.0, channelPriors: {} });
  var priorConfig = _priorConfig[0], setPriorConfig = _priorConfig[1];
  var _bootstrapResults = useState(null);
  var bootstrapResults = _bootstrapResults[0], setBootstrapResults = _bootstrapResults[1];
  var _cvResults = useState(null);
  var cvResults = _cvResults[0], setCvResults = _cvResults[1];
  var _runBootstrap = useState(true);
  var runBootstrap = _runBootstrap[0], setRunBootstrap = _runBootstrap[1];
  var _nBootstrap = useState(100);
  var nBootstrap = _nBootstrap[0], setNBootstrap = _nBootstrap[1];
  var _runCV = useState(true);
  var runCV = _runCV[0], setRunCV = _runCV[1];
  var _nCVFolds = useState(5);
  var nCVFolds = _nCVFolds[0], setNCVFolds = _nCVFolds[1];
  var fileRef = useRef(null);

  var numericCols = useMemo(function() {
    if (!data || !data.length) return [];
    return columns.filter(function(c) { return typeof data[0][c] === "number"; });
  }, [data, columns]);

  var filteredData = useMemo(function() {
    if (!data) return null;
    if (!dmaCol || selectedDMA === "All") return data;
    return data.filter(function(r) { return r[dmaCol] === selectedDMA; });
  }, [data, dmaCol, selectedDMA]);

  var stepsList = [
    { name: "Upload", icon: Upload },
    { name: "Map", icon: Settings },
    { name: "Explore", icon: Eye },
    { name: "Configure", icon: Settings },
    { name: "Train", icon: Play },
    { name: "Optimize", icon: DollarSign },
  ];

  // All memos at top level

  var dataValidation = useMemo(function() {
    if (!data || !columns.length) return null;
    var missingByCol = {};
    var outliersByCol = {};
    var zeroSpendByCol = {};
    var totalIssues = 0;
    var flaggedCols = [];

    columns.forEach(function(col) {
      var missingCount = 0;
      data.forEach(function(row) {
        var val = row[col];
        if (val === null || val === undefined || val === "") missingCount++;
      });
      var missingPct = data.length > 0 ? (missingCount / data.length) * 100 : 0;
      missingByCol[col] = { count: missingCount, pct: missingPct };
      if (missingPct > 5) { totalIssues++; flaggedCols.push(col); }
    });

    numericCols.forEach(function(col) {
      var values = data.map(function(row) { return row[col]; }).filter(function(v) { return typeof v === "number"; });
      if (values.length < 4) { outliersByCol[col] = { count: 0, pct: 0 }; return; }
      values.sort(function(a, b) { return a - b; });
      var q1 = values[Math.floor(values.length * 0.25)];
      var q3 = values[Math.floor(values.length * 0.75)];
      var iqr = q3 - q1;
      var outlierCount = 0;
      values.forEach(function(v) { if (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr) outlierCount++; });
      var outlierPct = values.length > 0 ? (outlierCount / values.length) * 100 : 0;
      outliersByCol[col] = { count: outlierCount, pct: outlierPct };
      if (outlierPct > 5) { totalIssues++; if (flaggedCols.indexOf(col) === -1) flaggedCols.push(col); }
    });

    var dateGaps = [];
    if (dateCol && data.length > 1) {
      var dates = data.map(function(row) { return row[dateCol] ? new Date(row[dateCol]) : null; }).filter(function(d) { return d !== null; });
      dates.sort(function(a, b) { return a - b; });
      if (dates.length > 1) {
        var typicalGap = Math.round((dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24) / (dates.length - 1));
        var expectedDays = typicalGap <= 2 ? 1 : 7;
        for (var i = 1; i < dates.length; i++) {
          var diffDays = Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
          if (diffDays > expectedDays * 1.5) {
            dateGaps.push({ from: dates[i - 1].toISOString().slice(0, 10), to: dates[i].toISOString().slice(0, 10), gap: diffDays });
          }
        }
      }
      if (dateGaps.length > 0) totalIssues++;
    }

    mediaCols.forEach(function(col) {
      var zeroCount = 0;
      data.forEach(function(row) { if (row[col] === 0 || row[col] === null || row[col] === undefined) zeroCount++; });
      var zeroPct = data.length > 0 ? (zeroCount / data.length) * 100 : 0;
      zeroSpendByCol[col] = { count: zeroCount, pct: zeroPct };
      if (zeroPct > 30) { totalIssues++; if (flaggedCols.indexOf(col) === -1) flaggedCols.push(col); }
    });

    var qualityScore = "Good";
    if (totalIssues > 0 && totalIssues <= 3) qualityScore = "Fair";
    if (totalIssues > 3) qualityScore = "Poor";

    return { missingByCol: missingByCol, outliersByCol: outliersByCol, dateGaps: dateGaps, zeroSpendByCol: zeroSpendByCol, qualityScore: qualityScore, totalIssues: totalIssues, flaggedCols: flaggedCols };
  }, [data, columns, numericCols, dateCol, mediaCols]);

  var corrCols = useMemo(function() {
    if (!targetCol || !mediaCols.length) return [];
    return [targetCol].concat(mediaCols.slice(0, 6));
  }, [targetCol, mediaCols]);

  var corrMatrix = useMemo(function() {
    if (!filteredData || !corrCols.length) return [];
    return computeCorrelation(filteredData, corrCols);
  }, [filteredData, corrCols]);

  var tsData = useMemo(function() {
    if (!filteredData) return [];
    return filteredData.map(function(r) {
      var row = { date: r[dateCol] };
      row[targetCol] = r[targetCol];
      mediaCols.forEach(function(c) { row[c] = r[c]; });
      return row;
    });
  }, [filteredData, dateCol, targetCol, mediaCols]);

  var stabilityAnalysis = useMemo(function() {
    if (!filteredData || filteredData.length < 20 || !targetCol || !mediaCols.length) return null;
    var halfIdx = Math.floor(filteredData.length / 2);
    var earlyData = filteredData.slice(0, halfIdx);
    var recentData = filteredData.slice(halfIdx);

    function calcCorr(arr, colX, colY) {
      var n = 0, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
      arr.forEach(function(r) {
        var x = r[colX], y = r[colY];
        if (typeof x === "number" && typeof y === "number") { n++; sx += x; sy += y; sxy += x * y; sx2 += x * x; sy2 += y * y; }
      });
      if (n < 3) return 0;
      var denom = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
      return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    }

    function calcSlope(arr, colX, colY) {
      var n = 0, sx = 0, sy = 0, sxy = 0, sx2 = 0;
      arr.forEach(function(r) {
        var x = r[colX], y = r[colY];
        if (typeof x === "number" && typeof y === "number") { n++; sx += x; sy += y; sxy += x * y; sx2 += x * x; }
      });
      if (n < 3) return 0;
      var denom = n * sx2 - sx * sx;
      return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    }

    var channels = mediaCols.slice(0, 10);
    var results = channels.map(function(col) {
      var corrFull = calcCorr(filteredData, col, targetCol);
      var corrEarly = calcCorr(earlyData, col, targetCol);
      var corrRecent = calcCorr(recentData, col, targetCol);
      var slopeFull = calcSlope(filteredData, col, targetCol);
      var slopeEarly = calcSlope(earlyData, col, targetCol);
      var slopeRecent = calcSlope(recentData, col, targetCol);
      var corrDrift = Math.abs(corrEarly - corrRecent);
      var slopeFlip = (slopeEarly > 0 && slopeRecent < 0) || (slopeEarly < 0 && slopeRecent > 0);
      var stable = corrDrift < 0.3 && !slopeFlip;
      return { col: col, corrFull: corrFull, corrEarly: corrEarly, corrRecent: corrRecent, slopeFull: slopeFull, slopeEarly: slopeEarly, slopeRecent: slopeRecent, corrDrift: corrDrift, slopeFlip: slopeFlip, stable: stable };
    });

    var stableCount = results.filter(function(r) { return r.stable; }).length;
    var unstableCount = results.length - stableCount;
    return { results: results, stableCount: stableCount, unstableCount: unstableCount, earlyN: earlyData.length, recentN: recentData.length };
  }, [filteredData, targetCol, mediaCols]);

  var activePreviewCol = previewChannel && mediaCols.indexOf(previewChannel) >= 0 ? previewChannel : (mediaCols.length > 0 ? mediaCols[0] : "");

  var adstockPreview = useMemo(function() {
    if (!activePreviewCol) return [];
    var params = adstockParams[activePreviewCol];
    if (!params) params = { thetaMin: 0.3, thetaMax: 0.7 };
    var nLags = adstockType === "binomial" ? Math.max(12, (params.maxLagMax || 16) + 2) : 12;
    var pts = [];
    for (var lag = 0; lag < nLags; lag++) {
      var minVal = 0, maxVal = 0;
      if (adstockType === "geometric") {
        minVal = Math.pow(params.thetaMin || 0.3, lag);
        maxVal = Math.pow(params.thetaMax || 0.7, lag);
      } else if (adstockType === "weibull_cdf") {
        var sMin = Math.max(1, Math.round((params.scaleMin || 0.01) * 13));
        var sMax = Math.max(1, Math.round((params.scaleMax || 0.1) * 13));
        minVal = lag === 0 ? 1 : Math.exp(-Math.pow(lag / sMin, params.shapeMin || 0.5));
        maxVal = lag === 0 ? 1 : Math.exp(-Math.pow(lag / sMax, params.shapeMax || 2));
      } else if (adstockType === "weibull_pdf") {
        var sMin2 = Math.max(1, Math.round((params.scaleMin || 0.01) * 13));
        var sMax2 = Math.max(1, Math.round((params.scaleMax || 0.1) * 13));
        var t = lag + 0.5;
        minVal = (params.shapeMin || 1) / sMin2 * Math.pow(t / sMin2, (params.shapeMin || 1) - 1) * Math.exp(-Math.pow(t / sMin2, params.shapeMin || 1));
        maxVal = (params.shapeMax || 2) / sMax2 * Math.pow(t / sMax2, (params.shapeMax || 2) - 1) * Math.exp(-Math.pow(t / sMax2, params.shapeMax || 2));
      } else if (adstockType === "binomial") {
        /* Binomial weights for min/max alpha and maxLag */
        var aMin = params.alphaMin || 0.1, aMax = params.alphaMax || 0.5;
        var lMin = params.maxLagMin || 8, lMax = params.maxLagMax || 12;
        function binW(s, a, L) {
          if (s > L) return 0;
          var logC = 0;
          for (var ii = 1; ii <= s; ii++) logC += Math.log(L - ii + 1) - Math.log(ii);
          var sa = Math.max(0.001, Math.min(0.999, a));
          return Math.exp(logC + s * Math.log(sa) + (L - s) * Math.log(1 - sa));
        }
        minVal = binW(lag, aMin, lMin);
        maxVal = binW(lag, aMax, lMax);
      }
      pts.push({ lag: lag, min: Math.max(0, minVal) || 0, max: Math.max(0, maxVal) || 0 });
    }
    return pts;
  }, [adstockParams, activePreviewCol, adstockType]);

  var satPreview = useMemo(function() {
    if (!activePreviewCol) return [];
    var sp = satParams[activePreviewCol];
    var pts = [];
    for (var i = 0; i <= 50; i++) {
      var x = i / 50;
      var minSat = 0, maxSat = 0;
      if (satFunction === "hill") {
        if (!sp) sp = { alphaMin: 1.5, alphaMax: 3.0, gammaMin: 0.3, gammaMax: 0.7 };
        minSat = x > 0 ? (1 - 1 / (1 + Math.pow(x / (sp.gammaMin || 0.3), sp.alphaMin || 1.5))) : 0;
        maxSat = x > 0 ? (1 - 1 / (1 + Math.pow(x / (sp.gammaMax || 0.7), sp.alphaMax || 3.0))) : 0;
      } else if (satFunction === "neg_exponential") {
        if (!sp) sp = { alphaMin: 0.5, alphaMax: 2.0, betaMin: 0.5, betaMax: 5.0 };
        minSat = (sp.alphaMin || 0.5) * (1 - Math.exp(-(sp.betaMin || 0.5) * x));
        maxSat = (sp.alphaMax || 2.0) * (1 - Math.exp(-(sp.betaMax || 5.0) * x));
      } else if (satFunction === "logarithmic") {
        if (!sp) sp = { alphaMin: 0.5, alphaMax: 3.0 };
        minSat = (sp.alphaMin || 0.5) * Math.log(1 + x);
        maxSat = (sp.alphaMax || 3.0) * Math.log(1 + x);
      } else if (satFunction === "power") {
        if (!sp) sp = { alphaMin: 0.1, alphaMax: 1.0 };
        minSat = x > 0 ? Math.pow(x, sp.alphaMin || 0.1) : 0;
        maxSat = x > 0 ? Math.pow(x, sp.alphaMax || 1.0) : 0;
      }
      pts.push({ x: Math.round(x * 100), min: minSat, max: maxSat });
    }
    return pts;
  }, [satParams, activePreviewCol, satFunction]);

  var decompData = useMemo(function() {
    if (!modelResult) return [];
    return Object.entries(modelResult.contribPct)
      .sort(function(a, b) { return b[1] - a[1]; })
      .map(function(entry) {
        var name = entry[0], pct = entry[1];
        return {
          name: name.length > 18 ? name.slice(0, 16) + ".." : name,
          fullName: name, pct: Math.round(pct * 10) / 10,
          fill: mediaCols.indexOf(name) >= 0 ? "#2563eb" : name.indexOf("base") >= 0 ? "#f97316" : organicCols.indexOf(name) >= 0 ? "#16a34a" : "#94a3b8"
        };
      });
  }, [modelResult, mediaCols, organicCols]);

  var mediaShareData = useMemo(function() {
    if (!modelResult || !modelResult.mediaSharePct) return [];
    return Object.entries(modelResult.mediaSharePct)
      .filter(function(e) { return e[1] > 0; })
      .sort(function(a, b) { return b[1] - a[1]; })
      .map(function(e) { return { name: e[0], pct: Math.round(e[1] * 10) / 10 }; });
  }, [modelResult]);

  var fitData = useMemo(function() {
    if (!modelResult) return [];
    var result = [];
    modelResult.ytr.forEach(function(v, i) {
      result.push({ date: modelResult.dates[i], actual: v, predicted: Math.round(modelResult.ytrPred[i]), set: "train" });
    });
    modelResult.yte.forEach(function(v, i) {
      result.push({ date: modelResult.dates[modelResult.splitIdx + i], actual: v, predicted: Math.round(modelResult.ytePred[i]), set: "test" });
    });
    return result;
  }, [modelResult]);

  var totalGridCombinations = maxIterations;

  var gridCombColor = useMemo(function() {
    if (maxIterations >= 500) return "#dc2626";
    if (maxIterations >= 200) return "#ca8a04";
    return "#15803d";
  }, [maxIterations]);

  /* ── File handling ── */

  function handleFileUpload(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var result = parseCSV(ev.target.result);
      setData(result.data);
      setColumns(result.columns);
      autoDetect(result.data, result.columns);
    };
    reader.readAsText(file);
  }

  function loadSample() {
    var d = generateSampleData(156);
    var cols = Object.keys(d[0]);
    setData(d);
    setColumns(cols);
    autoDetect(d, cols);
  }

  function reinitAdstockParams(newType) {
    var ap = {};
    mediaCols.forEach(function(c) {
      var isLong = /tv|radio|print|linear|traditional/i.test(c);
      var oldSteps = (adstockParams[c] && adstockParams[c].steps) ? adstockParams[c].steps : 3;
      if (newType === "geometric") {
        ap[c] = isLong ? { thetaMin: 0.4, thetaMax: 0.8, steps: oldSteps } : { thetaMin: 0.1, thetaMax: 0.4, steps: oldSteps };
      } else if (newType === "weibull_cdf") {
        ap[c] = { shapeMin: 0.5, shapeMax: 2.0, scaleMin: 0.01, scaleMax: 0.1, steps: oldSteps };
      } else if (newType === "weibull_pdf") {
        ap[c] = { shapeMin: 0.5, shapeMax: 10.0, scaleMin: 0.01, scaleMax: 0.1, steps: oldSteps };
      } else if (newType === "binomial") {
        ap[c] = isLong ? { alphaMin: 0.3, alphaMax: 0.7, maxLagMin: 8, maxLagMax: 16, steps: oldSteps } : { alphaMin: 0.05, alphaMax: 0.3, maxLagMin: 4, maxLagMax: 10, steps: oldSteps };
      }
    });
    setAdstockParams(ap);
  }

  function reinitSatParams(newFunc) {
    var sp = {};
    mediaCols.forEach(function(c) {
      var oldSteps = (satParams[c] && satParams[c].steps) ? satParams[c].steps : 3;
      if (newFunc === "hill") {
        sp[c] = { alphaMin: 1.5, alphaMax: 3.0, gammaMin: 0.3, gammaMax: 0.7, steps: oldSteps };
      } else if (newFunc === "neg_exponential") {
        sp[c] = { alphaMin: 0.5, alphaMax: 2.0, betaMin: 0.5, betaMax: 5.0, steps: oldSteps };
      } else if (newFunc === "logarithmic") {
        sp[c] = { alphaMin: 0.5, alphaMax: 3.0, steps: oldSteps };
      } else if (newFunc === "power") {
        sp[c] = { alphaMin: 0.1, alphaMax: 1.0, steps: oldSteps };
      }
    });
    setSatParams(sp);
  }

  function autoDetect(d, cols) {
    var dateKw = ["date", "time", "period", "week"];
    var targetKw = ["revenue", "sales", "conversion", "kpi", "target"];
    var dmaKw = ["dma", "market", "geo", "region"];
    var spendKw = ["spend", "cost", "budget", "tv", "digital", "social", "search", "print", "radio", "display", "linear", "streaming", "video", "programmatic", "facebook", "instagram", "tiktok", "google", "bing", "newspaper", "magazine", "traditional", "podcast"];
    var orgKw = ["organic", "seo", "word_of_mouth", "wom", "email_list"];
    var ctxKw = ["holiday", "competitor", "confidence", "gdp", "temperature"];

    var dc = cols.find(function(c) { return dateKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });
    var tc = cols.filter(function(c) { return typeof d[0][c] === "number"; }).find(function(c) { return targetKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });
    var dmc = cols.find(function(c) { return dmaKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });
    var mc = cols.filter(function(c) { return typeof d[0][c] === "number" && c !== tc && spendKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });
    var oc = cols.filter(function(c) { return typeof d[0][c] === "number" && c !== tc && mc.indexOf(c) < 0 && orgKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });
    var cc = cols.filter(function(c) { return typeof d[0][c] === "number" && c !== tc && mc.indexOf(c) < 0 && oc.indexOf(c) < 0 && ctxKw.some(function(k) { return c.toLowerCase().indexOf(k) >= 0; }); });

    if (dc) setDateCol(dc);
    if (tc) setTargetCol(tc);
    if (dmc) {
      setDmaCol(dmc);
      var dmaVals = [];
      d.forEach(function(r) {
        var v = r[dmc];
        if (v && dmaVals.indexOf(v) < 0) dmaVals.push(v);
      });
      setAvailableDMAs(dmaVals.sort());
      setSelectedDMA("All");
    }
    setMediaCols(mc);
    setOrganicCols(oc);
    setContextCols(cc);

    var ap = {}, sp = {};
    mc.forEach(function(c) {
      var isLong = /tv|radio|print|linear|traditional/i.test(c);
      if (adstockType === "geometric") {
        if (isLong) {
          ap[c] = { thetaMin: 0.4, thetaMax: 0.8, steps: 3 };
        } else {
          ap[c] = { thetaMin: 0.1, thetaMax: 0.4, steps: 3 };
        }
      } else if (adstockType === "weibull_cdf") {
        ap[c] = { shapeMin: 0.5, shapeMax: 2.0, scaleMin: 0.01, scaleMax: 0.1, steps: 3 };
      } else if (adstockType === "weibull_pdf") {
        ap[c] = { shapeMin: 0.5, shapeMax: 10.0, scaleMin: 0.01, scaleMax: 0.1, steps: 3 };
      } else if (adstockType === "binomial") {
        if (isLong) {
          ap[c] = { alphaMin: 0.3, alphaMax: 0.7, maxLagMin: 8, maxLagMax: 16, steps: 3 };
        } else {
          ap[c] = { alphaMin: 0.05, alphaMax: 0.3, maxLagMin: 4, maxLagMax: 10, steps: 3 };
        }
      }
      if (satFunction === "hill") {
        sp[c] = { alphaMin: 1.5, alphaMax: 3.0, gammaMin: 0.3, gammaMax: 0.7, steps: 3 };
      } else if (satFunction === "neg_exponential") {
        sp[c] = { alphaMin: 0.5, alphaMax: 2.0, betaMin: 0.5, betaMax: 5.0, steps: 3 };
      } else if (satFunction === "logarithmic") {
        sp[c] = { alphaMin: 0.5, alphaMax: 3.0, steps: 3 };
      } else if (satFunction === "power") {
        sp[c] = { alphaMin: 0.1, alphaMax: 1.0, steps: 3 };
      }
    });
    setAdstockParams(ap);
    setSatParams(sp);
  }

  /* ── Grid generation ── */

  function pickFromGrid(lo, hi, steps) {
    var grid = linspace(lo, hi, steps);
    return grid[Math.floor(Math.random() * grid.length)];
  }

  function sampleAdstockForChannel(col) {
    var params = adstockParams[col] || {};
    var s = params.steps || gridSteps;
    if (adstockType === "geometric") {
      return { theta: pickFromGrid(params.thetaMin || 0.1, params.thetaMax || 0.7, s) };
    } else if (adstockType === "binomial") {
      return { alpha: pickFromGrid(params.alphaMin || 0.1, params.alphaMax || 0.5, s), maxLag: Math.round(pickFromGrid(params.maxLagMin || 4, params.maxLagMax || 12, s)) };
    } else {
      return { shape: pickFromGrid(params.shapeMin || 0.5, params.shapeMax || 2.0, s), scale: pickFromGrid(params.scaleMin || 0.01, params.scaleMax || 0.1, s) };
    }
  }

  function sampleSatForChannel(col) {
    var params = satParams[col] || {};
    var s = params.steps || gridSteps;
    if (satFunction === "hill") {
      return { alpha: pickFromGrid(params.alphaMin || 1.5, params.alphaMax || 3.0, s), gamma: pickFromGrid(params.gammaMin || 0.3, params.gammaMax || 0.7, s) };
    } else if (satFunction === "neg_exponential") {
      return { alpha: pickFromGrid(params.alphaMin || 0.5, params.alphaMax || 2.0, s), beta: pickFromGrid(params.betaMin || 0.5, params.betaMax || 5.0, s) };
    } else {
      return { alpha: pickFromGrid(params.alphaMin || 0.1, params.alphaMax || 1.0, s) };
    }
  }

  function generateGrid() {
    var combos = [];
    var nIter = maxIterations;

    for (var i = 0; i < nIter; i++) {
      var adstock = null;
      var sat = null;

      if (searchMode === "adstock" || searchMode === "both") {
        adstock = {};
        mediaCols.forEach(function(col) { adstock[col] = sampleAdstockForChannel(col); });
      }
      if (searchMode === "saturation" || searchMode === "both") {
        sat = {};
        mediaCols.forEach(function(col) { sat[col] = sampleSatForChannel(col); });
      }

      combos.push({ adstock: adstock, sat: sat });
    }

    return combos;
  }

  /* ── Single model runner ── */

  function runSingleModel(combo, callback, methodOverride, priorOverride) {
    try {
      var runMethod = methodOverride || modelingMethod;
      var runPriors = priorOverride || priorConfig;
      var allFeatures = mediaCols.concat(organicCols).concat(contextCols);
      var n = filteredData.length;
      var splitIdx = Math.floor(n * (1 - testPct / 100));

      var transformedData = filteredData.map(function(row) {
        var newRow = {};
        allFeatures.forEach(function(col) { newRow[col] = row[col] || 0; });
        return newRow;
      });

      mediaCols.forEach(function(col) {
        var raw = filteredData.map(function(r) { return r[col] || 0; });
        var adstocked = raw;
        if (adstockType === "geometric") {
          var ap = combo.adstock && combo.adstock[col] ? combo.adstock[col] : null;
          var theta = ap ? (ap.theta != null ? ap.theta : ap) : (adstockParams[col] ? adstockParams[col].thetaMin || 0.3 : 0.3);
          adstocked = geometricAdstock(raw, theta);
        } else if (adstockType === "weibull_cdf") {
          var ap = combo.adstock && combo.adstock[col] ? combo.adstock[col] : null;
          var shape = ap ? ap.shape || 1 : (adstockParams[col] ? adstockParams[col].shapeMin || 1 : 1);
          var scale = ap ? ap.scale || 0.05 : (adstockParams[col] ? adstockParams[col].scaleMin || 0.05 : 0.05);
          adstocked = weibullCdfAdstock(raw, shape, scale);
        } else if (adstockType === "weibull_pdf") {
          var ap = combo.adstock && combo.adstock[col] ? combo.adstock[col] : null;
          var shape = ap ? ap.shape || 1 : (adstockParams[col] ? adstockParams[col].shapeMin || 1 : 1);
          var scale = ap ? ap.scale || 0.05 : (adstockParams[col] ? adstockParams[col].scaleMin || 0.05 : 0.05);
          adstocked = weibullPdfAdstock(raw, shape, scale);
        } else if (adstockType === "binomial") {
          var ap = combo.adstock && combo.adstock[col] ? combo.adstock[col] : null;
          var bAlpha = ap ? ap.alpha || 0.2 : (adstockParams[col] ? adstockParams[col].alphaMin || 0.2 : 0.2);
          var bMaxLag = ap ? ap.maxLag || 8 : (adstockParams[col] ? adstockParams[col].maxLagMin || 8 : 8);
          adstocked = binomialAdstock(raw, bAlpha, bMaxLag);
        }
        var sp = combo.sat && combo.sat[col] ? combo.sat[col] : satParams[col];
        var saturated = adstocked;
        if (satFunction === "hill") {
          if (!sp) sp = { alphaMin: 1.5, gammaMin: 0.3 };
          var alpha = sp.alpha || sp.alphaMin || 2.0;
          var gamma = sp.gamma || sp.gammaMin || 0.5;
          saturated = hillSaturation(adstocked, alpha, gamma);
        } else if (satFunction === "neg_exponential") {
          if (!sp) sp = { alphaMin: 0.5, betaMin: 0.5 };
          var alpha = sp.alpha || sp.alphaMin || 1.0;
          var beta = sp.beta || sp.betaMin || 1.0;
          saturated = negExponentialSaturation(adstocked, alpha, beta);
        } else if (satFunction === "logarithmic") {
          if (!sp) sp = { alphaMin: 0.5 };
          var alpha = sp.alpha || sp.alphaMin || 1.0;
          saturated = logarithmicSaturation(adstocked, alpha);
        } else if (satFunction === "power") {
          if (!sp) sp = { alphaMin: 0.5 };
          var alpha = sp.alpha || sp.alphaMin || 0.5;
          saturated = powerSaturation(adstocked, alpha);
        }
        saturated.forEach(function(v, i) { transformedData[i][col] = v; });
      });

      var normStats = {};
      allFeatures.forEach(function(col) {
        var trainVals = transformedData.slice(0, splitIdx).map(function(r) { return r[col]; });
        var min = Math.min.apply(null, trainVals);
        var max = Math.max.apply(null, trainVals);
        var range = (max - min) || 1;
        normStats[col] = { min: min, max: max, range: range };
      });

      var X = transformedData.map(function(row) {
        return allFeatures.map(function(col) {
          var s2 = normStats[col];
          return Math.max(0, Math.min(1, (row[col] - s2.min) / s2.range));
        });
      });

      var y = filteredData.map(function(r) { return r[targetCol] || 0; });
      var Xtr = X.slice(0, splitIdx), Xte = X.slice(splitIdx);
      var ytr = y.slice(0, splitIdx), yte = y.slice(splitIdx);

      var bestBeta = null, bestLambda = 0, bestTestR2 = -Infinity;
      var usedMethod = runMethod;

      if (runMethod === "bayesian") {
        /* Bayesian MAP estimation (Meridian-style) */
        console.log("[MMM] Running Bayesian MAP for combo");
        var betaMAP = bayesianMAP(Xtr, ytr, mediaCols, runPriors);
        bestBeta = betaMAP;
        bestLambda = "MAP";
        /* Evaluate test R2 */
        var yM = 0; for (var ii = 0; ii < ytr.length; ii++) yM += ytr[ii]; yM /= ytr.length;
        var xM = allFeatures.map(function(_, j) { var ss = 0; for (var kk = 0; kk < Xtr.length; kk++) ss += Xtr[kk][j]; return ss / Xtr.length; });
        var intSum = 0; for (var ii2 = 0; ii2 < betaMAP.length; ii2++) intSum += betaMAP[ii2] * xM[ii2];
        var intcpt = yM - intSum;
        var preds = Xte.map(function(row) { var ss = intcpt; for (var ii3 = 0; ii3 < row.length; ii3++) ss += row[ii3] * betaMAP[ii3]; return ss; });
        bestTestR2 = computeMetrics(yte, preds).r2;
      } else {
        /* Ridge regression (Robyn-style) — try multiple lambda values */
        var lambdas = [0.01, 0.1, 0.5, 1.0, 5.0, 10.0, 50.0, 100.0];
        lambdas.forEach(function(lam) {
          var bTry = ridgeRegression(Xtr, ytr, lam);
          bTry = bTry.map(function(b, i) { return i < mediaCols.length ? Math.max(0, b) : b; });
          var yM = 0; for (var ii = 0; ii < ytr.length; ii++) yM += ytr[ii]; yM /= ytr.length;
          var xM = allFeatures.map(function(_, j) { var ss = 0; for (var kk = 0; kk < Xtr.length; kk++) ss += Xtr[kk][j]; return ss / Xtr.length; });
          var intSum = 0; for (var ii2 = 0; ii2 < bTry.length; ii2++) intSum += bTry[ii2] * xM[ii2];
          var intcpt = yM - intSum;
          var preds = Xte.map(function(row) { var ss = intcpt; for (var ii3 = 0; ii3 < row.length; ii3++) ss += row[ii3] * bTry[ii3]; return ss; });
          var m = computeMetrics(yte, preds);
          if (m.r2 > bestTestR2) { bestTestR2 = m.r2; bestBeta = bTry; bestLambda = lam; }
        });
      }
      var beta = bestBeta || ridgeRegression(Xtr, ytr, regAlpha);
      beta = beta.map(function(b, i) { return i < mediaCols.length ? Math.max(0, b) : b; });

      var yMean = 0; for (var i = 0; i < ytr.length; i++) yMean += ytr[i]; yMean /= ytr.length;
      var xMeans = allFeatures.map(function(_, j) {
        var sum = 0; for (var k = 0; k < Xtr.length; k++) sum += Xtr[k][j]; return sum / Xtr.length;
      });
      var interceptSum = 0; for (var i2 = 0; i2 < beta.length; i2++) interceptSum += beta[i2] * xMeans[i2];
      var intercept = yMean - interceptSum;

      function predict(Xm) {
        return Xm.map(function(row) {
          var sum = intercept;
          for (var i3 = 0; i3 < row.length; i3++) sum += row[i3] * beta[i3];
          return sum;
        });
      }
      var ytrPred = predict(Xtr);
      var ytePred = predict(Xte);

      var trainMetrics = computeMetrics(ytr, ytrPred);
      var testMetrics = computeMetrics(yte, ytePred);

      var contributions = {};
      var totalContrib = 0;
      allFeatures.forEach(function(col, j) {
        var c = beta[j] * xMeans[j];
        contributions[col] = c;
        totalContrib += c;
      });
      contributions["base (intercept)"] = intercept;
      totalContrib += intercept;

      var contribPct = {};
      Object.keys(contributions).forEach(function(k) {
        contribPct[k] = totalContrib !== 0 ? (contributions[k] / totalContrib * 100) : 0;
      });

      var mediaOnlyTotal = 0;
      mediaCols.forEach(function(c) { mediaOnlyTotal += (contributions[c] || 0); });
      var mediaSharePct = {};
      mediaCols.forEach(function(c) {
        mediaSharePct[c] = mediaOnlyTotal > 0 ? (contributions[c] / mediaOnlyTotal * 100) : 0;
      });

      var responseCurves = {};
      mediaCols.forEach(function(col, idx) {
        var raw = filteredData.map(function(r) { return r[col] || 0; });
        var maxSpend = Math.max.apply(null, raw) * 1.5 || 1;
        var points = [];
        for (var ss = 0; ss <= 50; ss++) {
          var spend = (ss / 50) * maxSpend;
          var spendArr = [spend];
          var adstockedArr = spendArr;
          var ap = combo.adstock && combo.adstock[col] ? combo.adstock[col] : null;
          if (adstockType === "geometric") {
            var th = ap ? (ap.theta != null ? ap.theta : ap) : (adstockParams[col] ? adstockParams[col].thetaMin || 0.3 : 0.3);
            adstockedArr = [spend * (1 + th)];
          } else if (adstockType === "weibull_cdf") {
            var sh = ap ? ap.shape || 1 : (adstockParams[col] ? adstockParams[col].shapeMin || 1 : 1);
            adstockedArr = [spend * (1 + weibullCDF(1, sh, 1))];
          } else if (adstockType === "weibull_pdf") {
            var sh = ap ? ap.shape || 1 : (adstockParams[col] ? adstockParams[col].shapeMin || 1 : 1);
            adstockedArr = [spend * (1 + sh * 0.1)];
          } else if (adstockType === "binomial") {
            var bA = ap ? ap.alpha || 0.2 : 0.2;
            var bL = ap ? ap.maxLag || 8 : 8;
            /* Steady state multiplier for binomial: sum of weights is 1, but carryover accumulates */
            adstockedArr = [spend * (1 + bA * bL * 0.15)];
          }
          var maxAd = maxSpend * (adstockedArr[0] / (spend || 1) || 1);
          var norm = maxAd > 0 ? adstockedArr[0] / maxAd : 0;
          var satVal = 0;
          var sp2 = combo.sat && combo.sat[col] ? combo.sat[col] : (satParams[col] || {});
          if (satFunction === "hill") {
            var a = sp2.alpha || sp2.alphaMin || 2.0;
            var g = sp2.gamma || sp2.gammaMin || 0.5;
            satVal = norm > 0 ? 1 - 1 / (1 + Math.pow(norm / g, a)) : 0;
          } else if (satFunction === "neg_exponential") {
            var a = sp2.alpha || sp2.alphaMin || 1.0;
            var b = sp2.beta || sp2.betaMin || 1.0;
            satVal = a * (1 - Math.exp(-b * norm));
          } else if (satFunction === "logarithmic") {
            var a = sp2.alpha || sp2.alphaMin || 1.0;
            satVal = a * Math.log(1 + norm);
          } else if (satFunction === "power") {
            var a = sp2.alpha || sp2.alphaMin || 0.5;
            satVal = norm > 0 ? Math.pow(norm, a) : 0;
          }
          var response = satVal * beta[idx];
          points.push({ spend: Math.round(spend), response: Math.round(response) });
        }
        responseCurves[col] = points;
      });

      var ba = {};
      mediaCols.forEach(function(col) {
        var sum = 0; filteredData.forEach(function(r) { sum += (r[col] || 0); }); ba[col] = Math.round(sum / n);
      });

      /* DECOMP.RSSD: measures how well model decomposition matches spend shares */
      var decompRssd = computeDecompRSSD(mediaSharePct, mediaCols, contributions, filteredData);

      /* Business sense checks */
      var negBetaCount = 0;
      mediaCols.forEach(function(c, j) { if (beta[j] < 0) negBetaCount++; });
      var maxContribPct = 0;
      mediaCols.forEach(function(c) { if ((contribPct[c] || 0) > maxContribPct) maxContribPct = contribPct[c] || 0; });
      var overfitGap = trainMetrics.r2 - testMetrics.r2;

      /* Composite score for Pareto ranking (lower = better) */
      var modelScore = computeModelScore(testMetrics.nrmse, decompRssd);

      var result = {
        beta: beta, intercept: intercept, featureNames: allFeatures, normStats: normStats,
        trainMetrics: trainMetrics, testMetrics: testMetrics, ytr: ytr, yte: yte, ytrPred: ytrPred, ytePred: ytePred,
        splitIdx: splitIdx, contribPct: contribPct, contributions: contributions, mediaSharePct: mediaSharePct,
        responseCurves: responseCurves, dates: filteredData.map(function(r) { return r[dateCol] || ""; }), xMeans: xMeans,
        combo: combo, budgetAlloc: ba,
        /* New metrics for Pareto ranking */
        decompRssd: decompRssd, modelScore: modelScore, ridgeLambda: bestLambda,
        negBetaCount: negBetaCount, maxContribPct: maxContribPct, overfitGap: overfitGap,
        method: usedMethod
      };

      if (callback) callback(result);
      return result;
    } catch (err) {
      console.error("[MMM] runSingleModel error (method=" + runMethod + "):", err.message || err);
      if (callback) callback(null);
      return null;
    }
  }

  /* ── Grid search training ── */

  function trainModel() {
    try {
      /* Snapshot current method & priors at call time to avoid stale closures in setTimeout */
      var snapMethod = modelingMethod;
      var snapPriors = Object.assign({}, priorConfig);
      console.log("[MMM] trainModel called with method:", snapMethod);

      setTrainError(null);
      setIsTraining(true);
      setModelResult(null);
      setGridResults([]);
      setSelectedModelIdx(null);

      var allFeatures = mediaCols.concat(organicCols).concat(contextCols);
      if (!allFeatures.length) throw new Error("No features selected");
      if (!targetCol) throw new Error("No target column selected");

      var n = filteredData.length;
      var splitIdx = Math.floor(n * (1 - testPct / 100));
      if (splitIdx < 10) throw new Error("Not enough training data");

      var combos = generateGrid();
      var totalCombos = combos.length;
      var results = [];

      /* Pre-compute X_global and y_global for bootstrap/CV after grid search */
      var X_global = null, y_global = null;
      try {
        var allFeatGlobal = mediaCols.concat(organicCols).concat(contextCols);
        var tdGlobal = filteredData.map(function(row) {
          return allFeatGlobal.map(function(col) { return row[col] || 0; });
        });
        /* Simple min-max normalize */
        var nStatsG = allFeatGlobal.map(function(col, j) {
          var vals = tdGlobal.map(function(r) { return r[j]; });
          var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
          return { min: mn, range: (mx - mn) || 1 };
        });
        X_global = tdGlobal.map(function(row) {
          return row.map(function(v, j) { return Math.max(0, Math.min(1, (v - nStatsG[j].min) / nStatsG[j].range)); });
        });
        y_global = filteredData.map(function(r) { return r[targetCol] || 0; });
      } catch(e) { /* if it fails, bootstrap/cv just won't run */ }

      function processNext(idx) {
        if (idx >= totalCombos) {
          /* Sort by composite Pareto score (lower = better) — balances fit quality
             (NRMSE) with business sense (DECOMP.RSSD), like Robyn does. */
          results.sort(function(a, b) { return (a.modelScore || 1) - (b.modelScore || 1); });
          setGridResults(results);
          setSelectedModelIdx(0);
          if (results.length > 0) {
            setModelResult(results[0]);
            setBudgetAlloc(results[0].budgetAlloc);
            var bTot = 0; Object.values(results[0].budgetAlloc).forEach(function(v) { bTot += v; }); setTargetBudget(bTot);

            /* Run bootstrap CI on best model if enabled */
            if (runBootstrap && results[0]) {
              try {
                var bestR = results[0];
                var ciResult = bootstrapCI(
                  X_global, y_global, mediaCols.length,
                  snapMethod, snapPriors, nBootstrap, 0.05
                );
                setBootstrapResults(ciResult);
              } catch(e) { setBootstrapResults(null); }
            }

            /* Run expanding window CV if enabled */
            if (runCV) {
              try {
                var cvResult = expandingWindowCV(
                  X_global, y_global, mediaCols.length, nCVFolds,
                  snapMethod, snapPriors, regAlpha
                );
                setCvResults(cvResult);
              } catch(e) { setCvResults(null); }
            }
          }
          setIsTraining(false);
          return;
        }

        setGridProgress({ current: idx + 1, total: totalCombos });
        var result = runSingleModel(combos[idx], null, snapMethod, snapPriors);
        if (result) results.push(result);

        setTimeout(function() { processNext(idx + 1); }, 0);
      }

      processNext(0);
    } catch (err) {
      setTrainError(err.message || "Unknown error during training");
      setIsTraining(false);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     BUDGET OPTIMIZER — derived directly from the trained MMM

     Revenue = intercept + Σ_j  beta[j] * norm( sat( adstock( spend_j ) ) )
              + Σ_k  beta[k] * xMean[k]   (non-media at training means)

     Three modes:
       1. Maximize Revenue: given total budget + per-channel min/max
       2. Hit Revenue Target: find minimum budget for target revenue
       3. Scenario Curve: revenue at multiple budget levels
     ══════════════════════════════════════════════════════════════ */

  function getChannelParams(col) {
    var combo = modelResult ? modelResult.combo : {};
    var ap = (combo && combo.adstock && combo.adstock[col]) ? combo.adstock[col] : null;
    var sp = (combo && combo.sat && combo.sat[col]) ? combo.sat[col] : (satParams[col] || {});
    var ns = (modelResult && modelResult.normStats && modelResult.normStats[col]) ? modelResult.normStats[col] : { min: 0, range: 1 };
    var idx = mediaCols.indexOf(col);
    var b = (modelResult && idx >= 0) ? modelResult.beta[idx] : 0;
    return { ap: ap, sp: sp, ns: ns, beta: b, idx: idx };
  }

  /* Reference max: the max of adstocked raw spend in training data.
     This is what the saturation function normalizes by during training. */
  function getTrainRefMax(col) {
    if (!filteredData || !modelResult) return 1;
    var combo = modelResult.combo || {};
    var ap = (combo.adstock && combo.adstock[col]) ? combo.adstock[col] : null;
    var rawSpend = filteredData.map(function(r) { return r[col] || 0; });
    /* Apply adstock to full series to get adstocked values */
    var adstocked;
    if (adstockType === "geometric") {
      var theta = ap ? (ap.theta != null ? ap.theta : 0.3) : 0.3;
      adstocked = []; var carry = 0;
      for (var i = 0; i < rawSpend.length; i++) {
        carry = rawSpend[i] + theta * carry;
        adstocked.push(carry);
      }
    } else if (adstockType === "weibull_cdf") {
      var sh = ap ? ap.shape || 1 : 1;
      var sc = ap ? ap.scale || 0.05 : 0.05;
      var maxL = 8; var wts = [];
      for (var t = 0; t < maxL; t++) { wts.push(1 - Math.exp(-Math.pow(t * sc, sh))); }
      adstocked = [];
      for (var i2 = 0; i2 < rawSpend.length; i2++) {
        var s2 = 0; for (var l = 0; l < maxL && i2 - l >= 0; l++) { s2 += rawSpend[i2 - l] * (l === 0 ? 1 : wts[l]); }
        adstocked.push(s2);
      }
    } else if (adstockType === "binomial") {
      var bAlpha = ap ? ap.alpha || 0.2 : 0.2;
      var bMaxLag = ap ? ap.maxLag || 8 : 8;
      adstocked = binomialAdstock(rawSpend, bAlpha, bMaxLag);
    } else {
      var sh2 = ap ? ap.shape || 1 : 1;
      var sc2 = ap ? ap.scale || 0.05 : 0.05;
      var maxL2 = 8; var wts2 = [];
      for (var t2 = 0; t2 < maxL2; t2++) {
        var val = t2 === 0 ? 1 : (sh2 / sc2) * Math.pow(t2 / sc2, sh2 - 1) * Math.exp(-Math.pow(t2 / sc2, sh2));
        wts2.push(val);
      }
      adstocked = [];
      for (var i3 = 0; i3 < rawSpend.length; i3++) {
        var s3 = 0; for (var l2 = 0; l2 < maxL2 && i3 - l2 >= 0; l2++) { s3 += rawSpend[i3 - l2] * wts2[l2]; }
        adstocked.push(s3);
      }
    }
    var mx = 0;
    for (var k = 0; k < adstocked.length; k++) { if (adstocked[k] > mx) mx = adstocked[k]; }
    return mx || 1;
  }

  /* f_j(spend): channel contribution to weekly revenue.
     Replicates the training pipeline for one spend value.

     Training does: raw → adstock(series) → saturation(series) → minmax_normalize → ridge
     For optimizer we approximate: spend → adstock_steady_state → saturation → scale_to_model

     Key insight: the saturation functions (Hill, NegExp, etc.) already normalize
     by max(adstocked_training_data). So we pass adVal/refMax as normInput.
     The saturation output then maps naturally to the model's learned scale.
     We use normStats to translate saturation output to the model's feature scale,
     but with a SOFT ceiling instead of hard [0,1] clamp, so marginal returns
     smoothly approach zero rather than hitting a hard wall. */
  function channelResponse(col, spend) {
    if (!modelResult) return 0;
    var p = getChannelParams(col);
    if (p.idx < 0) return 0;
    if (spend <= 0) return 0;

    /* Step 1: Adstock steady-state for weekly spend */
    var adVal = spend;
    if (adstockType === "geometric") {
      var th = p.ap ? (p.ap.theta != null ? p.ap.theta : 0.3) : 0.3;
      adVal = spend / Math.max(0.01, 1 - th);
    } else if (adstockType === "weibull_cdf") {
      var sh = p.ap ? p.ap.shape || 1 : 1;
      var sc = p.ap ? p.ap.scale || 0.05 : 0.05;
      adVal = spend * (1 + sh * sc * 5);
    } else if (adstockType === "weibull_pdf") {
      var sh2 = p.ap ? p.ap.shape || 1 : 1;
      var sc2 = p.ap ? p.ap.scale || 0.05 : 0.05;
      adVal = spend * (1 + sh2 * sc2 * 3);
    } else if (adstockType === "binomial") {
      var bA = p.ap ? p.ap.alpha || 0.2 : 0.2;
      var bL = p.ap ? p.ap.maxLag || 8 : 8;
      adVal = spend * (1 + bA * bL * 0.15);
    }

    /* Step 2: Saturation — normalize by training reference max, then apply curve */
    var refMax = getTrainRefMax(col);
    var normInput = refMax > 0 ? adVal / refMax : 0;
    normInput = Math.max(0, normInput);

    var satVal = 0;
    if (satFunction === "hill") {
      var a = p.sp.alpha || p.sp.alphaMin || 2.0;
      var g = p.sp.gamma || p.sp.gammaMin || 0.5;
      satVal = normInput > 0 ? 1 - 1 / (1 + Math.pow(normInput / g, a)) : 0;
    } else if (satFunction === "neg_exponential") {
      var a2 = p.sp.alpha || p.sp.alphaMin || 1.0;
      var bta = p.sp.beta || p.sp.betaMin || 1.0;
      satVal = a2 * (1 - Math.exp(-bta * normInput));
    } else if (satFunction === "logarithmic") {
      var a3 = p.sp.alpha || p.sp.alphaMin || 1.0;
      satVal = a3 * Math.log(1 + normInput);
    } else if (satFunction === "power") {
      var a4 = p.sp.alpha || p.sp.alphaMin || 0.5;
      satVal = normInput > 0 ? Math.pow(normInput, a4) : 0;
    }

    /* Step 3: Scale to model feature space.
       Training used hard [0,1] clamp but for the optimizer we use a soft ceiling:
       - Below training min → smoothly approaches 0 (not hard clamp)
       - Above training max → logarithmic diminishing returns (not flat zero)
       This preserves meaningful MROI gradients at all spend levels. */
    var raw = (satVal - p.ns.min) / (p.ns.range || 1);
    var normalized;
    if (raw <= 0) {
      /* Below training min: allow small positive contribution that grows from 0 */
      normalized = Math.max(0, raw * 0.1 + 0.01 * satVal);
    } else if (raw <= 1) {
      /* In-distribution: use directly */
      normalized = raw;
    } else {
      /* Above training max: soft ceiling with log diminishing returns */
      normalized = 1.0 + 0.1 * Math.log(raw);
    }
    normalized = Math.max(0, normalized);

    /* Step 4: Multiply by beta */
    return normalized * p.beta;
  }

  /* Baseline: intercept + non-media contributions at training means */
  function baselineRevenue() {
    if (!modelResult) return 0;
    var base = modelResult.intercept || 0;
    var nonMediaCols = organicCols.concat(contextCols);
    nonMediaCols.forEach(function(col) {
      var idx2 = modelResult.featureNames ? modelResult.featureNames.indexOf(col) : -1;
      if (idx2 >= 0 && modelResult.xMeans && modelResult.beta) {
        base += modelResult.xMeans[idx2] * modelResult.beta[idx2];
      }
    });
    return base;
  }

  /* Predict total revenue for a budget allocation */
  var simulateBudget = useCallback(function(alloc) {
    if (!modelResult) return {};
    var responses = {};
    var mediaTotal = 0;
    mediaCols.forEach(function(col) {
      var resp = channelResponse(col, alloc[col] || 0);
      responses[col] = resp;
      mediaTotal += resp;
    });
    var total = baselineRevenue() + mediaTotal;
    responses.total = total;
    responses.mediaTotal = mediaTotal;
    responses.baseline = baselineRevenue();
    return responses;
  }, [modelResult, mediaCols, organicCols, contextCols, satParams, adstockType, satFunction, filteredData]);

  /* Marginal ROI: ∂f_j/∂spend_j */
  function computeMROI(col, spend) {
    var delta = Math.max(10, spend * 0.01);
    var r1 = channelResponse(col, spend);
    var r2 = channelResponse(col, spend + delta);
    return (r2 - r1) / delta;
  }

  /* ── Mode 1: Maximize Revenue given total budget + per-channel bounds ── */
  function optimizeBudget(totalB, bounds) {
    if (!modelResult || mediaCols.length === 0) return {};
    var bnds = bounds || {};
    var alloc = {};

    /* Compute effective min/max per channel */
    var effMin = {}, effMax = {};
    var sumMin = 0;
    mediaCols.forEach(function(col) {
      var b = bnds[col] || {};
      effMin[col] = b.min != null ? b.min : 0;
      effMax[col] = b.max != null ? b.max : totalB;
      sumMin += effMin[col];
    });

    /* Initialize from CURRENT allocation proportions (not equal split).
       This keeps us near the training distribution where the model has
       meaningful gradients, then the optimizer refines from there. */
    var curTotInit = 0;
    mediaCols.forEach(function(col) {
      var sum = 0;
      if (filteredData) filteredData.forEach(function(r) { sum += (r[col] || 0); });
      var avg = filteredData ? sum / filteredData.length : 1;
      alloc[col] = avg;
      curTotInit += avg;
    });
    /* Scale proportionally to target budget, then clamp to bounds */
    var scale = curTotInit > 0 ? totalB / curTotInit : 1;
    mediaCols.forEach(function(col) {
      alloc[col] = Math.max(effMin[col], Math.min(effMax[col], alloc[col] * scale));
    });
    /* If bounds prevent exact budget, redistribute remainder */
    var initSum = 0;
    mediaCols.forEach(function(col) { initSum += alloc[col]; });
    var slack = totalB - initSum;
    if (Math.abs(slack) > 1) {
      var sortedByMroi = mediaCols.slice().sort(function(a, b) { return computeMROI(b, alloc[b]) - computeMROI(a, alloc[a]); });
      for (var ri = 0; ri < sortedByMroi.length && Math.abs(slack) > 1; ri++) {
        var rc = sortedByMroi[ri];
        if (slack > 0) {
          var room = effMax[rc] - alloc[rc];
          var add = Math.min(slack, room);
          alloc[rc] += add; slack -= add;
        } else {
          var room2 = alloc[rc] - effMin[rc];
          var sub = Math.min(-slack, room2);
          alloc[rc] -= sub; slack += sub;
        }
      }
    }

    /* Iterative equimarginal rebalancing respecting bounds.
       Uses adaptive shift size: starts larger for faster convergence,
       shrinks as MROIs converge. */
    var baseShift = totalB * 0.01;
    for (var iter = 0; iter < 800; iter++) {
      var mrois = [];
      mediaCols.forEach(function(col) {
        mrois.push({ col: col, mroi: computeMROI(col, alloc[col]), canUp: alloc[col] < effMax[col] - 1, canDown: alloc[col] > effMin[col] + 1 });
      });
      mrois.sort(function(a, b) { return b.mroi - a.mroi; });

      /* Find best channel that can receive and worst that can give */
      var best = null, worst = null;
      for (var bi = 0; bi < mrois.length; bi++) { if (mrois[bi].canUp) { best = mrois[bi]; break; } }
      for (var wi = mrois.length - 1; wi >= 0; wi--) { if (mrois[wi].canDown && mrois[wi].mroi < (best ? best.mroi : Infinity)) { worst = mrois[wi]; break; } }
      if (!best || !worst || best.col === worst.col) break;

      var gap = best.mroi - worst.mroi;
      var avgM = (Math.abs(best.mroi) + Math.abs(worst.mroi)) / 2;
      if (avgM > 0 && gap / avgM < 0.005) break;

      /* Adaptive shift: larger early, smaller as MROIs converge */
      var convergeFactor = avgM > 0 ? Math.min(1, gap / avgM) : 0.5;
      var maxShiftUp = effMax[best.col] - alloc[best.col];
      var maxShiftDown = alloc[worst.col] - effMin[worst.col];
      var shift = Math.max(10, Math.min(baseShift * convergeFactor, maxShiftUp * 0.3, maxShiftDown * 0.3));
      alloc[worst.col] -= shift;
      alloc[best.col] += shift;

      /* Decay the base shift size for finer tuning */
      if (iter > 0 && iter % 100 === 0) baseShift *= 0.7;
    }

    /* Enforce budget constraint: round and fix */
    var result = {};
    mediaCols.forEach(function(col) {
      result[col] = Math.max(effMin[col], Math.min(effMax[col], Math.round(alloc[col])));
    });
    var allocated = 0;
    mediaCols.forEach(function(col) { allocated += result[col]; });
    var diff = Math.round(totalB) - allocated;
    if (diff !== 0) {
      /* Distribute diff among channels that have room */
      var sorted = mediaCols.slice().sort(function(a, b) { return computeMROI(b, result[b]) - computeMROI(a, result[a]); });
      for (var di = 0; di < sorted.length && diff !== 0; di++) {
        var c2 = sorted[di];
        var canAdd = diff > 0 ? (effMax[c2] - result[c2]) : -(result[c2] - effMin[c2]);
        var addAmt = diff > 0 ? Math.min(diff, canAdd) : Math.max(diff, canAdd);
        result[c2] += addAmt;
        diff -= addAmt;
      }
    }
    return result;
  }

  /* ── Mode 2: Find minimum budget to hit a revenue target ── */
  function optimizeForTarget(revTarget, bounds) {
    if (!modelResult) return { budget: 0, alloc: {} };
    /* Binary search over total budget */
    var lo = 0;
    var hi = 0;
    mediaCols.forEach(function(col) { var raw = filteredData.map(function(r) { return r[col] || 0; }); var mx = Math.max.apply(null, raw); hi += mx * 3; });
    hi = Math.max(hi, 100000);

    var bestAlloc = {};
    var bestBudget = hi;
    for (var s = 0; s < 40; s++) {
      var mid = (lo + hi) / 2;
      var alloc = optimizeBudget(mid, bounds);
      var resp = simulateBudget(alloc);
      if (resp.total >= revTarget) {
        bestAlloc = alloc;
        bestBudget = mid;
        hi = mid;
      } else {
        lo = mid;
      }
      if (hi - lo < 100) break;
    }
    return { budget: Math.round(bestBudget), alloc: bestAlloc };
  }

  /* ── Mode 3: Scenario curve at multiple budget levels ── */
  function generateScenarioCurve(bounds) {
    var results = [];
    var curTot = 0;
    mediaCols.forEach(function(col) { var s = 0; if (filteredData) filteredData.forEach(function(r) { s += (r[col] || 0); }); curTot += s / (filteredData ? filteredData.length : 1); });
    var mults = [0.5, 0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];
    mults.forEach(function(mult) {
      var tb = Math.round(curTot * mult);
      var alloc = optimizeBudget(tb, bounds);
      var resp = simulateBudget(alloc);
      results.push({ mult: mult, budget: tb, alloc: alloc, revenue: resp.total, mediaRev: resp.mediaTotal || 0 });
    });
    return results;
  }

  function toggleCol(col, list, setter, otherSetters) {
    if (list.indexOf(col) >= 0) {
      setter(list.filter(function(c) { return c !== col; }));
    } else {
      otherSetters.forEach(function(fn) { fn(function(prev) { return prev.filter(function(c) { return c !== col; }); }); });
      setter(list.concat([col]));
    }
  }

  function corrColor(v) {
    var abs = Math.min(Math.abs(v), 1);
    return v > 0 ? "rgba(37,99,235," + (abs * 0.85) + ")" : "rgba(220,38,38," + (abs * 0.85) + ")";
  }

  // Budget optimizer values
  var currentAlloc = {};
  if (filteredData && mediaCols.length) {
    mediaCols.forEach(function(col) { var sum = 0; filteredData.forEach(function(r) { sum += (r[col] || 0); }); currentAlloc[col] = Math.round(sum / filteredData.length); });
  }
  var currentResponse = modelResult ? simulateBudget(currentAlloc) : {};
  var scenarioResponse = modelResult ? simulateBudget(budgetAlloc) : {};
  var totalBudget = 0; Object.values(budgetAlloc).forEach(function(v) { totalBudget += v; });
  var currentTotal = 0; Object.values(currentAlloc).forEach(function(v) { currentTotal += v; });
  var respChange = currentResponse.total > 0 ? ((scenarioResponse.total - currentResponse.total) / currentResponse.total * 100) : 0;

  var mroiData = useMemo(function() {
    if (!modelResult) return [];
    return mediaCols.map(function(col) {
      var spend = budgetAlloc[col] || currentAlloc[col] || 1;
      var mroi = computeMROI(col, spend);
      var totalResp = channelResponse(col, spend);
      var avgROI = spend > 0 ? totalResp / spend : 0;
      return { channel: col, spend: spend, mroi: mroi, avgROI: avgROI, response: totalResp };
    }).sort(function(a, b) { return b.mroi - a.mroi; });
  }, [modelResult, budgetAlloc, currentAlloc, mediaCols]);

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e40af", margin: 0 }}>Marketing Mix Modeling Tool</h1>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Powered by Meta Robyn + Google Meridian methodologies</p>
          <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 0", fontWeight: 600 }}>Built by Ronak Vijayvergia</p>
        </div>
        {filteredData && <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "4px 8px", borderRadius: 4 }}>{filteredData.length} rows | {mediaCols.length} media channels</span>}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {/* Step Nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, background: "white", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 12, overflowX: "auto", gap: 4 }}>
          {stepsList.map(function(s, i) {
            var Icon = s.icon;
            var isActive = step === i;
            var isDone = i < step;
            return (
              <button key={i} onClick={function() { setStep(i); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8,
                  fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                  background: isActive ? "#2563eb" : isDone ? "#f0fdf4" : "transparent",
                  color: isActive ? "white" : isDone ? "#15803d" : "#9ca3af"
                }}>
                {isDone ? <Check size={14} /> : <Icon size={14} />}
                {" "}{s.name}
              </button>
            );
          })}
        </div>

        {/* DMA Filter Bar */}
        {dmaCol && availableDMAs.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: "white", borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", overflowX: "auto" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" }}>DMA:</span>
            {["All"].concat(availableDMAs).map(function(dma) {
              return (
                <button key={dma} onClick={function() { setSelectedDMA(dma); }}
                  style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                    background: selectedDMA === dma ? "#2563eb" : "#f1f5f9",
                    color: selectedDMA === dma ? "white" : "#6b7280",
                    whiteSpace: "nowrap" }}>
                  {dma.replace(/_/g, " ")}
                </button>
              );
            })}
            {selectedDMA !== "All" && <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{filteredData ? filteredData.length : 0} rows</span>}
          </div>
        )}

        {/* ── STEP 0: UPLOAD ── */}
        {step === 0 && (
          <div>
            <Card title="Upload Your Data">
              <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>Upload a CSV file with your marketing data, or load sample data to explore the tool.</p>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label style={{ flex: 1, minWidth: 240, border: "2px dashed #93c5fd", borderRadius: 12, padding: 32, textAlign: "center", cursor: "pointer" }}>
                  <Upload size={32} style={{ color: "#60a5fa", display: "block", margin: "0 auto 8px" }} />
                  <div style={{ color: "#2563eb", fontWeight: 500 }}>Click to upload CSV</div>
                  <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>Supports .csv files</div>
                  <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileUpload} />
                </label>
                <div style={{ display: "flex", alignItems: "center" }}><span style={{ color: "#d1d5db", fontSize: 13 }}>OR</span></div>
                <button onClick={loadSample}
                  style={{ flex: 1, minWidth: 240, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", border: "none", borderRadius: 12, padding: 32, textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>Load Sample Dataset</div>
                  <div style={{ color: "#93c5fd", fontSize: 12, marginTop: 4 }}>156 weeks, 5 DMAs, 12 sub-channels</div>
                </button>
              </div>
            </Card>
            {data && (
              <div>
              <Card title="Data Preview">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <MetricBox label="Rows" value={data.length} />
                  <MetricBox label="Columns" value={columns.length} />
                  <MetricBox label="Numeric" value={numericCols.length} />
                </div>
                <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead><tr style={{ background: "#f8fafc" }}>
                      {columns.slice(0, 8).map(function(c) { return <th key={c} style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 500, fontSize: 11 }}>{c}</th>; })}
                      {columns.length > 8 && <th style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 11 }}>+{columns.length - 8}</th>}
                    </tr></thead>
                    <tbody>
                      {data.slice(0, 5).map(function(row, i) {
                        return (
                          <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                            {columns.slice(0, 8).map(function(c) { return <td key={c} style={{ padding: "6px 12px", color: "#475569", fontSize: 11 }}>{typeof row[c] === "number" ? row[c].toLocaleString() : row[c]}</td>; })}
                            {columns.length > 8 && <td style={{ padding: "6px 12px", color: "#94a3b8" }}>...</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={function() { setStep(1); }} style={{ marginTop: 16, background: "#2563eb", color: "white", border: "none", padding: "10px 24px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                  Continue to Variable Mapping <ChevronRight size={14} />
                </button>
              </Card>

              {dataValidation && (
                <Card title="Data Validation Report">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                    <div style={{ padding: 12, borderRadius: 8, backgroundColor: dataValidation.qualityScore === "Good" ? "#dcfce7" : dataValidation.qualityScore === "Fair" ? "#fef3c7" : "#fee2e2" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Quality</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: dataValidation.qualityScore === "Good" ? "#16a34a" : dataValidation.qualityScore === "Fair" ? "#d97706" : "#dc2626" }}>{dataValidation.qualityScore}</div>
                    </div>
                    <MetricBox label="Issues Found" value={dataValidation.totalIssues} color={dataValidation.totalIssues === 0 ? "green" : "blue"} />
                    <MetricBox label="Missing Cols" value={Object.keys(dataValidation.missingByCol).filter(function(c) { return dataValidation.missingByCol[c].pct > 5; }).length} />
                    <MetricBox label="Outlier Cols" value={Object.keys(dataValidation.outliersByCol).filter(function(c) { return dataValidation.outliersByCol[c].pct > 5; }).length} />
                  </div>

                  <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: dataValidation.dateGaps.length === 0 ? "#16a34a" : "#dc2626" }}>
                      {dataValidation.dateGaps.length === 0 ? "✓ Date continuity OK" : "⚠ " + dataValidation.dateGaps.length + " date gap(s) detected"}
                    </div>
                    {dataValidation.dateGaps.length > 0 && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                        {dataValidation.dateGaps.slice(0, 3).map(function(gap, idx) {
                          return <div key={idx} style={{ marginBottom: 2 }}>{gap.from} → {gap.to} ({gap.gap} days)</div>;
                        })}
                        {dataValidation.dateGaps.length > 3 && <div>+{dataValidation.dateGaps.length - 3} more</div>}
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Per-Column Details</div>
                  <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #e5e7eb", maxHeight: 260, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead><tr style={{ backgroundColor: "#f9fafb", position: "sticky", top: 0 }}>
                        <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>COLUMN</th>
                        <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>MISSING #</th>
                        <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>MISSING %</th>
                        <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>OUTLIERS #</th>
                        <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>OUTLIERS %</th>
                        <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>ZERO %</th>
                      </tr></thead>
                      <tbody>
                        {columns.map(function(col, idx) {
                          var mInfo = dataValidation.missingByCol[col] || { count: 0, pct: 0 };
                          var oInfo = dataValidation.outliersByCol[col] || { count: 0, pct: 0 };
                          var zInfo = dataValidation.zeroSpendByCol[col] || { count: 0, pct: 0 };
                          var flagged = mInfo.pct > 5 || oInfo.pct > 5 || zInfo.pct > 30;
                          return (
                            <tr key={col} style={{ borderTop: "1px solid #f1f5f9", backgroundColor: flagged ? "#fef3c7" : idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                              <td style={{ padding: "6px 10px", fontWeight: 500, color: "#1f2937" }}>{col}{flagged && <span style={{ color: "#dc2626", marginLeft: 4 }}>⚠</span>}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: "#4b5563" }}>{mInfo.count}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: mInfo.pct > 5 ? "#dc2626" : "#4b5563", fontWeight: mInfo.pct > 5 ? 600 : 400 }}>{mInfo.pct.toFixed(1)}%</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: "#4b5563" }}>{oInfo.count}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: oInfo.pct > 5 ? "#dc2626" : "#4b5563", fontWeight: oInfo.pct > 5 ? 600 : 400 }}>{oInfo.pct.toFixed(1)}%</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: zInfo.pct > 30 ? "#dc2626" : "#4b5563", fontWeight: zInfo.pct > 30 ? 600 : 400 }}>{zInfo.pct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {dataValidation.flaggedCols.length > 0 && (
                    <div style={{ marginTop: 12, padding: 10, backgroundColor: "#fef3c7", borderRadius: 6, borderLeft: "4px solid #f59e0b" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Flagged Issues</div>
                      {dataValidation.flaggedCols.map(function(col, idx) {
                        var mI = dataValidation.missingByCol[col] || { pct: 0 };
                        var oI = dataValidation.outliersByCol[col] || { pct: 0 };
                        var zI = dataValidation.zeroSpendByCol[col] || { pct: 0 };
                        var parts = [];
                        if (mI.pct > 5) parts.push("Missing " + mI.pct.toFixed(1) + "%");
                        if (oI.pct > 5) parts.push("Outliers " + oI.pct.toFixed(1) + "%");
                        if (zI.pct > 30) parts.push("Zeros " + zI.pct.toFixed(1) + "%");
                        return <div key={idx} style={{ fontSize: 11, color: "#78350f", marginBottom: 2 }}>• {col}: {parts.join(" | ")}</div>;
                      })}
                    </div>
                  )}
                </Card>
              )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 1: VARIABLE MAPPING ── */}
        {step === 1 && data && (
          <div>
            <Card title="Variable Mapping">
              <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>Assign each column to a category. Auto-detected suggestions are pre-selected.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Date Column</label>
                  <select value={dateCol} onChange={function(e) { setDateCol(e.target.value); }} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <option value="">Select...</option>
                    {columns.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Target / KPI</label>
                  <select value={targetCol} onChange={function(e) { setTargetCol(e.target.value); }} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <option value="">Select...</option>
                    {numericCols.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>DMA / Market (optional)</label>
                  <select value={dmaCol} onChange={function(e) { setDmaCol(e.target.value); if (e.target.value && data) { var vals = []; data.forEach(function(r) { var v = r[e.target.value]; if (v && vals.indexOf(v) < 0) vals.push(v); }); setAvailableDMAs(vals.sort()); } else { setAvailableDMAs([]); setSelectedDMA("All"); } }} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <option value="">None</option>
                    {columns.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { label: "Media Spend", cols: mediaCols, setter: setMediaCols, others: [setOrganicCols, setContextCols], bg: "#eff6ff" },
                  { label: "Organic", cols: organicCols, setter: setOrganicCols, others: [setMediaCols, setContextCols], bg: "#f0fdf4" },
                  { label: "Context", cols: contextCols, setter: setContextCols, others: [setMediaCols, setOrganicCols], bg: "#fff7ed" },
                ].map(function(cat) {
                  return (
                    <div key={cat.label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, background: cat.bg }}>
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>{cat.label}</div>
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        {numericCols.filter(function(c) { return c !== dateCol && c !== targetCol; }).map(function(c) {
                          return (
                            <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 4, fontSize: 12, cursor: "pointer" }}>
                              <input type="checkbox" checked={cat.cols.indexOf(c) >= 0}
                                onChange={function() { toggleCol(c, cat.cols, cat.setter, cat.others); }} />
                              <span style={{ fontWeight: cat.cols.indexOf(c) >= 0 ? 600 : 400 }}>{c}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, fontWeight: 500 }}>{cat.cols.length} selected</div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={function() { setStep(0); }} style={{ padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Back</button>
              <button onClick={function() {
                var ap = Object.assign({}, adstockParams), sp = Object.assign({}, satParams);
                mediaCols.forEach(function(c) {
                  if (!ap[c]) {
                    var isLong = /tv|radio|print|linear|traditional/i.test(c);
                    ap[c] = isLong ? { thetaMin: 0.4, thetaMax: 0.8 } : { thetaMin: 0.1, thetaMax: 0.4 };
                  }
                  if (!sp[c]) sp[c] = { alphaMin: 1.5, alphaMax: 3.0, gammaMin: 0.3, gammaMax: 0.7 };
                });
                setAdstockParams(ap); setSatParams(sp); setStep(2);
              }} disabled={!dateCol || !targetCol || !mediaCols.length}
                style={{ background: (!dateCol || !targetCol || !mediaCols.length) ? "#94a3b8" : "#2563eb", color: "white", border: "none", padding: "10px 24px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 500, opacity: (!dateCol || !targetCol || !mediaCols.length) ? 0.4 : 1 }}>
                Continue <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: EDA ── */}
        {step === 2 && filteredData && (
          <div>
            <TabBar tabs={[{ key: "ts", label: "Time Series" }, { key: "corr", label: "Correlations" }, { key: "scatter", label: "Scatter" }, { key: "stability", label: "Stability" }]} active={edaTab} onChange={setEdaTab} />

            {edaTab === "ts" && (
              <Card title={targetCol + " & Media Spend Over Time"}>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={tsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(filteredData.length / 8)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                    <Tooltip formatter={function(v) { return typeof v === "number" ? v.toLocaleString() : v; }} />
                    <Legend />
                    <Line type="monotone" dataKey={targetCol} stroke="#2563eb" strokeWidth={2} dot={false} name={targetCol} />
                  </ComposedChart>
                </ResponsiveContainer>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={tsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(filteredData.length / 8)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                    <Tooltip />
                    <Legend />
                    {mediaCols.slice(0, 6).map(function(c, i) {
                      return <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i]} dot={false} strokeWidth={1.5} />;
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            )}

            {edaTab === "corr" && (
              <Card title="Correlation Heatmap">
                <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 12 }}>Blue = positive, Red = negative</p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ fontSize: 11, borderCollapse: "separate", borderSpacing: 2 }}>
                    <thead><tr><td></td>{corrCols.map(function(c) { return <td key={c} style={{ textAlign: "center", fontWeight: 500, color: "#6b7280", padding: 4, maxWidth: 70, overflow: "hidden" }}>{c.slice(0,10)}</td>; })}</tr></thead>
                    <tbody>
                      {corrCols.map(function(r, i) {
                        return (
                          <tr key={r}>
                            <td style={{ fontWeight: 500, color: "#475569", paddingRight: 8, textAlign: "right", maxWidth: 90 }}>{r.slice(0,12)}</td>
                            {corrCols.map(function(c, j) {
                              var val = corrMatrix[i] ? (corrMatrix[i][j] || 0) : 0;
                              return (
                                <td key={j} style={{ textAlign: "center", borderRadius: 4, padding: 6, backgroundColor: corrColor(val), color: Math.abs(val) > 0.4 ? "white" : "#333", minWidth: 48 }}>{val.toFixed(2)}</td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {edaTab === "scatter" && (
              <Card title={"Spend vs " + targetCol}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {mediaCols.slice(0, 4).map(function(col, i) {
                    var sd = filteredData.map(function(r) { return { x: r[col] || 0, y: r[targetCol] || 0 }; });
                    return (
                      <div key={col}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#475569", marginBottom: 4 }}>{col}</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="x" tick={{ fontSize: 9 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                            <YAxis dataKey="y" tick={{ fontSize: 9 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                            <Tooltip formatter={function(v) { return typeof v === "number" ? v.toLocaleString() : v; }} />
                            <Scatter data={sd} fill={COLORS[i]} opacity={0.5} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {edaTab === "stability" && (
              <div>
                <Card title="Relationship Stability Analysis">
                  <div style={{ padding: 10, backgroundColor: "#eff6ff", borderRadius: 6, marginBottom: 16, fontSize: 12, color: "#1e40af" }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Why Stability Matters</div>
                    Data is split into two halves (early vs recent). If the correlation between a channel and the KPI changes drastically between periods, the relationship may be an artifact — not a real marketing effect. Stable relationships give more reliable models.
                  </div>
                  {stabilityAnalysis ? (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                        <MetricBox label="Stable Channels" value={stabilityAnalysis.stableCount} color="green" />
                        <MetricBox label="Unstable Channels" value={stabilityAnalysis.unstableCount} color={stabilityAnalysis.unstableCount > 0 ? "red" : "green"} />
                        <div style={{ padding: 10, borderRadius: 8, backgroundColor: "#f8fafc", textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Split</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Early {stabilityAnalysis.earlyN}w / Recent {stabilityAnalysis.recentN}w</div>
                        </div>
                      </div>
                      <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                          <thead><tr style={{ backgroundColor: "#f9fafb" }}>
                            <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>CHANNEL</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>FULL CORR</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>EARLY CORR</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>RECENT CORR</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>DRIFT</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>SLOPE FLIP</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>STATUS</th>
                          </tr></thead>
                          <tbody>
                            {stabilityAnalysis.results.map(function(r, idx) {
                              return (
                                <tr key={r.col} style={{ borderTop: "1px solid #f1f5f9", backgroundColor: r.stable ? (idx % 2 === 0 ? "#fafafa" : "#fff") : "#fee2e2" }}>
                                  <td style={{ padding: "6px 8px", fontWeight: 500, color: "#1f2937" }}>{r.col.replace(/_spend$/, "").replace(/_/g, " ")}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace" }}>{r.corrFull.toFixed(3)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace" }}>{r.corrEarly.toFixed(3)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace" }}>{r.corrRecent.toFixed(3)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: r.corrDrift > 0.3 ? "#dc2626" : "#16a34a", fontWeight: 600 }}>{r.corrDrift.toFixed(3)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center", color: r.slopeFlip ? "#dc2626" : "#16a34a", fontWeight: 600 }}>{r.slopeFlip ? "Yes ⚠" : "No"}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                    <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: r.stable ? "#dcfce7" : "#fee2e2", color: r.stable ? "#166534" : "#991b1b" }}>{r.stable ? "Stable" : "Unstable"}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>Early vs Recent Correlation</div>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={stabilityAnalysis.results.map(function(r) { return { name: r.col.replace(/_spend$/, "").replace(/_/g, " ").slice(0, 12), early: Number(r.corrEarly.toFixed(3)), recent: Number(r.corrRecent.toFixed(3)) }; })} layout="vertical" margin={{ left: 80, right: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" domain={[-0.5, 1]} tick={{ fontSize: 10 }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={75} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="early" fill="#93c5fd" name="Early Period" barSize={8} />
                            <Bar dataKey="recent" fill="#2563eb" name="Recent Period" barSize={8} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      {stabilityAnalysis.unstableCount > 0 && (
                        <div style={{ marginTop: 12, padding: 10, backgroundColor: "#fef3c7", borderRadius: 6, borderLeft: "4px solid #f59e0b" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Recommendation</div>
                          <div style={{ fontSize: 12, color: "#78350f" }}>
                            {stabilityAnalysis.unstableCount} channel(s) show unstable relationships. Consider: (1) investigating if spend patterns changed, (2) using shorter training windows, (3) adding interaction terms, or (4) excluding these channels if instability is severe.
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: "#94a3b8", fontSize: 13 }}>Need at least 20 data points with target and media columns mapped.</p>
                  )}
                </Card>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <button onClick={function() { setStep(1); }} style={{ padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Back</button>
              <button onClick={function() { setStep(3); }} style={{ background: "#2563eb", color: "white", border: "none", padding: "10px 24px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>Configure <ChevronRight size={14} /></button>
            </div>
          </div>
        )}

        {/* ── STEP 3: CONFIGURE ── */}
        {step === 3 && filteredData && (
          <div>
            {/* PROMINENT Modeling Approach Selector - always visible */}
            <div style={{ marginBottom: 20, padding: 16, background: "linear-gradient(135deg, #f8fafc, #f1f5f9)", borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 }}>Select Modeling Approach</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button onClick={function() { setModelingMethod("ridge"); if (configTab === "priors") setConfigTab("model"); }}
                  style={{ padding: 16, border: modelingMethod === "ridge" ? "2px solid #f97316" : "1px solid #d1d5db", borderRadius: 12, background: modelingMethod === "ridge" ? "#fff7ed" : "white", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#f97316", color: "white", padding: "3px 8px", borderRadius: 4 }}>ROBYN</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: modelingMethod === "ridge" ? "#c2410c" : "#334155" }}>Ridge Regression</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    Meta Robyn methodology. L2 regularized frequentist approach with auto-tuned lambda, positive media constraints, Pareto-optimal model selection.
                  </div>
                </button>
                <button onClick={function() { setModelingMethod("bayesian"); }}
                  style={{ padding: 16, border: modelingMethod === "bayesian" ? "2px solid #16a34a" : "1px solid #d1d5db", borderRadius: 12, background: modelingMethod === "bayesian" ? "#f0fdf4" : "white", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#16a34a", color: "white", padding: "3px 8px", borderRadius: 4 }}>MERIDIAN</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: modelingMethod === "bayesian" ? "#166534" : "#334155" }}>Bayesian MAP</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    Google Meridian methodology. Bayesian MAP estimation with per-channel informative priors (HalfNormal, LogNormal, Beta). Full prior specification.
                  </div>
                </button>
              </div>
            </div>

            <TabBar tabs={[{ key: "adstock", label: "Adstock (Carryover)" }, { key: "saturation", label: "Saturation" }]
              .concat(modelingMethod === "bayesian" ? [{ key: "priors", label: "Bayesian Priors" }] : [])
              .concat([{ key: "model", label: "Model Settings" }])} active={configTab} onChange={setConfigTab} />

            {configTab === "adstock" && (
              <div>
                <Card title="Adstock Type">
                  <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 12 }}>Choose the adstock decay model</p>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {[{ key: "geometric", label: "Geometric" }, { key: "weibull_cdf", label: "Weibull CDF" }, { key: "weibull_pdf", label: "Weibull PDF" }, { key: "binomial", label: "Binomial (Meridian)" }].map(function(type) {
                      return (
                        <button key={type.key} onClick={function() { setAdstockType(type.key); reinitAdstockParams(type.key); }}
                          style={{ flex: 1, padding: "8px 12px", border: adstockType === type.key ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 6, background: adstockType === type.key ? "#eff6ff" : "white", color: adstockType === type.key ? "#2563eb" : "#6b7280", fontWeight: adstockType === type.key ? 600 : 500, fontSize: 12, cursor: "pointer" }}>
                          {type.label}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ color: "#6b7280", fontSize: 11 }}>
                    {adstockType === "geometric" ? "Fixed exponential decay rate (theta). Simple, fast. Used by Meta Robyn as default." : adstockType === "weibull_cdf" ? "Flexible decay shape (S or L curve). No lagged peak. Used by Meta Robyn." : adstockType === "weibull_pdf" ? "Flexible decay WITH lagged peak. Best for longer conversion windows." : "Google Meridian's binomial distribution adstock. Alpha controls peak position (0=immediate, 1=delayed), maxLag controls memory length. Best for modeling channels with delayed impact peaks."}
                  </p>
                </Card>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card title="Channel Parameters">
                    <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    {mediaCols.map(function(col) {
                      var params = adstockParams[col] || {};
                      var chSteps = params.steps || gridSteps;
                      return (
                        <div key={col} style={{ marginBottom: 10, padding: 10, background: "#f8fafc", borderRadius: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{col}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 9, color: "#94a3b8", marginRight: 4 }}>steps</span>
                              {[2, 3, 4, 5].map(function(sv) {
                                return (
                                  <button key={sv} onClick={function() { setAdstockParams(function(prev) { var next = Object.assign({}, prev); next[col] = Object.assign({}, prev[col] || {}, { steps: sv }); return next; }); }}
                                    style={{ width: 22, height: 20, border: chSteps === sv ? "1.5px solid #2563eb" : "1px solid #d1d5db", borderRadius: 4, background: chSteps === sv ? "#eff6ff" : "white", color: chSteps === sv ? "#2563eb" : "#9ca3af", fontSize: 10, fontWeight: chSteps === sv ? 700 : 500, cursor: "pointer", padding: 0 }}>
                                    {sv}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {adstockType === "geometric" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Min Theta</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(params.thetaMin || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="95" value={Math.round((params.thetaMin || 0) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { thetaMin: v, thetaMax: Math.max(v, old.thetaMax || 0.7) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Max Theta</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(params.thetaMax || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="0" max="95" value={Math.round((params.thetaMax || 0) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { thetaMax: v, thetaMin: Math.min(v, old.thetaMin || 0.1) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            </div>
                          )}
                          {(adstockType === "weibull_cdf" || adstockType === "weibull_pdf") && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Shape Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(params.shapeMin || 0).toFixed(1)}</span>
                                </div>
                                <input type="range" min="1" max={adstockType === "weibull_pdf" ? "100" : "20"} value={Math.round((params.shapeMin || 0.5) * 10)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 10; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { shapeMin: v, shapeMax: Math.max(v, old.shapeMax || 2) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Shape Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(params.shapeMax || 0).toFixed(1)}</span>
                                </div>
                                <input type="range" min="1" max={adstockType === "weibull_pdf" ? "100" : "20"} value={Math.round((params.shapeMax || 2) * 10)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 10; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { shapeMax: v, shapeMin: Math.min(v, old.shapeMin || 0.5) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Scale Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(params.scaleMin || 0).toFixed(3)}</span>
                                </div>
                                <input type="range" min="1" max="100" value={Math.round((params.scaleMin || 0.01) * 1000)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 1000; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { scaleMin: v, scaleMax: Math.max(v, old.scaleMax || 0.1) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Scale Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(params.scaleMax || 0).toFixed(3)}</span>
                                </div>
                                <input type="range" min="1" max="100" value={Math.round((params.scaleMax || 0.1) * 1000)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 1000; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { scaleMax: v, scaleMin: Math.min(v, old.scaleMin || 0.01) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            </div>
                          )}
                          {adstockType === "binomial" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Alpha Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(params.alphaMin || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="1" max="95" value={Math.round((params.alphaMin || 0.1) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { alphaMin: v, alphaMax: Math.max(v, old.alphaMax || 0.5) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Alpha Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(params.alphaMax || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="1" max="95" value={Math.round((params.alphaMax || 0.5) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { alphaMax: v, alphaMin: Math.min(v, old.alphaMin || 0.1) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Max Lag Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{params.maxLagMin || 4}</span>
                                </div>
                                <input type="range" min="2" max="20" value={params.maxLagMin || 4}
                                  onChange={function(e) { var v = parseInt(e.target.value); setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { maxLagMin: v, maxLagMax: Math.max(v, old.maxLagMax || 12) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Max Lag Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{params.maxLagMax || 12}</span>
                                </div>
                                <input type="range" min="2" max="20" value={params.maxLagMax || 12}
                                  onChange={function(e) { var v = parseInt(e.target.value); setAdstockParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { maxLagMax: v, maxLagMin: Math.min(v, old.maxLagMin || 4) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </Card>
                  <Card title="Decay Preview">
                    <div style={{ marginBottom: 8 }}>
                      <select value={previewChannel} onChange={function(e) { setPreviewChannel(e.target.value); }} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                        {mediaCols.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                      </select>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={adstockPreview}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="lag" tick={{ fontSize: 10 }} label={{ value: "Weeks", position: "bottom", fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="min" fill="#93c5fd" name="Min params" />
                        <Bar dataKey="max" fill="#2563eb" name="Max params" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              </div>
            )}

            {configTab === "saturation" && (
              <div>
                <Card title="Saturation Function">
                  <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 12 }}>Choose the saturation/diminishing returns model</p>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {[{ key: "hill", label: "Hill (S-Curve)" }, { key: "neg_exponential", label: "Neg Exponential" }, { key: "logarithmic", label: "Logarithmic" }, { key: "power", label: "Power" }].map(function(type) {
                      return (
                        <button key={type.key} onClick={function() { setSatFunction(type.key); reinitSatParams(type.key); }}
                          style={{ flex: 1, minWidth: 100, padding: "8px 12px", border: satFunction === type.key ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 6, background: satFunction === type.key ? "#eff6ff" : "white", color: satFunction === type.key ? "#2563eb" : "#6b7280", fontWeight: satFunction === type.key ? 600 : 500, fontSize: 12, cursor: "pointer" }}>
                          {type.label}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ color: "#6b7280", fontSize: 11 }}>
                    {satFunction === "hill" ? "S-curve: slow start, rapid growth, plateau. Alpha = steepness, Gamma = inflection point." : satFunction === "neg_exponential" ? "Classic diminishing returns. Alpha = max level, Beta = rate of approach." : satFunction === "logarithmic" ? "Simple log curve. Alpha = scale factor. Only 1 param per channel." : "Concave power curve. Alpha < 1 for diminishing returns."}
                  </p>
                </Card>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card title="Channel Parameters">
                    <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    {mediaCols.map(function(col) {
                      var sp = satParams[col] || {};
                      var chSteps = sp.steps || gridSteps;
                      return (
                        <div key={col} style={{ marginBottom: 10, padding: 10, background: "#f8fafc", borderRadius: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{col}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 9, color: "#94a3b8", marginRight: 4 }}>steps</span>
                              {[2, 3, 4, 5].map(function(sv) {
                                return (
                                  <button key={sv} onClick={function() { setSatParams(function(prev) { var next = Object.assign({}, prev); next[col] = Object.assign({}, prev[col] || {}, { steps: sv }); return next; }); }}
                                    style={{ width: 22, height: 20, border: chSteps === sv ? "1.5px solid #2563eb" : "1px solid #d1d5db", borderRadius: 4, background: chSteps === sv ? "#eff6ff" : "white", color: chSteps === sv ? "#2563eb" : "#9ca3af", fontSize: 10, fontWeight: chSteps === sv ? 700 : 500, cursor: "pointer", padding: 0 }}>
                                    {sv}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                <span>Alpha Min</span>
                                <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(sp.alphaMin || 0).toFixed(2)}</span>
                              </div>
                              <input type="range" min="1" max={satFunction === "hill" ? "50" : satFunction === "power" ? "10" : "30"}
                                value={Math.round((sp.alphaMin || 0) * 10)}
                                onChange={function(e) { var v = parseInt(e.target.value) / 10; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { alphaMin: v, alphaMax: Math.max(v, old.alphaMax || v + 0.5) }); return next; }); }}
                                style={{ width: "100%" }} />
                            </div>
                            <div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                <span>Alpha Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(sp.alphaMax || 0).toFixed(2)}</span>
                              </div>
                              <input type="range" min="1" max={satFunction === "hill" ? "50" : satFunction === "power" ? "10" : "30"}
                                value={Math.round((sp.alphaMax || 0) * 10)}
                                onChange={function(e) { var v = parseInt(e.target.value) / 10; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { alphaMax: v, alphaMin: Math.min(v, old.alphaMin || 0.1) }); return next; }); }}
                                style={{ width: "100%" }} />
                            </div>
                            {satFunction === "hill" && (
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Gamma Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(sp.gammaMin || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="5" max="95" value={Math.round((sp.gammaMin || 0.3) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { gammaMin: v, gammaMax: Math.max(v, old.gammaMax || 0.7) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            )}
                            {satFunction === "hill" && (
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Gamma Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(sp.gammaMax || 0).toFixed(2)}</span>
                                </div>
                                <input type="range" min="5" max="95" value={Math.round((sp.gammaMax || 0.7) * 100)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 100; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { gammaMax: v, gammaMin: Math.min(v, old.gammaMin || 0.3) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            )}
                            {satFunction === "neg_exponential" && (
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Beta Min</span><span style={{ color: "#2563eb", fontFamily: "monospace" }}>{(sp.betaMin || 0).toFixed(1)}</span>
                                </div>
                                <input type="range" min="5" max="50" value={Math.round((sp.betaMin || 0.5) * 10)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 10; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { betaMin: v, betaMax: Math.max(v, old.betaMax || 5.0) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            )}
                            {satFunction === "neg_exponential" && (
                              <div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b7280", marginBottom: 2 }}>
                                  <span>Beta Max</span><span style={{ color: "#16a34a", fontFamily: "monospace" }}>{(sp.betaMax || 0).toFixed(1)}</span>
                                </div>
                                <input type="range" min="5" max="50" value={Math.round((sp.betaMax || 5.0) * 10)}
                                  onChange={function(e) { var v = parseInt(e.target.value) / 10; setSatParams(function(prev) { var next = Object.assign({}, prev); var old = prev[col] || {}; next[col] = Object.assign({}, old, { betaMax: v, betaMin: Math.min(v, old.betaMin || 0.5) }); return next; }); }}
                                  style={{ width: "100%" }} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </Card>
                  <Card title="Saturation Curve Preview">
                    <div style={{ marginBottom: 8 }}>
                      <select value={previewChannel} onChange={function(e) { setPreviewChannel(e.target.value); }} style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                        {mediaCols.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                      </select>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={satPreview}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="x" tick={{ fontSize: 10 }} label={{ value: "Spend %", position: "bottom", fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} label={{ value: "Response", angle: -90, position: "insideLeft", fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="min" stroke="#93c5fd" strokeWidth={2} dot={false} name="Min params" strokeDasharray="4 4" />
                        <Line type="monotone" dataKey="max" stroke="#2563eb" strokeWidth={2} dot={false} name="Max params" />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              </div>
            )}

            {configTab === "priors" && (
              <div>
                <Card title="Bayesian Prior Specification">
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: "#166534", lineHeight: 1.6 }}>
                    <strong>Priors encode your belief about channel effects BEFORE seeing data.</strong> Google Meridian uses informative priors to regularize the model. Stronger priors (smaller sigma) constrain the model more. Weaker priors (larger sigma) let data decide.
                  </div>
                </Card>

                <Card title="Default Prior Settings">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 8 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Media Beta Prior: HalfNormal(<span style={{ color: "#16a34a", fontFamily: "monospace" }}>{priorConfig.mediaSigma.toFixed(1)}</span>)</label>
                      <input type="range" min="5" max="200" value={Math.round(priorConfig.mediaSigma * 10)} onChange={function(e) { var v = parseInt(e.target.value) / 10; setPriorConfig(function(prev) { return Object.assign({}, prev, { mediaSigma: v }); }); }} style={{ width: "100%" }} />
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Controls how strongly media betas are pulled toward zero. Meridian default: 5.0</div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Non-Media Prior: Normal(0, <span style={{ color: "#7c3aed", fontFamily: "monospace" }}>{priorConfig.nonMediaSigma.toFixed(1)}</span>)</label>
                      <input type="range" min="5" max="500" value={Math.round(priorConfig.nonMediaSigma * 10)} onChange={function(e) { var v = parseInt(e.target.value) / 10; setPriorConfig(function(prev) { return Object.assign({}, prev, { nonMediaSigma: v }); }); }} style={{ width: "100%" }} />
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Prior sigma for control/organic features. Larger = more flexible.</div>
                    </div>
                  </div>
                </Card>

                <Card title="Per-Channel Priors">
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>Override default priors for individual channels. Customize based on your domain knowledge about each channel.</div>
                  <div style={{ maxHeight: 500, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e2e8f0", background: "#f8fafc" }}>
                          <th style={{ textAlign: "left", padding: "8px 6px", fontWeight: 600, color: "#475569", minWidth: 100 }}>Channel</th>
                          <th style={{ textAlign: "center", padding: "8px 4px", fontWeight: 600, color: "#16a34a" }}>
                            <div>Beta Sigma</div>
                            <div style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>HalfNormal</div>
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 4px", fontWeight: 600, color: "#2563eb" }}>
                            <div>ROI Prior Mu</div>
                            <div style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>LogNormal</div>
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 4px", fontWeight: 600, color: "#2563eb" }}>
                            <div>ROI Prior Sigma</div>
                            <div style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>LogNormal</div>
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 4px", fontWeight: 600, color: "#9333ea" }}>
                            <div>Contrib Alpha</div>
                            <div style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>Beta dist</div>
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 4px", fontWeight: 600, color: "#9333ea" }}>
                            <div>Contrib Beta</div>
                            <div style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>Beta dist</div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mediaCols.map(function(col) {
                          var cp = (priorConfig.channelPriors || {})[col] || {};
                          var sigma = cp.sigma !== undefined ? cp.sigma : priorConfig.mediaSigma;
                          var roiMu = cp.roiMu !== undefined ? cp.roiMu : 0.2;
                          var roiSigma = cp.roiSigma !== undefined ? cp.roiSigma : 0.9;
                          var cAlpha = cp.contributionAlpha !== undefined ? cp.contributionAlpha : 1.0;
                          var cBeta = cp.contributionBeta !== undefined ? cp.contributionBeta : 99.0;
                          var makeHandler = function(field) {
                            return function(e) {
                              var v = parseFloat(e.target.value);
                              if (isNaN(v)) return;
                              setPriorConfig(function(prev) {
                                var cp2 = Object.assign({}, prev.channelPriors || {});
                                var upd = {};
                                upd[field] = v;
                                cp2[col] = Object.assign({}, cp2[col] || {}, upd);
                                return Object.assign({}, prev, { channelPriors: cp2 });
                              });
                            };
                          };
                          var inputStyle = { width: 60, padding: "3px 4px", border: "1px solid #d1d5db", borderRadius: 4, textAlign: "center", fontSize: 11 };
                          return (
                            <tr key={col} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "6px", fontWeight: 500, color: "#334155", fontSize: 10 }}>{col}</td>
                              <td style={{ padding: "4px 2px", textAlign: "center" }}>
                                <input type="number" value={sigma} step="0.5" min="0.5" max="50" style={Object.assign({}, inputStyle, { borderColor: "#bbf7d0" })} onChange={makeHandler("sigma")} />
                              </td>
                              <td style={{ padding: "4px 2px", textAlign: "center" }}>
                                <input type="number" value={roiMu} step="0.1" min="-2" max="5" style={Object.assign({}, inputStyle, { borderColor: "#bfdbfe" })} onChange={makeHandler("roiMu")} />
                              </td>
                              <td style={{ padding: "4px 2px", textAlign: "center" }}>
                                <input type="number" value={roiSigma} step="0.1" min="0.1" max="5" style={Object.assign({}, inputStyle, { borderColor: "#bfdbfe" })} onChange={makeHandler("roiSigma")} />
                              </td>
                              <td style={{ padding: "4px 2px", textAlign: "center" }}>
                                <input type="number" value={cAlpha} step="0.5" min="0.1" max="50" style={Object.assign({}, inputStyle, { borderColor: "#e9d5ff" })} onChange={makeHandler("contributionAlpha")} />
                              </td>
                              <td style={{ padding: "4px 2px", textAlign: "center" }}>
                                <input type="number" value={cBeta} step="1" min="1" max="999" style={Object.assign({}, inputStyle, { borderColor: "#e9d5ff" })} onChange={makeHandler("contributionBeta")} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div style={{ padding: 10, background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#166534", marginBottom: 4 }}>Beta Sigma (HalfNormal)</div>
                      <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.4 }}>Controls media coefficient magnitude. Smaller = stronger belief channel has modest effect. Meridian default: 5.0</div>
                    </div>
                    <div style={{ padding: 10, background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#1e40af", marginBottom: 4 }}>ROI Prior (LogNormal)</div>
                      <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.4 }}>Expected return on investment. Mu=0.2, Sigma=0.9 is Meridian default. Higher mu = expect higher ROI.</div>
                    </div>
                    <div style={{ padding: 10, background: "#faf5ff", borderRadius: 8, border: "1px solid #e9d5ff" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#7e22ce", marginBottom: 4 }}>Contribution Prior (Beta)</div>
                      <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.4 }}>Expected share of KPI from channel. Beta(1,99) = expect ~1% contribution. Beta(2,98) = expect ~2%.</div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {configTab === "model" && (
              <div>
                {/* Method-specific settings */}
                <Card title={modelingMethod === "ridge" ? "Ridge Regression Settings" : "Model Settings"}>
                  {modelingMethod === "ridge" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 16 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Default Regularization: <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{regAlpha.toFixed(1)}</span></label>
                        <input type="range" min="1" max="200" value={regAlpha * 10} onChange={function(e) { setRegAlpha(parseInt(e.target.value) / 10); }} style={{ width: "100%" }} />
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Lambda is also auto-tuned per model across 8 values during grid search.</div>
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Test Size: <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{testPct}%</span></label>
                        <input type="range" min="10" max="40" step="5" value={testPct} onChange={function(e) { setTestPct(parseInt(e.target.value)); }} style={{ width: "100%" }} />
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Train: {Math.floor(filteredData.length * (1 - testPct/100))} | Test: {filteredData.length - Math.floor(filteredData.length * (1 - testPct/100))}</div>
                      </div>
                    </div>
                  )}
                  {modelingMethod === "bayesian" && (
                    <div>
                      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 11, color: "#166534", lineHeight: 1.5 }}>
                        <strong>Configure Bayesian priors in the Bayesian Priors tab above.</strong> HalfNormal priors on media betas ensure positive coefficients. Per-channel prior specification allows domain knowledge to guide the model.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 16 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 4 }}>Test Size: <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{testPct}%</span></label>
                          <input type="range" min="10" max="40" step="5" value={testPct} onChange={function(e) { setTestPct(parseInt(e.target.value)); }} style={{ width: "100%" }} />
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Train: {Math.floor(filteredData.length * (1 - testPct/100))} | Test: {filteredData.length - Math.floor(filteredData.length * (1 - testPct/100))}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Bootstrap & CV Settings */}
                <Card title="Validation Settings">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 16 }}>
                    <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={runBootstrap} onChange={function(e) { setRunBootstrap(e.target.checked); }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Bootstrap Confidence Intervals</span>
                      </label>
                      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Resample data and refit to get uncertainty estimates on all coefficients and contributions.</div>
                      {runBootstrap && (
                        <div>
                          <label style={{ fontSize: 11, color: "#475569" }}>Resamples: <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{nBootstrap}</span></label>
                          <input type="range" min="30" max="500" step="10" value={nBootstrap} onChange={function(e) { setNBootstrap(parseInt(e.target.value)); }} style={{ width: "100%" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={runCV} onChange={function(e) { setRunCV(e.target.checked); }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Expanding Window Cross-Validation</span>
                      </label>
                      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Time-series aware CV that trains on expanding windows and tests on the next period.</div>
                      {runCV && (
                        <div>
                          <label style={{ fontSize: 11, color: "#475569" }}>Folds: <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{nCVFolds}</span></label>
                          <input type="range" min="3" max="10" value={nCVFolds} onChange={function(e) { setNCVFolds(parseInt(e.target.value)); }} style={{ width: "100%" }} />
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                <Card title="Grid Search Settings">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 8 }}>Search Mode</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        {["adstock", "saturation", "both"].map(function(mode) {
                          return (
                            <button key={mode} onClick={function() { setSearchMode(mode); }}
                              style={{ flex: 1, padding: "8px 12px", border: searchMode === mode ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 6, background: searchMode === mode ? "#eff6ff" : "white", color: searchMode === mode ? "#2563eb" : "#6b7280", fontWeight: searchMode === mode ? 600 : 500, fontSize: 12, cursor: "pointer" }}>
                              {mode === "adstock" ? "Adstock" : mode === "saturation" ? "Saturation" : "Both"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#475569", marginBottom: 8 }}>Iterations <span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8" }}>(random samples)</span></label>
                      <div style={{ display: "flex", gap: 8 }}>
                        {[50, 100, 200, 500].map(function(n) {
                          return (
                            <button key={n} onClick={function() { setMaxIterations(n); }}
                              style={{ flex: 1, padding: "8px 12px", border: maxIterations === n ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 6, background: maxIterations === n ? "#eff6ff" : "white", color: maxIterations === n ? "#2563eb" : "#6b7280", fontWeight: maxIterations === n ? 600 : 500, fontSize: 12, cursor: "pointer" }}>
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: 12, borderRadius: 8, background: gridCombColor === "#dc2626" ? "#fef2f2" : gridCombColor === "#ca8a04" ? "#fffbeb" : "#f0fdf4", border: "1px solid " + (gridCombColor === "#dc2626" ? "#fecaca" : gridCombColor === "#ca8a04" ? "#fde68a" : "#bbf7d0") }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: gridCombColor }}>Total Combinations</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                          Random sampling within per-channel min/max ranges
                        </div>
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: gridCombColor }}>{totalGridCombinations}</div>
                    </div>
                    {maxIterations >= 500 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: 8, background: "rgba(255,255,255,0.5)", borderRadius: 4 }}>
                        <AlertTriangle size={14} style={{ color: "#dc2626" }} />
                        <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 500 }}>Warning: This may take several minutes</span>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <button onClick={function() { setStep(2); }} style={{ padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Back</button>
              <button onClick={function() { setModelResult(null); setGridResults([]); setSelectedModelIdx(null); setBootstrapResults(null); setCvResults(null); setStep(4); }} style={{ background: "#2563eb", color: "white", border: "none", padding: "10px 24px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>Train Model <ChevronRight size={14} /></button>
            </div>
          </div>
        )}

        {/* ── STEP 4: TRAIN & RESULTS ── */}
        {step === 4 && filteredData && (
          <div>
            {!modelResult && !isTraining && !trainError && (
              <Card>
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <Play size={48} style={{ color: "#60a5fa", display: "block", margin: "0 auto 16px" }} />
                  <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ready to Train</h3>
                  <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 8 }}>{mediaCols.length} media + {organicCols.length} organic + {contextCols.length} context features</p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, background: modelingMethod === "bayesian" ? "#dcfce7" : "#fff7ed", color: modelingMethod === "bayesian" ? "#166534" : "#9a3412", padding: "3px 10px", borderRadius: 4 }}>{modelingMethod === "bayesian" ? "Bayesian MAP (Meridian)" : "Ridge Regression (Robyn)"}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, background: "#eff6ff", color: "#1e40af", padding: "3px 10px", borderRadius: 4 }}>{adstockType.replace("_", " ")} adstock</span>
                    <span style={{ fontSize: 10, fontWeight: 600, background: "#eff6ff", color: "#1e40af", padding: "3px 10px", borderRadius: 4 }}>{satFunction.replace("_", " ")} saturation</span>
                  </div>
                  <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 16 }}>Testing {maxIterations} random parameter combinations{runBootstrap ? " + bootstrap CI" : ""}{runCV ? " + cross-validation" : ""}</p>
                  <button onClick={trainModel}
                    style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", border: "none", padding: "12px 32px", borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 500 }}>
                    Start Grid Search
                  </button>
                </div>
              </Card>
            )}

            {isTraining && (
              <Card>
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <RefreshCw size={40} style={{ color: "#3b82f6", display: "block", margin: "0 auto 12px" }} />
                  <p style={{ color: "#475569", fontWeight: 500, marginBottom: 16 }}>Training grid search...</p>
                  <div style={{ background: "#f3f4f6", borderRadius: 8, height: 24, overflow: "hidden" }}>
                    <div style={{ background: "#2563eb", height: "100%", width: Math.round((gridProgress.current / gridProgress.total) * 100) + "%", transition: "width 0.2s" }}></div>
                  </div>
                  <p style={{ color: "#6b7280", fontSize: 12, marginTop: 12 }}>{gridProgress.current} / {gridProgress.total} models</p>
                </div>
              </Card>
            )}

            {trainError && (
              <Card>
                <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#b91c1c", fontWeight: 500, marginBottom: 4 }}>
                    <AlertTriangle size={16} /> Training Error
                  </div>
                  <p style={{ color: "#dc2626", fontSize: 13 }}>{trainError}</p>
                  <button onClick={function() { setTrainError(null); trainModel(); }} style={{ marginTop: 12, fontSize: 13, color: "#2563eb", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
                </div>
              </Card>
            )}

            {modelResult && (
              <div>
                <TabBar tabs={[{ key: "leaderboard", label: "Leaderboard" }, { key: "metrics", label: "Performance" }, { key: "fit", label: "Fit" }, { key: "decomp", label: "Decomposition" }, { key: "response", label: "Response Curves" }, { key: "validation", label: "Validation" }]} active={resultTab} onChange={setResultTab} />

                {/* Selected Model Banner — shows across all tabs */}
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", background: "#dbeafe", padding: "2px 8px", borderRadius: 4 }}>Model #{(selectedModelIdx != null ? selectedModelIdx : 0) + 1}</span>
                    <span style={{ fontSize: 8, fontWeight: 700, background: modelResult.method === "bayesian" ? "#16a34a" : "#f97316", color: "white", padding: "2px 5px", borderRadius: 3 }}>{modelResult.method === "bayesian" ? "MERIDIAN" : "ROBYN"}</span>
                    <span style={{ fontSize: 12, color: "#1e40af" }}>
                      Score: <strong>{(modelResult.modelScore || 0).toFixed(4)}</strong> | R²: <strong>{modelResult.testMetrics.r2.toFixed(3)}</strong> | NRMSE: <strong>{(modelResult.testMetrics.nrmse || 0).toFixed(4)}</strong> | DECOMP: <strong>{(modelResult.decompRssd || 0).toFixed(4)}</strong> | {modelResult.method === "bayesian" ? "MAP" : "λ: " + (modelResult.ridgeLambda || "?")}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={function() { setModelResult(null); setGridResults([]); setSelectedModelIdx(null); setBootstrapResults(null); setCvResults(null); }} style={{ fontSize: 11, color: "white", background: "#f97316", border: "none", cursor: "pointer", padding: "4px 12px", borderRadius: 4, fontWeight: 600 }}>Re-Train</button>
                    <button onClick={function() { setConfigTab("model"); setStep(3); }} style={{ fontSize: 11, color: "#6b7280", background: "#f1f5f9", border: "none", cursor: "pointer", padding: "4px 12px", borderRadius: 4, fontWeight: 500 }}>Change Settings</button>
                    <button onClick={function() { setResultTab("leaderboard"); setShowModelHint(true); setTimeout(function() { setShowModelHint(false); }, 3000); }} style={{ fontSize: 11, color: "#2563eb", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Change Model</button>
                  </div>
                </div>

                {resultTab === "leaderboard" && (
                  <Card title="Model Leaderboard">
                    {showModelHint && (
                      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <AlertTriangle size={14} style={{ color: "#d97706" }} />
                        <span style={{ fontSize: 12, color: "#92400e", fontWeight: 500 }}>Click any row below to select a different model</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                      <button onClick={function() {
                        var headers = ["Rank", "Score", "Test R\u00B2", "NRMSE", "DECOMP.RSSD", "MAPE", modelResult && modelResult.method === "bayesian" ? "Method" : "Lambda", "Train R\u00B2", "Overfit Gap"];
                        var rows = gridResults.map(function(r, i) {
                          return [i + 1, (r.modelScore || 0).toFixed(4), r.testMetrics.r2.toFixed(4), (r.testMetrics.nrmse || 0).toFixed(4), (r.decompRssd || 0).toFixed(4), (r.testMetrics.mape * 100).toFixed(2) + "%", r.method === "bayesian" ? "MAP" : (r.ridgeLambda || ""), r.trainMetrics.r2.toFixed(4), (r.overfitGap || 0).toFixed(3)];
                        });
                        downloadCSV("mmm_leaderboard.csv", headers, rows);
                      }} style={{ padding: "5px 12px", border: "1px solid #2563eb", borderRadius: 6, background: "white", color: "#2563eb", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                        Export Leaderboard CSV
                      </button>
                    </div>
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: "#1e40af", lineHeight: 1.5 }}>
                        <strong>How model selection works:</strong> Each row is a different model trained with different hyperparameters (adstock decay rates, saturation curve shapes). Models are ranked by a <strong>composite Pareto score</strong> that balances two criteria: (1) <strong>NRMSE</strong> — how well the model fits the data, and (2) <strong>DECOMP.RSSD</strong> — whether the model's channel importance aligns with actual spend patterns. {modelResult && modelResult.method === "bayesian" ? "This approach uses Google Meridian's Bayesian MAP estimation with informative priors (HalfNormal on media betas). Per-channel prior specification guides coefficient estimation." : "This approach mirrors Meta Robyn's methodology. Ridge regularization strength (\u03BB) is also auto-tuned per model."}
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ color: "#334155", fontSize: 13, fontWeight: 500 }}>Evaluated {gridResults.length} models — click any row to select it</p>
                      <p style={{ color: "#94a3b8", fontSize: 11 }}>Best model: Score = {modelResult.modelScore != null ? modelResult.modelScore.toFixed(4) : "N/A"} | Test R² = {modelResult.testMetrics.r2.toFixed(3)} | NRMSE = {modelResult.testMetrics.nrmse != null ? modelResult.testMetrics.nrmse.toFixed(4) : "N/A"} | DECOMP.RSSD = {modelResult.decompRssd != null ? modelResult.decompRssd.toFixed(4) : "N/A"}</p>
                    </div>
                    <div style={{ maxHeight: 400, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                        <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
                          <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 10 }}>#</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Score</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Test R²</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>NRMSE</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>DECOMP</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>MAPE</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>{modelResult && modelResult.method === "bayesian" ? "Method" : "\u03BB"}</th>
                          <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Quality</th>
                        </tr></thead>
                        <tbody>
                          {gridResults.map(function(result, idx) {
                            /* Quality traffic light based on business checks */
                            var qColor = "#16a34a"; var qLabel = "Good";
                            if (result.testMetrics.r2 < 0.3 || (result.overfitGap || 0) > 0.3) { qColor = "#dc2626"; qLabel = "Poor"; }
                            else if (result.testMetrics.r2 < 0.6 || (result.decompRssd || 0) > 0.3 || (result.overfitGap || 0) > 0.15) { qColor = "#f59e0b"; qLabel = "Fair"; }
                            return (
                              <tr key={idx} onClick={function() { setSelectedModelIdx(idx); setModelResult(result); setBudgetAlloc(result.budgetAlloc); }}
                                style={{ borderBottom: "1px solid #e2e8f0", cursor: "pointer", background: selectedModelIdx === idx ? "#eff6ff" : idx === 0 ? "#fefce8" : "white" }}>
                                <td style={{ padding: "6px 8px", color: "#475569", fontWeight: selectedModelIdx === idx ? 600 : 400 }}>
                                  {idx === 0 && <span style={{ fontSize: 9, background: "#2563eb", color: "white", borderRadius: 3, padding: "1px 4px", marginRight: 4 }}>Best</span>}
                                  {idx + 1}
                                </td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#1e293b" }}>{(result.modelScore || 0).toFixed(4)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb", fontWeight: 600 }}>{result.testMetrics.r2.toFixed(3)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>{(result.testMetrics.nrmse || 0).toFixed(4)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>{(result.decompRssd || 0).toFixed(4)}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>{(result.testMetrics.mape * 100).toFixed(1)}%</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8", fontSize: 10 }}>{result.method === "bayesian" ? "MAP" : (result.ridgeLambda || "?")}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                  <span style={{ fontSize: 9, fontWeight: 600, color: qColor, background: qColor + "15", padding: "2px 6px", borderRadius: 3 }}>{qLabel}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Model diagnostics for selected model */}
                    {selectedModelIdx !== null && gridResults[selectedModelIdx] && (
                      <div style={{ marginTop: 16 }}>
                        {/* Diagnostic warnings */}
                        {(function() {
                          var m = gridResults[selectedModelIdx];
                          var warnings = [];
                          if ((m.overfitGap || 0) > 0.15) warnings.push("Train-test R\u00B2 gap is " + (m.overfitGap || 0).toFixed(2) + " — possible overfitting. Consider more data or stronger regularization.");
                          if (m.testMetrics.r2 < 0.3) warnings.push("Test R\u00B2 is low (" + m.testMetrics.r2.toFixed(3) + ") — model has weak predictive power. Try different hyperparameters or check variable selection.");
                          if ((m.decompRssd || 0) > 0.3) warnings.push("DECOMP.RSSD is high (" + (m.decompRssd || 0).toFixed(3) + ") — model\u2019s channel importance doesn\u2019t match actual spend patterns.");
                          if ((m.maxContribPct || 0) > 50) warnings.push("One channel accounts for >" + Math.round(m.maxContribPct || 0) + "% of contribution — may indicate multicollinearity.");
                          if (warnings.length > 0) {
                            return (
                              <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Model Diagnostics</div>
                                {warnings.map(function(w, wi) {
                                  return <div key={wi} style={{ fontSize: 10, color: "#92400e", lineHeight: 1.5, marginBottom: 2 }}>• {w}</div>;
                                })}
                              </div>
                            );
                          }
                          return (
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "#15803d" }}>Model passes all diagnostic checks</div>
                              <div style={{ fontSize: 10, color: "#15803d" }}>Good fit (R²={m.testMetrics.r2.toFixed(3)}), reasonable decomposition (RSSD={((m.decompRssd || 0)).toFixed(3)}), no overfitting concern (gap={((m.overfitGap || 0)).toFixed(2)})</div>
                            </div>
                          );
                        })()}

                        <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 4 }}>Selected Model #{(selectedModelIdx || 0) + 1} — Hyperparameters</div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 8 }}>These are the adstock and saturation parameters for each channel. Different models use different parameter values, affecting how spend translates to the KPI.</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                            {mediaCols.map(function(col, idx) {
                              var combo = gridResults[selectedModelIdx].combo;
                              var betaVal = gridResults[selectedModelIdx].beta ? Math.abs(gridResults[selectedModelIdx].beta[idx]) : 0;
                              return (
                                <div key={col} style={{ padding: 6, background: "white", borderRadius: 4, border: "1px solid #e2e8f0" }}>
                                  <div style={{ fontWeight: 600, color: "#475569", fontSize: 11 }}>{col.replace(/_spend/g, "")}</div>
                                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                                    {combo.adstock && combo.adstock[col] && (
                                      adstockType === "geometric"
                                        ? <span>θ={((combo.adstock[col].theta != null ? combo.adstock[col].theta : 0)).toFixed(2)} </span>
                                        : <span>sh={((combo.adstock[col].shape || 0)).toFixed(2)} sc={((combo.adstock[col].scale || 0)).toFixed(3)} </span>
                                    )}
                                    {combo.sat && combo.sat[col] && (
                                      <span>
                                        α={((combo.sat[col].alpha || 0)).toFixed(2)}
                                        {combo.sat[col].gamma != null && <span> γ={combo.sat[col].gamma.toFixed(2)}</span>}
                                        {combo.sat[col].beta != null && <span> β={combo.sat[col].beta.toFixed(2)}</span>}
                                      </span>
                                    )}
                                    <span style={{ color: "#2563eb", marginLeft: 4 }}>β={betaVal.toFixed(0)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {resultTab === "metrics" && (
                  <Card title="Model Performance">
                    <p style={{ color: "#64748b", fontSize: 11, marginBottom: 12 }}>These metrics measure how well the selected model fits the data. The first row shows predictive accuracy, the second row shows {modelResult.method === "bayesian" ? "Meridian-style Bayesian" : "Robyn-style"} quality metrics used for model ranking.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <MetricBox label="Train R²" value={modelResult.trainMetrics.r2.toFixed(3)} color={modelResult.trainMetrics.r2 > 0.7 ? "green" : "blue"} />
                      <MetricBox label="Test R²" value={modelResult.testMetrics.r2.toFixed(3)} color={modelResult.testMetrics.r2 > 0.7 ? "green" : "blue"} />
                      <MetricBox label="Train MAPE" value={(modelResult.trainMetrics.mape * 100).toFixed(1) + "%"} />
                      <MetricBox label="Test MAPE" value={(modelResult.testMetrics.mape * 100).toFixed(1) + "%"} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <MetricBox label="NRMSE" value={(modelResult.testMetrics.nrmse || 0).toFixed(4)} color={(modelResult.testMetrics.nrmse || 1) < 0.1 ? "green" : "blue"} />
                      <MetricBox label="DECOMP.RSSD" value={(modelResult.decompRssd || 0).toFixed(4)} color={(modelResult.decompRssd || 1) < 0.2 ? "green" : "blue"} />
                      <MetricBox label="Pareto Score" value={(modelResult.modelScore || 0).toFixed(4)} color={(modelResult.modelScore || 1) < 0.15 ? "green" : "blue"} />
                      <MetricBox label={modelResult.method === "bayesian" ? "Estimation" : "Ridge \u03BB"} value={modelResult.method === "bayesian" ? "MAP" : String(modelResult.ridgeLambda || "?")} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                      <MetricBox label="Train RMSE" value={Math.round(modelResult.trainMetrics.rmse).toLocaleString()} />
                      <MetricBox label="Test RMSE" value={Math.round(modelResult.testMetrics.rmse).toLocaleString()} />
                      <MetricBox label="Overfit Gap" value={(modelResult.overfitGap || 0).toFixed(3)} color={(modelResult.overfitGap || 0) < 0.1 ? "green" : "red"} />
                      <MetricBox label="Max Ch. %" value={Math.round(modelResult.maxContribPct || 0) + "%"} color={(modelResult.maxContribPct || 0) < 40 ? "green" : "red"} />
                    </div>
                    <div style={{ padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.6, background: modelResult.testMetrics.r2 > 0.6 ? "#f0fdf4" : "#fef2f2", color: modelResult.testMetrics.r2 > 0.6 ? "#15803d" : "#991b1b", marginBottom: 16 }}>
                      {modelResult.testMetrics.r2 > 0.8 ? "Excellent model fit — high predictive accuracy on unseen data. Reliable for budget optimization." :
                       modelResult.testMetrics.r2 > 0.6 ? "Good fit — the model captures main KPI trends. Suitable for directional budget planning." :
                       modelResult.testMetrics.r2 > 0.3 ? "Moderate fit — predictions have meaningful signal but high noise. Consider tuning hyperparameters, adding features, or increasing iterations." :
                       "Weak fit — model has limited predictive power. Try different hyperparameter ranges, check variable selection, or investigate data quality."}
                    </div>

                    {modelResult.method === "bayesian" && (
                      <div style={{ marginBottom: 16, border: "2px solid #16a34a", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ background: "#16a34a", color: "white", padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>
                          Bayesian MAP Estimation (Google Meridian)
                        </div>
                        <div style={{ padding: 14, background: "#f0fdf4" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                            <div style={{ padding: 8, background: "white", borderRadius: 6, border: "1px solid #bbf7d0" }}>
                              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Media Prior</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>HalfNormal({priorConfig.mediaSigma.toFixed(1)})</div>
                            </div>
                            <div style={{ padding: 8, background: "white", borderRadius: 6, border: "1px solid #bbf7d0" }}>
                              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Non-Media Prior</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed" }}>Normal(0, {priorConfig.nonMediaSigma.toFixed(1)})</div>
                            </div>
                            <div style={{ padding: 8, background: "white", borderRadius: 6, border: "1px solid #bbf7d0" }}>
                              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>Estimation</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e40af" }}>Maximum A Posteriori</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.5 }}>
                            Coefficients estimated via Bayesian MAP with informative priors. Media betas constrained to be positive (HalfNormal prior). {bootstrapResults ? "Bootstrap confidence intervals computed with " + bootstrapResults.samples.length + " resamples." : "Enable Bootstrap CI in settings for uncertainty estimates."}
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 8 }}>Hyperparameters & Coefficients for this Model</div>
                    <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #e5e7eb", maxHeight: 300, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr style={{ backgroundColor: "#f9fafb", position: "sticky", top: 0 }}>
                          <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>CHANNEL</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>BETA (β)</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>CONTRIBUTION %</th>
                          <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>ADSTOCK</th>
                          <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>SATURATION</th>
                          {modelResult.method === "bayesian" && bootstrapResults ? <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#16a34a", fontSize: 10 }}>CI 2.5%</th> : null}
                          {modelResult.method === "bayesian" && bootstrapResults ? <th style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "#16a34a", fontSize: 10 }}>CI 97.5%</th> : null}
                          {modelResult.method === "bayesian" && bootstrapResults ? <th style={{ padding: "6px 8px", textAlign: "center", fontWeight: 600, color: "#16a34a", fontSize: 10 }}>SIG</th> : null}
                        </tr></thead>
                        <tbody>
                          {mediaCols.map(function(col, i) {
                            var beta = modelResult.beta ? modelResult.beta[i] : 0;
                            var contribPct = modelResult.contribPct ? (modelResult.contribPct[col] || 0) : 0;
                            var adP = modelResult.combo && modelResult.combo.adstock ? modelResult.combo.adstock[col] : null;
                            var satP = modelResult.combo && modelResult.combo.sat ? modelResult.combo.sat[col] : null;
                            var adStr = "";
                            if (adP) {
                              if (adP.theta != null) adStr = "θ=" + adP.theta.toFixed(3);
                              else if (adP.shape != null) adStr = "sh=" + adP.shape.toFixed(2) + " sc=" + adP.scale.toFixed(3);
                            }
                            var satStr = "";
                            if (satP) {
                              var parts = [];
                              if (satP.alpha != null) parts.push("α=" + satP.alpha.toFixed(2));
                              if (satP.gamma != null) parts.push("γ=" + satP.gamma.toFixed(2));
                              if (satP.beta != null) parts.push("β=" + satP.beta.toFixed(2));
                              satStr = parts.join(" ");
                            }
                            return (
                              <tr key={col} style={{ borderTop: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "5px 8px", fontWeight: 500, color: "#334155" }}>{col.replace(/_spend$/, "")}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: beta > 0 ? "#16a34a" : "#dc2626" }}>{beta.toFixed(4)}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right" }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                    <div style={{ width: 40, height: 5, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                                      <div style={{ width: Math.min(100, contribPct) + "%", height: "100%", background: "#2563eb", borderRadius: 3 }}></div>
                                    </div>
                                    <span style={{ fontFamily: "monospace", fontSize: 10 }}>{contribPct.toFixed(1)}%</span>
                                  </div>
                                </td>
                                <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#6b7280" }}>{adStr || "—"}</td>
                                <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#6b7280" }}>{satStr || "—"}</td>
                                {modelResult.method === "bayesian" && bootstrapResults ? (function() {
                                  var ci = bootstrapResults;
                                  var lo = ci.lower && ci.lower[i] != null ? ci.lower[i] : null;
                                  var hi = ci.upper && ci.upper[i] != null ? ci.upper[i] : null;
                                  var sig = lo != null && lo > 0 ? "Yes" : "No";
                                  return [
                                    React.createElement("td", { key: "lo", style: { padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: "#16a34a" } }, lo != null ? lo.toFixed(4) : "-"),
                                    React.createElement("td", { key: "hi", style: { padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 10, color: "#16a34a" } }, hi != null ? hi.toFixed(4) : "-"),
                                    React.createElement("td", { key: "sig", style: { padding: "5px 8px", textAlign: "center" } },
                                      React.createElement("span", { style: { fontSize: 9, fontWeight: 700, background: sig === "Yes" ? "#dcfce7" : "#fef2f2", color: sig === "Yes" ? "#166534" : "#991b1b", padding: "2px 6px", borderRadius: 3 } }, sig === "Yes" ? "***" : "n.s.")
                                    )
                                  ];
                                })() : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <button onClick={function() {
                        var headers = ["Channel", "Beta", "Contribution %", "Adstock Params", "Saturation Params"];
                        var rows = mediaCols.map(function(col, i) {
                          var beta = modelResult.beta ? modelResult.beta[i] : 0;
                          var contribPct = modelResult.contribPct ? (modelResult.contribPct[col] || 0) : 0;
                          var adP = modelResult.combo && modelResult.combo.adstock ? modelResult.combo.adstock[col] : {};
                          var satP = modelResult.combo && modelResult.combo.sat ? modelResult.combo.sat[col] : {};
                          return [col, beta.toFixed(6), contribPct.toFixed(2), JSON.stringify(adP || {}), JSON.stringify(satP || {})];
                        });
                        downloadCSV("mmm_model_params.csv", headers, rows);
                      }} style={{ padding: "5px 12px", border: "1px solid #2563eb", borderRadius: 6, background: "white", color: "#2563eb", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                        Export Model Params CSV
                      </button>
                    </div>

                    {modelResult.method === "bayesian" && (
                      <Card title="Prior Influence Analysis">
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>Shows how strongly each channel's prior influenced the final coefficient estimate. Stronger priors (smaller sigma) pull the estimate more toward zero.</div>
                        <div style={{ maxHeight: 300, overflowY: "auto" }}>
                          {mediaCols.map(function(col, i) {
                            var beta = modelResult.beta ? modelResult.beta[i] : 0;
                            var chPrior = (priorConfig.channelPriors || {})[col] || {};
                            var sigma = chPrior.sigma !== undefined ? chPrior.sigma : priorConfig.mediaSigma;
                            var priorStrength = Math.max(0, Math.min(100, Math.round(100 * (1 - sigma / 20))));
                            return (
                              React.createElement("div", { key: col, style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #f1f5f9" } },
                                React.createElement("div", { style: { width: 140, fontSize: 10, fontWeight: 500, color: "#334155" } }, col.replace(/_spend$/, "")),
                                React.createElement("div", { style: { flex: 1, height: 14, background: "#f1f5f9", borderRadius: 7, overflow: "hidden", position: "relative" } },
                                  React.createElement("div", { style: { width: priorStrength + "%", height: "100%", background: "linear-gradient(90deg, #bbf7d0, #16a34a)", borderRadius: 7 } })
                                ),
                                React.createElement("div", { style: { width: 60, fontSize: 10, color: "#6b7280", textAlign: "right" } }, "σ=" + sigma.toFixed(1)),
                                React.createElement("div", { style: { width: 70, fontSize: 10, fontFamily: "monospace", color: "#1e40af", textAlign: "right" } }, "β=" + beta.toFixed(4))
                              )
                            );
                          })}
                        </div>
                      </Card>
                    )}
                  </Card>
                )}

                {resultTab === "fit" && (
                  <Card title="Actual vs Predicted">
                    <p style={{ color: "#64748b", fontSize: 11, marginBottom: 8 }}>Weekly {targetCol}: actual (blue) vs model prediction (orange dashed). Train/test split at {modelResult.splitIdx ? (Math.round(modelResult.splitIdx / (modelResult.ytr.length + modelResult.yte.length) * 100)) + "% of data" : "80%"}. Test R² = {modelResult.testMetrics.r2.toFixed(3)}, MAPE = {(modelResult.testMetrics.mape * 100).toFixed(1)}%.</p>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={fitData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(fitData.length / 10)} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                        <Tooltip formatter={function(v) { return typeof v === "number" ? "$" + v.toLocaleString() : v; }} />
                        <Legend />
                        <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={1.5} dot={false} name="Actual" />
                        <Line type="monotone" dataKey="predicted" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Predicted" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Card>
                )}

                {resultTab === "decomp" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                      <button onClick={function() {
                        var headers = ["Channel", "Contribution %", "Beta"];
                        var rows = decompData.map(function(d) { return [d.name, d.pct, d.beta || ""]; });
                        downloadCSV("mmm_decomposition.csv", headers, rows);
                      }} style={{ padding: "5px 12px", border: "1px solid #2563eb", borderRadius: 6, background: "white", color: "#2563eb", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                        Export Decomposition CSV
                      </button>
                    </div>
                    <Card title="Total Contribution (including base)">
                      <ResponsiveContainer width="100%" height={Math.max(200, decompData.length * 28)}>
                        <BarChart data={decompData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={function(v) { return v.toFixed(0) + "%"; }} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                          <Tooltip formatter={function(v) { return v + "%"; }} />
                          <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                            {decompData.map(function(d, i) { return <Cell key={i} fill={d.fill} />; })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                    {mediaShareData.length > 0 && (
                      <Card title="Media Channel Share (media only)">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "center" }}>
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie data={mediaShareData} dataKey="pct" nameKey="name" cx="50%" cy="50%"
                                outerRadius={85} innerRadius={40}
                                label={function(entry) { return entry.name.replace(/_spend/g, "") + ": " + entry.pct.toFixed(0) + "%"; }}
                                labelLine={{ strokeWidth: 1 }}>
                                {mediaShareData.map(function(_, i) { return <Cell key={i} fill={COLORS[i % COLORS.length]} />; })}
                              </Pie>
                              <Tooltip formatter={function(v) { return v + "%"; }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div>
                            {mediaShareData.map(function(d, i) {
                              return (
                                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                  <div style={{ width: 12, height: 12, borderRadius: 3, background: COLORS[i % COLORS.length] }}></div>
                                  <span style={{ fontSize: 13, flex: 1 }}>{d.name}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.pct.toFixed(1)}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>
                )}

                {resultTab === "response" && (
                  <Card title="Response Curves">
                    <p style={{ color: "#64748b", fontSize: 11, marginBottom: 12 }}>Each curve shows predicted {targetCol} contribution vs. spend for this model's fitted parameters ({adstockType.replace("_", " ")} adstock, {satFunction.replace("_", " ")} saturation). Flatter regions = diminishing returns. These curves drive the budget optimizer.</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {mediaCols.map(function(col, i) {
                        return (
                          <div key={col}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "#475569", marginBottom: 4 }}>{col}</div>
                            <ResponsiveContainer width="100%" height={160}>
                              <LineChart data={modelResult.responseCurves[col] || []}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="spend" tick={{ fontSize: 9 }} tickFormatter={function(v) { return (v/1000).toFixed(0) + "K"; }} />
                                <YAxis tick={{ fontSize: 9 }} />
                                <Tooltip formatter={function(v) { return typeof v === "number" ? v.toLocaleString() : v; }} />
                                <Line type="monotone" dataKey="response" stroke={COLORS[i]} strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {resultTab === "validation" && (
                  <div>
                    {/* Bootstrap CI Results */}
                    {bootstrapResults && (
                      <Card title="Bootstrap Confidence Intervals (95%)">
                        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: "#1e40af", lineHeight: 1.5 }}>
                          <strong>How it works:</strong> The training data was resampled {nBootstrap} times with replacement. The model was re-fit on each sample to estimate uncertainty in all coefficients. Wider intervals = more uncertainty about a channel's true effect.
                        </div>
                        <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead><tr style={{ backgroundColor: "#f9fafb" }}>
                              <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>CHANNEL</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>MEDIAN β</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>2.5% β</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>97.5% β</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>CI WIDTH</th>
                              <th style={{ padding: "7px 8px", textAlign: "center", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>SIGNIFICANT</th>
                            </tr></thead>
                            <tbody>
                              {modelResult.featureNames.map(function(col, j) {
                                if (j >= mediaCols.length + organicCols.length) return null;
                                var lo = bootstrapResults.lower[j] || 0;
                                var hi = bootstrapResults.upper[j] || 0;
                                var med = bootstrapResults.median[j] || 0;
                                var sig = (lo > 0 && hi > 0) || (lo < 0 && hi < 0);
                                var ciWidth = Math.abs(hi - lo);
                                return (
                                  <tr key={col} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 8px", fontWeight: 500, color: "#334155" }}>{col.replace(/_spend$/, "")}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{med.toFixed(2)}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>{lo.toFixed(2)}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>{hi.toFixed(2)}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{ciWidth.toFixed(2)}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "center" }}>
                                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: sig ? "#dcfce7" : "#fee2e2", color: sig ? "#166534" : "#991b1b" }}>{sig ? "Yes" : "No"}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>Coefficient Distributions</div>
                          <ResponsiveContainer width="100%" height={Math.max(160, Math.min(mediaCols.length, 8) * 30)}>
                            <BarChart data={mediaCols.slice(0, 8).map(function(col, j) {
                              return { name: col.replace(/_spend$/, "").slice(0, 12), median: Number((bootstrapResults.median[j] || 0).toFixed(2)), low: Number((bootstrapResults.lower[j] || 0).toFixed(2)), high: Number((bootstrapResults.upper[j] || 0).toFixed(2)) };
                            })} layout="vertical" margin={{ left: 80, right: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis type="number" tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={75} />
                              <Tooltip />
                              <Bar dataKey="low" fill="#bfdbfe" name="2.5% CI" barSize={6} />
                              <Bar dataKey="median" fill="#2563eb" name="Median β" barSize={6} />
                              <Bar dataKey="high" fill="#93c5fd" name="97.5% CI" barSize={6} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* CV Results */}
                    {cvResults && (
                      <Card title="Expanding Window Cross-Validation">
                        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 11, color: "#166534", lineHeight: 1.5 }}>
                          <strong>Time-Series CV:</strong> The data is split into {cvResults.nFolds} expanding windows. Each fold trains on all prior data and tests on the next period. This is more realistic than random CV for time-series data — it simulates how the model would perform predicting forward in time.
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                          <MetricBox label="Avg CV R²" value={cvResults.avgR2.toFixed(3)} color={cvResults.avgR2 > 0.6 ? "green" : "blue"} />
                          <MetricBox label="Avg CV MAPE" value={(cvResults.avgMape * 100).toFixed(1) + "%"} color={cvResults.avgMape < 0.15 ? "green" : "red"} />
                          <MetricBox label="Avg CV NRMSE" value={cvResults.avgNrmse.toFixed(4)} color={cvResults.avgNrmse < 0.1 ? "green" : "blue"} />
                        </div>
                        <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead><tr style={{ backgroundColor: "#f9fafb" }}>
                              <th style={{ padding: "7px 8px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>FOLD</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>TRAIN SIZE</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>TEST SIZE</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>R²</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>MAPE</th>
                              <th style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 10 }}>NRMSE</th>
                            </tr></thead>
                            <tbody>
                              {cvResults.folds.map(function(f) {
                                return (
                                  <tr key={f.fold} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 8px", fontWeight: 500 }}>Fold {f.fold}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{f.trainSize}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{f.testSize}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: f.r2 > 0.6 ? "#16a34a" : f.r2 > 0.3 ? "#ca8a04" : "#dc2626", fontWeight: 600 }}>{f.r2.toFixed(3)}</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{(f.mape * 100).toFixed(1)}%</td>
                                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{f.nrmse.toFixed(4)}</td>
                                  </tr>
                                );
                              })}
                              <tr style={{ borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
                                <td style={{ padding: "5px 8px" }}>Average</td>
                                <td style={{ padding: "5px 8px" }}></td>
                                <td style={{ padding: "5px 8px" }}></td>
                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb" }}>{cvResults.avgR2.toFixed(3)}</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb" }}>{(cvResults.avgMape * 100).toFixed(1)}%</td>
                                <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb" }}>{cvResults.avgNrmse.toFixed(4)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={cvResults.folds.map(function(f) { return { name: "Fold " + f.fold, r2: Number(f.r2.toFixed(3)) }; })}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                              <Tooltip />
                              <Bar dataKey="r2" fill="#2563eb" name="R²" radius={[4, 4, 0, 0]} />
                              <ReferenceLine y={cvResults.avgR2} stroke="#f97316" strokeDasharray="3 3" label={{ value: "Avg", fill: "#f97316", fontSize: 10 }} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {!bootstrapResults && !cvResults && (
                      <Card>
                        <div style={{ textAlign: "center", padding: 32, color: "#94a3b8" }}>
                          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>No Validation Results</p>
                          <p style={{ fontSize: 12 }}>Enable Bootstrap CI and/or Expanding Window CV in the Configure step (Model Settings tab), then retrain to see validation results here.</p>
                        </div>
                      </Card>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                  <button onClick={function() { setStep(3); }} style={{ padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Back</button>
                  <button onClick={function() { setStep(5); }} style={{ background: "#2563eb", color: "white", border: "none", padding: "10px 24px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>Budget Optimizer <ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: BUDGET OPTIMIZER ── */}
        {step === 5 && filteredData && (
          <div>
            {!modelResult ? (
              <Card title="Budget Optimizer">
                <div style={{ textAlign: "center", padding: 32 }}>
                  <DollarSign size={32} style={{ color: "#d1d5db", display: "block", margin: "0 auto 12px" }} />
                  <p style={{ color: "#6b7280", fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Train a model first</p>
                  <p style={{ color: "#94a3b8", fontSize: 12 }}>The budget optimizer uses your trained MMM equation to predict how different spend allocations affect your KPI. Go to Step 3 to configure and train a model, then come back here to optimize your budget.</p>
                </div>
              </Card>
            ) : (
              <div>
                {/* ── How It Works ── */}
                <Card title="Budget Optimizer">
                  <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1e40af", marginBottom: 6 }}>How the Optimizer Works</div>
                    <div style={{ fontSize: 11, color: "#1e40af", lineHeight: 1.6 }}>
                      This optimizer uses the trained MMM equation (KPI = Intercept + Media Effects + Organic/Context) to predict how different spend allocations affect your target metric. It applies the <strong>equimarginal principle</strong> to find the spend mix where every channel delivers the same marginal return per dollar, maximizing the target for your budget. All predictions come directly from your trained model — no external assumptions.
                    </div>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>Choose Optimization Mode</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {[
                      { key: "maximize", label: "Maximize " + targetCol, desc: "You set the total budget. Optimizer finds the best channel split to maximize predicted " + targetCol + "." },
                      { key: "target", label: "Hit " + targetCol + " Target", desc: "You set a " + targetCol + " goal. Optimizer finds the minimum budget needed and how to allocate it." },
                      { key: "scenarios", label: "Scenario Curve", desc: "Compare 9 budget levels (50% to 200% of current) to see how " + targetCol + " scales with spend." }
                    ].map(function(m) {
                      return (
                        <button key={m.key} onClick={function() { setOptMode(m.key); setOptResult(null); }}
                          style={{ flex: 1, padding: "10px 12px", border: optMode === m.key ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 8, background: optMode === m.key ? "#eff6ff" : "white", cursor: "pointer", textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: optMode === m.key ? "#2563eb" : "#334155" }}>{m.label}</div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.4 }}>{m.desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Budget / Target Input ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                    {optMode !== "target" && (
                      <div>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>Total Weekly Budget ($)</label>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>Enter the total weekly media budget you want to allocate across channels. Use the quick buttons below or type a custom amount.</div>
                        <input type="number" value={targetBudget || ""} placeholder={fmt(currentTotal)}
                          onChange={function(e) { setTargetBudget(parseInt(e.target.value) || 0); }}
                          style={{ width: "100%", padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, fontFamily: "monospace" }} />
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Your current avg weekly spend is <strong>{fmt(currentTotal)}</strong>. Click a quick scenario or enter your own.</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                          {[0.7, 0.85, 1.0, 1.15, 1.3, 1.5].map(function(mult) {
                            var val = Math.round(currentTotal * mult);
                            var lb = mult === 1 ? "Current" : (mult < 1 ? "-" + Math.round((1 - mult) * 100) + "%" : "+" + Math.round((mult - 1) * 100) + "%");
                            return (
                              <button key={mult} onClick={function() { setTargetBudget(val); }}
                                style={{ padding: "4px 8px", border: targetBudget === val ? "1.5px solid #2563eb" : "1px solid #e2e8f0", borderRadius: 4, background: targetBudget === val ? "#eff6ff" : "#f8fafc", color: targetBudget === val ? "#2563eb" : "#6b7280", fontSize: 10, cursor: "pointer", fontWeight: 500 }}>
                                {lb}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {optMode === "target" && (
                      <div>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>{targetCol} Target (/week)</label>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>What weekly {targetCol} do you want to achieve? The optimizer will find the minimum budget and optimal allocation to reach this target.</div>
                        <input type="number" value={revenueTarget || ""} placeholder={fmt(Math.round(currentResponse.total || 0))}
                          onChange={function(e) { setRevenueTarget(parseInt(e.target.value) || 0); }}
                          style={{ width: "100%", padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, fontFamily: "monospace" }} />
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Your model currently predicts <strong>{fmt(Math.round(currentResponse.total || 0))}</strong>/week {targetCol}. Set a target above this to see what budget you need.</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                          {[1.05, 1.1, 1.15, 1.2, 1.3].map(function(mult) {
                            var val = Math.round((currentResponse.total || 0) * mult);
                            return (
                              <button key={mult} onClick={function() { setRevenueTarget(val); }}
                                style={{ padding: "4px 8px", border: revenueTarget === val ? "1.5px solid #2563eb" : "1px solid #e2e8f0", borderRadius: 4, background: revenueTarget === val ? "#eff6ff" : "#f8fafc", color: revenueTarget === val ? "#2563eb" : "#6b7280", fontSize: 10, cursor: "pointer", fontWeight: 500 }}>
                                +{Math.round((mult - 1) * 100)}%
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Current Performance</label>
                      <div style={{ background: "#f8fafc", borderRadius: 8, padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#64748b" }}>Avg Weekly Spend</span>
                          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{fmt(currentTotal)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#64748b" }}>Predicted {targetCol}</span>
                          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "#16a34a" }}>{fmt(Math.round(currentResponse.total || 0))}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, color: "#64748b" }}>Baseline (no media)</span>
                          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 500, color: "#94a3b8" }}>{fmt(Math.round(currentResponse.baseline || 0))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* ── Per-Channel Constraints ── */}
                <Card title="Per-Channel Constraints (Min / Max Weekly Spend)">
                  <p style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Set minimum and maximum weekly spend limits for each channel. The optimizer will respect these bounds when allocating budget.</p>
                  <p style={{ color: "#94a3b8", fontSize: 10, marginBottom: 8 }}>Leave fields blank for no constraint. Tip: use "Auto-fill" to quickly set reasonable limits based on your current spend, then adjust individual channels. Make sure the sum of minimums is less than your total budget.</p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
                    <button onClick={function() {
                      var b = {};
                      mediaCols.forEach(function(col) {
                        var avg = currentAlloc[col] || 0;
                        b[col] = { min: Math.round(avg * 0.5), max: Math.round(avg * 1.5) };
                      });
                      setChannelBounds(b);
                    }} style={{ padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#f8fafc", color: "#475569", fontSize: 10, cursor: "pointer" }}>
                      Auto-fill (50%-150% of current)
                    </button>
                    <button onClick={function() { setChannelBounds({}); }}
                      style={{ padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 4, background: "#f8fafc", color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>
                      Clear All
                    </button>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Channel</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Current Avg</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Min ($)</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Max ($)</th>
                      </tr></thead>
                      <tbody>
                        {mediaCols.map(function(col) {
                          var cb = channelBounds[col] || {};
                          var avg = currentAlloc[col] || 0;
                          return (
                            <tr key={col} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "5px 8px", fontWeight: 500, color: "#334155", fontSize: 11 }}>{col.replace(/_spend/g, "")}</td>
                              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8", fontSize: 11 }}>{fmt(avg)}</td>
                              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                <input type="number" value={cb.min != null ? cb.min : ""} placeholder="0"
                                  onChange={function(e) { var v = e.target.value === "" ? undefined : parseInt(e.target.value); setChannelBounds(function(prev) { var next = Object.assign({}, prev); next[col] = Object.assign({}, prev[col] || {}, { min: v }); return next; }); }}
                                  style={{ width: 70, padding: "4px 6px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                              </td>
                              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                                <input type="number" value={cb.max != null ? cb.max : ""} placeholder="no limit"
                                  onChange={function(e) { var v = e.target.value === "" ? undefined : parseInt(e.target.value); setChannelBounds(function(prev) { var next = Object.assign({}, prev); next[col] = Object.assign({}, prev[col] || {}, { max: v }); return next; }); }}
                                  style={{ width: 70, padding: "4px 6px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Sum of bounds check */}
                  {(function() {
                    var sumMin = 0, sumMax = 0, hasMax = false;
                    mediaCols.forEach(function(col) { var cb = channelBounds[col] || {}; sumMin += (cb.min || 0); if (cb.max != null) { sumMax += cb.max; hasMax = true; } });
                    return (
                      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: "#64748b" }}>
                        <span>Sum of minimums: <strong style={{ fontFamily: "monospace" }}>{fmt(sumMin)}</strong></span>
                        {hasMax && <span>Sum of maximums: <strong style={{ fontFamily: "monospace" }}>{fmt(Math.round(sumMax))}</strong></span>}
                      </div>
                    );
                  })()}
                </Card>

                {/* ── Run Optimization Button ── */}
                <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12, margin: "12px 0", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                    {optMode === "maximize" && "Click below to find the optimal channel-wise allocation for your budget. The optimizer will redistribute spend to equalize marginal returns across channels."}
                    {optMode === "target" && "Click below to find the minimum budget needed to hit your " + targetCol + " target and how it should be split across channels."}
                    {optMode === "scenarios" && "Click below to generate " + targetCol + " predictions at 9 budget levels (50% to 200% of current). Each scenario uses the optimal allocation for that budget."}
                  </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={function() {
                    if (optMode === "maximize") {
                      var tb = targetBudget || currentTotal;
                      var alloc = optimizeBudget(tb, channelBounds);
                      var resp = simulateBudget(alloc);
                      setBudgetAlloc(alloc);
                      setOptResult({ mode: "maximize", budget: tb, alloc: alloc, revenue: resp.total, mediaRev: resp.mediaTotal, baseline: resp.baseline, responses: resp });
                    } else if (optMode === "target") {
                      var rt = revenueTarget || Math.round((currentResponse.total || 0) * 1.1);
                      var result = optimizeForTarget(rt, channelBounds);
                      var resp2 = simulateBudget(result.alloc);
                      setBudgetAlloc(result.alloc);
                      setOptResult({ mode: "target", revenueTarget: rt, budget: result.budget, alloc: result.alloc, revenue: resp2.total, mediaRev: resp2.mediaTotal, baseline: resp2.baseline, responses: resp2 });
                    } else {
                      var scenarios = generateScenarioCurve(channelBounds);
                      setOptScenarios(scenarios);
                      setOptResult({ mode: "scenarios", scenarios: scenarios });
                    }
                  }} style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", border: "none", padding: "12px 28px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    {optMode === "maximize" ? "Optimize Allocation" : optMode === "target" ? "Find Required Budget" : "Generate Scenarios"}
                  </button>
                  <button onClick={function() { setBudgetAlloc({}); setOptResult(null); setOptScenarios([]); }}
                    style={{ background: "white", color: "#6b7280", border: "1px solid #d1d5db", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 500, fontSize: 13 }}>
                    Reset
                  </button>
                </div>
                </div>

                {/* ── Results: Maximize / Target Mode ── */}
                {optResult && (optResult.mode === "maximize" || optResult.mode === "target") && (
                  <div>
                    {/* Summary metrics */}
                    <Card title={optResult.mode === "target" ? "Required Budget to Hit Target" : "Optimized Budget Allocation"}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                        <MetricBox label="Total Budget" value={fmt(optResult.budget)} />
                        <MetricBox label={"Predicted " + targetCol} value={fmt(Math.round(optResult.revenue))} color="green" />
                        <MetricBox label={"vs Current " + targetCol} value={((currentResponse.total || 0) > 0 ? ((optResult.revenue - currentResponse.total) / currentResponse.total * 100 >= 0 ? "+" : "") + ((optResult.revenue - currentResponse.total) / currentResponse.total * 100).toFixed(1) + "%" : "N/A")} color={(optResult.revenue > (currentResponse.total || 0)) ? "green" : "red"} />
                        <MetricBox label="vs Current Budget" value={currentTotal > 0 ? ((optResult.budget - currentTotal) / currentTotal * 100 >= 0 ? "+" : "") + ((optResult.budget - currentTotal) / currentTotal * 100).toFixed(0) + "%" : "N/A"} />
                      </div>
                      {optResult.mode === "target" && (
                        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                          <span style={{ fontSize: 12, color: "#15803d", fontWeight: 600 }}>To reach {fmt(optResult.revenueTarget)}/week {targetCol}, you need {fmt(optResult.budget)}/week budget ({currentTotal > 0 ? ((optResult.budget - currentTotal) / currentTotal * 100 >= 0 ? "+" : "") + ((optResult.budget - currentTotal) / currentTotal * 100).toFixed(0) + "%" : "N/A"} vs current)</span>
                        </div>
                      )}
                    </Card>

                    {/* Channel allocation table */}
                    <Card title="Channel-Wise Spend Distribution">
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <button onClick={function() {
                          var headers = ["Channel", "Current Spend", "Optimized Spend", "Change %", "% of Budget", "MROI"];
                          var rows = mediaCols.map(function(col) {
                            var cur = currentAlloc[col] || 0;
                            var opt = optResult.alloc[col] || 0;
                            var chg = cur > 0 ? ((opt - cur) / cur * 100) : 0;
                            var pctBudget = optResult.budget > 0 ? (opt / optResult.budget * 100) : 0;
                            var mroi = computeMROI(col, opt);
                            return [col, Math.round(cur), Math.round(opt), chg.toFixed(1) + "%", pctBudget.toFixed(1) + "%", mroi.toFixed(4)];
                          });
                          rows.push(["TOTAL", Math.round(currentTotal), Math.round(optResult.budget), "", "100%", ""]);
                          downloadCSV("mmm_optimized_budget.csv", headers, rows);
                        }} style={{ padding: "5px 12px", border: "1px solid #2563eb", borderRadius: 6, background: "white", color: "#2563eb", fontSize: 11, cursor: "pointer", fontWeight: 500 }}>
                          Export Budget CSV
                        </button>
                      </div>
                      <p style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>Below is the recommended weekly spend for each channel. The optimizer shifted budget from saturated channels (where extra spend has diminishing returns) toward under-invested channels with higher marginal ROI.</p>
                      <p style={{ color: "#94a3b8", fontSize: 10, marginBottom: 8 }}>MROI (Marginal ROI) shows the additional {targetCol} per additional dollar spent. Channels with similar MROI values are optimally balanced. Contribution shows each channel's predicted {targetCol} contribution at the recommended spend level.</p>
                      <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                          <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 }}>
                            <th style={{ padding: "7px 8px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Channel</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Current</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Optimized</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Change</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>% of Budget</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Contribution</th>
                            <th style={{ padding: "7px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>MROI</th>
                          </tr></thead>
                          <tbody>
                            {mediaCols.map(function(col) {
                              var cur = currentAlloc[col] || 0;
                              var opt = optResult.alloc[col] || 0;
                              var chg = cur > 0 ? ((opt - cur) / cur * 100) : 0;
                              var pctBudget = optResult.budget > 0 ? (opt / optResult.budget * 100) : 0;
                              var contrib = optResult.responses ? (optResult.responses[col] || 0) : channelResponse(col, opt);
                              var mroi = computeMROI(col, opt);
                              return (
                                <tr key={col} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                  <td style={{ padding: "6px 8px", fontWeight: 500, color: "#334155" }}>{col.replace(/_spend/g, "")}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8" }}>{fmt(cur)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#1e293b" }}>{fmt(opt)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: chg > 5 ? "#16a34a" : chg < -5 ? "#dc2626" : "#6b7280" }}>
                                    {chg > 0 ? "+" : ""}{chg.toFixed(0)}%
                                  </td>
                                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                      <div style={{ width: 36, height: 5, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                                        <div style={{ width: Math.min(100, pctBudget) + "%", height: "100%", background: "#2563eb", borderRadius: 3 }}></div>
                                      </div>
                                      <span style={{ fontFamily: "monospace", fontSize: 10 }}>{pctBudget.toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#475569" }}>{contrib.toFixed(1)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", color: "#2563eb", fontWeight: 600 }}>{mroi.toFixed(3)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>

                    {/* Allocation bar chart */}
                    <Card title="Current vs Optimized Allocation">
                      <p style={{ color: "#94a3b8", fontSize: 10, marginBottom: 8 }}>Visual comparison of your current average weekly spend (gray) versus the optimizer's recommended allocation (blue). Channels where the blue bar is longer received more budget; channels where it's shorter are being de-prioritized due to saturation.</p>
                      <ResponsiveContainer width="100%" height={Math.max(200, mediaCols.length * 28)}>
                        <BarChart data={mediaCols.map(function(c) { return { name: c.replace(/_spend/g, ""), current: currentAlloc[c], optimized: optResult.alloc[c] || 0 }; })} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={function(v) { return (v / 1000).toFixed(0) + "K"; }} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={110} />
                          <Tooltip formatter={function(v) { return "$" + v.toLocaleString(); }} />
                          <Legend />
                          <Bar dataKey="current" fill="#cbd5e1" name="Current" radius={[0, 3, 3, 0]} barSize={8} />
                          <Bar dataKey="optimized" fill="#2563eb" name="Optimized" radius={[0, 3, 3, 0]} barSize={8} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                  </div>
                )}

                {/* ── Results: Scenario Mode ── */}
                {optResult && optResult.mode === "scenarios" && optScenarios.length > 0 && (
                  <div>
                    <Card title={"Budget vs " + targetCol + " Curve"}>
                      <p style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>This curve shows how {targetCol} responds to different total budget levels, with each point using the optimal channel allocation for that budget. The flattening curve illustrates diminishing returns — each additional dollar of budget generates less incremental {targetCol}.</p>
                      <p style={{ color: "#94a3b8", fontSize: 10, marginBottom: 8 }}>The dashed line shows current (unoptimized) {targetCol} for comparison. Click "View Details" on any row below to see the full channel-wise breakdown for that scenario.</p>
                      <ResponsiveContainer width="100%" height={240}>
                        <ComposedChart data={optScenarios.map(function(s) {
                          return { budget: fmt(s.budget), revenue: Math.round(s.revenue), currentRev: Math.round(currentResponse.total || 0), label: s.mult === 1 ? "Current" : (s.mult < 1 ? -Math.round((1 - s.mult) * 100) + "%" : "+" + Math.round((s.mult - 1) * 100) + "%") };
                        })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={function(v) { return (v / 1000).toFixed(0) + "K"; }} />
                          <Tooltip formatter={function(v) { return "$" + v.toLocaleString(); }} />
                          <Legend />
                          <Bar dataKey="revenue" fill="#2563eb" name={"Optimized " + targetCol} radius={[4, 4, 0, 0]} />
                          <Line type="monotone" dataKey="currentRev" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Current (unoptimized)" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </Card>

                    <Card title="Scenario Comparison">
                      <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                          <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Scenario</th>
                            <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Budget</th>
                            <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Predicted KPI</th>
                            <th style={{ padding: "6px 8px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: 10 }}>vs Current</th>
                            <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600, fontSize: 10 }}>Action</th>
                          </tr></thead>
                          <tbody>
                            {optScenarios.map(function(s) {
                              var pctChg = (currentResponse.total || 0) > 0 ? ((s.revenue - currentResponse.total) / currentResponse.total * 100) : 0;
                              return (
                                <tr key={s.mult} style={{ borderBottom: "1px solid #f1f5f9", background: s.mult === 1 ? "#fffbeb" : "transparent" }}>
                                  <td style={{ padding: "6px 8px", fontWeight: 500 }}>
                                    {s.mult === 1 ? "Current" : (s.mult < 1 ? Math.round((1 - s.mult) * 100) + "% cut" : "+" + Math.round((s.mult - 1) * 100) + "% increase")}
                                  </td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace" }}>{fmt(s.budget)}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(Math.round(s.revenue))}</td>
                                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, color: pctChg > 0 ? "#16a34a" : pctChg < 0 ? "#dc2626" : "#6b7280" }}>
                                    {pctChg > 0 ? "+" : ""}{pctChg.toFixed(1)}%
                                  </td>
                                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                    <button onClick={function() {
                                      setOptMode("maximize");
                                      setTargetBudget(s.budget);
                                      setBudgetAlloc(s.alloc);
                                      var resp = simulateBudget(s.alloc);
                                      setOptResult({ mode: "maximize", budget: s.budget, alloc: s.alloc, revenue: resp.total, mediaRev: resp.mediaTotal, baseline: resp.baseline, responses: resp });
                                    }} style={{ padding: "3px 8px", border: "1px solid #2563eb", borderRadius: 4, background: "white", color: "#2563eb", fontSize: 10, cursor: "pointer", fontWeight: 500 }}>
                                      View Details
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                  <button onClick={function() { setStep(4); }} style={{ padding: "8px 16px", background: "transparent", border: "none", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><ChevronLeft size={14} /> Back</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
