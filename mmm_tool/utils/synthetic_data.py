"""
Synthetic Data Generator for MMM Tool Demo.
Generates realistic marketing mix data with known ground truth
for testing and demonstration purposes.
"""
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional, Dict


def generate_synthetic_mmm_data(
    n_weeks: int = 156,  # 3 years
    start_date: str = "2022-01-03",
    seed: int = 42,
    channels: Optional[Dict] = None
) -> pd.DataFrame:
    """
    Generate synthetic MMM dataset with realistic patterns.
    
    Creates data with:
    - Known media channel effects (with adstock and saturation baked in)
    - Seasonality (yearly and quarterly)
    - Trend component
    - Holiday effects
    - External factors (competitor activity, economic indicator)
    - Organic traffic
    - Random noise
    
    Args:
        n_weeks: Number of weekly observations
        start_date: Start date for the time series
        seed: Random seed for reproducibility
        channels: Optional dict of channel configs
    Returns:
        DataFrame with all variables and revenue
    """
    np.random.seed(seed)
    
    dates = pd.date_range(start=start_date, periods=n_weeks, freq="W-MON")
    
    # Default channel configuration with true effects
    if channels is None:
        channels = {
            "tv_spend": {"mean": 50000, "std": 15000, "coef": 0.15, "decay": 0.7, "saturation": 0.6},
            "digital_spend": {"mean": 30000, "std": 10000, "coef": 0.25, "decay": 0.3, "saturation": 0.5},
            "social_media_spend": {"mean": 15000, "std": 5000, "coef": 0.20, "decay": 0.4, "saturation": 0.45},
            "search_spend": {"mean": 20000, "std": 8000, "coef": 0.30, "decay": 0.2, "saturation": 0.55},
            "print_spend": {"mean": 10000, "std": 4000, "coef": 0.08, "decay": 0.5, "saturation": 0.7},
            "radio_spend": {"mean": 8000, "std": 3000, "coef": 0.10, "decay": 0.6, "saturation": 0.65},
        }
    
    df = pd.DataFrame({"date": dates})
    df["week_num"] = range(n_weeks)
    
    # --- Media Spend Variables ---
    for ch_name, ch_config in channels.items():
        # Base spend with some autocorrelation
        spend = np.zeros(n_weeks)
        spend[0] = ch_config["mean"]
        for t in range(1, n_weeks):
            spend[t] = 0.7 * spend[t-1] + 0.3 * (ch_config["mean"] + np.random.normal(0, ch_config["std"]))
        
        # Add seasonal spend patterns (higher in Q4, lower in Q1)
        month = dates.month.values  # Convert to numpy array
        seasonal_multiplier = 1.0 + 0.15 * np.sin(2 * np.pi * (month - 3) / 12)
        spend = spend * seasonal_multiplier
        
        # Ensure non-negative
        spend = np.maximum(spend, 0)
        
        # Some weeks have zero spend (budget pauses)
        pause_mask = np.random.random(n_weeks) < 0.05
        spend = spend.copy()  # Ensure we have a writable array
        spend[pause_mask] = 0
        
        df[ch_name] = np.round(spend, 2)
    
    # --- Organic Variables ---
    # SEO/organic traffic (grows over time with noise)
    df["organic_traffic"] = (
        5000 + 
        20 * df["week_num"] +  # growth trend
        1000 * np.sin(2 * np.pi * df["week_num"] / 52) +  # seasonality
        np.random.normal(0, 500, n_weeks)
    ).clip(0)
    
    # Word of mouth (will be correlated with lagged spend as a proxy for brand awareness)
    total_spend = sum(df[ch].values for ch in channels.keys())
    lagged_spend = np.roll(total_spend, 4)  # 4-week lag
    lagged_spend[:4] = total_spend[:4].mean()  # Fill initial lags with mean
    wom_signal = lagged_spend / (lagged_spend.max() + 1e-10) * 1000
    df["word_of_mouth"] = (
        wom_signal +
        np.random.normal(0, 100, n_weeks)
    ).clip(0).round(2)
    
    # Email subscribers (growing base)
    df["email_list_size"] = (10000 + 50 * df["week_num"] + np.random.normal(0, 200, n_weeks)).round(0)
    
    # --- Contextual / External Variables ---
    # Economic indicator (e.g., consumer confidence index)
    df["consumer_confidence"] = (
        100 + 
        5 * np.sin(2 * np.pi * df["week_num"] / 104) +  # 2-year cycle
        np.random.normal(0, 2, n_weeks)
    ).round(2)
    
    # Competitor spending (random walk)
    competitor_spend = np.zeros(n_weeks)
    competitor_spend[0] = 100000
    for t in range(1, n_weeks):
        competitor_spend[t] = competitor_spend[t-1] + np.random.normal(0, 5000)
    df["competitor_spend"] = np.maximum(competitor_spend, 50000).round(2)
    
    # Holiday indicator
    df["is_holiday"] = 0
    # Mark some holiday periods
    df.loc[df["date"].dt.month == 11, "is_holiday"] = 1  # Thanksgiving
    df.loc[df["date"].dt.month == 12, "is_holiday"] = 1  # Christmas
    df.loc[(df["date"].dt.month == 1) & (df["date"].dt.day <= 7), "is_holiday"] = 1  # New Year
    df.loc[(df["date"].dt.month == 7) & (df["date"].dt.day >= 1) & (df["date"].dt.day <= 7), "is_holiday"] = 1  # Independence Day
    
    # --- Build Revenue with Known Effects ---
    # Start with a base revenue
    base_revenue = 500000
    
    # Calculate adstocked media effects
    def apply_adstock(spend_col, decay_rate, l_max=8):
        """Apply geometric adstock with normalized decay weights."""
        weights = np.array([decay_rate ** lag for lag in range(l_max)])
        weights = weights / weights.sum()  # Normalize so weights sum to 1
        adstocked = np.zeros_like(spend_col, dtype=float)
        for i in range(len(spend_col)):
            for lag in range(min(l_max, i + 1)):
                adstocked[i] += spend_col[i - lag] * weights[lag]
        return adstocked

    def apply_saturation(spend_col, saturation_param):
        """Apply Hill saturation curve: x^a / (gamma^a + x^a)."""
        x_max = spend_col.max()
        if x_max == 0:
            return np.zeros_like(spend_col)
        x_normalized = spend_col / x_max
        gamma = 0.5  # Half-saturation at 50% of max spend
        return x_normalized ** saturation_param / (gamma ** saturation_param + x_normalized ** saturation_param)
    
    revenue = np.ones(n_weeks) * base_revenue
    
    # Add media channel effects
    for ch_name, ch_config in channels.items():
        adstocked = apply_adstock(df[ch_name].values, ch_config["decay"])
        saturated = apply_saturation(adstocked, ch_config["saturation"])
        contribution = saturated * ch_config["coef"] * 100000
        revenue += contribution
    
    # Organic traffic effect
    organic_max = df["organic_traffic"].max()
    organic_normalized = df["organic_traffic"].values / organic_max if organic_max > 0 else np.zeros(n_weeks)
    revenue += organic_normalized * 50000

    # Word of mouth effect (correlated with lagged revenue)
    wom_max = df["word_of_mouth"].max()
    wom_normalized = df["word_of_mouth"].values / wom_max if wom_max > 0 else np.zeros(n_weeks)
    revenue += wom_normalized * 20000
    
    # Context effects
    consumer_conf_effect = (df["consumer_confidence"].values - 100) / 10 * 10000
    revenue += consumer_conf_effect
    
    # Holiday boost
    revenue = revenue + df["is_holiday"].values * 30000
    
    # Add random noise (variance around 5% of base)
    noise = np.random.normal(0, base_revenue * 0.05, n_weeks)
    revenue += noise
    
    # Ensure non-negative revenue
    revenue = np.maximum(revenue, 100000)
    
    df["revenue"] = np.round(revenue, 2)
    
    return df


def generate_calibration_data(channels: list) -> pd.DataFrame:
    """
    Generate calibration/priors data for Bayesian modeling.
    
    Typically includes known effects from past experiments or literature.
    
    Args:
        channels: List of channel names
    Returns:
        DataFrame with calibration data
    """
    calibration_data = []
    
    # Default priors/calibration values
    priors = {
        "tv_spend": {"elasticity": 0.3, "adstock_decay": 0.65, "saturation": 0.6},
        "digital_spend": {"elasticity": 0.5, "adstock_decay": 0.25, "saturation": 0.5},
        "social_media_spend": {"elasticity": 0.4, "adstock_decay": 0.35, "saturation": 0.45},
        "search_spend": {"elasticity": 0.6, "adstock_decay": 0.15, "saturation": 0.55},
        "print_spend": {"elasticity": 0.2, "adstock_decay": 0.45, "saturation": 0.7},
        "radio_spend": {"elasticity": 0.25, "adstock_decay": 0.55, "saturation": 0.65},
    }
    
    for ch in channels:
        if ch in priors:
            calibration_data.append({
                "channel": ch,
                "elasticity": priors[ch]["elasticity"],
                "adstock_decay": priors[ch]["adstock_decay"],
                "saturation": priors[ch]["saturation"],
            })
    
    return pd.DataFrame(calibration_data)
