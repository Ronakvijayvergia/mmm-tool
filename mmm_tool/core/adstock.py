"""
Adstock Transformations for Marketing Mix Modeling.
Implements geometric decay and Weibull decay (CDF and PDF variants).
Based on Meta Robyn methodology.
"""
import numpy as np
import pandas as pd
from typing import Tuple, Optional


def geometric_adstock(x: np.ndarray, theta: float = 0.5, l_max: int = 8) -> np.ndarray:
    """
    Apply geometric adstock transformation.
    Models carryover effects with exponential decay.
    
    Args:
        x: Input spend/impression array
        theta: Decay rate (0-1). Higher = longer carryover
        l_max: Maximum lag length
    Returns:
        Transformed array with adstock effects
    """
    if theta < 0 or theta > 1:
        raise ValueError("theta must be between 0 and 1")
    
    weights = np.array([theta ** i for i in range(l_max)])
    weights = weights / weights.sum()
    
    x_decayed = np.zeros_like(x, dtype=float)
    for t in range(len(x)):
        for lag in range(min(l_max, t + 1)):
            x_decayed[t] += weights[lag] * x[t - lag]
    
    return x_decayed


def weibull_adstock_cdf(x: np.ndarray, shape: float = 1.0, scale: float = 1.0, l_max: int = 8) -> np.ndarray:
    """
    Weibull CDF adstock transformation.
    Flexible decay pattern: shape<1 = delayed peak, shape>1 = immediate peak.
    
    Args:
        x: Input array
        shape: Weibull shape parameter (controls decay curve shape)
        scale: Weibull scale parameter (controls time to peak effect)
        l_max: Maximum lag length
    Returns:
        Transformed array
    """
    from scipy.stats import weibull_min
    
    lags = np.arange(l_max)
    weights = weibull_min.cdf(lags + 1, c=shape, scale=scale) - weibull_min.cdf(lags, c=shape, scale=scale)
    
    if weights.sum() > 0:
        weights = weights / weights.sum()
    
    x_decayed = np.zeros_like(x, dtype=float)
    for t in range(len(x)):
        for lag in range(min(l_max, t + 1)):
            x_decayed[t] += weights[lag] * x[t - lag]
    
    return x_decayed


def weibull_adstock_pdf(x: np.ndarray, shape: float = 2.0, scale: float = 3.0, l_max: int = 8) -> np.ndarray:
    """
    Weibull PDF adstock transformation.
    Allows delayed peak effect (e.g., branding campaigns).
    
    Args:
        x: Input array
        shape: Weibull shape parameter
        scale: Weibull scale parameter
        l_max: Maximum lag length
    Returns:
        Transformed array
    """
    from scipy.stats import weibull_min
    
    lags = np.arange(l_max)
    weights = weibull_min.pdf(lags, c=shape, scale=scale)
    
    if weights.sum() > 0:
        weights = weights / weights.sum()
    
    x_decayed = np.zeros_like(x, dtype=float)
    for t in range(len(x)):
        for lag in range(min(l_max, t + 1)):
            x_decayed[t] += weights[lag] * x[t - lag]
    
    return x_decayed


def apply_adstock(x: np.ndarray, method: str = "geometric", **kwargs) -> np.ndarray:
    """
    Apply adstock transformation using specified method.
    
    Args:
        x: Input array
        method: One of 'geometric', 'weibull_cdf', 'weibull_pdf'
        **kwargs: Parameters for the chosen method
    Returns:
        Transformed array
    """
    methods = {
        "geometric": geometric_adstock,
        "weibull_cdf": weibull_adstock_cdf,
        "weibull_pdf": weibull_adstock_pdf,
    }
    
    if method not in methods:
        raise ValueError(f"Unknown method: {method}. Choose from {list(methods.keys())}")
    
    return methods[method](x, **kwargs)


def get_adstock_weights(method: str = "geometric", l_max: int = 8, **kwargs) -> np.ndarray:
    """Get the weight distribution for visualization."""
    impulse = np.zeros(l_max * 2)
    impulse[0] = 1.0
    response = apply_adstock(impulse, method=method, l_max=l_max, **kwargs)
    return response[:l_max]
