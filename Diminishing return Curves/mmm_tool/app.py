"""
Marketing Mix Modeling — Diminishing Returns Curve Tool
========================================================

A post-MMM companion tool for visualizing and optimizing
diminishing returns curves across marketing channels.

You bring the parameters from your existing MMM model.
This tool visualizes the curves and optimizes your budget.

Launch: streamlit run app.py
"""

import sys
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import streamlit as st
from io import BytesIO
import json
import warnings

warnings.filterwarnings("ignore")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core_engine import (
    ResponseFunction,
    ChannelConfig,
    generate_response_curve,
    generate_sample_data,
    simulate_steady_state,
)
from optimization import BudgetOptimizer
from visualizations import (
    plot_response_curve,
    plot_overlay_curves,
    plot_marginal_overlay,
    plot_budget_allocation,
    generate_response_table,
    fig_to_bytes,
)


# ═══════════════════════════════════════════════════════════════
# PAGE CONFIG & STYLING
# ═══════════════════════════════════════════════════════════════

st.set_page_config(
    page_title="MMM Diminishing Returns Tool",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
    .main .block-container { padding-top: 1.5rem; max-width: 1200px; }
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] { padding: 8px 20px; border-radius: 6px 6px 0 0; font-weight: 500; }
    div[data-testid="stSidebarContent"] { padding-top: 1rem; }
    .stExpander { border: 1px solid #e2e8f0; border-radius: 8px; }
    .info-box { background: #1e2a3a; border-left: 4px solid #60a5fa; padding: 14px 18px;
                border-radius: 0 8px 8px 0; margin-bottom: 16px; font-size: 0.9rem;
                color: #e2e8f0; line-height: 1.6; }
    .info-box b, .info-box strong { color: #93c5fd; }
    .warn-box { background: #2a2215; border-left: 4px solid #fbbf24; padding: 14px 18px;
                border-radius: 0 8px 8px 0; margin-bottom: 16px; font-size: 0.9rem;
                color: #e2e8f0; line-height: 1.6; }
    .warn-box b, .warn-box strong { color: #fcd34d; }
    .step-header { background: linear-gradient(135deg, #1e2a3a, #1a2535); border-radius: 10px;
                   padding: 12px 18px; margin-bottom: 14px; border-left: 4px solid #60a5fa;
                   color: #e2e8f0; }
</style>
""", unsafe_allow_html=True)


# ═══════════════════════════════════════════════════════════════
# SESSION STATE
# ═══════════════════════════════════════════════════════════════

def init_state():
    for key, val in {
        "data": None, "data_source": None, "channel_configs": [],
        "optimization_result": None, "channels": [], "control_cols": [],
    }.items():
        if key not in st.session_state:
            st.session_state[key] = val

init_state()


# ═══════════════════════════════════════════════════════════════
# SIDEBAR
# ═══════════════════════════════════════════════════════════════

with st.sidebar:
    st.markdown("## 📈 MMM Curve Tool")
    st.caption("Visualize diminishing returns & optimize budgets")
    st.markdown("---")

    st.markdown("### Step 1: Load Data")
    st.markdown(
        '<div class="info-box">'
        '<b>Why load data?</b> The tool uses your historical spend data to set realistic '
        'spend ranges for curves and to calculate your current average spend per channel. '
        'The actual curve shapes come from your MMM parameters (Step 2).'
        '</div>',
        unsafe_allow_html=True,
    )

    data_source = st.radio(
        "Choose data source:",
        ["Sample Data (Demo)", "Upload CSV/Excel"],
        help=(
            "**Sample Data**: Generates realistic synthetic data with 5 channels "
            "(TV, Social, Search, Email, Display) for testing the tool.\n\n"
            "**Upload**: Use your own data. The file should have columns named "
            "spend_TV, spend_Social, etc. (prefix 'spend_' followed by channel name) "
            "and a 'sales' column."
        ),
    )

    if data_source == "Sample Data (Demo)":
        n_periods = st.slider("Number of periods (weeks)", 52, 260, 156, 26)
        if st.button("Generate Sample Data", type="primary", use_container_width=True):
            st.session_state.data = generate_sample_data(n_periods=n_periods)
            st.session_state.data_source = "sample"
            st.session_state.channels = ["TV", "Social", "Search", "Email", "Display"]
            st.session_state.control_cols = ["price_index", "holiday", "competitor_spend"]
            st.success(f"Generated {n_periods} weeks with 5 channels.")
    else:
        st.markdown(
            "**Expected format:** CSV or Excel with columns like:\n"
            "`date, sales, spend_TV, spend_Social, spend_Search, ...`"
        )
        uploaded_file = st.file_uploader("Upload your data", type=["csv", "xlsx", "xls"])
        if uploaded_file is not None:
            try:
                df = pd.read_csv(uploaded_file) if uploaded_file.name.endswith(".csv") else pd.read_excel(uploaded_file)
                st.session_state.data = df
                st.session_state.data_source = "upload"
                spend_cols = [c for c in df.columns if c.startswith("spend_")]
                st.session_state.channels = [c.replace("spend_", "") for c in spend_cols]
                non_controls = {"date", "sales"} | set(spend_cols)
                st.session_state.control_cols = [c for c in df.columns if c not in non_controls]
                st.success(f"Loaded {len(df)} rows, {len(st.session_state.channels)} channels detected.")
            except Exception as e:
                st.error(f"Error loading file: {e}")

    if st.session_state.data is not None:
        st.markdown("---")
        df = st.session_state.data
        st.caption(f"**{len(df)} rows**  ·  **{len(st.session_state.channels)} channels**: {', '.join(st.session_state.channels)}")
        with st.expander("Preview Data", expanded=False):
            st.dataframe(df.head(8), use_container_width=True, height=180)

    st.markdown("---")
    st.markdown("### Display Settings")
    spend_multiplier = st.slider(
        "Spend range multiplier", 0.5, 3.0, 1.5, 0.1,
        help=(
            "How far beyond your max historical spend the curves extend. "
            "1.5× means curves go up to 150% of the highest spend you've ever had in that channel. "
            "Increase this to see what happens at higher spend levels."
        ),
    )
    curve_resolution = st.slider(
        "Curve smoothness (points)", 50, 500, 200, 50,
        help="More points = smoother curves, but slightly slower. 200 is a good default.",
    )


# ═══════════════════════════════════════════════════════════════
# MAIN CONTENT
# ═══════════════════════════════════════════════════════════════

st.markdown("# 📈 MMM — Diminishing Returns Curves")
st.markdown(
    "A **post-MMM companion tool**. You've already built your Marketing Mix Model "
    "(in Robyn, LightweightMMM, PyMC-Marketing, or any other tool). "
    "Now plug in the parameters and use this tool to **visualize the curves** "
    "and **optimize your budget allocation** across channels."
)

if st.session_state.data is None:
    st.markdown("---")
    st.markdown(
        '<div class="step-header">'
        '<b>Getting Started</b><br>'
        '1. Load your data from the sidebar (or use Sample Data to explore)<br>'
        '2. Enter your MMM parameters in the Channel Config tab<br>'
        '3. View your diminishing returns curves<br>'
        '4. Optimize your budget allocation'
        '</div>',
        unsafe_allow_html=True,
    )
    st.info("👈 Start by loading data from the sidebar. Use **Sample Data** for a quick demo.")
    st.stop()

df = st.session_state.data
channels = st.session_state.channels


# ═══════════════════════════════════════════════════════════════
# TABS — 4 clean tabs
# ═══════════════════════════════════════════════════════════════

tab0, tab1, tab2, tab3, tab4 = st.tabs([
    "📖 Guide",
    "⚙️ Channel Config",
    "📉 Response Curves",
    "🎯 Budget Optimization",
    "💾 Export",
])


# ═══════════════════════════════════════════════════════════════
# TAB 0: GUIDE — Intuitive walkthrough with examples
# ═══════════════════════════════════════════════════════════════

with tab0:
    st.markdown("## How This Tool Works — A Complete Walkthrough")
    st.markdown("")

    # ── What is this tool? ──
    st.markdown(
        '<div class="info-box">'
        "<b>In one sentence:</b> You already built an MMM somewhere (Robyn, LightweightMMM, PyMC-Marketing, etc.). "
        "That model gave you coefficients — numbers that describe how each channel's spend turns into results. "
        "This tool takes those numbers and lets you <b>see the curves</b> and <b>find the best budget split</b>."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # SECTION 1: THE BIG PICTURE — MMM Equation
    # ══════════════════════════════════════════════════════════

    st.markdown("### 1. The Big Picture — What an MMM Produces")
    st.markdown(
        "Your Marketing Mix Model estimates the following relationship:"
    )
    st.latex(r"\text{Sales}_t = \text{Base} + \sum_{i=1}^{n} f_i\!\left(\text{AdStocked Spend}_{i,t}\right) + \text{Controls} + \varepsilon_t")
    st.markdown(
        "Each channel *i* has its own response function *f_i* with parameters (β, γ, δ) "
        "that your model estimated. **This tool focuses on those** *f_i* **functions** — "
        "visualizing them and using them to optimize budget."
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # SECTION 2: THE 6 EQUATION TYPES — with formulas and charts
    # ══════════════════════════════════════════════════════════

    st.markdown("### 2. The 6 Response Equations — Formula + Shape + When to Use")
    st.markdown(
        "Below is every equation type the tool supports. For each one you'll see: "
        "the **formula**, a **sample curve**, a **numerical example**, and **which channels typically use it**."
    )
    st.markdown("")

    # Helper: generate a small demo chart for an equation
    def _guide_chart(x, y, title, color="#60a5fa", annotation=None):
        """Return a small matplotlib figure for the guide tab (dark theme)."""
        fig, ax = plt.subplots(figsize=(5, 2.8))
        fig.patch.set_facecolor("#0e1117")
        ax.set_facecolor("#1a1f2e")
        ax.plot(x / 1000, y, color=color, linewidth=2.2)
        ax.fill_between(x / 1000, y, alpha=0.12, color=color)
        ax.set_xlabel("Spend ($K)", fontsize=9, color="#c9d1d9")
        ax.set_ylabel("Response", fontsize=9, color="#c9d1d9")
        ax.set_title(title, fontsize=10, fontweight="bold", color="#e2e8f0")
        ax.tick_params(labelsize=8, colors="#8b949e")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["bottom"].set_color("#2d3548")
        ax.spines["left"].set_color("#2d3548")
        ax.grid(True, color="#2d3548", alpha=0.5)
        if annotation:
            ax.annotate(annotation["text"], xy=annotation["xy"],
                        xytext=annotation["xytext"], fontsize=7.5, color="#94a3b8",
                        arrowprops=dict(arrowstyle="->", color="#94a3b8", lw=0.8))
        fig.tight_layout()
        return fig

    x_demo = np.linspace(1, 200000, 300)

    # ── 2a. Hill / S-Curve ──
    st.markdown("#### 2a. Hill / S-Curve  *(Most common in MMM)*")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \frac{\beta \cdot \text{Spend}^{\gamma}}{\text{Spend}^{\gamma} + \delta^{\gamma}}")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 5,000 (max possible response)<br>"
            "• γ = 2.0 (steepness of the S-curve)<br>"
            "• δ = 50,000 (half-saturation: 50% of max reached at $50K)<br><br>"
            "<b>Example calculation at Spend = $80,000:</b><br>"
            "<code>f = 5000 × 80000² / (80000² + 50000²)</code><br>"
            "<code>f = 5000 × 6.4B / (6.4B + 2.5B)</code><br>"
            "<code>f = 5000 × 0.719 = <b>3,596</b></code><br><br>"
            "<b>Typical channels:</b> TV, Video, OOH, Radio — channels with "
            "a threshold effect (need minimum exposure to register)."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_hill = 5000 * x_demo**2 / (x_demo**2 + 50000**2)
        fig_h = _guide_chart(x_demo, y_hill, "Hill: β=5000, γ=2, δ=50K", "#60a5fa",
                             {"text": "δ=50K → half-max", "xy": (50, 2500), "xytext": (100, 1500)})
        st.pyplot(fig_h, use_container_width=True)
        plt.close(fig_h)

    st.markdown("")

    # ── 2b. Logarithmic ──
    st.markdown("#### 2b. Logarithmic")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \beta \cdot \ln(\gamma \cdot \text{Spend} + 1)")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 3,000 (scaling factor)<br>"
            "• γ = 0.00005 (controls how fast diminishing kicks in)<br><br>"
            "<b>Example at Spend = $80,000:</b><br>"
            "<code>f = 3000 × ln(0.00005 × 80000 + 1)</code><br>"
            "<code>f = 3000 × ln(5) = 3000 × 1.609</code><br>"
            "<code>f = <b>4,828</b></code><br><br>"
            "<b>Typical channels:</b> Paid Search, SEM — "
            "high-intent clicks come cheap, then CPC rises as you bid on broader terms."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_log = 3000 * np.log(0.00005 * x_demo + 1)
        fig_l = _guide_chart(x_demo, y_log, "Logarithmic: β=3000, γ=0.00005", "#34d399")
        st.pyplot(fig_l, use_container_width=True)
        plt.close(fig_l)

    st.markdown("")

    # ── 2c. Power ──
    st.markdown("#### 2c. Power")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \beta \cdot \text{Spend}^{\gamma}")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 0.5 (scaling factor)<br>"
            "• γ = 0.6 (exponent &lt; 1 → diminishing returns)<br><br>"
            "<b>Example at Spend = $80,000:</b><br>"
            "<code>f = 0.5 × 80000^0.6</code><br>"
            "<code>f = 0.5 × 874.7 = <b>437</b></code><br><br>"
            "<b>Key insight:</b> If γ &lt; 1 → diminishing returns. If γ = 1 → linear. If γ &gt; 1 → increasing returns.<br><br>"
            "<b>Typical channels:</b> Display, Programmatic — flexible curvature fits many patterns."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_pow = 0.5 * x_demo**0.6
        fig_p = _guide_chart(x_demo, y_pow, "Power: β=0.5, γ=0.6", "#f472b6")
        st.pyplot(fig_p, use_container_width=True)
        plt.close(fig_p)

    st.markdown("")

    # ── 2d. Exponential Saturation ──
    st.markdown("#### 2d. Exponential Saturation")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \beta \cdot \left(1 - e^{-\gamma \cdot \text{Spend}}\right)")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 4,000 (ceiling — max response as spend → ∞)<br>"
            "• γ = 0.00003 (rate of approach to ceiling)<br><br>"
            "<b>Example at Spend = $80,000:</b><br>"
            "<code>f = 4000 × (1 - e^(-0.00003 × 80000))</code><br>"
            "<code>f = 4000 × (1 - e^(-2.4))</code><br>"
            "<code>f = 4000 × 0.909 = <b>3,637</b></code><br><br>"
            "<b>Typical channels:</b> Email, Push Notifications — hard ceiling at list/audience size."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_exp = 4000 * (1 - np.exp(-0.00003 * x_demo))
        fig_e = _guide_chart(x_demo, y_exp, "Exponential: β=4000, γ=0.00003", "#fbbf24")
        st.pyplot(fig_e, use_container_width=True)
        plt.close(fig_e)

    st.markdown("")

    # ── 2e. Linear ──
    st.markdown("#### 2e. Linear *(Baseline / sanity check)*")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \beta \cdot \text{Spend}")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 0.05 (each dollar generates 0.05 units of response)<br><br>"
            "<b>Example at Spend = $80,000:</b><br>"
            "<code>f = 0.05 × 80000 = <b>4,000</b></code><br><br>"
            "<b>Note:</b> No diminishing returns — every dollar is equally effective. "
            "Rarely realistic, but useful as a baseline comparison. "
            "If your optimizer moves all budget here, your other curves may need re-checking."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_lin = 0.05 * x_demo
        fig_li = _guide_chart(x_demo, y_lin, "Linear: β=0.05", "#a78bfa")
        st.pyplot(fig_li, use_container_width=True)
        plt.close(fig_li)

    st.markdown("")

    # ── 2f. Quadratic ──
    st.markdown("#### 2f. Quadratic *(Over-spending penalty)*")
    eq_col1, eq_col2 = st.columns([1, 1])
    with eq_col1:
        st.latex(r"f(\text{Spend}) = \beta \cdot \text{Spend} - \gamma \cdot \text{Spend}^2")
        st.markdown(
            '<div class="info-box">'
            "<b>Parameters:</b><br>"
            "• β = 0.08 (initial return per dollar)<br>"
            "• γ = 0.0000004 (penalty rate for over-spending)<br><br>"
            "<b>Example at Spend = $80,000:</b><br>"
            "<code>f = 0.08 × 80000 - 0.0000004 × 80000²</code><br>"
            "<code>f = 6400 - 2560 = <b>3,840</b></code><br><br>"
            "<b>Peak spend</b> = β / (2γ) = 0.08 / 0.0000008 = <b>$100,000</b><br>"
            "Above $100K, response actually decreases (ad fatigue).<br><br>"
            "<b>Typical channels:</b> Social (ad fatigue), highly targeted channels with frequency capping."
            "</div>",
            unsafe_allow_html=True,
        )
    with eq_col2:
        y_quad = 0.08 * x_demo - 0.0000004 * x_demo**2
        y_quad_clipped = np.maximum(y_quad, 0)
        fig_q = _guide_chart(x_demo, y_quad_clipped, "Quadratic: β=0.08, γ=0.0000004", "#fb7185",
                             {"text": "Peak at $100K\nthen declines", "xy": (100, 4000), "xytext": (145, 2500)})
        st.pyplot(fig_q, use_container_width=True)
        plt.close(fig_q)

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # SECTION 3: ADSTOCK — How carryover works
    # ══════════════════════════════════════════════════════════

    st.markdown("### 3. Adstock — Modeling Carryover Effects")
    st.markdown(
        "Marketing doesn't stop working the moment you stop spending. "
        "A TV ad seen today still influences buying next week. Adstock models this."
    )
    st.latex(r"\text{AdStock}_t = \text{Spend}_t + \lambda \cdot \text{AdStock}_{t-1}")
    st.markdown(
        '<div class="info-box">'
        "<b>Geometric decay (λ):</b> Each week retains λ% of last week's effect.<br><br>"
        "<b>Example — TV with λ = 0.4, weekly spend = $50,000:</b><br>"
        "• Week 1: AdStock = $50,000<br>"
        "• Week 2: AdStock = $50,000 + 0.4 × $50,000 = $70,000<br>"
        "• Week 3: AdStock = $50,000 + 0.4 × $70,000 = $78,000<br>"
        "• Steady-state: AdStock → $50,000 / (1 - 0.4) = <b>$83,333</b><br><br>"
        "So the response function sees $83,333 of effective input even though you're only spending $50,000/week. "
        "That's the carryover premium.<br><br>"
        "<b>Typical values:</b><br>"
        "• TV / Video: λ = 0.3 – 0.7 (strong carryover, people remember ads)<br>"
        "• Social Media: λ = 0.1 – 0.3 (moderate, content fades from feed)<br>"
        "• Search / SEM: λ = 0.0 – 0.1 (almost instant, click-based)<br>"
        "• Email: λ = 0.0 – 0.1 (opens happen quickly)"
        "</div>",
        unsafe_allow_html=True,
    )

    # Small adstock decay chart
    adstock_col1, adstock_col2 = st.columns([1, 1])
    with adstock_col1:
        weeks = np.arange(0, 12)
        decay_04 = 0.4 ** weeks
        decay_07 = 0.7 ** weeks
        decay_02 = 0.2 ** weeks
        fig_ad, ax_ad = plt.subplots(figsize=(5, 2.8))
        fig_ad.patch.set_facecolor("#0e1117")
        ax_ad.set_facecolor("#1a1f2e")
        ax_ad.plot(weeks, decay_02 * 100, "o-", color="#34d399", markersize=4, linewidth=1.8, label="λ=0.2 (Search)")
        ax_ad.plot(weeks, decay_04 * 100, "s-", color="#60a5fa", markersize=4, linewidth=1.8, label="λ=0.4 (Social)")
        ax_ad.plot(weeks, decay_07 * 100, "^-", color="#f472b6", markersize=4, linewidth=1.8, label="λ=0.7 (TV)")
        ax_ad.set_xlabel("Weeks after ad", fontsize=9, color="#c9d1d9")
        ax_ad.set_ylabel("% of original effect remaining", fontsize=9, color="#c9d1d9")
        ax_ad.set_title("Adstock Decay Comparison", fontsize=10, fontweight="bold", color="#e2e8f0")
        ax_ad.legend(fontsize=8, frameon=False, labelcolor="#c9d1d9")
        ax_ad.spines["top"].set_visible(False)
        ax_ad.spines["right"].set_visible(False)
        ax_ad.spines["bottom"].set_color("#2d3548")
        ax_ad.spines["left"].set_color("#2d3548")
        ax_ad.tick_params(labelsize=8, colors="#8b949e")
        ax_ad.grid(True, color="#2d3548", alpha=0.5)
        fig_ad.tight_layout()
        st.pyplot(fig_ad, use_container_width=True)
        plt.close(fig_ad)
    with adstock_col2:
        st.markdown(
            '<div class="info-box">'
            "<b>Reading this chart:</b><br><br>"
            "• <b>λ=0.7 (TV)</b> — After 4 weeks, 24% of the original ad effect is still active. "
            "TV has long memory.<br>"
            "• <b>λ=0.4 (Social)</b> — Drops to 3% by week 4. Moderate carryover.<br>"
            "• <b>λ=0.2 (Search)</b> — Virtually zero after 2 weeks. Impact is near-instant."
            "</div>",
            unsafe_allow_html=True,
        )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # SECTION 4: GLOSSARY (reference — stays in theory section)
    # ══════════════════════════════════════════════════════════

    st.markdown("### 4. Quick Glossary")
    glossary = pd.DataFrame({
        "Term": [
            "Diminishing Returns",
            "Response Curve",
            "Marginal Response",
            "Adstock / Carryover",
            "Half-Saturation (δ)",
            "Saturation Point",
            "Steady-State",
            "Budget Optimization",
        ],
        "What It Means": [
            "Each additional dollar spent produces less incremental result than the previous dollar",
            "A graph showing total response (Y) at each spend level (X) for a channel",
            "The extra response from one more dollar — the slope (derivative) of the curve at any point",
            "The lingering effect of past advertising; a TV ad from last week still drives some sales this week",
            "The spend level where you've reached 50% of the channel's maximum possible response (Hill curves only)",
            "The spend level beyond which additional investment produces near-zero incremental returns",
            "When you spend the same amount every week, the adstocked input converges to Spend / (1 - λ)",
            "Finding the budget split across channels that maximizes total response for a fixed total spend",
        ],
    })
    st.dataframe(glossary, use_container_width=True, hide_index=True)

    st.markdown("")
    st.markdown("")

    # ══════════════════════════════════════════════════════════════════════════
    #
    #   ██████  ██████   █████   ██████ ████████ ██  ██████  █████  ██
    #   ██   ██ ██   ██ ██   ██ ██         ██    ██ ██      ██   ██ ██
    #   ██████  ██████  ███████ ██         ██    ██ ██      ███████ ██
    #   ██      ██   ██ ██   ██ ██         ██    ██ ██      ██   ██ ██
    #   ██      ██   ██ ██   ██  ██████    ██    ██  ██████ ██   ██ ███████
    #
    # ══════════════════════════════════════════════════════════════════════════

    st.markdown(
        '<div style="background: linear-gradient(90deg, #1e40af, #7c3aed); padding: 20px 28px; '
        'border-radius: 12px; margin: 20px 0 30px 0; text-align: center;">'
        '<span style="color: #ffffff; font-size: 1.5rem; font-weight: 700;">'
        'Practical Walkthrough — From MMM Output to Optimized Budget'
        '</span><br>'
        '<span style="color: #c7d2fe; font-size: 0.95rem;">'
        'Follow along with a real example using sample Robyn MMM output'
        '</span>'
        '</div>',
        unsafe_allow_html=True,
    )

    # ══════════════════════════════════════════════════════════
    # PRACTICAL STEP A: Your MMM Output
    # ══════════════════════════════════════════════════════════

    st.markdown("### A. Start Here — Your MMM Model Output")
    st.markdown(
        "Let's say you ran Robyn and it produced this model. The overall equation is:"
    )
    st.latex(
        r"\text{Sales}_t = 12{,}000 "
        r"+ f_{\text{TV}}(\text{Spend}_{\text{TV},t}) "
        r"+ f_{\text{Social}}(\text{Spend}_{\text{Social},t}) "
        r"+ f_{\text{Search}}(\text{Spend}_{\text{Search},t}) "
        r"+ \varepsilon_t"
    )
    st.markdown(
        "Where **12,000** is the base sales (what you'd sell with zero marketing), and each *f* is "
        "the channel's response function. Robyn's output report tells you the function type and "
        "fitted parameters for each:"
    )

    st.markdown("")
    mmm_output_df = pd.DataFrame({
        "Channel": ["TV", "Social Media", "Paid Search"],
        "Function": ["Hill", "Logarithmic", "Power"],
        "Beta (β)": ["5,000", "3,000", "0.5"],
        "Gamma (γ)": ["2.0", "0.00005", "0.6"],
        "Delta (δ)": ["50,000", "n/a", "n/a"],
        "Adstock decay (λ)": ["0.4", "0.2", "0.0"],
        "Avg Weekly Spend": ["$80,000", "$30,000", "$40,000"],
    })
    st.markdown("**Your Robyn model output (example):**")
    st.dataframe(mmm_output_df, use_container_width=True, hide_index=True)

    st.markdown(
        '<div class="info-box">'
        "<b>Where do these come from?</b><br>"
        "• <b>Robyn</b>: One-pager output → response curves section → fitted hyperparameters table<br>"
        "• <b>LightweightMMM</b>: Model posterior summary — check the fitted media coefficients and Hill parameters<br>"
        "• <b>PyMC-Marketing</b>: Posterior summary from the fitted model — channel coefficients and saturation parameters<br>"
        "• <b>Custom model</b>: Whatever coefficients your regression or Bayesian model estimated<br><br>"
        "<i>Refer to each tool's documentation for exact variable names, as these vary across versions.</i>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # PRACTICAL STEP B: Plug each channel equation
    # ══════════════════════════════════════════════════════════

    st.markdown("### B. The Equations for Each Channel")
    st.markdown(
        "Here's exactly what each channel's equation looks like with the numbers plugged in:"
    )

    st.markdown("")
    st.markdown("**TV — Hill function:**")
    st.latex(r"f_{\text{TV}}(\text{Spend}) = \frac{5000 \times \text{Spend}^{2.0}}{\text{Spend}^{2.0} + 50000^{2.0}}")
    st.markdown(
        '<div class="info-box">'
        "<b>At current spend ($80K/week with adstock λ=0.4):</b><br>"
        "1. Steady-state input = $80,000 / (1 − 0.4) = <b>$133,333</b><br>"
        "2. f = 5000 × 133,333² / (133,333² + 50,000²)<br>"
        "3. f = 5000 × 17.78B / (17.78B + 2.50B) = 5000 × 0.877<br>"
        "4. <b>Response = 4,384 sales units</b>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("")
    st.markdown("**Social Media — Logarithmic function:**")
    st.latex(r"f_{\text{Social}}(\text{Spend}) = 3000 \times \ln(0.00005 \times \text{Spend} + 1)")
    st.markdown(
        '<div class="info-box">'
        "<b>At current spend ($30K/week with adstock λ=0.2):</b><br>"
        "1. Steady-state input = $30,000 / (1 − 0.2) = <b>$37,500</b><br>"
        "2. f = 3000 × ln(0.00005 × 37,500 + 1) = 3000 × ln(2.875)<br>"
        "3. f = 3000 × 1.056<br>"
        "4. <b>Response = 3,168 sales units</b>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("")
    st.markdown("**Paid Search — Power function:**")
    st.latex(r"f_{\text{Search}}(\text{Spend}) = 0.5 \times \text{Spend}^{0.6}")
    st.markdown(
        '<div class="info-box">'
        "<b>At current spend ($40K/week, no adstock):</b><br>"
        "1. No adstock → input = $40,000 directly<br>"
        "2. f = 0.5 × 40,000^0.6 = 0.5 × 577.1<br>"
        "3. <b>Response = 289 sales units</b>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("")
    st.markdown(
        '<div class="warn-box">'
        "<b>Total current weekly response:</b><br>"
        "Base (12,000) + TV (4,384) + Social (3,168) + Search (289) = <b>19,841 sales units</b><br><br>"
        "The <b>incremental</b> response from marketing = 4,384 + 3,168 + 289 = <b>7,841 sales units</b> above base."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # PRACTICAL STEP C: Generate the curves (with actual charts)
    # ══════════════════════════════════════════════════════════

    st.markdown("### C. What the Curves Look Like")
    st.markdown(
        "When you plug these parameters into the **⚙️ Channel Config** tab and go to "
        "**📉 Response Curves**, here's what you'll see:"
    )

    # Generate the actual curves from the sample parameters
    _x_prac = np.linspace(1, 200000, 300)

    # TV Hill (with adstock steady-state)
    _x_tv_ss = _x_prac / (1 - 0.4)  # steady-state transform
    _y_tv = 5000 * _x_tv_ss**2 / (_x_tv_ss**2 + 50000**2)

    # Social Log (with adstock steady-state)
    _x_soc_ss = _x_prac / (1 - 0.2)
    _y_soc = 3000 * np.log(0.00005 * _x_soc_ss + 1)

    # Search Power (no adstock)
    _y_srch = 0.5 * _x_prac**0.6

    # Overlay chart
    fig_prac_overlay, ax_po = plt.subplots(figsize=(9, 4.5))
    fig_prac_overlay.patch.set_facecolor("#0e1117")
    ax_po.set_facecolor("#1a1f2e")
    ax_po.plot(_x_prac / 1000, _y_tv, color="#60a5fa", linewidth=2.3, label="TV (Hill)")
    ax_po.plot(_x_prac / 1000, _y_soc, color="#34d399", linewidth=2.3, label="Social (Log)")
    ax_po.plot(_x_prac / 1000, _y_srch, color="#f472b6", linewidth=2.3, label="Search (Power)")
    ax_po.axvline(80, color="#60a5fa", linestyle="--", alpha=0.5, linewidth=1)
    ax_po.axvline(30, color="#34d399", linestyle="--", alpha=0.5, linewidth=1)
    ax_po.axvline(40, color="#f472b6", linestyle="--", alpha=0.5, linewidth=1)
    ax_po.annotate("TV current\n$80K", xy=(80, 4384), fontsize=7.5, color="#60a5fa",
                   ha="center", va="bottom")
    ax_po.annotate("Social\n$30K", xy=(30, 3168), fontsize=7.5, color="#34d399",
                   ha="center", va="bottom")
    ax_po.annotate("Search\n$40K", xy=(40, 289), fontsize=7.5, color="#f472b6",
                   ha="left", va="bottom")
    ax_po.set_xlabel("Weekly Spend ($K)", fontsize=10, color="#c9d1d9")
    ax_po.set_ylabel("Response (Sales Units)", fontsize=10, color="#c9d1d9")
    ax_po.set_title("Response Curves — All Channels (Sample Parameters)", fontsize=11, fontweight="bold", color="#e2e8f0")
    ax_po.legend(fontsize=9, frameon=False, labelcolor="#c9d1d9")
    ax_po.spines["top"].set_visible(False)
    ax_po.spines["right"].set_visible(False)
    ax_po.spines["bottom"].set_color("#2d3548")
    ax_po.spines["left"].set_color("#2d3548")
    ax_po.tick_params(labelsize=9, colors="#8b949e")
    ax_po.grid(True, color="#2d3548", alpha=0.5)
    fig_prac_overlay.tight_layout()
    st.pyplot(fig_prac_overlay, use_container_width=True)
    plt.close(fig_prac_overlay)

    st.markdown(
        '<div class="info-box">'
        "<b>Reading this chart:</b><br>"
        "• <b>TV (blue)</b> — Classic S-curve. Steep gains up to ~$60K, then flattens. "
        "At $80K you're already at 88% of max. More TV spend gives diminishing returns.<br>"
        "• <b>Social (green)</b> — Log curve still climbing. At $30K you're not near saturation. "
        "There's room to grow here.<br>"
        "• <b>Search (pink)</b> — Power curve. Lower absolute scale but consistent growth. "
        "Dashed lines show current spend levels."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("")

    # Marginal curves
    st.markdown("**Marginal response curves** — this is where the optimization insight lives:")

    # Compute marginals
    _m_tv = (5000 * 2.0 * _x_tv_ss**(2.0 - 1) * 50000**2.0) / (_x_tv_ss**2.0 + 50000**2.0)**2
    _m_tv *= 1 / (1 - 0.4)  # chain rule for adstock
    _m_soc = 3000 * 0.00005 / (0.00005 * _x_soc_ss + 1)
    _m_soc *= 1 / (1 - 0.2)  # chain rule
    _m_srch = 0.5 * 0.6 * np.maximum(_x_prac, 1)**(0.6 - 1)

    fig_prac_marg, ax_pm = plt.subplots(figsize=(9, 4))
    fig_prac_marg.patch.set_facecolor("#0e1117")
    ax_pm.set_facecolor("#1a1f2e")
    ax_pm.plot(_x_prac / 1000, _m_tv, color="#60a5fa", linewidth=2.3, label="TV marginal")
    ax_pm.plot(_x_prac / 1000, _m_soc, color="#34d399", linewidth=2.3, label="Social marginal")
    ax_pm.plot(_x_prac / 1000, _m_srch, color="#f472b6", linewidth=2.3, label="Search marginal")
    ax_pm.axvline(80, color="#60a5fa", linestyle="--", alpha=0.4, linewidth=1)
    ax_pm.axvline(30, color="#34d399", linestyle="--", alpha=0.4, linewidth=1)
    ax_pm.axvline(40, color="#f472b6", linestyle="--", alpha=0.4, linewidth=1)
    ax_pm.set_xlabel("Weekly Spend ($K)", fontsize=10, color="#c9d1d9")
    ax_pm.set_ylabel("Marginal Response (per extra $)", fontsize=10, color="#c9d1d9")
    ax_pm.set_title("Marginal Curves — Where Should the Next Dollar Go?", fontsize=11, fontweight="bold", color="#e2e8f0")
    ax_pm.legend(fontsize=9, frameon=False, labelcolor="#c9d1d9")
    ax_pm.set_ylim(0, min(0.3, max(_m_tv.max(), _m_soc.max(), _m_srch.max()) * 1.1))
    ax_pm.spines["top"].set_visible(False)
    ax_pm.spines["right"].set_visible(False)
    ax_pm.spines["bottom"].set_color("#2d3548")
    ax_pm.spines["left"].set_color("#2d3548")
    ax_pm.tick_params(labelsize=9, colors="#8b949e")
    ax_pm.grid(True, color="#2d3548", alpha=0.5)
    fig_prac_marg.tight_layout()
    st.pyplot(fig_prac_marg, use_container_width=True)
    plt.close(fig_prac_marg)

    st.markdown(
        '<div class="warn-box">'
        "<b>The key insight:</b> At current spend levels, look at where each channel's marginal "
        "curve is at its dashed line. If Social's marginal at $30K is much higher than TV's marginal "
        "at $80K — you should shift budget from TV to Social. That's exactly what the optimizer does."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # PRACTICAL STEP D: Optimization result
    # ══════════════════════════════════════════════════════════

    st.markdown("### D. Optimize — What the Tool Tells You")
    st.markdown(
        "You go to the **🎯 Budget Optimization** tab, enter total budget = **$150,000/week**, "
        "and click Optimize. The tool runs the algorithm and produces:"
    )

    result_df = pd.DataFrame({
        "Channel": ["TV", "Social Media", "Paid Search"],
        "Current Spend": ["$80,000", "$30,000", "$40,000"],
        "Optimized Spend": ["$55,000", "$52,000", "$43,000"],
        "Change": ["-$25,000", "+$22,000", "+$3,000"],
    })
    st.dataframe(result_df, use_container_width=True, hide_index=True)

    # Budget allocation bar chart
    fig_prac_alloc, (ax_b1, ax_b2) = plt.subplots(1, 2, figsize=(9, 3.5))
    fig_prac_alloc.patch.set_facecolor("#0e1117")
    channels_ex = ["TV", "Social", "Search"]
    current_ex = [80000, 30000, 40000]
    optimized_ex = [55000, 52000, 43000]
    colors_ex = ["#60a5fa", "#34d399", "#f472b6"]
    for ax_b in [ax_b1, ax_b2]:
        ax_b.set_facecolor("#1a1f2e")
        ax_b.spines["top"].set_visible(False)
        ax_b.spines["right"].set_visible(False)
        ax_b.spines["bottom"].set_color("#2d3548")
        ax_b.spines["left"].set_color("#2d3548")
        ax_b.tick_params(labelsize=9, colors="#8b949e")
    bars1 = ax_b1.barh(channels_ex, current_ex, color=colors_ex, height=0.5)
    ax_b1.set_xlabel("Weekly Spend ($)", fontsize=9, color="#c9d1d9")
    ax_b1.set_title("Current Allocation", fontsize=10, fontweight="bold", color="#e2e8f0")
    for bar, val in zip(bars1, current_ex):
        ax_b1.text(bar.get_width() + 1000, bar.get_y() + bar.get_height()/2,
                   f"${val/1000:.0f}K", va="center", fontsize=8.5, color="#c9d1d9")
    bars2 = ax_b2.barh(channels_ex, optimized_ex, color=colors_ex, height=0.5)
    ax_b2.set_xlabel("Weekly Spend ($)", fontsize=9, color="#c9d1d9")
    ax_b2.set_title("Optimized Allocation", fontsize=10, fontweight="bold", color="#e2e8f0")
    for bar, val in zip(bars2, optimized_ex):
        ax_b2.text(bar.get_width() + 1000, bar.get_y() + bar.get_height()/2,
                   f"${val/1000:.0f}K", va="center", fontsize=8.5, color="#c9d1d9")
    ax_b1.set_xlim(0, 100000)
    ax_b2.set_xlim(0, 100000)
    fig_prac_alloc.tight_layout()
    st.pyplot(fig_prac_alloc, use_container_width=True)
    plt.close(fig_prac_alloc)

    st.markdown("**Why these changes?**")
    st.markdown(
        '<div class="info-box">'
        "<b>TV: $80K → $55K (−$25K)</b><br>"
        "At $80K, TV is past the steep part of the Hill curve — each extra dollar returns very little. "
        "Pulling back to $55K barely reduces TV response (you only lose ~400 units out of 4,384) "
        "because the curve is nearly flat in that range.<br><br>"
        "<b>Social: $30K → $52K (+$22K)</b><br>"
        "Social's log curve still has strong marginal returns at $30K. The freed-up TV budget goes here, "
        "where each dollar still generates meaningful incremental response.<br><br>"
        "<b>Search: $40K → $43K (+$3K)</b><br>"
        "Search was already near its optimal level. Small additional budget fills the gap."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown(
        '<div class="warn-box">'
        "<b>Net effect:</b> Same total budget ($150K), but the optimizer estimates roughly "
        "<b>+8-12% more total response</b> by shifting money from a saturated channel (TV) "
        "to a still-growing one (Social). The exact lift depends on your specific parameters."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("---")

    # ══════════════════════════════════════════════════════════
    # PRACTICAL STEP E: How to enter these into the tool
    # ══════════════════════════════════════════════════════════

    st.markdown("### E. How to Enter This Into the Tool — Step by Step")
    st.markdown("")

    st.markdown("**Step 1:** Load your spend data from the sidebar (or click *Sample Data*)")
    st.markdown(
        '<div class="info-box">'
        "<b>Data format needed:</b><br><br>"
        "<code>date, sales, spend_TV, spend_Social, spend_Search</code><br>"
        "<code>2024-01-01, 52000, 25000, 8000, 12000</code><br>"
        "<code>2024-01-08, 55000, 30000, 10000, 11000</code><br>"
        "<code>...</code><br><br>"
        "Columns must start with <code>spend_</code> followed by channel name. "
        "The tool auto-detects all <code>spend_*</code> columns."
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown("")
    st.markdown("**Step 2:** Go to **⚙️ Channel Config** tab and for each channel set:")
    config_steps = pd.DataFrame({
        "Setting": [
            "Equation Type",
            "Beta (β)",
            "Gamma (γ)",
            "Delta (δ)",
            "Adstock Type",
            "Adstock Decay (λ)",
            "Lag",
        ],
        "What to enter": [
            "Select from dropdown: Hill, Logarithmic, Power, Exponential, Linear, or Quadratic",
            "The scale parameter from your MMM output",
            "The shape parameter from your MMM output",
            "Half-saturation point (Hill only — leave default for others)",
            "Geometric (most common) or None",
            "The decay rate from your MMM (0 to 1)",
            "Number of periods the effect is delayed (usually 0)",
        ],
        "TV Example": [
            "Hill",
            "5000",
            "2.0",
            "50000",
            "Geometric",
            "0.4",
            "0",
        ],
    })
    st.dataframe(config_steps, use_container_width=True, hide_index=True)

    st.markdown("")
    st.markdown("**Step 3:** Switch to **📉 Response Curves** tab — see your curves plotted (like the charts above)")

    st.markdown("")
    st.markdown("**Step 4:** Go to **🎯 Budget Optimization** tab:")
    st.markdown(
        "- Enter your **total weekly budget** (e.g., $150,000)\n"
        "- Optionally set **min/max spend** per channel (e.g., TV must have at least $20K)\n"
        "- Pick an **algorithm** (L-BFGS-B is recommended for most cases)\n"
        "- Click **Optimize** and review the results"
    )

    st.markdown("")
    st.markdown("**Step 5:** Export from the **💾 Export** tab — download curves, optimization results, or save config as JSON")

    st.markdown("")
    st.markdown("")
    st.markdown(
        '<div style="background: linear-gradient(90deg, #1e40af, #7c3aed); padding: 16px 24px; '
        'border-radius: 10px; text-align: center;">'
        '<span style="color: #ffffff; font-size: 1.1rem; font-weight: 600;">'
        'Ready? Load your data from the sidebar, then head to ⚙️ Channel Config to enter your parameters.'
        '</span>'
        '</div>',
        unsafe_allow_html=True,
    )


# ═══════════════════════════════════════════════════════════════
# TAB 1: CHANNEL CONFIGURATION
# ═══════════════════════════════════════════════════════════════

with tab1:
    st.markdown("## Step 2: Enter Your MMM Parameters")

    st.markdown(
        '<div class="info-box">'
        "<b>What goes here?</b> These are the parameters from your existing MMM model. "
        "For each channel, enter:<br><br>"
        "<b>Response Function</b> — the mathematical shape of diminishing returns "
        "(e.g., Hill for S-shaped TV response, Logarithmic for gradual social taper).<br>"
        "<b>Parameters (β, γ, δ)</b> — the specific values from your model output.<br>"
        "<b>Adstock</b> — the carryover decay rate (how long the effect of a dollar lasts).<br>"
        "<b>Lag</b> — delay before the effect kicks in (e.g., TV might take 1-2 weeks).<br><br>"
        "If you don't know exact values, the defaults are reasonable starting points. "
        "You can adjust and see the curve change in real time in the preview."
        "</div>",
        unsafe_allow_html=True,
    )

    # Equation type descriptions for the help panel
    EQUATION_DESCRIPTIONS = {
        "Linear": "**f = β × Spend** — No diminishing returns. Every dollar has the same impact. "
                  "Rarely realistic, but useful as a baseline comparison.",
        "Logarithmic": "**f = β × log(γ × Spend + 1)** — Gradual, concave taper. "
                       "Response grows quickly at low spend, then slows down. "
                       "Common for always-on channels like Social or Display.",
        "Power": "**f = β × Spend^γ** — When γ < 1, gives diminishing returns. "
                 "Simple and flexible. The exponent γ directly controls how fast returns diminish.",
        "Exponential": "**f = β × (1 − e^(−γ × Spend))** — Asymptotic saturation. "
                       "Response approaches a ceiling (β) and never exceeds it. "
                       "Good for channels with a clear maximum reach.",
        "Hill": "**f = (β × Spend^γ) / (Spend^γ + δ^γ)** — S-shaped curve. "
                "Low spend has minimal effect, then ramps up, then saturates. "
                "The most flexible option. δ is the half-saturation point (where you get 50% of max). "
                "Popular for TV and high-spend channels.",
        "Quadratic": "**f = β × Spend − γ × Spend²** — Peaks then turns negative. "
                     "Models channels where overspending actually hurts (ad fatigue). "
                     "Use with caution — the decline after the peak is a strong assumption.",
    }

    channel_configs = []

    for ch_idx, ch in enumerate(channels):
        with st.expander(f"🔧 {ch}", expanded=(ch_idx == 0)):
            col1, col2, col3 = st.columns([1.3, 1, 1])

            with col1:
                st.markdown("**Response Function**")
                func_type = st.selectbox(
                    "Equation type",
                    ResponseFunction.TYPES,
                    index=4,
                    key=f"func_{ch}",
                    help="Choose the curve shape that your MMM uses for this channel.",
                )

                # Show description of the selected equation
                st.caption(EQUATION_DESCRIPTIONS.get(func_type, ""))

                defaults = ResponseFunction.default_params(func_type)
                bounds = ResponseFunction.param_bounds(func_type)

                func_params = {}

                # Beta
                beta_help = {
                    "Linear": "Each dollar of spend generates β dollars of response.",
                    "Logarithmic": "Scales the overall height of the curve. Bigger β = more total response.",
                    "Power": "Scales the response. Combined with γ, determines total output.",
                    "Exponential": "The maximum possible response (ceiling). The curve approaches but never exceeds this.",
                    "Hill": "The maximum possible response (ceiling) at infinite spend.",
                    "Quadratic": "The linear coefficient. Combined with γ, determines where the peak is.",
                }
                func_params["beta"] = st.number_input(
                    "β (scale / max response)",
                    value=defaults["beta"],
                    min_value=bounds["beta"][0],
                    max_value=bounds["beta"][1] * 10,
                    step=defaults["beta"] * 0.1,
                    key=f"beta_{ch}",
                    help=beta_help.get(func_type, "Controls the magnitude of the response."),
                )

                # Gamma
                if "gamma" in defaults:
                    gamma_help = {
                        "Logarithmic": "Controls how quickly returns diminish. Smaller γ = faster taper.",
                        "Power": "The exponent. γ < 1 gives diminishing returns. γ = 0.5 means square-root shape. γ = 1 is linear.",
                        "Exponential": "Controls how fast the curve approaches the ceiling. Larger γ = faster saturation.",
                        "Hill": "Steepness of the S-curve. γ = 1 is gentle, γ = 3+ is very steep (sharp threshold).",
                        "Quadratic": "The quadratic coefficient. Determines where the peak is: peak spend = β / (2γ).",
                    }
                    func_params["gamma"] = st.number_input(
                        "γ (shape / rate)",
                        value=defaults["gamma"],
                        min_value=bounds["gamma"][0],
                        max_value=bounds["gamma"][1] * 10,
                        format="%.6f",
                        step=defaults["gamma"] * 0.1,
                        key=f"gamma_{ch}",
                        help=gamma_help.get(func_type, "Controls the curvature."),
                    )

                # Delta (Hill only)
                if "delta" in defaults:
                    func_params["delta"] = st.number_input(
                        "δ (half-max spend / EC50)",
                        value=defaults["delta"],
                        min_value=bounds["delta"][0],
                        max_value=bounds["delta"][1] * 10,
                        step=defaults["delta"] * 0.1,
                        key=f"delta_{ch}",
                        help=(
                            "The spend level at which you achieve 50% of your max response. "
                            "This is the 'inflection point' of the S-curve. "
                            "For example, if δ = 40,000 and β = 8,000, then spending $40K/week gives you ~4,000 response."
                        ),
                    )

            with col2:
                st.markdown("**Adstock (Carryover)**")
                st.caption(
                    "Marketing impact doesn't vanish instantly. "
                    "A TV ad seen today still influences purchases next week. "
                    "Adstock models this lingering effect."
                )

                adstock_type = st.selectbox(
                    "Adstock type",
                    ["none", "geometric", "weibull"],
                    index=1,
                    key=f"adstock_{ch}",
                    help=(
                        "**None**: Effect is only in the week of spend.\n\n"
                        "**Geometric**: Simple exponential decay. Each week, the remaining "
                        "effect is multiplied by λ. Most common choice.\n\n"
                        "**Weibull**: Flexible decay shape. Can model effects that peak "
                        "after a delay (e.g., awareness campaigns)."
                    ),
                )

                adstock_params = {}
                if adstock_type == "geometric":
                    adstock_params["decay"] = st.slider(
                        "Decay rate (λ)",
                        0.0, 0.95, 0.5, 0.05,
                        key=f"decay_{ch}",
                        help=(
                            "How much of the effect carries over each period.\n\n"
                            "**λ = 0**: No carryover (effect is instant and gone).\n"
                            "**λ = 0.5**: Half the effect carries to next week.\n"
                            "**λ = 0.8**: Strong carryover (TV/Brand campaigns).\n\n"
                            "**Typical ranges:**\n"
                            "- TV: 0.6 – 0.8 (long-lasting brand effect)\n"
                            "- Social: 0.2 – 0.4 (shorter memory)\n"
                            "- Search: 0.0 – 0.2 (mostly immediate)\n"
                            "- Email: 0.1 – 0.3\n"
                            "- Display: 0.3 – 0.6"
                        ),
                    )
                elif adstock_type == "weibull":
                    adstock_params["shape"] = st.slider(
                        "Shape (k)", 0.1, 5.0, 1.0, 0.1, key=f"wb_shape_{ch}",
                        help="k < 1: front-loaded decay. k > 1: delayed peak (effect builds then fades).",
                    )
                    adstock_params["scale"] = st.slider(
                        "Scale (λ)", 0.5, 10.0, 2.0, 0.5, key=f"wb_scale_{ch}",
                        help="Controls the width of the decay. Larger = longer carryover.",
                    )

            with col3:
                st.markdown("**Lag (Delay)**")
                st.caption(
                    "Some channels take time before the effect shows up. "
                    "A lag of 2 means spend in week 1 affects sales in week 3."
                )
                lag = st.slider(
                    "Lag periods (k)", 0, 12, 0, 1,
                    key=f"lag_{ch}",
                    help=(
                        "Number of periods before the effect starts.\n\n"
                        "**0**: Immediate effect (Search, Email).\n"
                        "**1-2**: Short delay (Social, Display).\n"
                        "**2-4**: Medium delay (TV, Print).\n"
                        "**4+**: Long delay (Brand campaigns, PR)."
                    ),
                )

                # Live preview
                st.markdown("**Live Preview**")
                col_name = f"spend_{ch}"
                if col_name in df.columns:
                    max_spend = df[col_name].max()
                    preview_range = np.linspace(0, max_spend * 1.2, 100)
                    preview_resp = ResponseFunction.evaluate(func_type, preview_range, func_params)

                    fig_prev, ax_prev = plt.subplots(figsize=(3, 2.2))
                    ax_prev.plot(preview_range, preview_resp, color="#2563EB", linewidth=2)
                    ax_prev.fill_between(preview_range, 0, preview_resp, alpha=0.08, color="#2563EB")
                    ax_prev.set_xticks([])
                    ax_prev.set_yticks([])
                    ax_prev.set_xlabel("Spend →", fontsize=7, color="#64748b")
                    ax_prev.set_ylabel("Response →", fontsize=7, color="#64748b")
                    ax_prev.set_title(f"{func_type}", fontsize=8, color="#2563EB", fontweight="bold")
                    fig_prev.tight_layout()
                    st.pyplot(fig_prev, use_container_width=True)
                    plt.close(fig_prev)

                    avg_spend = df[col_name].mean()
                    st.caption(f"Avg weekly spend: **${avg_spend:,.0f}**")

            config = ChannelConfig(
                name=ch, func_type=func_type, func_params=func_params,
                adstock_type=adstock_type, adstock_params=adstock_params, lag=lag,
            )
            channel_configs.append(config)

    st.session_state.channel_configs = channel_configs

    st.markdown("---")
    st.markdown(
        '<div class="info-box">'
        "Parameters are saved automatically as you change them. "
        "Switch to the <b>Response Curves</b> tab to see your curves, "
        "or <b>Budget Optimization</b> to find the best allocation."
        "</div>",
        unsafe_allow_html=True,
    )


# ═══════════════════════════════════════════════════════════════
# TAB 2: RESPONSE CURVES
# ═══════════════════════════════════════════════════════════════

with tab2:
    st.markdown("## Diminishing Returns Curves")
    st.markdown(
        '<div class="info-box">'
        "<b>What am I looking at?</b> These charts show how each marketing channel's "
        "response (incremental sales) changes as you increase spend. "
        "The flattening of each curve is the 'diminishing returns' — "
        "each additional dollar produces less incremental response than the last."
        "</div>",
        unsafe_allow_html=True,
    )

    if not st.session_state.channel_configs:
        st.warning("Go to the ⚙️ Channel Config tab first to set up your channels.")
        st.stop()

    curve_mode = st.radio(
        "View mode:",
        ["Individual Channels", "Overlay (All Channels)", "Marginal Curves", "Data Table"],
        horizontal=True,
        help=(
            "**Individual**: Deep-dive into one channel at a time.\n"
            "**Overlay**: Compare all channels on the same chart.\n"
            "**Marginal**: See the rate of return at every spend level (dy/dx).\n"
            "**Data Table**: Browse exact numbers."
        ),
    )

    # Generate all curves
    all_curves = {}
    all_marginals = {}

    for config in st.session_state.channel_configs:
        col_name = f"spend_{config.name}"
        if col_name not in df.columns:
            continue

        max_spend = df[col_name].max() * spend_multiplier
        spend_range = np.linspace(0, max_spend, curve_resolution)

        s, r, m = generate_response_curve(
            spend_range, config.func_type, config.func_params,
            config.adstock_type, config.adstock_params, config.lag,
        )
        all_curves[config.name] = (s, r)
        all_marginals[config.name] = (s, m)

    if curve_mode == "Individual Channels":
        selected_ch = st.selectbox("Select channel:", channels)

        if selected_ch in all_curves:
            s, r = all_curves[selected_ch]
            _, m = all_marginals[selected_ch]

            col_name = f"spend_{selected_ch}"
            current_avg = df[col_name].mean() if col_name in df.columns else None

            optimal = None
            if st.session_state.optimization_result is not None:
                opt = st.session_state.optimization_result
                if selected_ch in opt.channel_allocations:
                    optimal = opt.channel_allocations[selected_ch]

            fig = plot_response_curve(
                s, r, selected_ch, marginal=m,
                current_spend=current_avg, optimal_spend=optimal,
                show_marginal=True,
            )
            st.pyplot(fig, use_container_width=True)
            plt.close(fig)

            # Key metrics
            mc1, mc2, mc3, mc4 = st.columns(4)
            mc1.metric("Max Response", f"{r.max():,.0f}",
                       help="The highest response achievable within the spend range shown.")
            if len(m) > 1 and m[1] > 0:
                sat_idx = np.where(m < m[1] * 0.1)[0]
                sat_spend = s[sat_idx[0]] if len(sat_idx) > 0 else s[-1]
                mc2.metric("Saturation Point", f"${sat_spend:,.0f}",
                           help="Spend level where marginal returns drop below 10% of their initial value. Beyond this, additional spend has minimal impact.")
            mc3.metric("Current Avg Spend", f"${current_avg:,.0f}" if current_avg else "N/A",
                       help="Your historical average weekly spend in this channel.")
            mc4.metric("Initial Marginal", f"{m[1]:.4f}" if len(m) > 1 else "N/A",
                       help="The marginal return at the lowest spend level — essentially your best possible ROI on the first dollar.")

    elif curve_mode == "Overlay (All Channels)":
        normalize = st.checkbox(
            "Normalize curves (0-1 scale)",
            help="When channels have very different response magnitudes, normalizing lets you compare their *shapes* (how fast they saturate) rather than absolute values.",
        )
        fig = plot_overlay_curves(all_curves, normalize=normalize)
        st.pyplot(fig, use_container_width=True)
        plt.close(fig)

    elif curve_mode == "Marginal Curves":
        st.markdown(
            '<div class="info-box">'
            "<b>Marginal Response = dResponse / dSpend.</b> "
            "This tells you how much additional response you get per additional dollar. "
            "Where the marginal curve = 1, you're breaking even (1 dollar in = 1 dollar out). "
            "The optimal budget allocation equalizes marginal returns across all channels."
            "</div>",
            unsafe_allow_html=True,
        )
        fig = plot_marginal_overlay(all_marginals)
        st.pyplot(fig, use_container_width=True)
        plt.close(fig)

    elif curve_mode == "Data Table":
        selected_ch_table = st.selectbox("Channel for table:", channels, key="table_ch")
        if selected_ch_table in all_curves:
            s, r = all_curves[selected_ch_table]
            _, m = all_marginals[selected_ch_table]
            table = generate_response_table(s, r, m, selected_ch_table, n_rows=25)
            st.dataframe(table, use_container_width=True, hide_index=True, height=600)


# ═══════════════════════════════════════════════════════════════
# TAB 3: BUDGET OPTIMIZATION
# ═══════════════════════════════════════════════════════════════

with tab3:
    st.markdown("## Budget Optimization")
    st.markdown(
        '<div class="info-box">'
        "<b>How it works:</b> Given a total marketing budget, the optimizer "
        "finds the best way to split it across your channels. It works by "
        "equalizing the <b>marginal return</b> across all channels — if one channel "
        "has a higher marginal return than another, it shifts budget toward it "
        "until the marginals equalize. This is the mathematically optimal allocation "
        "under the diminishing returns curves you've configured."
        "</div>",
        unsafe_allow_html=True,
    )

    if not st.session_state.channel_configs:
        st.warning("Configure channels first.")
        st.stop()

    col_budget, col_opt = st.columns([1, 1])

    with col_budget:
        current_total = sum(
            df[f"spend_{ch}"].mean() for ch in channels if f"spend_{ch}" in df.columns
        )

        total_budget = st.number_input(
            "Total Budget ($)",
            value=float(round(current_total)),
            min_value=1000.0,
            step=10000.0,
            format="%.0f",
            help=(
                "Enter the total budget you want to distribute across all channels. "
                f"Your current average total weekly spend is **${current_total:,.0f}**. "
                "Try different budgets to see how the optimal allocation changes."
            ),
        )

        st.markdown("**Channel Constraints** *(optional)*")
        st.caption(
            "Set minimum or maximum spend per channel. "
            "For example, you might have a minimum contractual commitment for TV, "
            "or a maximum capacity for Email."
        )

        min_spends = {}
        max_spends = {}
        for ch in channels:
            c1, c2 = st.columns(2)
            with c1:
                min_spends[ch] = st.number_input(
                    f"Min {ch}", value=0.0, step=1000.0, format="%.0f", key=f"min_{ch}",
                )
            with c2:
                max_spends[ch] = st.number_input(
                    f"Max {ch}", value=float(total_budget), step=1000.0,
                    format="%.0f", key=f"max_{ch}",
                )

    with col_opt:
        opt_algo = st.selectbox(
            "Optimization Algorithm",
            BudgetOptimizer.ALGORITHMS,
            index=0,
            help=(
                "**L-BFGS-B (Gradient)**: Fastest. Uses calculus to find the optimum. "
                "Best for smooth curves (Hill, Exponential, Logarithmic).\n\n"
                "**Differential Evolution**: Slower but thorough. Tests many random "
                "combinations and evolves toward the best. Good if you're not sure "
                "the gradient method found the global optimum.\n\n"
                "**Linear Programming**: Approximates your curves as straight-line "
                "segments and solves exactly. Very fast, slightly less precise.\n\n"
                "**Genetic Algorithm**: Mimics natural selection. Good for complex "
                "constraint scenarios.\n\n"
                "**Grid Search**: Tries every combination on a grid. Slowest but "
                "guaranteed to find the best answer. Only practical for 2-3 channels."
            ),
        )

        st.markdown("")
        st.markdown("")
        if st.button("🎯 Optimize Budget", type="primary", use_container_width=True):
            with st.spinner(f"Optimizing with {opt_algo}..."):
                try:
                    optimizer = BudgetOptimizer(
                        st.session_state.channel_configs,
                        min_spends=min_spends,
                        max_spends=max_spends,
                    )
                    opt_result = optimizer.optimize(opt_algo, total_budget)
                    st.session_state.optimization_result = opt_result
                    st.success("Optimization complete!")
                except Exception as e:
                    st.error(f"Optimization error: {e}")
                    import traceback
                    st.code(traceback.format_exc())

        if st.session_state.optimization_result is not None:
            st.markdown("")
            st.markdown(
                '<div class="warn-box">'
                "<b>Interpreting results:</b> The optimizer finds the mathematically "
                "optimal split based purely on the curves. In practice, consider "
                "factors the model doesn't capture — creative quality, competitive "
                "dynamics, brand-building value, seasonal timing, etc."
                "</div>",
                unsafe_allow_html=True,
            )

    # Display results
    if st.session_state.optimization_result is not None:
        opt = st.session_state.optimization_result
        st.markdown("---")

        current_alloc = {
            ch: df[f"spend_{ch}"].mean() for ch in channels if f"spend_{ch}" in df.columns
        }
        optimizer = BudgetOptimizer(st.session_state.channel_configs)
        current_responses = {}
        for config in st.session_state.channel_configs:
            if config.name in current_alloc:
                current_responses[config.name] = optimizer._channel_response(current_alloc[config.name], config)

        current_total_resp = sum(current_responses.values())
        optimized_total_resp = opt.total_response
        lift = ((optimized_total_resp - current_total_resp) / max(current_total_resp, 1)) * 100

        st.markdown("### Results Summary")
        r1, r2, r3 = st.columns(3)
        r1.metric("Current Total Response", f"{current_total_resp:,.0f}",
                   help="Sum of predicted responses across all channels at your current average spend levels.")
        r2.metric("Optimized Total Response", f"{optimized_total_resp:,.0f}",
                   help="Sum of predicted responses using the optimized allocation.")
        r3.metric("Potential Lift", f"{lift:+.1f}%",
                   help="How much more total response the optimized allocation produces compared to your current split.")

        # Comparison table
        st.markdown("### Channel-by-Channel Comparison")
        comparison_data = []
        for ch in channels:
            current = current_alloc.get(ch, 0)
            optimized = opt.channel_allocations.get(ch, 0)
            change = optimized - current
            pct_change = (change / max(current, 1)) * 100
            curr_resp = current_responses.get(ch, 0)
            opt_resp = opt.channel_responses.get(ch, 0)
            comparison_data.append({
                "Channel": ch,
                "Current Spend": f"${current:,.0f}",
                "Optimized Spend": f"${optimized:,.0f}",
                "Change": f"${change:+,.0f}",
                "% Change": f"{pct_change:+.1f}%",
                "Current Response": f"{curr_resp:,.0f}",
                "Optimized Response": f"{opt_resp:,.0f}",
                "Marginal ROI": f"{opt.channel_marginal_roi.get(ch, 0):.4f}",
            })
        st.dataframe(pd.DataFrame(comparison_data), use_container_width=True, hide_index=True)

        st.caption(
            "**Marginal ROI** = the return on the *next* dollar in each channel at the optimized spend level. "
            "When the optimizer works perfectly, these values are equalized across channels — "
            "meaning no reallocation can improve total response."
        )

        # Charts
        fig_alloc = plot_budget_allocation(current_alloc, opt.channel_allocations)
        st.pyplot(fig_alloc, use_container_width=True)
        plt.close(fig_alloc)

        st.markdown("### Budget Split")
        pc1, pc2 = st.columns(2)
        with pc1:
            fig_pie1, ax_pie1 = plt.subplots(figsize=(5, 5))
            vals = [current_alloc.get(ch, 0) for ch in channels]
            if sum(vals) > 0:
                ax_pie1.pie(vals, labels=channels, autopct="%1.1f%%", startangle=90,
                           colors=[plt.cm.Set2(i) for i in range(len(channels))])
                ax_pie1.set_title("Current Allocation", fontweight="bold")
            st.pyplot(fig_pie1, use_container_width=True)
            plt.close(fig_pie1)

        with pc2:
            fig_pie2, ax_pie2 = plt.subplots(figsize=(5, 5))
            vals = [opt.channel_allocations.get(ch, 0) for ch in channels]
            if sum(vals) > 0:
                ax_pie2.pie(vals, labels=channels, autopct="%1.1f%%", startangle=90,
                           colors=[plt.cm.Set2(i) for i in range(len(channels))])
                ax_pie2.set_title("Optimized Allocation", fontweight="bold")
            st.pyplot(fig_pie2, use_container_width=True)
            plt.close(fig_pie2)


# ═══════════════════════════════════════════════════════════════
# TAB 4: EXPORT
# ═══════════════════════════════════════════════════════════════

with tab4:
    st.markdown("## Export Results")
    st.markdown(
        "Download your curve data, optimization results, and channel configurations "
        "to use in presentations, reports, or further analysis."
    )

    col_exp1, col_exp2 = st.columns(2)

    with col_exp1:
        st.markdown("### Curve Data (CSV)")
        st.caption(
            "A table with columns: Channel, Spend, Response, Marginal, ROI "
            "for every point on every channel's curve. "
            "Import this into Excel, Google Sheets, or any BI tool."
        )
        if all_curves:
            all_tables = []
            for config in st.session_state.channel_configs:
                if config.name in all_curves:
                    s, r = all_curves[config.name]
                    _, m = all_marginals[config.name]
                    tbl = pd.DataFrame({
                        "Channel": config.name,
                        "Spend": s, "Response": r, "Marginal": m,
                        "ROI": np.where(s > 0, r / s, 0),
                    })
                    all_tables.append(tbl)
            if all_tables:
                export_df = pd.concat(all_tables, ignore_index=True)
                st.download_button(
                    "📥 Download Curves CSV",
                    export_df.to_csv(index=False),
                    "mmm_response_curves.csv", "text/csv",
                    use_container_width=True,
                )

        st.markdown("### Charts (PNG)")
        st.caption("High-resolution overlay chart of all channels.")
        if all_curves:
            fig_export = plot_overlay_curves(all_curves)
            st.download_button(
                "📥 Download Overlay Chart",
                fig_to_bytes(fig_export),
                "mmm_curves_overlay.png", "image/png",
                use_container_width=True,
            )
            plt.close(fig_export)

    with col_exp2:
        st.markdown("### Optimization Report (CSV)")
        st.caption("Optimized spend, predicted response, and marginal ROI per channel.")
        if st.session_state.optimization_result is not None:
            opt = st.session_state.optimization_result
            opt_df = pd.DataFrame({
                "Channel": list(opt.channel_allocations.keys()),
                "Optimized_Spend": list(opt.channel_allocations.values()),
                "Predicted_Response": list(opt.channel_responses.values()),
                "Marginal_ROI": list(opt.channel_marginal_roi.values()),
            })
            st.download_button(
                "📥 Download Optimization CSV",
                opt_df.to_csv(index=False),
                "mmm_optimization.csv", "text/csv",
                use_container_width=True,
            )
        else:
            st.caption("*Run optimization first to enable this export.*")

        st.markdown("### Channel Config (JSON)")
        st.caption(
            "All your channel parameters as a JSON file. "
            "Save this to reload your configuration later or share with colleagues."
        )
        if st.session_state.channel_configs:
            config_json = json.dumps(
                [c.to_dict() for c in st.session_state.channel_configs], indent=2,
            )
            st.download_button(
                "📥 Download Config JSON",
                config_json,
                "mmm_channel_config.json", "application/json",
                use_container_width=True,
            )

    st.markdown("---")
    st.markdown("### Sample Data")
    st.caption("Download the sample dataset to use as a template for formatting your own data.")
    sample = generate_sample_data()
    st.download_button(
        "📥 Download Sample Data CSV",
        sample.to_csv(index=False),
        "mmm_sample_data.csv", "text/csv",
    )


# ═══════════════════════════════════════════════════════════════
# FOOTER
# ═══════════════════════════════════════════════════════════════

st.markdown("---")
st.markdown(
    "<div style='text-align: center; color: #9CA3AF; font-size: 0.85rem;'>"
    "MMM Diminishing Returns Curve Tool  ·  "
    "Equations: Linear, Log, Power, Exponential, Hill, Quadratic  ·  "
    "Optimizers: L-BFGS-B, Differential Evolution, LP, Genetic, Grid Search"
    "</div>",
    unsafe_allow_html=True,
)
