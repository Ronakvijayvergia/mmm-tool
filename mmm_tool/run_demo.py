#!/usr/bin/env python
"""
MMM Tool — Quick Demo Script
=============================
Demonstrates the complete MMM pipeline programmatically:
1. Generate synthetic data
2. Configure model
3. Train and evaluate
4. Optimize budget
5. Display results

Run: python run_demo.py
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import pandas as pd

from utils.synthetic_data import generate_synthetic_mmm_data, generate_calibration_data
from core.mmm_model import MMMConfig, MarketingMixModel
from core.optimizer import BudgetOptimizer, BudgetConstraint
from core.adstock import get_adstock_weights
from core.saturation import apply_saturation


def main():
    print("=" * 70)
    print("  MARKETING MIX MODELING TOOL — DEMO")
    print("  Built on Meta Robyn Methodology")
    print("=" * 70)

    # ── Step 1: Generate Data ─────────────────────────────────────────────
    print("\n📊 STEP 1: Generating synthetic MMM data...")
    df = generate_synthetic_mmm_data(n_weeks=156, seed=42)
    print(f"   Dataset: {len(df)} weeks ({df['date'].min().strftime('%Y-%m-%d')} to {df['date'].max().strftime('%Y-%m-%d')})")
    print(f"   Revenue: ${df['revenue'].min():,.0f} – ${df['revenue'].max():,.0f} (mean: ${df['revenue'].mean():,.0f})")

    media_cols = ["tv_spend", "digital_spend", "social_media_spend", "search_spend", "print_spend", "radio_spend"]
    organic_cols = ["organic_traffic", "word_of_mouth", "email_list_size"]
    context_cols = ["consumer_confidence", "competitor_spend", "is_holiday"]

    print(f"   Media channels: {len(media_cols)}")
    print(f"   Organic vars: {len(organic_cols)}")
    print(f"   Context vars: {len(context_cols)}")

    # ── Step 2: Configure Model ───────────────────────────────────────────
    print("\n⚙️  STEP 2: Configuring model...")
    config = MMMConfig()
    config.date_col = "date"
    config.target_col = "revenue"
    config.media_cols = media_cols
    config.organic_cols = organic_cols
    config.context_cols = context_cols

    # Adstock: different decay rates per channel type
    config.adstock_method = "geometric"
    config.adstock_params = {
        "tv_spend":           {"theta": 0.7, "l_max": 12},  # TV has long carryover
        "digital_spend":      {"theta": 0.2, "l_max": 4},   # Digital is immediate
        "social_media_spend": {"theta": 0.4, "l_max": 8},   # Social is moderate
        "search_spend":       {"theta": 0.15, "l_max": 4},  # Search is immediate
        "print_spend":        {"theta": 0.5, "l_max": 10},  # Print lingers
        "radio_spend":        {"theta": 0.6, "l_max": 10},  # Radio lingers
    }

    # Saturation: Hill function with per-channel parameters
    config.saturation_method = "hill"
    config.saturation_params = {
        "tv_spend":           {"alpha": 2.0, "gamma": 0.5},
        "digital_spend":      {"alpha": 3.0, "gamma": 0.4},
        "social_media_spend": {"alpha": 2.5, "gamma": 0.45},
        "search_spend":       {"alpha": 3.5, "gamma": 0.35},
        "print_spend":        {"alpha": 1.5, "gamma": 0.6},
        "radio_spend":        {"alpha": 1.8, "gamma": 0.55},
    }

    config.model_type = "ridge"
    config.alpha = 1.0
    config.positive_coefficients = True
    config.test_size = 0.2
    config.time_based_split = True

    print(f"   Adstock: {config.adstock_method}")
    print(f"   Saturation: {config.saturation_method}")
    print(f"   Model: {config.model_type} (α={config.alpha})")
    print(f"   Train/Test split: {int((1 - config.test_size) * 100)}/{int(config.test_size * 100)} (time-based)")

    # ── Step 3: Train Model ───────────────────────────────────────────────
    print("\n🚀 STEP 3: Training Marketing Mix Model...")
    model = MarketingMixModel(config)
    result = model.fit(df)

    print(f"\n   ┌─────────────────────────────────────┐")
    print(f"   │       MODEL PERFORMANCE              │")
    print(f"   ├─────────────────────────────────────┤")
    print(f"   │  Train R²:    {result.train_r2:>8.4f}              │")
    print(f"   │  Test R²:     {result.test_r2:>8.4f}              │")
    print(f"   │  Train MAPE:  {result.train_mape:>8.2%}              │")
    print(f"   │  Test MAPE:   {result.test_mape:>8.2%}              │")
    print(f"   │  NRMSE:       {result.nrmse:>8.4f}              │")
    print(f"   └─────────────────────────────────────┘")

    # Overfitting check
    gap = result.train_r2 - result.test_r2
    if gap < 0.05:
        print("   ✅ No significant overfitting")
    elif gap < 0.15:
        print("   ⚠️  Some overfitting detected")
    else:
        print("   ❌ Significant overfitting — consider more regularization")

    # ── Step 4: Channel Decomposition ─────────────────────────────────────
    print("\n📈 STEP 4: Channel Contribution Decomposition")
    print(f"   {'Channel':<25} {'Coeff':>10} {'Contribution':>14}")
    print(f"   {'─' * 25} {'─' * 10} {'─' * 14}")

    sorted_contribs = sorted(
        result.contribution_pct.items(),
        key=lambda x: x[1],
        reverse=True
    )
    for channel, pct in sorted_contribs:
        coef = result.coefficients.get(channel, result.intercept if channel == "base" else 0)
        bar = "█" * int(pct / 2)
        print(f"   {channel:<25} {coef:>10.4f} {pct:>8.1f}% {bar}")

    # ── Step 5: Budget Optimization ───────────────────────────────────────
    print("\n💰 STEP 5: Budget Optimization")
    current_allocation = {col: float(df[col].mean()) for col in media_cols}
    total_budget = sum(current_allocation.values())

    print(f"   Total current budget: ${total_budget:,.0f}/week")

    constraints = BudgetConstraint()
    for ch in media_cols:
        constraints.set_bounds(ch, 0, total_budget * 0.5)  # Max 50% in any channel

    optimizer = BudgetOptimizer(result, config)
    opt_result = optimizer.optimize(
        total_budget=total_budget,
        current_allocation=current_allocation,
        constraints=constraints
    )

    print(f"\n   {'Channel':<25} {'Current':>12} {'Optimal':>12} {'Change':>12}")
    print(f"   {'─' * 25} {'─' * 12} {'─' * 12} {'─' * 12}")

    for detail in opt_result.channel_details:
        print(f"   {detail['channel']:<25} ${detail['current_spend']:>10,.0f} ${detail['optimal_spend']:>10,.0f} {detail['change_pct']:>+8.1f}%")

    print(f"\n   Expected improvement: {opt_result.improvement_pct:+.2f}%")

    # ── Step 6: Response Curves Summary ───────────────────────────────────
    print("\n📉 STEP 6: Response Curve Summary")
    for ch in media_cols:
        if ch in result.response_curves:
            curve = result.response_curves[ch]
            print(f"   {ch}: current spend ${curve['current_spend']:,.0f}, max tested ${curve['max_spend']:,.0f}")

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("  DEMO COMPLETE")
    print("=" * 70)
    print(f"""
  To launch the full interactive UI:
    cd {os.path.dirname(os.path.abspath(__file__))}
    streamlit run app.py

  The Streamlit app provides:
    • Interactive data upload & variable mapping
    • Feature engineering with transformations
    • Visual EDA (scatter plots, heatmaps, distributions)
    • Per-channel adstock & saturation configuration
    • Real-time model training & diagnostics
    • Budget optimizer with scenario simulator
    • Calibration with ground truth data
""")


if __name__ == "__main__":
    main()
