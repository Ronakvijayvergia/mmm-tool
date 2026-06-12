# Marketing Mix Modeling Tool — Deployment Guide

## What You Have

A single `index.html` file (~238 KB) that runs entirely in the browser. No server, no database, no build step. Users upload their own data and all modeling happens on their machine.

### V2 Features
- **Dual modeling approaches**: Ridge Regression (Meta Robyn) + Bayesian MAP (Google Meridian)
- **4 adstock types**: Geometric, Weibull CDF, Weibull PDF, Binomial (Meridian)
- **4 saturation functions**: Hill, Negative Exponential, Logarithmic, Power
- **Bootstrap confidence intervals** on all coefficients
- **Expanding window time-series cross-validation**
- **Prior specification UI** for Bayesian mode (HalfNormal media priors)
- **Grid search** with Pareto-optimal model selection (NRMSE vs DECOMP.RSSD)
- **Budget optimizer** with 3 modes: maximize, target, scenario curve

---

## Option A: GitHub Pages (Free Public Hosting)

### Steps

1. **Create a GitHub account** (if you don't have one): https://github.com/signup

2. **Create a new repository**:
   - Go to https://github.com/new
   - Name it something like `mmm-tool`
   - Set it to **Public**
   - Click "Create repository"

3. **Upload the file**:
   - On the repo page, click "uploading an existing file"
   - Drag `index.html` into the upload area
   - Click "Commit changes"

4. **Enable GitHub Pages**:
   - Go to **Settings** → **Pages** (left sidebar)
   - Under "Source", select **Deploy from a branch**
   - Branch: `main`, folder: `/ (root)`
   - Click **Save**

5. **Your tool is live** within 1-2 minutes at:
   ```
   https://YOUR-USERNAME.github.io/mmm-tool/
   ```

### Updating
Just upload a new `index.html` to the same repo. GitHub Pages auto-deploys.

---

## Option B: Share as a File (Zero Hosting)

Simply send `index.html` to anyone. They open it in Chrome/Firefox/Edge and it works. The file loads libraries from CDN on first open, so an internet connection is needed for the initial load.

---

## Option C: Netlify (Alternative Free Hosting)

1. Go to https://app.netlify.com/drop
2. Drag the folder containing `index.html` onto the page
3. Done — you get a URL like `https://random-name.netlify.app`
4. Optionally rename the URL in site settings

---

## Technical Notes

- **All computation is client-side** — no data ever leaves the user's browser
- **CDN dependencies** (loaded automatically): React 18, Recharts 2.12, Lucide React, Babel Standalone
- **Browser support**: Chrome, Firefox, Edge, Safari (modern versions)
- **File size**: ~238 KB (loads fast on any connection)
- **First load**: Babel transpiles JSX in-browser (~1-2 sec), then cached by browser
