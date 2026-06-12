"""
MMM Core Engine — Transformations, Adstock, Equation Types, and Sample Data Generation.

This module provides the mathematical foundation for Marketing Mix Modeling:
- Adstock transformations (Geometric, Weibull)
- Lag transformations
- Response functions (Linear, Log, Power, Exponential, Hill, Quadratic)
- Steady-state simulation for curve generation
- Sample data generator for demos
"""

import numpy as np
import pandas as pd
from scipy.special import gamma as gamma_func
from typing import Dict, List, Optional, Tuple
import warnings

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────
# 1. ADSTOCK TRANSFORMATIONS
# ─────────────────────────────────────────────────────────────

def geometric_adstock(spend: np.ndarray, decay: float) -> np.ndarray:
    """
    Geometric adstock (carryover decay).
    Adstock_t = Spend_t + λ * Adstock_{t-1}

    Args:
        spend: Time-series of spend values.
        decay: Decay rate λ ∈ [0, 1). Higher = longer carryover.

    Returns:
        Transformed spend with carryover effects.
    """
    adstocked = np.zeros_like(spend, dtype=float)
    adstocked[0] = spend[0]
    for t in range(1, len(spend)):
        adstocked[t] = spend[t] + decay * adstocked[t - 1]
    return adstocked


def weibull_adstock(spend: np.ndarray, shape: float, scale: float, max_lag: int = 13) -> np.ndarray:
    """
    Weibull adstock using Weibull PDF as weights for flexible decay shapes.

    Args:
        spend: Time-series of spend values.
        shape: Weibull shape parameter (k). k<1 = front-loaded, k>1 = delayed peak.
        scale: Weibull scale parameter (λ).
        max_lag: Maximum lag periods to consider.

    Returns:
        Transformed spend with Weibull-shaped carryover.
    """
    lags = np.arange(0, max_lag)
    # Weibull PDF weights
    weights = (shape / scale) * (lags / scale) ** (shape - 1) * np.exp(-(lags / scale) ** shape)
    weights[0] = max(weights[0], 1e-10)  # Avoid zero at lag 0
    weights = weights / weights.sum()  # Normalize

    n = len(spend)
    adstocked = np.zeros(n)
    for t in range(n):
        for l in range(min(max_lag, t + 1)):
            adstocked[t] += weights[l] * spend[t - l]
    return adstocked


def apply_lag(spend: np.ndarray, lag_periods: int) -> np.ndarray:
    """
    Apply a simple fixed lag (delay) to spend.
    Effective_Spend_t = Spend_{t-k}

    Args:
        spend: Time-series of spend values.
        lag_periods: Number of periods to delay (k).

    Returns:
        Lagged spend series (zero-padded at the start).
    """
    if lag_periods <= 0:
        return spend.copy()
    lagged = np.zeros_like(spend)
    lagged[lag_periods:] = spend[:-lag_periods]
    return lagged


# ─────────────────────────────────────────────────────────────
# 2. RESPONSE FUNCTIONS (EQUATION TYPES)
# ─────────────────────────────────────────────────────────────

class ResponseFunction:
    """Base class for channel response functions f(Spend)."""

    TYPES = ["Linear", "Logarithmic", "Power", "Exponential", "Hill", "Quadratic"]

    @staticmethod
    def linear(spend: np.ndarray, beta: float) -> np.ndarray:
        """f = β * Spend. No diminishing returns."""
        return beta * spend

    @staticmethod
    def logarithmic(spend: np.ndarray, beta: float, gamma: float) -> np.ndarray:
        """f = β * log(γ * Spend + 1). Gradual taper — concave."""
        return beta * np.log(gamma * spend + 1)

    @staticmethod
    def power(spend: np.ndarray, beta: float, gamma: float) -> np.ndarray:
        """f = β * Spend^γ. γ<1 gives diminishing returns."""
        return beta * np.power(np.maximum(spend, 0), gamma)

    @staticmethod
    def exponential(spend: np.ndarray, beta: float, gamma: float) -> np.ndarray:
        """f = β * (1 - exp(-γ * Spend)). Asymptotic saturation at β."""
        return beta * (1 - np.exp(-gamma * spend))

    @staticmethod
    def hill(spend: np.ndarray, beta: float, gamma: float, delta: float) -> np.ndarray:
        """
        f = (β * Spend^γ) / (Spend^γ + δ^γ). S-shaped Hill function.
        delta = half-max spend (EC50), gamma = steepness.
        """
        spend_g = np.power(np.maximum(spend, 0), gamma)
        delta_g = np.power(max(delta, 1e-10), gamma)
        return beta * spend_g / (spend_g + delta_g)

    @staticmethod
    def quadratic(spend: np.ndarray, beta: float, gamma: float) -> np.ndarray:
        """f = β * Spend - γ * Spend². Peaks then turns negative."""
        return beta * spend - gamma * spend ** 2

    @classmethod
    def evaluate(cls, func_type: str, spend: np.ndarray, params: dict) -> np.ndarray:
        """Dispatch to the correct response function by name."""
        func_map = {
            "Linear": cls.linear,
            "Logarithmic": cls.logarithmic,
            "Power": cls.power,
            "Exponential": cls.exponential,
            "Hill": cls.hill,
            "Quadratic": cls.quadratic,
        }
        func = func_map[func_type]
        if func_type == "Linear":
            return func(spend, params["beta"])
        elif func_type in ("Logarithmic", "Power", "Exponential", "Quadratic"):
            return func(spend, params["beta"], params["gamma"])
        elif func_type == "Hill":
            return func(spend, params["beta"], params["gamma"], params["delta"])
        else:
            raise ValueError(f"Unknown function type: {func_type}")

    @classmethod
    def marginal(cls, func_type: str, spend: np.ndarray, params: dict) -> np.ndarray:
        """Compute marginal response (df/dSpend) via analytical derivatives."""
        beta = params.get("beta", 1.0)
        gamma = params.get("gamma", 1.0)
        delta = params.get("delta", 1.0)

        if func_type == "Linear":
            return np.full_like(spend, beta, dtype=float)
        elif func_type == "Logarithmic":
            return beta * gamma / (gamma * spend + 1)
        elif func_type == "Power":
            safe_spend = np.maximum(spend, 1e-10)
            return beta * gamma * np.power(safe_spend, gamma - 1)
        elif func_type == "Exponential":
            return beta * gamma * np.exp(-gamma * spend)
        elif func_type == "Hill":
            spend_g = np.power(np.maximum(spend, 1e-10), gamma)
            delta_g = np.power(max(delta, 1e-10), gamma)
            denom = (spend_g + delta_g) ** 2
            numer = beta * gamma * np.power(np.maximum(spend, 1e-10), gamma - 1) * delta_g
            return numer / np.maximum(denom, 1e-20)
        elif func_type == "Quadratic":
            return beta - 2 * gamma * spend
        else:
            raise ValueError(f"Unknown function type: {func_type}")

    @classmethod
    def default_params(cls, func_type: str) -> dict:
        """Return sensible default parameters for each function type."""
        defaults = {
            "Linear": {"beta": 0.5},
            "Logarithmic": {"beta": 500.0, "gamma": 0.001},
            "Power": {"beta": 50.0, "gamma": 0.6},
            "Exponential": {"beta": 5000.0, "gamma": 0.0001},
            "Hill": {"beta": 5000.0, "gamma": 2.0, "delta": 500.0},
            "Quadratic": {"beta": 1.0, "gamma": 0.0005},
        }
        return defaults.get(func_type, {"beta": 1.0})

    @classmethod
    def param_bounds(cls, func_type: str) -> dict:
        """Return (lower, upper) bounds for each parameter."""
        bounds = {
            "Linear": {"beta": (0.001, 10.0)},
            "Logarithmic": {"beta": (1.0, 10000.0), "gamma": (1e-6, 1.0)},
            "Power": {"beta": (1.0, 10000.0), "gamma": (0.01, 1.5)},
            "Exponential": {"beta": (100.0, 50000.0), "gamma": (1e-7, 0.01)},
            "Hill": {"beta": (100.0, 50000.0), "gamma": (0.5, 5.0), "delta": (10.0, 5000.0)},
            "Quadratic": {"beta": (0.001, 10.0), "gamma": (1e-8, 0.01)},
        }
        return bounds.get(func_type, {"beta": (0.01, 100.0)})


# ─────────────────────────────────────────────────────────────
# 3. STEADY-STATE SIMULATION FOR CURVE GENERATION
# ─────────────────────────────────────────────────────────────

def simulate_steady_state(
    spend_level: float,
    adstock_type: str = "geometric",
    adstock_params: dict = None,
    lag: int = 0,
    n_periods: int = 104,
) -> float:
    """
    Simulate constant spend over n_periods to find the steady-state
    effective (transformed) spend after adstock + lag.

    This is used to translate a "spend level" into the actual transformed
    input that enters the response function when generating curves.

    Args:
        spend_level: Constant spend per period.
        adstock_type: "none", "geometric", or "weibull".
        adstock_params: Dict with decay/shape/scale parameters.
        lag: Number of lag periods.
        n_periods: Simulation length.

    Returns:
        Steady-state transformed spend value (last period).
    """
    if adstock_params is None:
        adstock_params = {}

    spend_series = np.full(n_periods, spend_level)

    # Apply lag first
    if lag > 0:
        spend_series = apply_lag(spend_series, lag)

    # Apply adstock
    if adstock_type == "geometric":
        decay = adstock_params.get("decay", 0.0)
        spend_series = geometric_adstock(spend_series, decay)
    elif adstock_type == "weibull":
        shape = adstock_params.get("shape", 1.0)
        scale = adstock_params.get("scale", 1.0)
        spend_series = weibull_adstock(spend_series, shape, scale)

    # Return steady-state (last period value)
    return spend_series[-1]


def generate_response_curve(
    spend_range: np.ndarray,
    func_type: str,
    func_params: dict,
    adstock_type: str = "none",
    adstock_params: dict = None,
    lag: int = 0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Generate response and marginal curves over a range of spend levels.

    For each spend level, simulates steady-state transformed spend,
    then applies the response function.

    Args:
        spend_range: Array of spend levels to evaluate.
        func_type: Response function type name.
        func_params: Parameters for the response function.
        adstock_type: Adstock transformation type.
        adstock_params: Adstock parameters.
        lag: Lag periods.

    Returns:
        Tuple of (spend_range, response_values, marginal_values).
    """
    if adstock_type != "none":
        # Simulate steady-state for each spend level
        transformed = np.array([
            simulate_steady_state(s, adstock_type, adstock_params, lag)
            for s in spend_range
        ])
    else:
        transformed = spend_range.copy()

    response = ResponseFunction.evaluate(func_type, transformed, func_params)
    marginal = ResponseFunction.marginal(func_type, transformed, func_params)

    # Adjust marginal for adstock multiplier (chain rule)
    if adstock_type == "geometric" and adstock_params:
        decay = adstock_params.get("decay", 0.0)
        # Steady-state multiplier: 1 / (1 - λ)
        if decay < 1.0:
            marginal = marginal * (1.0 / (1.0 - decay))
    elif adstock_type == "weibull" and adstock_params:
        # Approximate multiplier from weights sum
        marginal = marginal  # Weibull weights already normalized

    return spend_range, response, marginal


# ─────────────────────────────────────────────────────────────
# 4. SAMPLE DATA GENERATOR
# ─────────────────────────────────────────────────────────────

def generate_sample_data(
    n_periods: int = 156,
    channels: List[str] = None,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Generate realistic synthetic MMM data with 5 channels.

    Creates weekly data with seasonality, trend, diminishing returns
    per channel, and noise. Useful for demos and testing.

    Args:
        n_periods: Number of time periods (weeks).
        channels: List of channel names.
        seed: Random seed for reproducibility.

    Returns:
        DataFrame with date, channel spends, controls, and sales.
    """
    if channels is None:
        channels = ["TV", "Social", "Search", "Email", "Display"]

    np.random.seed(seed)
    dates = pd.date_range(start="2022-01-03", periods=n_periods, freq="W-MON")

    # Channel spend profiles (different distributions per channel)
    spend_config = {
        "TV": {"mean": 50000, "std": 20000, "min": 0, "flight_prob": 0.3},
        "Social": {"mean": 15000, "std": 5000, "min": 2000, "flight_prob": 0.0},
        "Search": {"mean": 25000, "std": 8000, "min": 5000, "flight_prob": 0.0},
        "Email": {"mean": 5000, "std": 2000, "min": 1000, "flight_prob": 0.0},
        "Display": {"mean": 10000, "std": 4000, "min": 1000, "flight_prob": 0.1},
    }

    data = {"date": dates}

    # True model parameters for data generation
    true_params = {
        "TV": {"type": "Hill", "beta": 8000, "gamma": 1.8, "delta": 40000, "adstock_decay": 0.7},
        "Social": {"type": "Logarithmic", "beta": 600, "gamma": 0.0005, "adstock_decay": 0.3},
        "Search": {"type": "Power", "beta": 80, "gamma": 0.55, "adstock_decay": 0.1},
        "Email": {"type": "Exponential", "beta": 2000, "gamma": 0.0008, "adstock_decay": 0.2},
        "Display": {"type": "Logarithmic", "beta": 400, "gamma": 0.0003, "adstock_decay": 0.5},
    }

    # Generate spends
    for ch in channels:
        cfg = spend_config.get(ch, {"mean": 10000, "std": 5000, "min": 0, "flight_prob": 0.0})
        raw = np.random.normal(cfg["mean"], cfg["std"], n_periods)
        # Flighting (some weeks off for TV/Display)
        if cfg["flight_prob"] > 0:
            flights = np.random.binomial(1, 1 - cfg["flight_prob"], n_periods)
            raw = raw * flights
        raw = np.maximum(raw, cfg["min"])
        # Add seasonality to spend (higher in Q4)
        week_of_year = dates.isocalendar().week.values.astype(float)
        seasonal_mult = 1 + 0.3 * np.sin(2 * np.pi * (week_of_year - 13) / 52)
        data[f"spend_{ch}"] = np.round(raw * seasonal_mult, 2)

    # Control variables
    data["price_index"] = np.round(100 + np.cumsum(np.random.normal(0, 0.5, n_periods)), 2)
    data["holiday"] = ((week_of_year >= 47) & (week_of_year <= 52)).astype(float)
    data["competitor_spend"] = np.round(np.random.normal(100000, 30000, n_periods).clip(20000), 2)

    # Generate sales from true model
    base_sales = 50000
    trend = np.linspace(0, 5000, n_periods)
    seasonality = 8000 * np.sin(2 * np.pi * (week_of_year - 13) / 52)

    channel_contributions = np.zeros(n_periods)
    for ch in channels:
        spend = data[f"spend_{ch}"]
        p = true_params[ch]
        adstocked = geometric_adstock(spend, p["adstock_decay"])

        if p["type"] == "Hill":
            contrib = ResponseFunction.hill(adstocked, p["beta"], p["gamma"], p["delta"])
        elif p["type"] == "Logarithmic":
            contrib = ResponseFunction.logarithmic(adstocked, p["beta"], p["gamma"])
        elif p["type"] == "Power":
            contrib = ResponseFunction.power(adstocked, p["beta"], p["gamma"])
        elif p["type"] == "Exponential":
            contrib = ResponseFunction.exponential(adstocked, p["beta"], p["gamma"])
        else:
            contrib = ResponseFunction.linear(adstocked, p["beta"])

        channel_contributions += contrib

    # Controls effect
    price_effect = -100 * (data["price_index"] - 100)
    holiday_effect = 15000 * data["holiday"]
    competitor_effect = -0.05 * data["competitor_spend"]

    noise = np.random.normal(0, 3000, n_periods)

    data["sales"] = np.round(
        base_sales + trend + seasonality + channel_contributions
        + price_effect + holiday_effect + competitor_effect + noise,
        2,
    )
    data["sales"] = np.maximum(data["sales"], 0)

    return pd.DataFrame(data)


# ─────────────────────────────────────────────────────────────
# 5. CHANNEL CONFIGURATION DATACLASS
# ─────────────────────────────────────────────────────────────

class ChannelConfig:
    """Configuration for a single marketing channel."""

    def __init__(
        self,
        name: str,
        func_type: str = "Hill",
        func_params: dict = None,
        adstock_type: str = "geometric",
        adstock_params: dict = None,
        lag: int = 0,
    ):
        self.name = name
        self.func_type = func_type
        self.func_params = func_params or ResponseFunction.default_params(func_type)
        self.adstock_type = adstock_type
        self.adstock_params = adstock_params or {"decay": 0.5}
        self.lag = lag

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "func_type": self.func_type,
            "func_params": self.func_params,
            "adstock_type": self.adstock_type,
            "adstock_params": self.adstock_params,
            "lag": self.lag,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ChannelConfig":
        return cls(**d)
