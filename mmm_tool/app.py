"""
Marketing Mix Modeling (MMM) Tool
=================================
A comprehensive, end-to-end MMM platform built on Meta Robyn methodology.
Streamlines data upload, feature engineering, EDA, model training,
budget optimization, and calibration through an interactive Streamlit UI.

Run with:  streamlit run app.py
"""
import streamlit as st
import sys
import os

# Ensure the project root is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Page configuration
st.set_page_config(
    page_title="MMM Tool — Marketing Mix Modeling",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for better styling
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1a237e;
        margin-bottom: 0;
    }
    .sub-header {
        font-size: 1.1rem;
        color: #546e7a;
        margin-top: -10px;
        margin-bottom: 20px;
    }
    [data-testid="stSidebar"] {
        background-color: #f8f9fa;
    }
    .stMetric {
        background-color: #f0f4ff;
        padding: 10px;
        border-radius: 8px;
    }
    div[data-testid="stMetricValue"] {
        font-size: 1.3rem;
    }
</style>
""", unsafe_allow_html=True)

# --- Sidebar Navigation ---
with st.sidebar:
    st.markdown("## 📊 MMM Tool")
    st.markdown("*Marketing Mix Modeling*")
    st.markdown("---")

    page = st.radio(
        "Navigation",
        [
            "🏠 Home",
            "📊 Data Upload & Mapping",
            "🔧 Feature Engineering",
            "🔍 Exploratory Analysis (EDA)",
            "⚙️ Model Configuration",
            "🚀 Model Training & Results",
            "💰 Budget Optimizer",
            "🔬 Calibration & Validation",
        ],
        key="nav_radio",
    )

    st.markdown("---")

    # Status indicators
    st.markdown("### Status")
    checks = {
        "Data loaded": "raw_data" in st.session_state,
        "Variables mapped": "variable_mapping" in st.session_state,
        "Model configured": "model_config" in st.session_state,
        "Model trained": "mmm_result" in st.session_state,
        "Budget optimized": "optimization_result" in st.session_state,
    }
    for label, done in checks.items():
        icon = "✅" if done else "⬜"
        st.write(f"{icon} {label}")

    st.markdown("---")
    st.caption("Built on Meta Robyn methodology")
    st.caption("v1.0.0")

# --- Page Routing ---

if page == "🏠 Home":
    st.markdown('<p class="main-header">Marketing Mix Modeling Tool</p>', unsafe_allow_html=True)
    st.markdown('<p class="sub-header">End-to-end MMM platform powered by Meta Robyn methodology</p>', unsafe_allow_html=True)

    st.markdown("""
    Welcome to the **MMM Tool** — a comprehensive platform that simplifies Marketing Mix Modeling
    for data-driven marketing decisions. This tool guides you through the complete MMM workflow:
    """)

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("""
        #### 📊 Data & Features
        - Upload CSV/Excel data
        - Interactive variable mapping
        - Advanced feature engineering
        - Exploratory data analysis
        """)

    with col2:
        st.markdown("""
        #### 🧠 Modeling
        - Adstock (carryover) effects
        - Saturation (diminishing returns)
        - Ridge/ElasticNet regression
        - Train/test validation
        """)

    with col3:
        st.markdown("""
        #### 💡 Insights
        - Channel contribution decomposition
        - Response curves
        - Budget optimization
        - Calibration with ground truth
        """)

    st.markdown("---")

    st.subheader("Quick Start Guide")

    steps = [
        ("1️⃣", "Upload Data", "Upload your dataset or load sample data. Map variables to categories (media spend, organic, context)."),
        ("2️⃣", "Feature Engineering", "Transform variables, combine features, set bounds. Explore data with EDA tools."),
        ("3️⃣", "Configure Model", "Set adstock decay, saturation curves, and regression parameters. Use presets or customize per-channel."),
        ("4️⃣", "Train & Evaluate", "Train the MMM, review performance metrics, decomposition, and response curves."),
        ("5️⃣", "Optimize & Validate", "Use the budget optimizer to find optimal allocations. Calibrate with external test results."),
    ]

    for emoji, title, desc in steps:
        st.markdown(f"**{emoji} {title}:** {desc}")

    st.markdown("---")

    st.subheader("Key Concepts")

    with st.expander("What is Adstock?"):
        st.markdown("""
        **Adstock** models the carryover effect of marketing — how an ad seen today can influence
        purchases days or weeks later. This tool supports:

        - **Geometric decay**: Simple exponential decay (parameter: θ)
        - **Weibull CDF/PDF**: Flexible decay patterns for delayed-peak effects

        Higher θ values mean longer-lasting effects (e.g., TV branding = 0.7, digital performance = 0.2).
        """)

    with st.expander("What are Saturation Curves?"):
        st.markdown("""
        **Saturation** (diminishing returns) captures how each additional dollar of media spend
        delivers less incremental value. The Hill function is the standard in Meta's Robyn:

        - **Alpha**: Controls the steepness of the curve
        - **Gamma**: The half-saturation point (spend level at 50% maximum response)

        Channels with lower gamma saturate faster, meaning budget efficiency peaks earlier.
        """)

    with st.expander("What is Budget Optimization?"):
        st.markdown("""
        The **budget optimizer** uses the **equimarginal principle**: reallocate budget until
        marginal returns are equalized across channels. This finds the allocation that maximizes
        total response for a given budget.

        Key distinction: **Marginal ROI** (next dollar) matters more than **Average ROI**
        (historical average) for forward-looking budget decisions.
        """)

    with st.expander("What is Calibration?"):
        st.markdown("""
        **Calibration** anchors MMM outputs with external experimental evidence — results from
        geo-experiments, lift studies, or A/B tests. This combines statistical modeling with
        empirical measurement to improve credibility and accuracy.
        """)

    st.markdown("---")
    st.info("👈 Use the sidebar to navigate between sections. Start with **Data Upload & Mapping**.")

elif page == "📊 Data Upload & Mapping":
    from modules.data_upload import render_data_upload
    render_data_upload()

elif page == "🔧 Feature Engineering":
    from modules.feature_engineering import render_feature_engineering
    render_feature_engineering()

elif page == "🔍 Exploratory Analysis (EDA)":
    from modules.eda import render_eda
    render_eda()

elif page == "⚙️ Model Configuration":
    from modules.model_config import render_model_config
    render_model_config()

elif page == "🚀 Model Training & Results":
    from modules.model_training import render_model_training
    render_model_training()

elif page == "💰 Budget Optimizer":
    from modules.budget_optimizer import render_budget_optimizer
    render_budget_optimizer()

elif page == "🔬 Calibration & Validation":
    from modules.calibration import render_calibration
    render_calibration()
