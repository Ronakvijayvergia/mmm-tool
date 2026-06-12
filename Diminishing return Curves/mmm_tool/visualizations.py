"""
MMM Visualization Module.

Produces publication-quality charts for:
  - Individual channel response curves
  - Overlaid multi-channel response curves
  - Marginal response (dy/dx) curves
  - Budget allocation waterfall / bar charts
  - Model fit diagnostics (actual vs. predicted, residuals)
  - Channel contribution decomposition
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from typing import Dict, List, Optional, Tuple
from io import BytesIO

from core_engine import (
    ResponseFunction,
    generate_response_curve,
    ChannelConfig,
)

# ─── Style Configuration ─────────────────────────────────────
# Dark-mode friendly palette: brighter, higher-contrast colors
# that read well on both dark Streamlit themes and white export.

CHANNEL_COLORS = {
    "TV": "#60a5fa",       # Blue-400
    "Social": "#a78bfa",   # Violet-400
    "Search": "#34d399",   # Emerald-400
    "Email": "#fbbf24",    # Amber-400
    "Display": "#fb7185",  # Rose-400
}

FALLBACK_COLORS = [
    "#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#fb7185",
    "#22d3ee", "#f472b6", "#a3e635", "#c084fc", "#fb923c",
]

# Dark theme: dark figure/axes backgrounds, light text & gridlines
sns.set_theme(style="darkgrid", font_scale=1.1)
plt.rcParams.update({
    "figure.facecolor": "#0e1117",     # Streamlit dark bg
    "axes.facecolor": "#1a1f2e",       # Slightly lighter than bg
    "axes.edgecolor": "#2d3548",       # Subtle border
    "axes.labelcolor": "#c9d1d9",      # Light text
    "grid.color": "#2d3548",           # Dark gridlines
    "text.color": "#c9d1d9",           # Light text everywhere
    "xtick.color": "#8b949e",          # Muted tick labels
    "ytick.color": "#8b949e",
    "font.family": "sans-serif",
    "legend.facecolor": "#1a1f2e",
    "legend.edgecolor": "#2d3548",
})


def _get_color(channel_name: str, idx: int = 0) -> str:
    return CHANNEL_COLORS.get(channel_name, FALLBACK_COLORS[idx % len(FALLBACK_COLORS)])


def _format_currency(x, _=None):
    if abs(x) >= 1e6:
        return f"${x/1e6:.1f}M"
    elif abs(x) >= 1e3:
        return f"${x/1e3:.0f}K"
    else:
        return f"${x:.0f}"


# ─── 1. Individual Channel Response Curve ─────────────────────

def plot_response_curve(
    spend_range: np.ndarray,
    response: np.ndarray,
    channel_name: str,
    marginal: np.ndarray = None,
    current_spend: float = None,
    optimal_spend: float = None,
    figsize: Tuple = (10, 6),
    show_marginal: bool = True,
) -> plt.Figure:
    """
    Plot a single channel's response and marginal curves.

    Args:
        spend_range: Array of spend values (x-axis).
        response: Response values (y-axis).
        channel_name: Channel label.
        marginal: Marginal response values (optional, secondary y-axis).
        current_spend: Vertical line for current average spend.
        optimal_spend: Vertical line for optimized spend.
        figsize: Figure dimensions.
        show_marginal: Whether to overlay marginal curve.

    Returns:
        matplotlib Figure.
    """
    color = _get_color(channel_name)

    if show_marginal and marginal is not None:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(figsize[0], figsize[1] * 1.3),
                                         sharex=True, gridspec_kw={"height_ratios": [2, 1]})
    else:
        fig, ax1 = plt.subplots(figsize=figsize)
        ax2 = None

    # Response curve
    ax1.plot(spend_range, response, color=color, linewidth=2.5, label="Response")
    ax1.fill_between(spend_range, 0, response, alpha=0.08, color=color)

    # Annotations
    if current_spend is not None:
        idx = np.argmin(np.abs(spend_range - current_spend))
        ax1.axvline(current_spend, color="#94a3b8", linestyle="--", linewidth=1, alpha=0.7)
        ax1.plot(current_spend, response[idx], "o", color="#94a3b8", markersize=8, zorder=5)
        ax1.annotate(
            f"Current\n{_format_currency(current_spend)}",
            xy=(current_spend, response[idx]),
            xytext=(15, 15), textcoords="offset points",
            fontsize=9, color="#94a3b8",
            arrowprops=dict(arrowstyle="->", color="#94a3b8", lw=0.8),
        )

    if optimal_spend is not None:
        idx = np.argmin(np.abs(spend_range - optimal_spend))
        ax1.axvline(optimal_spend, color="#4ade80", linestyle="--", linewidth=1, alpha=0.7)
        ax1.plot(optimal_spend, response[idx], "s", color="#4ade80", markersize=8, zorder=5)
        ax1.annotate(
            f"Optimal\n{_format_currency(optimal_spend)}",
            xy=(optimal_spend, response[idx]),
            xytext=(15, -25), textcoords="offset points",
            fontsize=9, color="#4ade80",
            arrowprops=dict(arrowstyle="->", color="#4ade80", lw=0.8),
        )

    ax1.set_ylabel("Incremental Response (Sales)", fontsize=11)
    ax1.set_title(f"{channel_name} — Diminishing Returns Curve", fontsize=13, fontweight="bold")
    ax1.xaxis.set_major_formatter(mticker.FuncFormatter(_format_currency))
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda x, _: f"{x/1e3:.0f}K" if abs(x) >= 1e3 else f"{x:.0f}"
    ))
    ax1.legend(loc="upper left", framealpha=0.9)

    # Marginal curve
    if ax2 is not None and marginal is not None:
        ax2.plot(spend_range, marginal, color=color, linewidth=2, linestyle="-", alpha=0.8)
        ax2.axhline(0, color="#64748b", linewidth=0.5)

        # Highlight where marginal ROI = 1 (break-even)
        if np.any(marginal >= 1) and np.any(marginal <= 1):
            cross_idx = np.where(np.diff(np.sign(marginal - 1)))[0]
            if len(cross_idx) > 0:
                be_spend = spend_range[cross_idx[0]]
                ax2.axvline(be_spend, color="#f87171", linestyle=":", linewidth=1)
                ax2.annotate(
                    f"mROI=1\n{_format_currency(be_spend)}",
                    xy=(be_spend, 1),
                    xytext=(15, 10), textcoords="offset points",
                    fontsize=9, color="#f87171",
                )

        ax2.set_xlabel("Spend", fontsize=11)
        ax2.set_ylabel("Marginal Response\n(dResponse / dSpend)", fontsize=10)
        ax2.xaxis.set_major_formatter(mticker.FuncFormatter(_format_currency))

    elif ax2 is None:
        ax1.set_xlabel("Spend", fontsize=11)

    fig.tight_layout()
    return fig


# ─── 2. Overlaid Multi-Channel Response Curves ───────────────

def plot_overlay_curves(
    curves: Dict[str, Tuple[np.ndarray, np.ndarray]],
    title: str = "Channel Response Curves — Overlay",
    figsize: Tuple = (12, 7),
    normalize: bool = False,
) -> plt.Figure:
    """
    Overlay response curves for multiple channels on one plot.

    Args:
        curves: Dict mapping channel_name -> (spend_range, response).
        title: Plot title.
        figsize: Figure dimensions.
        normalize: If True, normalize responses to [0, 1] for comparison.

    Returns:
        matplotlib Figure.
    """
    fig, ax = plt.subplots(figsize=figsize)

    for idx, (ch_name, (spend, resp)) in enumerate(curves.items()):
        color = _get_color(ch_name, idx)
        display_resp = resp / resp.max() if normalize and resp.max() > 0 else resp

        ax.plot(spend, display_resp, color=color, linewidth=2.5, label=ch_name)

    ax.set_xlabel("Spend", fontsize=11)
    ax.set_ylabel("Response" + (" (Normalized)" if normalize else ""), fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(_format_currency))
    ax.legend(loc="best", framealpha=0.9, fontsize=10)

    fig.tight_layout()
    return fig


# ─── 3. Marginal Response Overlay ─────────────────────────────

def plot_marginal_overlay(
    curves: Dict[str, Tuple[np.ndarray, np.ndarray]],
    title: str = "Marginal Response Curves — All Channels",
    figsize: Tuple = (12, 6),
) -> plt.Figure:
    """Overlay marginal curves for all channels."""
    fig, ax = plt.subplots(figsize=figsize)

    for idx, (ch_name, (spend, marginal)) in enumerate(curves.items()):
        color = _get_color(ch_name, idx)
        ax.plot(spend, marginal, color=color, linewidth=2, label=ch_name)

    ax.axhline(1.0, color="#f87171", linestyle=":", linewidth=1, label="mROI = 1 (break-even)")
    ax.axhline(0.0, color="#64748b", linestyle="-", linewidth=0.5)

    ax.set_xlabel("Spend", fontsize=11)
    ax.set_ylabel("Marginal Response (dR / dS)", fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(_format_currency))
    ax.legend(loc="best", framealpha=0.9, fontsize=10)

    fig.tight_layout()
    return fig


# ─── 4. Budget Allocation Bar Chart ──────────────────────────

def plot_budget_allocation(
    current: Dict[str, float],
    optimized: Dict[str, float],
    title: str = "Budget Allocation — Current vs. Optimized",
    figsize: Tuple = (12, 6),
) -> plt.Figure:
    """Side-by-side bar chart comparing current vs. optimized allocations."""
    channels = list(current.keys())
    x = np.arange(len(channels))
    width = 0.35

    fig, ax = plt.subplots(figsize=figsize)

    bars1 = ax.bar(x - width / 2, [current[c] for c in channels], width,
                   label="Current", color="#64748b", edgecolor="#1a1f2e")
    bars2 = ax.bar(x + width / 2, [optimized[c] for c in channels], width,
                   label="Optimized", color="#60a5fa", edgecolor="#1a1f2e")

    # Add value labels
    for bar in bars1:
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h, _format_currency(h),
                ha="center", va="bottom", fontsize=8, color="#94a3b8")
    for bar in bars2:
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h, _format_currency(h),
                ha="center", va="bottom", fontsize=8, color="#93c5fd")

    ax.set_xticks(x)
    ax.set_xticklabels(channels, fontsize=11)
    ax.set_ylabel("Budget ($)", fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(_format_currency))
    ax.legend(loc="upper right", framealpha=0.9)

    fig.tight_layout()
    return fig


# ─── 5. Model Fit Diagnostics ────────────────────────────────

def plot_model_fit(
    actual: np.ndarray,
    predicted: np.ndarray,
    dates: np.ndarray = None,
    title: str = "Model Fit — Actual vs. Predicted",
    uncertainty_lower: np.ndarray = None,
    uncertainty_upper: np.ndarray = None,
    figsize: Tuple = (14, 8),
) -> plt.Figure:
    """
    Time-series + scatter plot of actual vs. predicted sales.
    Includes residuals subplot.
    """
    fig, axes = plt.subplots(2, 2, figsize=figsize,
                              gridspec_kw={"height_ratios": [2, 1], "width_ratios": [2, 1]})
    ax_ts, ax_scatter = axes[0]
    ax_resid, ax_hist = axes[1]

    residuals = actual - predicted
    x_axis = dates if dates is not None else np.arange(len(actual))

    # Time series
    ax_ts.plot(x_axis, actual, color="#e2e8f0", linewidth=1.5, label="Actual", alpha=0.9)
    ax_ts.plot(x_axis, predicted, color="#60a5fa", linewidth=1.5, label="Predicted", alpha=0.9)
    if uncertainty_lower is not None and uncertainty_upper is not None:
        ax_ts.fill_between(x_axis, uncertainty_lower, uncertainty_upper,
                           color="#60a5fa", alpha=0.15, label="95% CI")
    ax_ts.set_title(title, fontsize=13, fontweight="bold")
    ax_ts.set_ylabel("Sales", fontsize=10)
    ax_ts.legend(loc="upper left", fontsize=9)

    # Scatter (actual vs. predicted)
    ax_scatter.scatter(actual, predicted, alpha=0.4, s=20, color="#60a5fa")
    lims = [min(actual.min(), predicted.min()), max(actual.max(), predicted.max())]
    ax_scatter.plot(lims, lims, "k--", linewidth=0.8, alpha=0.5)
    ax_scatter.set_xlabel("Actual", fontsize=10)
    ax_scatter.set_ylabel("Predicted", fontsize=10)
    ax_scatter.set_title("Predicted vs. Actual", fontsize=11)

    # Residuals over time
    ax_resid.bar(x_axis, residuals, color=np.where(residuals >= 0, "#60a5fa", "#fb7185"),
                 alpha=0.6, width=1)
    ax_resid.axhline(0, color="#64748b", linewidth=0.5)
    ax_resid.set_ylabel("Residuals", fontsize=10)
    ax_resid.set_xlabel("Period", fontsize=10)

    # Residual histogram
    ax_hist.hist(residuals, bins=30, color="#60a5fa", alpha=0.7, edgecolor="#1a1f2e")
    ax_hist.axvline(0, color="#64748b", linewidth=0.5)
    ax_hist.set_xlabel("Residual", fontsize=10)
    ax_hist.set_ylabel("Count", fontsize=10)

    fig.tight_layout()
    return fig


# ─── 6. Channel Contribution Decomposition ───────────────────

def plot_contribution_decomposition(
    contributions: Dict[str, np.ndarray],
    base_sales: np.ndarray,
    dates: np.ndarray = None,
    title: str = "Sales Decomposition by Channel",
    figsize: Tuple = (14, 6),
) -> plt.Figure:
    """Stacked area chart of channel contributions over time."""
    fig, ax = plt.subplots(figsize=figsize)

    x_axis = dates if dates is not None else np.arange(len(base_sales))

    # Stack: base at bottom, then channels
    bottom = base_sales.copy()
    ax.fill_between(x_axis, 0, bottom, alpha=0.3, color="#64748b", label="Base Sales")

    for idx, (ch_name, contrib) in enumerate(contributions.items()):
        color = _get_color(ch_name, idx)
        ax.fill_between(x_axis, bottom, bottom + contrib, alpha=0.5, color=color, label=ch_name)
        bottom = bottom + contrib

    ax.set_xlabel("Period", fontsize=11)
    ax.set_ylabel("Sales", fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.legend(loc="upper left", fontsize=9, ncol=3)

    fig.tight_layout()
    return fig


# ─── 7. Response Table Generator ─────────────────────────────

def generate_response_table(
    spend_range: np.ndarray,
    response: np.ndarray,
    marginal: np.ndarray,
    channel_name: str,
    n_rows: int = 20,
) -> pd.DataFrame:
    """Create a tabular summary of the response curve."""
    indices = np.linspace(0, len(spend_range) - 1, n_rows, dtype=int)

    df = pd.DataFrame({
        "Channel": channel_name,
        "Spend": spend_range[indices],
        "Response": response[indices],
        "Marginal_Response": marginal[indices],
        "ROI": np.where(spend_range[indices] > 0,
                        response[indices] / spend_range[indices], 0),
        "Marginal_ROI": marginal[indices],
    })

    df["Spend"] = df["Spend"].map(lambda x: f"${x:,.0f}")
    df["Response"] = df["Response"].map(lambda x: f"{x:,.0f}")
    df["Marginal_Response"] = df["Marginal_Response"].map(lambda x: f"{x:.4f}")
    df["ROI"] = df["ROI"].map(lambda x: f"{x:.4f}")
    df["Marginal_ROI"] = df["Marginal_ROI"].map(lambda x: f"{x:.4f}")

    return df


# ─── 8. Save Figure Utility ──────────────────────────────────

def save_figure(fig: plt.Figure, filepath: str, dpi: int = 150):
    """Save figure to file (PNG, PDF, SVG)."""
    fig.savefig(filepath, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


def fig_to_bytes(fig: plt.Figure, format: str = "png", dpi: int = 150) -> bytes:
    """Convert figure to bytes for Streamlit display."""
    buf = BytesIO()
    fig.savefig(buf, format=format, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    buf.seek(0)
    return buf.getvalue()
