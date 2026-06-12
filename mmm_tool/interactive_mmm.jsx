import { useState, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter,
  Cell, PieChart, Pie, ComposedChart, Area, ReferenceLine
} from "recharts";
import {
  Upload, Settings, BarChart3, TrendingUp, Target, DollarSign,
  ChevronRight, ChevronLeft, Check, AlertTriangle, Play, Database,
  Layers, Zap, Eye, RefreshCw, ArrowRight, X as XIcon, Plus, Minus
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(",");
    const row = {};
    headers.forEach((h, j) => {
      const val = (values[j] || "").trim().replace(/^"|"$/g, "");
      const num = Number(val);
      row[h] = val === "" ? null : isNaN(num) ? val : num;
    });
    data.push(row);
  }
  return { data, columns: headers };
}

function generateSampleData(nWeeks = 156) {
  const data = [];
  const base = new Date("2022-01-03");
  const rng = (seed) => {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
  };
  const random = rng(42);
  const rand = () => (random() - 0.5) * 2;

  let prevTV = 50000, prevDig = 30000, prevSoc = 15000;
  let prevSearch = 20000, prevPrint = 10000, prevRadio = 8000;

  for (let w = 0; w < nWeeks; w++) {
    const d = new Date(base);
    d.setDate(d.getDate() + w * 7);
    const dateStr = d.toISOString().slice(0, 10);
    const s52 = Math.sin(2 * Math.PI * w / 52);
    const s26 = Math.sin(2 * Math.PI * w / 26);
    const month = d.getMonth() + 1;
    const seasonMult = 1 + 0.15 * Math.sin(2 * Math.PI * (month - 3) / 12);

    const tv = Math.max(500, Math.round((0.7 * prevTV + 0.3 * (50000 + rand() * 15000)) * seasonMult));
    const digital = Math.max(500, Math.round((0.7 * prevDig + 0.3 * (30000 + rand() * 10000)) * seasonMult));
    const social = Math.max(200, Math.round((0.7 * prevSoc + 0.3 * (15000 + rand() * 5000)) * seasonMult));
    const search = Math.max(500, Math.round((0.7 * prevSearch + 0.3 * (20000 + rand() * 8000)) * seasonMult));
    const print_ = Math.max(100, Math.round((0.7 * prevPrint + 0.3 * (10000 + rand() * 4000)) * seasonMult));
    const radio = Math.max(100, Math.round((0.7 * prevRadio + 0.3 * (8000 + rand() * 3000)) * seasonMult));
    prevTV = tv; prevDig = digital; prevSoc = social;
    prevSearch = search; prevPrint = print_; prevRadio = radio;

    const organic = Math.max(0, Math.round(5000 + 20 * w + 1000 * s52 + rand() * 500));
    const wom = Math.max(0, Math.round(1000 + rand() * 200));
    const confidence = Math.round((100 + 5 * Math.sin(2 * Math.PI * w / 104) + rand() * 2) * 100) / 100;
    const competitor = Math.max(0, Math.round(40000 + 10000 * Math.sin(2 * Math.PI * w / 52 + 0.8) + rand() * 5000));
    const isHoliday = ([11, 12, 1, 7].includes(month) && random() < 0.3) ? 1 : 0;

    // Revenue — strong media effects for good model fit
    const baseRev = 300000 + 300 * w + 30000 * s52 + 10000 * s26 + 25000 * isHoliday;

    // Media effects with adstock + saturation baked in
    const tvEffect = 3.5 * Math.pow(tv, 0.55);
    const digEffect = 5.0 * Math.pow(digital, 0.50);
    const socEffect = 4.0 * Math.pow(social, 0.48);
    const searchEffect = 6.0 * Math.pow(search, 0.52);
    const printEffect = 2.0 * Math.pow(print_, 0.45);
    const radioEffect = 2.5 * Math.pow(radio, 0.47);
    const mediaEffect = tvEffect + digEffect + socEffect + searchEffect + printEffect + radioEffect;

    const orgEffect = 0.8 * organic + 3.0 * wom;
    const extEffect = 300 * confidence - 0.15 * competitor;
    const noise = rand() * 12000;
    const revenue = Math.max(100000, Math.round(baseRev + mediaEffect + orgEffect + extEffect + noise));

    data.push({
      date: dateStr, tv_spend: tv, digital_spend: digital,
      social_media_spend: social, search_spend: search,
      print_spend: print_, radio_spend: radio,
      organic_traffic: organic, word_of_mouth: wom,
      consumer_confidence: confidence, competitor_spend: competitor,
      is_holiday: isHoliday, revenue
    });
  }
  return data;
}

function geometricAdstock(x, theta = 0.5) {
  const result = new Array(x.length).fill(0);
  result[0] = x[0];
  for (let t = 1; t < x.length; t++) {
    result[t] = x[t] + theta * result[t - 1];
  }
  return result;
}

function hillSaturation(x, alpha = 2.0, gamma = 0.5) {
  const maxVal = Math.max(...x) || 1;
  return x.map(v => {
    const norm = v / maxVal;
    if (norm <= 0) return 0;
    return 1 - 1 / (1 + Math.pow(norm / gamma, alpha));
  });
}

// Min-max normalize to [0, 1]
function minMaxNormalize(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min || 1;
  return { values: arr.map(v => (v - min) / range), min, max, range };
}

function solveSystem(A, b) {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) { aug[col][col] = 1e-12; continue; }
    for (let row = col + 1; row < n; row++) {
      const f = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] = Math.abs(aug[i][i]) > 1e-14 ? x[i] / aug[i][i] : 0;
  }
  return x;
}

function ridgeRegression(X, y, alpha = 1.0) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k < n; k++) XtX[i][j] += X[k][i] * X[k][j];
  for (let i = 0; i < p; i++) XtX[i][i] += alpha * n;
  const Xty = Array(p).fill(0);
  for (let i = 0; i < p; i++)
    for (let k = 0; k < n; k++) Xty[i] += X[k][i] * y[k];
  return solveSystem(XtX, Xty);
}

function computeMetrics(actual, predicted) {
  const n = actual.length;
  if (n === 0) return { r2: 0, mape: 0, rmse: 0, mae: 0 };
  const meanA = actual.reduce((a, b) => a + b, 0) / n;
  const ssTot = actual.reduce((a, v) => a + (v - meanA) ** 2, 0);
  const ssRes = actual.reduce((a, v, i) => a + (v - predicted[i]) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const mape = actual.reduce((a, v, i) => a + (Math.abs(v) > 0 ? Math.abs((v - predicted[i]) / v) : 0), 0) / n;
  const rmse = Math.sqrt(ssRes / n);
  const mae = actual.reduce((a, v, i) => a + Math.abs(v - predicted[i]), 0) / n;
  return { r2, mape, rmse, mae };
}

function computeCorrelation(data, cols) {
  const n = data.length;
  const matrix = [];
  for (let i = 0; i < cols.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < cols.length; j++) {
      const xi = data.map(r => r[cols[i]] || 0);
      const xj = data.map(r => r[cols[j]] || 0);
      const mi = xi.reduce((a, b) => a + b, 0) / n;
      const mj = xj.reduce((a, b) => a + b, 0) / n;
      let num = 0, d1 = 0, d2 = 0;
      for (let k = 0; k < n; k++) {
        num += (xi[k] - mi) * (xj[k] - mj);
        d1 += (xi[k] - mi) ** 2;
        d2 += (xj[k] - mj) ** 2;
      }
      matrix[i][j] = d1 && d2 ? num / Math.sqrt(d1 * d2) : i === j ? 1 : 0;
    }
  }
  return matrix;
}

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#ca8a04", "#e11d48"];
const fmt = (v) => typeof v === "number" ? (Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`) : v;

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

export default function MMMTool() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(null);
  const [columns, setColumns] = useState([]);
  const [dateCol, setDateCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [mediaCols, setMediaCols] = useState([]);
  const [organicCols, setOrganicCols] = useState([]);
  const [contextCols, setContextCols] = useState([]);
  const [adstockParams, setAdstockParams] = useState({});
  const [satParams, setSatParams] = useState({});
  const [regAlpha, setRegAlpha] = useState(1.0);
  const [testPct, setTestPct] = useState(20);
  const [modelResult, setModelResult] = useState(null);
  const [trainError, setTrainError] = useState(null);
  const [isTraining, setIsTraining] = useState(false);
  const [budgetAlloc, setBudgetAlloc] = useState({});
  const [edaTab, setEdaTab] = useState("ts");
  const [configTab, setConfigTab] = useState("adstock");
  const [resultTab, setResultTab] = useState("metrics");
  const fileRef = useRef(null);

  const numericCols = useMemo(() => {
    if (!data || !data.length) return [];
    return columns.filter(c => typeof data[0][c] === "number");
  }, [data, columns]);

  const steps = [
    { name: "Upload", icon: Upload },
    { name: "Map Variables", icon: Database },
    { name: "Explore", icon: Eye },
    { name: "Configure", icon: Settings },
    { name: "Train", icon: Play },
    { name: "Optimize", icon: DollarSign },
  ];

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { data: parsed, columns: cols } = parseCSV(ev.target.result);
      setData(parsed);
      setColumns(cols);
      autoDetect(parsed, cols);
    };
    reader.readAsText(file);
  };

  const loadSample = () => {
    const d = generateSampleData();
    const cols = Object.keys(d[0]);
    setData(d);
    setColumns(cols);
    autoDetect(d, cols);
  };

  const autoDetect = (d, cols) => {
    const dateKw = ["date", "time", "period", "week"];
    const targetKw = ["revenue", "sales", "conversion", "kpi", "target"];
    const spendKw = ["spend", "cost", "budget", "tv", "digital", "social", "search", "print", "radio", "display", "video"];
    const orgKw = ["organic", "seo", "word_of_mouth", "wom", "email_list", "subscriber"];
    const ctxKw = ["holiday", "competitor", "confidence", "gdp", "temperature", "weather", "inflation"];

    const dc = cols.find(c => dateKw.some(k => c.toLowerCase().includes(k)));
    const tc = cols.filter(c => typeof d[0][c] === "number").find(c => targetKw.some(k => c.toLowerCase().includes(k)));
    const mc = cols.filter(c => typeof d[0][c] === "number" && c !== tc && spendKw.some(k => c.toLowerCase().includes(k)));
    const oc = cols.filter(c => typeof d[0][c] === "number" && c !== tc && !mc.includes(c) && orgKw.some(k => c.toLowerCase().includes(k)));
    const cc = cols.filter(c => typeof d[0][c] === "number" && c !== tc && !mc.includes(c) && !oc.includes(c) && ctxKw.some(k => c.toLowerCase().includes(k)));

    if (dc) setDateCol(dc);
    if (tc) setTargetCol(tc);
    setMediaCols(mc);
    setOrganicCols(oc);
    setContextCols(cc);

    const ap = {}, sp = {};
    mc.forEach(c => {
      const isLong = c.toLowerCase().includes("tv") || c.toLowerCase().includes("radio") || c.toLowerCase().includes("print");
      ap[c] = { theta: isLong ? 0.6 : 0.3 };
      sp[c] = { alpha: 2.0, gamma: 0.5 };
    });
    setAdstockParams(ap);
    setSatParams(sp);
  };

  // ═══════════════════════════════════════════════════════════════
  // TRAIN MODEL — core MMM pipeline
  // ═══════════════════════════════════════════════════════════════

  const trainModel = () => {
    try {
      setTrainError(null);
      setIsTraining(true);
      setModelResult(null);

      const allFeatures = [...mediaCols, ...organicCols, ...contextCols];
      if (!allFeatures.length) throw new Error("No features selected");
      if (!targetCol) throw new Error("No target column selected");

      const n = data.length;
      const splitIdx = Math.floor(n * (1 - testPct / 100));
      if (splitIdx < 10) throw new Error("Not enough training data");

      // Step 1: Transform media columns (adstock -> saturation)
      // Result is [0, ~1] for each media channel
      const transformedData = data.map(row => {
        const newRow = {};
        allFeatures.forEach(col => { newRow[col] = row[col] || 0; });
        return newRow;
      });

      mediaCols.forEach(col => {
        const raw = data.map(r => r[col] || 0);
        const params = adstockParams[col] || { theta: 0.5 };
        const adstocked = geometricAdstock(raw, params.theta);
        const sp = satParams[col] || { alpha: 2.0, gamma: 0.5 };
        const saturated = hillSaturation(adstocked, sp.alpha, sp.gamma);
        saturated.forEach((v, i) => { transformedData[i][col] = v; });
      });

      // Step 2: Min-max normalize ALL features to [0, 1]
      // Using TRAINING data stats only (prevent data leakage)
      const normStats = {};
      allFeatures.forEach(col => {
        const trainVals = transformedData.slice(0, splitIdx).map(r => r[col]);
        const min = Math.min(...trainVals);
        const max = Math.max(...trainVals);
        const range = (max - min) || 1;
        normStats[col] = { min, max, range };
      });

      // Build feature matrix (normalized to 0-1)
      const X = transformedData.map(row =>
        allFeatures.map(col => {
          const s = normStats[col];
          return Math.max(0, Math.min(1, (row[col] - s.min) / s.range));
        })
      );

      const y = data.map(r => r[targetCol] || 0);
      const Xtr = X.slice(0, splitIdx), Xte = X.slice(splitIdx);
      const ytr = y.slice(0, splitIdx), yte = y.slice(splitIdx);

      // Step 3: Ridge regression
      let beta = ridgeRegression(Xtr, ytr, regAlpha);

      // Enforce positive coefficients for media channels
      beta = beta.map((b, i) => i < mediaCols.length ? Math.max(0, b) : b);

      // Compute intercept: y_mean = intercept + sum(beta_j * x_mean_j)
      const yMean = ytr.reduce((a, b) => a + b, 0) / ytr.length;
      const xMeans = allFeatures.map((_, j) =>
        Xtr.reduce((s, r) => s + r[j], 0) / Xtr.length
      );
      const intercept = yMean - beta.reduce((s, b, j) => s + b * xMeans[j], 0);

      // Step 4: Predictions
      const predict = (Xm) => Xm.map(row =>
        intercept + row.reduce((s, v, i) => s + v * beta[i], 0)
      );
      const ytrPred = predict(Xtr);
      const ytePred = predict(Xte);

      // Step 5: Metrics
      const trainMetrics = computeMetrics(ytr, ytrPred);
      const testMetrics = computeMetrics(yte, ytePred);

      // Step 6: Decomposition — contribution = coeff * mean(normalized feature)
      // This represents "how much revenue does each feature contribute at its average level"
      const contributions = {};
      let totalContrib = 0;

      allFeatures.forEach((col, j) => {
        const c = Math.abs(beta[j]) * Math.abs(xMeans[j]);
        contributions[col] = c;
        totalContrib += c;
      });
      contributions["base (intercept)"] = Math.abs(intercept);
      totalContrib += Math.abs(intercept);

      const contribPct = {};
      Object.keys(contributions).forEach(k => {
        contribPct[k] = totalContrib > 0 ? (contributions[k] / totalContrib * 100) : 0;
      });

      // Also compute media-only share (excluding base)
      const mediaOnlyTotal = mediaCols.reduce((s, c) => s + (contributions[c] || 0), 0);
      const mediaSharePct = {};
      mediaCols.forEach(c => {
        mediaSharePct[c] = mediaOnlyTotal > 0 ? (contributions[c] / mediaOnlyTotal * 100) : 0;
      });

      // Step 7: Response curves
      const responseCurves = {};
      mediaCols.forEach((col, idx) => {
        const raw = data.map(r => r[col] || 0);
        const maxSpend = Math.max(...raw) * 1.5 || 1;
        const sp = satParams[col] || { alpha: 2.0, gamma: 0.5 };
        const points = [];
        for (let s = 0; s <= 50; s++) {
          const spend = (s / 50) * maxSpend;
          const adstocked = spend * (1 + (adstockParams[col]?.theta || 0.5));
          const maxAdstocked = maxSpend * (1 + (adstockParams[col]?.theta || 0.5));
          const norm = maxAdstocked > 0 ? adstocked / maxAdstocked : 0;
          const sat = norm > 0 ? 1 - 1 / (1 + Math.pow(norm / sp.gamma, sp.alpha)) : 0;
          const response = sat * Math.abs(beta[idx]);
          points.push({ spend: Math.round(spend), response: Math.round(response) });
        }
        responseCurves[col] = points;
      });

      // Budget allocation initialization
      const ba = {};
      mediaCols.forEach(col => {
        ba[col] = Math.round(data.reduce((s, r) => s + (r[col] || 0), 0) / n);
      });
      setBudgetAlloc(ba);

      setModelResult({
        beta, intercept, featureNames: allFeatures, normStats,
        trainMetrics, testMetrics,
        ytr, yte, ytrPred, ytePred,
        splitIdx, contribPct, contributions, mediaSharePct,
        responseCurves,
        dates: data.map(r => r[dateCol] || ""),
        xMeans,
      });
      setIsTraining(false);
    } catch (err) {
      setTrainError(err.message || "Unknown error during training");
      setIsTraining(false);
    }
  };

  const simulateBudget = useCallback((alloc) => {
    if (!modelResult) return {};
    const responses = {};
    let total = 0;
    mediaCols.forEach((col, idx) => {
      const raw = data.map(r => r[col] || 0);
      const maxSpend = Math.max(...raw) * 1.5 || 1;
      const sp = satParams[col] || { alpha: 2.0, gamma: 0.5 };
      const ap = adstockParams[col] || { theta: 0.5 };
      const adstocked = alloc[col] * (1 + ap.theta);
      const maxAdstocked = maxSpend * (1 + ap.theta);
      const norm = maxAdstocked > 0 ? adstocked / maxAdstocked : 0;
      const sat = norm > 0 ? 1 - 1 / (1 + Math.pow(norm / sp.gamma, sp.alpha)) : 0;
      const resp = sat * Math.abs(modelResult.beta[idx]);
      responses[col] = resp;
      total += resp;
    });
    responses.total = total;
    return responses;
  }, [modelResult, mediaCols, data, satParams, adstockParams]);

  // ═════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═════════════════════════════════════════════════════════════

  const StepNav = () => (
    <div className="flex items-center justify-between mb-6 bg-white rounded-xl shadow p-3 overflow-x-auto">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <button key={i} onClick={() => setStep(i)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              step === i ? "bg-blue-600 text-white" :
              i < step ? "bg-green-50 text-green-700" : "text-gray-400 hover:text-gray-600"
            }`}>
            {i < step ? <Check size={16} /> : <Icon size={16} />}
            <span className="hidden sm:inline">{s.name}</span>
          </button>
        );
      })}
    </div>
  );

  const Card = ({ title, children, className = "" }) => (
    <div className={`bg-white rounded-xl shadow p-5 mb-4 ${className}`}>
      {title && <h3 className="text-lg font-semibold text-gray-800 mb-3">{title}</h3>}
      {children}
    </div>
  );

  const MetricBox = ({ label, value, sub, color = "blue" }) => (
    <div className={`rounded-lg p-3 text-center ${color === "green" ? "bg-green-50" : color === "red" ? "bg-red-50" : "bg-blue-50"}`}>
      <div className={`text-xl font-bold ${color === "green" ? "text-green-700" : color === "red" ? "text-red-700" : "text-blue-700"}`}>{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );

  const TabBar = ({ tabs, active, onChange }) => (
    <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap ${
            active === t.key ? "bg-white shadow text-blue-700" : "text-gray-500 hover:text-gray-700"
          }`}>{t.label}</button>
      ))}
    </div>
  );

  // ─── STEP 0: UPLOAD ────────────────────────────────────────

  const UploadStep = () => (
    <div>
      <Card title="Upload Your Data">
        <p className="text-gray-500 text-sm mb-4">Upload a CSV file with your marketing data, or load sample data to explore the tool.</p>
        <div className="flex gap-4 flex-wrap">
          <label className="flex-1 border-2 border-dashed border-blue-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition" style={{minWidth: 240}}>
            <Upload size={32} className="mx-auto text-blue-400 mb-2" />
            <div className="text-blue-600 font-medium">Click to upload CSV</div>
            <div className="text-gray-400 text-sm mt-1">Supports .csv files</div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
          <div className="flex items-center"><span className="text-gray-300 text-sm">OR</span></div>
          <button onClick={loadSample}
            className="flex-1 text-white rounded-xl p-8 text-center transition shadow-lg" style={{minWidth: 240, background: "linear-gradient(135deg, #2563eb, #1d4ed8)"}}>
            <Database size={32} className="mx-auto mb-2" />
            <div className="font-medium">Load Sample Dataset</div>
            <div style={{color: "#93c5fd"}} className="text-sm mt-1">156 weeks, 6 media channels</div>
          </button>
        </div>
      </Card>
      {data && (
        <Card title="Data Preview">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <MetricBox label="Rows" value={data.length} />
            <MetricBox label="Columns" value={columns.length} />
            <MetricBox label="Numeric" value={numericCols.length} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50">
                {columns.slice(0, 8).map(c => <th key={c} className="px-3 py-2 text-left text-gray-600 font-medium text-xs">{c}</th>)}
                {columns.length > 8 && <th className="px-3 py-2 text-gray-400 text-xs">+{columns.length - 8}</th>}
              </tr></thead>
              <tbody>
                {data.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-t">
                    {columns.slice(0, 8).map(c => <td key={c} className="px-3 py-2 text-gray-700 text-xs">{typeof row[c] === "number" ? row[c].toLocaleString() : row[c]}</td>)}
                    {columns.length > 8 && <td className="px-3 py-2 text-gray-400">...</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setStep(1)} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 transition">
            Continue to Variable Mapping <ChevronRight size={16} />
          </button>
        </Card>
      )}
    </div>
  );

  // ─── STEP 1: VARIABLE MAPPING ──────────────────────────────

  const MappingStep = () => {
    const toggleCol = (col, list, setter, otherSetters) => {
      if (list.includes(col)) {
        setter(list.filter(c => c !== col));
      } else {
        otherSetters.forEach(fn => fn(prev => prev.filter(c => c !== col)));
        setter([...list, col]);
      }
    };

    return (
      <div>
        <Card title="Variable Mapping">
          <p className="text-gray-500 text-sm mb-4">Assign each column to a category. Auto-detected suggestions are pre-selected.</p>
          <div className="grid grid-cols-1 gap-4 mb-4" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Date Column</label>
              <select value={dateCol} onChange={e => setDateCol(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select...</option>
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Target / KPI</label>
              <select value={targetCol} onChange={e => setTargetCol(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select...</option>
                {numericCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Media Spend", icon: "💰", cols: mediaCols, setter: setMediaCols, others: [setOrganicCols, setContextCols], bg: "#eff6ff" },
              { label: "Organic", icon: "🌱", cols: organicCols, setter: setOrganicCols, others: [setMediaCols, setContextCols], bg: "#f0fdf4" },
              { label: "Context", icon: "🌍", cols: contextCols, setter: setContextCols, others: [setMediaCols, setOrganicCols], bg: "#fff7ed" },
            ].map(cat => (
              <div key={cat.label} className="border rounded-lg p-3" style={{backgroundColor: cat.bg}}>
                <div className="font-medium text-sm mb-2">{cat.icon} {cat.label}</div>
                <div className="space-y-1 overflow-y-auto" style={{maxHeight: 200}}>
                  {numericCols.filter(c => c !== dateCol && c !== targetCol).map(c => (
                    <label key={c} className="flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-white">
                      <input type="checkbox" checked={cat.cols.includes(c)}
                        onChange={() => toggleCol(c, cat.cols, cat.setter, cat.others)} className="rounded" />
                      <span className={cat.cols.includes(c) ? "font-semibold" : ""}>{c}</span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-2 font-medium">{cat.cols.length} selected</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex justify-between">
          <button onClick={() => setStep(0)} className="px-4 py-2 text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={16} /> Back</button>
          <button onClick={() => {
            const ap = { ...adstockParams }, sp = { ...satParams };
            mediaCols.forEach(c => {
              if (!ap[c]) { const isLong = /tv|radio|print/i.test(c); ap[c] = { theta: isLong ? 0.6 : 0.3 }; }
              if (!sp[c]) sp[c] = { alpha: 2.0, gamma: 0.5 };
            });
            setAdstockParams(ap); setSatParams(sp); setStep(2);
          }} disabled={!dateCol || !targetCol || !mediaCols.length}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2">
            Continue <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  };

  // ─── STEP 2: EDA ───────────────────────────────────────────

  const EDAStep = () => {
    const corrCols = useMemo(() => [targetCol, ...mediaCols.slice(0, 6)], [targetCol, mediaCols]);
    const corrMatrix = useMemo(() => data ? computeCorrelation(data, corrCols) : [], [data, corrCols.join(",")]);

    const tsData = useMemo(() => {
      if (!data) return [];
      return data.map(r => {
        const row = { date: r[dateCol], [targetCol]: r[targetCol] };
        mediaCols.forEach(c => { row[c] = r[c]; });
        return row;
      });
    }, [data]);

    const corrColor = (v) => {
      const abs = Math.min(Math.abs(v), 1);
      return v > 0 ? `rgba(37, 99, 235, ${abs * 0.85})` : `rgba(220, 38, 38, ${abs * 0.85})`;
    };

    return (
      <div>
        <TabBar tabs={[
          { key: "ts", label: "Time Series" }, { key: "corr", label: "Correlations" }, { key: "scatter", label: "Scatter" },
        ]} active={edaTab} onChange={setEdaTab} />

        {edaTab === "ts" && (
          <Card title="Revenue & Media Spend Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={tsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(data.length / 8)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : v} />
                <Legend />
                <Line type="monotone" dataKey={targetCol} stroke="#2563eb" strokeWidth={2} dot={false} name="Revenue" />
              </ComposedChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={tsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(data.length / 8)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                <Tooltip />
                <Legend />
                {mediaCols.slice(0, 6).map((c, i) => (
                  <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i]} dot={false} strokeWidth={1.5} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {edaTab === "corr" && (
          <Card title="Correlation Heatmap">
            <p className="text-gray-400 text-xs mb-3">Blue = positive, Red = negative</p>
            <div className="overflow-x-auto">
              <table className="text-xs" style={{borderCollapse: "separate", borderSpacing: 2}}>
                <thead><tr><td></td>{corrCols.map(c => <td key={c} className="text-center font-medium text-gray-500 p-1" style={{maxWidth: 70, overflow: "hidden"}}>{c.slice(0,10)}</td>)}</tr></thead>
                <tbody>
                  {corrCols.map((r, i) => (
                    <tr key={r}>
                      <td className="font-medium text-gray-600 pr-2 text-right" style={{maxWidth: 90}}>{r.slice(0,12)}</td>
                      {corrCols.map((c, j) => {
                        const val = corrMatrix[i]?.[j] || 0;
                        return (
                          <td key={j} className="text-center rounded p-1.5" style={{
                            backgroundColor: corrColor(val),
                            color: Math.abs(val) > 0.4 ? "white" : "#333",
                            minWidth: 48
                          }}>{val.toFixed(2)}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {edaTab === "scatter" && (
          <Card title="Spend vs Revenue">
            <div className="grid grid-cols-2 gap-3">
              {mediaCols.slice(0, 4).map((col, i) => {
                const sd = data.map(r => ({ x: r[col] || 0, y: r[targetCol] || 0 }));
                return (
                  <div key={col}>
                    <div className="text-xs font-medium text-gray-600 mb-1">{col}</div>
                    <ResponsiveContainer width="100%" height={170}>
                      <ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="x" tick={{ fontSize: 9 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                        <YAxis dataKey="y" tick={{ fontSize: 9 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                        <Tooltip formatter={v => typeof v === "number" ? v.toLocaleString() : v} />
                        <Scatter data={sd} fill={COLORS[i]} opacity={0.5} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <div className="flex justify-between mt-4">
          <button onClick={() => setStep(1)} className="px-4 py-2 text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={16} /> Back</button>
          <button onClick={() => setStep(3)} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">Configure <ChevronRight size={16} /></button>
        </div>
      </div>
    );
  };

  // ─── STEP 3: CONFIGURE ─────────────────────────────────────

  const ConfigStep = () => {
    const adstockPreview = useMemo(() => {
      const pts = [];
      for (let lag = 0; lag < 12; lag++) {
        const p = { lag };
        mediaCols.slice(0, 4).forEach(col => {
          p[col] = Math.pow(adstockParams[col]?.theta || 0.5, lag);
        });
        pts.push(p);
      }
      return pts;
    }, [JSON.stringify(adstockParams), mediaCols.join(",")]);

    const satPreview = useMemo(() => {
      const pts = [];
      for (let i = 0; i <= 50; i++) {
        const x = i / 50;
        const p = { x: Math.round(x * 100) };
        mediaCols.slice(0, 4).forEach(col => {
          const sp = satParams[col] || { alpha: 2.0, gamma: 0.5 };
          p[col] = x > 0 ? (1 - 1 / (1 + Math.pow(x / sp.gamma, sp.alpha))) : 0;
        });
        pts.push(p);
      }
      return pts;
    }, [JSON.stringify(satParams), mediaCols.join(",")]);

    return (
      <div>
        <TabBar tabs={[
          { key: "adstock", label: "Adstock (Carryover)" },
          { key: "saturation", label: "Saturation" },
          { key: "model", label: "Model Settings" },
        ]} active={configTab} onChange={setConfigTab} />

        {configTab === "adstock" && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Adstock Decay Rate">
              <p className="text-gray-400 text-xs mb-3">Higher = longer carryover. TV ~0.6, Digital ~0.2</p>
              {mediaCols.map(col => (
                <div key={col} className="mb-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">{col}</span>
                    <span className="text-sm text-blue-600 font-mono">{(adstockParams[col]?.theta || 0.5).toFixed(2)}</span>
                  </div>
                  <input type="range" min="0" max="95" value={Math.round((adstockParams[col]?.theta || 0.5) * 100)}
                    onChange={e => setAdstockParams(prev => ({ ...prev, [col]: { ...prev[col], theta: parseInt(e.target.value) / 100 } }))}
                    className="w-full accent-blue-600" style={{height: 6}} />
                </div>
              ))}
            </Card>
            <Card title="Decay Weights Preview">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={adstockPreview}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="lag" label={{ value: "Lag (weeks)", position: "insideBottom", offset: -5, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip /><Legend />
                  {mediaCols.slice(0, 4).map((c, i) => <Bar key={c} dataKey={c} fill={COLORS[i]} opacity={0.7} />)}
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {configTab === "saturation" && (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Hill Function Parameters">
              <p className="text-gray-400 text-xs mb-3">Alpha = steepness. Gamma = half-saturation point.</p>
              {mediaCols.map(col => (
                <div key={col} className="mb-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-sm font-medium mb-2">{col}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Alpha</span><span className="text-blue-600 font-mono">{(satParams[col]?.alpha || 2.0).toFixed(1)}</span>
                      </div>
                      <input type="range" min="5" max="50" value={Math.round((satParams[col]?.alpha || 2.0) * 10)}
                        onChange={e => setSatParams(prev => ({ ...prev, [col]: { ...prev[col], alpha: parseInt(e.target.value) / 10 } }))}
                        className="w-full accent-blue-600" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Gamma</span><span className="text-green-600 font-mono">{(satParams[col]?.gamma || 0.5).toFixed(2)}</span>
                      </div>
                      <input type="range" min="5" max="95" value={Math.round((satParams[col]?.gamma || 0.5) * 100)}
                        onChange={e => setSatParams(prev => ({ ...prev, [col]: { ...prev[col], gamma: parseInt(e.target.value) / 100 } }))}
                        className="w-full accent-green-600" />
                    </div>
                  </div>
                </div>
              ))}
            </Card>
            <Card title="Diminishing Returns Curves">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={satPreview}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="x" label={{ value: "Spend %", position: "insideBottom", offset: -5, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend />
                  {mediaCols.slice(0, 4).map((c, i) => <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i]} strokeWidth={2} dot={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {configTab === "model" && (
          <Card title="Regression Settings">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Regularization: <span className="text-blue-600 font-mono">{regAlpha.toFixed(1)}</span></label>
                <input type="range" min="1" max="200" value={regAlpha * 10} onChange={e => setRegAlpha(parseInt(e.target.value) / 10)} className="w-full accent-blue-600" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Test Size: <span className="text-blue-600 font-mono">{testPct}%</span></label>
                <input type="range" min="10" max="40" step="5" value={testPct} onChange={e => setTestPct(parseInt(e.target.value))} className="w-full accent-blue-600" />
                <div className="text-xs text-gray-400 mt-1">Train: {Math.floor(data.length * (1 - testPct/100))} | Test: {data.length - Math.floor(data.length * (1 - testPct/100))}</div>
              </div>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
              <strong>Ridge Regression</strong> with positive media constraints. {mediaCols.length} media + {organicCols.length} organic + {contextCols.length} context = {mediaCols.length + organicCols.length + contextCols.length} features.
            </div>
          </Card>
        )}

        <div className="flex justify-between mt-4">
          <button onClick={() => setStep(2)} className="px-4 py-2 text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={16} /> Back</button>
          <button onClick={() => setStep(4)} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">Train Model <ChevronRight size={16} /></button>
        </div>
      </div>
    );
  };

  // ─── STEP 4: TRAIN & RESULTS ───────────────────────────────

  const TrainStep = () => {
    const decompData = useMemo(() => {
      if (!modelResult) return [];
      return Object.entries(modelResult.contribPct)
        .sort((a, b) => b[1] - a[1])
        .map(([name, pct]) => ({
          name: name.length > 18 ? name.slice(0, 16) + ".." : name,
          fullName: name,
          pct: Math.round(pct * 10) / 10,
          fill: mediaCols.includes(name) ? "#2563eb" :
                name.includes("base") ? "#f97316" :
                organicCols.includes(name) ? "#16a34a" : "#94a3b8"
        }));
    }, [modelResult]);

    const mediaShareData = useMemo(() => {
      if (!modelResult) return [];
      return Object.entries(modelResult.mediaSharePct || {})
        .filter(([_, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, pct]) => ({ name, pct: Math.round(pct * 10) / 10 }));
    }, [modelResult]);

    const fitData = useMemo(() => {
      if (!modelResult) return [];
      const { ytr, yte, ytrPred, ytePred, dates, splitIdx } = modelResult;
      return [
        ...ytr.map((v, i) => ({ date: dates[i], actual: v, predicted: Math.round(ytrPred[i]), set: "train" })),
        ...yte.map((v, i) => ({ date: dates[splitIdx + i], actual: v, predicted: Math.round(ytePred[i]), set: "test" })),
      ];
    }, [modelResult]);

    return (
      <div>
        {/* Train Button */}
        {!modelResult && !isTraining && (
          <Card>
            <div className="text-center py-8">
              <Zap size={48} className="mx-auto text-blue-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Ready to Train</h3>
              <p className="text-gray-500 text-sm mb-4">
                {mediaCols.length} media + {organicCols.length} organic + {contextCols.length} context features
              </p>
              <button onClick={trainModel}
                className="text-white px-8 py-3 rounded-lg shadow-lg flex items-center gap-2 mx-auto text-lg font-medium"
                style={{background: "linear-gradient(135deg, #2563eb, #1d4ed8)"}}>
                <Play size={20} /> Train Marketing Mix Model
              </button>
            </div>
          </Card>
        )}

        {/* Training indicator */}
        {isTraining && (
          <Card>
            <div className="text-center py-8">
              <RefreshCw size={40} className="mx-auto text-blue-500 mb-3 animate-spin" />
              <p className="text-gray-600 font-medium">Training model...</p>
            </div>
          </Card>
        )}

        {/* Error */}
        {trainError && (
          <Card>
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <div className="flex items-center gap-2 text-red-700 font-medium mb-1"><AlertTriangle size={16} /> Training Error</div>
              <p className="text-red-600 text-sm">{trainError}</p>
              <button onClick={() => { setTrainError(null); trainModel(); }} className="mt-3 text-sm text-blue-600 hover:underline">Retry</button>
            </div>
          </Card>
        )}

        {/* Results */}
        {modelResult && (
          <>
            <TabBar tabs={[
              { key: "metrics", label: "Performance" },
              { key: "fit", label: "Fit" },
              { key: "decomp", label: "Decomposition" },
              { key: "response", label: "Response Curves" },
            ]} active={resultTab} onChange={setResultTab} />

            {resultTab === "metrics" && (
              <Card title="Model Performance">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <MetricBox label="Train R²" value={modelResult.trainMetrics.r2.toFixed(3)} color={modelResult.trainMetrics.r2 > 0.7 ? "green" : "blue"} />
                  <MetricBox label="Test R²" value={modelResult.testMetrics.r2.toFixed(3)} color={modelResult.testMetrics.r2 > 0.7 ? "green" : "blue"} />
                  <MetricBox label="Train MAPE" value={`${(modelResult.trainMetrics.mape * 100).toFixed(1)}%`} />
                  <MetricBox label="Test MAPE" value={`${(modelResult.testMetrics.mape * 100).toFixed(1)}%`} />
                </div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <MetricBox label="Train RMSE" value={Math.round(modelResult.trainMetrics.rmse).toLocaleString()} />
                  <MetricBox label="Test RMSE" value={Math.round(modelResult.testMetrics.rmse).toLocaleString()} />
                  <MetricBox label="Train MAE" value={Math.round(modelResult.trainMetrics.mae).toLocaleString()} />
                  <MetricBox label="Test MAE" value={Math.round(modelResult.testMetrics.mae).toLocaleString()} />
                </div>
                <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: modelResult.testMetrics.r2 > 0.6 ? "#f0fdf4" : "#fef2f2" }}>
                  {modelResult.testMetrics.r2 > 0.8 ? "✅ Excellent model fit — high predictive accuracy" :
                   modelResult.testMetrics.r2 > 0.6 ? "✅ Good fit — model captures main trends" :
                   modelResult.testMetrics.r2 > 0.3 ? "🟡 Moderate fit — consider tuning hyperparameters" :
                   "🔴 Weak fit — try adjusting features or transformations"}
                </div>
                <div className="mt-3 flex gap-3">
                  <button onClick={() => { setModelResult(null); setTrainError(null); }}
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"><RefreshCw size={14} /> Re-train</button>
                  <button onClick={() => setStep(3)} className="text-sm text-gray-500 hover:underline flex items-center gap-1"><Settings size={14} /> Adjust config</button>
                </div>
              </Card>
            )}

            {resultTab === "fit" && (
              <Card title="Actual vs Predicted">
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={fitData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(fitData.length / 10)} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={v => typeof v === "number" ? `$${v.toLocaleString()}` : v} />
                    <Legend />
                    {fitData.some(d => d.set === "test") && (
                      <ReferenceLine x={fitData.find(d => d.set === "test")?.date} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: "Train | Test", fontSize: 10 }} />
                    )}
                    <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={1.5} dot={false} name="Actual" />
                    <Line type="monotone" dataKey="predicted" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="Predicted" />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            )}

            {resultTab === "decomp" && (
              <div>
                <Card title="Total Contribution (including base)">
                  <ResponsiveContainer width="100%" height={Math.max(200, decompData.length * 28)}>
                    <BarChart data={decompData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                      <Tooltip formatter={v => `${v}%`} />
                      <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                        {decompData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                {mediaShareData.length > 0 && (
                  <Card title="Media Channel Share (media only)">
                    <div className="grid grid-cols-2 gap-4 items-center">
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={mediaShareData} dataKey="pct" nameKey="name" cx="50%" cy="50%"
                            outerRadius={85} innerRadius={40}
                            label={({ name, pct }) => `${name.replace(/_spend/g, "")}: ${pct.toFixed(0)}%`}
                            labelLine={{ strokeWidth: 1 }}>
                            {mediaShareData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={v => `${v}%`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div>
                        {mediaShareData.map((d, i) => (
                          <div key={d.name} className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded" style={{backgroundColor: COLORS[i % COLORS.length]}}></div>
                            <span className="text-sm flex-1">{d.name}</span>
                            <span className="text-sm font-semibold">{d.pct.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {resultTab === "response" && (
              <Card title="Response Curves">
                <p className="text-gray-400 text-xs mb-3">How revenue responds to increasing spend. Flatter = more saturated.</p>
                <div className="grid grid-cols-2 gap-3">
                  {mediaCols.map((col, i) => (
                    <div key={col}>
                      <div className="text-xs font-medium text-gray-600 mb-1">{col}</div>
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={modelResult.responseCurves[col] || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="spend" tick={{ fontSize: 9 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                          <YAxis tick={{ fontSize: 9 }} />
                          <Tooltip formatter={v => typeof v === "number" ? v.toLocaleString() : v} />
                          <Line type="monotone" dataKey="response" stroke={COLORS[i]} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="flex justify-between mt-4">
              <button onClick={() => setStep(3)} className="px-4 py-2 text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={16} /> Back</button>
              <button onClick={() => setStep(5)} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">Budget Optimizer <ChevronRight size={16} /></button>
            </div>
          </>
        )}
      </div>
    );
  };

  // ─── STEP 5: BUDGET OPTIMIZER ──────────────────────────────

  const OptimizeStep = () => {
    if (!modelResult) return <Card><p className="text-center text-gray-500 py-8">Train a model first.</p></Card>;

    const currentAlloc = {};
    mediaCols.forEach(col => { currentAlloc[col] = Math.round(data.reduce((s, r) => s + (r[col] || 0), 0) / data.length); });
    const currentResponse = simulateBudget(currentAlloc);
    const scenarioResponse = simulateBudget(budgetAlloc);
    const totalBudget = Object.values(budgetAlloc).reduce((a, b) => a + b, 0);
    const currentTotal = Object.values(currentAlloc).reduce((a, b) => a + b, 0);
    const respChange = currentResponse.total > 0 ? ((scenarioResponse.total - currentResponse.total) / currentResponse.total * 100) : 0;

    return (
      <div>
        <Card title="Budget Scenario Simulator">
          <p className="text-gray-400 text-xs mb-4">Adjust sliders to see predicted impact in real-time.</p>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <MetricBox label="Total Budget" value={fmt(totalBudget)} />
            <MetricBox label="vs Current" value={`${((totalBudget - currentTotal) / (currentTotal || 1) * 100).toFixed(0)}%`} />
            <MetricBox label="Response Change" value={`${respChange >= 0 ? "+" : ""}${respChange.toFixed(1)}%`} color={respChange > 0 ? "green" : respChange < 0 ? "red" : "blue"} />
            <MetricBox label="Response Score" value={scenarioResponse.total?.toFixed(0) || "0"} />
          </div>
        </Card>

        <Card title="Channel Budgets">
          {mediaCols.map((col, i) => {
            const current = currentAlloc[col] || 1;
            const val = budgetAlloc[col] || current;
            const maxVal = current * 3;
            const changePct = ((val - current) / current * 100).toFixed(0);
            return (
              <div key={col} className="mb-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium">{col}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">Avg: {fmt(current)}</span>
                    <span className="text-sm font-mono text-blue-600 font-bold">{fmt(val)}</span>
                    <span className={`text-xs font-bold ${Number(changePct) > 0 ? "text-green-600" : Number(changePct) < 0 ? "text-red-600" : "text-gray-400"}`}>
                      {Number(changePct) > 0 ? "+" : ""}{changePct}%
                    </span>
                  </div>
                </div>
                <input type="range" min="0" max={maxVal} step={Math.max(100, Math.round(current * 0.01))}
                  value={val} onChange={e => setBudgetAlloc(prev => ({ ...prev, [col]: parseInt(e.target.value) }))}
                  className="w-full accent-blue-600" />
              </div>
            );
          })}
        </Card>

        <Card title="Current vs Scenario">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mediaCols.map(c => ({ name: c.replace(/_spend/g, ""), current: currentAlloc[c], scenario: budgetAlloc[c] || currentAlloc[c] }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
              <Tooltip formatter={v => `$${v.toLocaleString()}`} /><Legend />
              <Bar dataKey="current" fill="#93c5fd" name="Current" radius={[4, 4, 0, 0]} />
              <Bar dataKey="scenario" fill="#2563eb" name="Scenario" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <div className="flex justify-between mt-4">
          <button onClick={() => setStep(4)} className="px-4 py-2 text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={16} /> Back</button>
        </div>
      </div>
    );
  };

  // ═════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-blue-800">Marketing Mix Modeling Tool</h1>
          <p className="text-xs text-gray-400">Built on Meta Robyn methodology</p>
        </div>
        {data && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">{data.length} rows | {mediaCols.length} media channels</span>}
      </div>

      <div className="mx-auto p-4" style={{maxWidth: 1100}}>
        <StepNav />
        {step === 0 && <UploadStep />}
        {step === 1 && data && <MappingStep />}
        {step === 2 && data && <EDAStep />}
        {step === 3 && data && <ConfigStep />}
        {step === 4 && data && <TrainStep />}
        {step === 5 && data && <OptimizeStep />}
      </div>
    </div>
  );
}
