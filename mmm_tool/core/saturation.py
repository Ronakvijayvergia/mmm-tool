"""
Saturation (Diminishing Returns) Curves for MMM.
Implements Hill function and related transformations.
Based on Meta Robyn and industry best practices.
"""
import numpy as np
from typing import Tuple, Optional


def hill_function(x: np.ndarray, alpha: float = 1.0, gamma: float = 0.5) -> np.ndarray:
    """
    Hill saturation function (used in Meta Robyn).
    Models diminishing returns: initial spend is effective, but incremental gains shrink.
    
    Args:
        x: Input array (typically adstocked spend)
        alpha: Shape/steepness parameter (controls curve slope)
        gamma: Half-saturation point (EC50 - spend level at 50% max response)
    Returns:
        Saturated response array (0 to 1 scale)
    """
    x_normalized = x / (x.max() + 1e-10) if x.max() > 0 else x
    return 1 - 1 / (1 + (x_normalized / gamma) ** alpha)


def power_curve(x: np.ndarray, alpha: float = 0.5) -> np.ndarray:
    """
    Simple power/concave saturation curve.
    y = x^alpha where 0 < alpha < 1 gives diminishing returns.
    
    Args:
        x: Input array
        alpha: Power parameter (0-1 for diminishing returns)
    Returns:
        Transformed array
    """
    return np.power(np.maximum(x, 0), alpha)


def logistic_saturation(x: np.ndarray, mu: float = 0.5, lam: float = 5.0) -> np.ndarray:
    """
    Logistic (S-curve) saturation function.
    Captures increasing returns at low spend and diminishing returns at high spend.
    
    Args:
        x: Input array (normalized)
        mu: Inflection point
        lam: Steepness parameter
    Returns:
        Saturated response
    """
    x_normalized = x / (x.max() + 1e-10) if x.max() > 0 else x
    return 1 / (1 + np.exp(-lam * (x_normalized - mu)))


def michaelis_menten(x: np.ndarray, vmax: float = 1.0, km: float = 0.5) -> np.ndarray:
    """
    Michaelis-Menten saturation curve.
    Common in pharmacology, applicable to media saturation.
    
    Args:
        x: Input array
        vmax: Maximum response
        km: Half-saturation constant
    Returns:
        Saturated response
    """
    x_normalized = x / (x.max() + 1e-10) if x.max() > 0 else x
    return vmax * x_normalized / (km + x_normalized)


def apply_saturation(x: np.ndarray, method: str = "hill", **kwargs) -> np.ndarray:
    """
    Apply saturation transformation.
    
    Args:
        x: Input array
        method: One of 'hill', 'power', 'logistic', 'michaelis_menten'
        **kwargs: Parameters for chosen method
    Returns:
        Saturated response array
    """
    methods = {
        "hill": hill_function,
        "power": power_curve,
        "logistic": logistic_saturation,
        "michaelis_menten": michaelis_menten,
    }
    
    if method not in methods:
        raise ValueError(f"Unknown method: {method}. Choose from {list(methods.keys())}")
    
    return methods[method](x, **kwargs)


def marginal_response(x: np.ndarray, method: str = "hill", **kwargs) -> np.ndarray:
    """
    Calculate marginal response curve (derivative of saturation function).
    Key for budget optimization: shows ROI of next dollar spent.
    
    Args:
        x: Input spend levels
        method: Saturation method
        **kwargs: Parameters for method
    Returns:
        Marginal response at each spend level
    """
    y = apply_saturation(x, method=method, **kwargs)
    if len(x) < 2:
        return np.zeros_like(x)
    dx = np.gradient(x)
    dy = np.gradient(y)
    marginal = np.where(dx != 0, dy / dx, 0)
    return marginal


def compute_mroi(
    spend: np.ndarray,
    method: str = "hill",
    coef: float = 1.0,
    delta: float = 0.01,
    **kwargs
) -> np.ndarray:
    """
    Compute marginal ROI at each spend level by re-evaluating the saturation curve.

    Concatenates spend and spend+delta into one array before applying saturation,
    so both share the same internal normalization.

    Args:
        spend: Current spend levels
        method: Saturation method to use
        coef: Model coefficient for the channel
        delta: Percentage change for marginal calculation
        **kwargs: Parameters for the saturation method
    Returns:
        MROI at each point
    """
    n = len(spend)
    spend_plus = spend * (1 + delta)
    spend_plus = np.where(spend == 0, delta, spend_plus)

    # Combine both arrays so saturation normalizes them together
    combined = np.concatenate([spend, spend_plus])
    combined_response = coef * apply_saturation(combined, method=method, **kwargs)

    response = combined_response[:n]
    response_plus = combined_response[n:]

    spend_delta = spend_plus - spend
    mroi = np.where(
        spend_delta != 0,
        (response_plus - response) / spend_delta,
        0
    )
    return mroi
