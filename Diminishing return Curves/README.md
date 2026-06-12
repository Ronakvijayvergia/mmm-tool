# MMM Diminishing Returns Curve Tool

A **post-MMM companion tool** for visualizing diminishing returns curves and optimizing budget allocation across marketing channels.

You've already built your Marketing Mix Model (in Robyn, LightweightMMM, PyMC-Marketing, or any other tool). Now plug in the parameters and use this tool to **visualize the curves** and **find the best budget split**.

## Features

- **6 Response Equations**: Linear, Logarithmic, Power, Exponential, Hill (S-curve), Quadratic
- **Adstock Transformations**: Geometric decay, Weibull, with steady-state simulation
- **5 Optimization Algorithms**: L-BFGS-B, Differential Evolution, Linear Programming, Genetic Algorithm, Grid Search
- **Interactive Guide Tab**: Full walkthrough with sample equations, charts, and a worked example
- **Dark-Mode UI**: Streamlit dashboard with dark-themed matplotlib charts
- **Export**: Download curves (CSV), optimization results, and channel config (JSON)

## Quick Start

### Option 1: Double-click launcher (Mac)
Double-click `LAUNCH_MMM_TOOL.command` — it installs dependencies and opens the tool in your browser.

### Option 2: Manual setup
```bash
cd mmm_tool
pip install -r requirements.txt
streamlit run app.py
```

The tool opens at `http://localhost:8501`.

## File Structure

```
mmm_tool/
  app.py              # Streamlit UI (5 tabs: Guide, Config, Curves, Optimization, Export)
  core_engine.py      # Math foundation: adstock, response functions, steady-state simulation
  optimization.py     # 5 budget optimization algorithms
  visualizations.py   # Dark-themed matplotlib chart generators
  requirements.txt    # Python dependencies
  setup_and_run.py    # Alternative Python launcher
  run.sh              # Shell launcher
LAUNCH_MMM_TOOL.command  # One-click Mac launcher
```

## How It Works

1. **Load** your historical spend data (CSV/Excel with `spend_*` columns)
2. **Configure** each channel with equation type + parameters from your MMM
3. **Visualize** response curves, marginal curves, and overlay comparisons
4. **Optimize** budget allocation to maximize total response
5. **Export** results as CSV, PNG, or JSON

## Deployment / Hosting

### Option A: Streamlit Cloud (Full Interactive App — Recommended)

1. Go to [share.streamlit.io](https://share.streamlit.io)
2. Sign in with your **GitHub account**
3. Click **"New app"**
4. Select repo: `Ronakvijayvergia/DiminishingReturnTool`
5. Branch: `main`
6. Main file path: `mmm_tool/app.py`
7. Click **Deploy**

Your app will be live at a public URL like:
`https://ronakvijayvergia-diminishingreturntool.streamlit.app`

### Option B: GitHub Pages (Static HTML Dashboards Only)

1. Go to your repo → **Settings** → **Pages** (left sidebar)
2. Under "Source", select **main** branch and **/ (root)** folder
3. Click **Save**
4. After a minute, your HTML dashboards will be live at:
   - `https://ronakvijayvergia.github.io/DiminishingReturnTool/mmm_dashboard.html`
   - `https://ronakvijayvergia.github.io/DiminishingReturnTool/MMM_Diminishing_Returns_Tool.html`

> **Note:** GitHub Pages only hosts the static HTML files. For the full interactive Streamlit app with all 5 tabs, use Option A.

## Supported Equations

| Equation | Formula | Use Case |
|----------|---------|----------|
| Hill (S-curve) | `f = β × Spend^γ / (Spend^γ + δ^γ)` | TV, Video, OOH |
| Logarithmic | `f = β × ln(γ × Spend + 1)` | Search, SEM |
| Power | `f = β × Spend^γ` | Display, Programmatic |
| Exponential | `f = β × (1 - e^(-γ×Spend))` | Email, Push |
| Linear | `f = β × Spend` | Baseline comparison |
| Quadratic | `f = β × Spend - γ × Spend²` | Channels with ad fatigue |
