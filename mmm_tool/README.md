# Marketing Mix Modeling (MMM) Tool

A comprehensive, end-to-end Marketing Mix Modeling platform built on **Meta Robyn methodology**. This tool streamlines the entire MMM workflow from data upload through budget optimization, featuring both an interactive React-based UI and a full Python/Streamlit backend.

## Features

**Data Management**
- CSV/Excel upload with interactive variable mapping
- Auto-detection of date, media spend, organic, and context columns
- Built-in sample data generator (156 weeks, 6 media channels)

**Feature Engineering**
- Log, square root, and normalization transforms
- Variable combination and custom bounds
- Multicollinearity detection (VIF)

**Exploratory Data Analysis**
- Time series visualization
- Correlation heatmaps
- Distribution analysis
- Scatter plots with trend lines

**MMM Modeling**
- Adstock transformations (Geometric decay, Weibull CDF/PDF)
- Saturation curves (Hill function, Power, Logistic, Michaelis-Menten)
- Ridge/ElasticNet regression with positive coefficient constraints
- Time-based train/test splitting
- Cross-validation support

**Budget Optimization**
- Equimarginal principle optimization
- Interactive budget allocation sliders
- Real-time ROI predictions
- Channel response curves

**Model Evaluation**
- R-squared, MAPE, RMSE, NRMSE metrics
- Channel contribution decomposition (stacked bar, pie charts)
- Actual vs predicted plots
- Overfitting diagnostics

**Calibration**
- Ground truth validation with lift study results
- Geo-experiment calibration
- MAPE scoring against external benchmarks

## Interactive React Tool

The `interactive_mmm.jsx` file is a self-contained React application that provides the full MMM workflow in an interactive UI. It uses Recharts for visualization and implements the complete MMM pipeline in JavaScript, including adstock transformations, Hill saturation, ridge regression, and budget optimization.

### Key Steps in the Interactive Tool
1. **Upload Data** - Load CSV or generate sample data
2. **Map Variables** - Assign columns to media, organic, context, target, and date roles
3. **Explore (EDA)** - Time series, correlations, distributions
4. **Configure Model** - Set adstock decay and saturation parameters per channel
5. **Train Model** - Ridge regression with performance metrics and decomposition
6. **Optimize Budget** - Interactive budget allocation with predicted responses

## Python/Streamlit Backend

### Installation

```bash
pip install -r requirements.txt
```

### Running the Streamlit App

```bash
streamlit run app.py
```

### Running the Demo Script

```bash
python run_demo.py
```

## Project Structure

```
mmm_tool/
  app.py                     # Streamlit main app
  run_demo.py                # CLI demo script
  interactive_mmm.jsx        # React interactive tool
  overview.html              # Architecture overview
  architecture.mermaid       # System architecture diagram
  requirements.txt           # Python dependencies
  core/
    __init__.py
    adstock.py               # Adstock transformations
    saturation.py            # Saturation/diminishing returns curves
    mmm_model.py             # Core MMM engine
    optimizer.py             # Budget optimizer
  modules/
    __init__.py
    data_upload.py           # Data upload & variable mapping
    feature_engineering.py   # Feature transforms & combinations
    eda.py                   # Exploratory data analysis
    model_config.py          # Model configuration UI
    model_training.py        # Training & results display
    budget_optimizer.py      # Budget optimization dashboard
    calibration.py           # Calibration & validation
  utils/
    __init__.py
    synthetic_data.py        # Sample data generator
    helpers.py               # Auto-detection, VIF, stationarity
  demo_data/
    sample_mmm_data.csv      # Pre-generated sample dataset
```

## Key Concepts

**Adstock (Carryover Effect)**: Models how marketing exposure today influences purchases in future periods. TV typically has high carryover (theta ~0.7) while digital channels are more immediate (theta ~0.2).

**Saturation (Diminishing Returns)**: Captures how each additional dollar of media spend delivers less incremental value. The Hill function parameters control curve steepness (alpha) and half-saturation point (gamma).

**Budget Optimization**: Uses the equimarginal principle to reallocate budget until marginal returns are equalized across channels, maximizing total response for a given budget constraint.

**Calibration**: Anchors model outputs with external experimental evidence from geo-experiments, lift studies, or A/B tests to improve credibility and accuracy.

## Methodology

This tool implements the core methodology from [Meta's Robyn](https://github.com/facebookexperimental/Robyn) open-source MMM package, adapted for interactive use with both JavaScript and Python implementations.

## License

MIT
