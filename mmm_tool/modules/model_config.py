"""
Model Configuration Module.
Interactive hyperparameter setup for adstock, saturation, and model settings.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.adstock import get_adstock_weights, apply_adstock
from core.saturation import apply_saturation


def render_model_config():
    """Render the model configuration interface."""
    
    st.header("⚙️ Model Configuration")
    
    if "variable_mapping" not in st.session_state:
        st.warning("Please complete Data Upload & Variable Mapping first.")
        return
    
    mapping = st.session_state["variable_mapping"]
    media_cols = mapping["media_cols"]
    
    if not media_cols:
        st.warning("No media channels defined. Go back to variable mapping.")
        return
    
    tab1, tab2, tab3, tab4 = st.tabs([
        "Adstock Settings", "Saturation Settings",
        "Model Settings", "Train/Test Split"
    ])
    
    # Initialize config in session state
    if "model_config" not in st.session_state:
        st.session_state["model_config"] = {
            "adstock_method": "geometric",
            "saturation_method": "hill",
            "adstock_params": {},
            "saturation_params": {},
            "model_type": "ridge",
            "alpha": 1.0,
            "l1_ratio": 0.5,
            "positive_coefficients": True,
            "test_size": 0.2,
            "time_based_split": True,
        }
    
    config = st.session_state["model_config"]
    
    # --- Tab 1: Adstock ---
    with tab1:
        st.subheader("Adstock (Carryover) Effects")
        st.caption(
            "Adstock models how marketing effects carry over into future periods. "
            "A TV ad seen today can influence purchases for weeks."
        )
        
        col1, col2 = st.columns([1, 2])
        
        with col1:
            preset = st.radio(
                "Configuration mode",
                ["Beginner (Presets)", "Advanced (Per-Channel)"],
                key="adstock_mode"
            )
            
            config["adstock_method"] = st.selectbox(
                "Decay function",
                ["geometric", "weibull_cdf", "weibull_pdf"],
                help="Geometric: simple exponential decay. Weibull: flexible decay patterns.",
                key="adstock_method_select"
            )
        
        if preset == "Beginner (Presets)":
            st.markdown("**Quick Presets:**")
            preset_choice = st.selectbox(
                "Channel type preset",
                ["TV/Brand (Long carryover)", "Digital/Performance (Short carryover)", 
                 "Social Media (Medium carryover)", "Custom"],
                key="adstock_preset"
            )
            
            preset_map = {
                "TV/Brand (Long carryover)": {"theta": 0.7, "l_max": 12},
                "Digital/Performance (Short carryover)": {"theta": 0.2, "l_max": 4},
                "Social Media (Medium carryover)": {"theta": 0.4, "l_max": 8},
                "Custom": {"theta": 0.5, "l_max": 8},
            }
            
            default_params = preset_map[preset_choice]
            
            theta = st.slider("Decay rate (θ)", 0.0, 0.99, default_params["theta"], 0.01, key="global_theta",
                            help="Higher = longer carryover effect")
            l_max = st.slider("Max lag (weeks)", 1, 26, default_params["l_max"], key="global_lmax")
            
            for col in media_cols:
                config["adstock_params"][col] = {"theta": theta, "l_max": l_max}
        
        else:  # Advanced per-channel
            st.markdown("**Configure each channel:**")
            for col in media_cols:
                with st.expander(f"📺 {col}", expanded=False):
                    c1, c2 = st.columns(2)
                    with c1:
                        theta = st.slider(f"Decay rate (θ)", 0.0, 0.99, 0.5, 0.01, key=f"theta_{col}")
                    with c2:
                        l_max = st.slider(f"Max lag", 1, 26, 8, key=f"lmax_{col}")
                    config["adstock_params"][col] = {"theta": theta, "l_max": l_max}
        
        # Visualization of adstock weights
        with col2:
            st.markdown("**Adstock Weight Visualization:**")
            fig = go.Figure()
            
            display_channels = media_cols[:6]
            colors = ['#2962FF', '#FF6D00', '#2E7D32', '#C62828', '#6A1B9A', '#00838F']
            
            for i, col in enumerate(display_channels):
                params = config["adstock_params"].get(col, {"theta": 0.5, "l_max": 8})
                if config["adstock_method"] == "geometric":
                    weights = get_adstock_weights(method="geometric", l_max=params["l_max"], theta=params["theta"])
                else:
                    weights = get_adstock_weights(method=config["adstock_method"], l_max=params["l_max"],
                                                  shape=params.get("shape", 1.0), scale=params.get("scale", 1.0))
                
                fig.add_trace(go.Bar(
                    x=list(range(len(weights))),
                    y=weights,
                    name=col,
                    marker_color=colors[i % len(colors)],
                    opacity=0.7
                ))
            
            fig.update_layout(
                title="Decay Weight Distribution",
                xaxis_title="Lag (weeks)",
                yaxis_title="Weight",
                barmode="group",
                height=400,
                template="plotly_white"
            )
            st.plotly_chart(fig, use_container_width=True)
    
    # --- Tab 2: Saturation ---
    with tab2:
        st.subheader("Saturation (Diminishing Returns)")
        st.caption(
            "Saturation curves model how each additional dollar of spend delivers less incremental value. "
            "The Hill function is standard in Meta Robyn."
        )
        
        col1, col2 = st.columns([1, 2])
        
        with col1:
            config["saturation_method"] = st.selectbox(
                "Saturation function",
                ["hill", "power", "logistic", "michaelis_menten"],
                help="Hill: standard in Robyn. Power: simple x^alpha. Logistic: S-curve.",
                key="sat_method_select"
            )
            
            st.markdown("**Channel parameters:**")
            for col in media_cols:
                with st.expander(f"📈 {col}", expanded=False):
                    if config["saturation_method"] == "hill":
                        alpha = st.slider("Alpha (steepness)", 0.1, 5.0, 2.0, 0.1, key=f"sat_alpha_{col}")
                        gamma = st.slider("Gamma (half-saturation)", 0.01, 1.0, 0.5, 0.01, key=f"sat_gamma_{col}")
                        config["saturation_params"][col] = {"alpha": alpha, "gamma": gamma}
                    elif config["saturation_method"] == "power":
                        alpha = st.slider("Alpha (power)", 0.1, 1.0, 0.5, 0.05, key=f"pow_alpha_{col}")
                        config["saturation_params"][col] = {"alpha": alpha}
                    elif config["saturation_method"] == "logistic":
                        mu = st.slider("Mu (inflection)", 0.1, 0.9, 0.5, 0.05, key=f"log_mu_{col}")
                        lam = st.slider("Lambda (steepness)", 1.0, 20.0, 5.0, 0.5, key=f"log_lam_{col}")
                        config["saturation_params"][col] = {"mu": mu, "lam": lam}
                    else:
                        vmax = st.slider("Vmax", 0.1, 2.0, 1.0, 0.1, key=f"mm_vmax_{col}")
                        km = st.slider("Km (half-sat)", 0.01, 1.0, 0.5, 0.01, key=f"mm_km_{col}")
                        config["saturation_params"][col] = {"vmax": vmax, "km": km}
        
        # Saturation curve visualization
        with col2:
            st.markdown("**Saturation Curve Visualization:**")
            fig = go.Figure()
            
            x_range = np.linspace(0, 1, 200)
            colors = ['#2962FF', '#FF6D00', '#2E7D32', '#C62828', '#6A1B9A', '#00838F']
            
            for i, col in enumerate(media_cols[:6]):
                params = config["saturation_params"].get(col, {"alpha": 2.0, "gamma": 0.5})
                y = apply_saturation(x_range, method=config["saturation_method"], **params)
                
                fig.add_trace(go.Scatter(
                    x=x_range, y=y,
                    mode='lines', name=col,
                    line=dict(color=colors[i % len(colors)], width=2)
                ))
            
            fig.update_layout(
                title="Diminishing Returns Curves",
                xaxis_title="Normalized Spend",
                yaxis_title="Response (Saturated)",
                height=400,
                template="plotly_white"
            )
            st.plotly_chart(fig, use_container_width=True)
            
            st.info("💡 Steeper curves = faster saturation. Move gamma/mu to shift the inflection point.")
    
    # --- Tab 3: Model Settings ---
    with tab3:
        st.subheader("Regression Model Settings")
        
        col1, col2 = st.columns(2)
        
        with col1:
            config["model_type"] = st.selectbox(
                "Model type",
                ["ridge", "elasticnet"],
                help="Ridge: L2 regularization (recommended). ElasticNet: L1+L2 mix.",
                key="model_type_select"
            )
            
            config["alpha"] = st.slider(
                "Regularization strength (α)",
                0.01, 100.0, 1.0, 0.1,
                help="Higher = more regularization = simpler model.",
                key="reg_alpha"
            )
            
            if config["model_type"] == "elasticnet":
                config["l1_ratio"] = st.slider(
                    "L1 ratio (ElasticNet mixing)",
                    0.0, 1.0, 0.5, 0.05,
                    help="0 = pure Ridge, 1 = pure Lasso.",
                    key="l1_ratio"
                )
        
        with col2:
            config["positive_coefficients"] = st.checkbox(
                "Enforce positive coefficients",
                value=True,
                help="Ensures media channels can only have positive impact. Recommended for MMM.",
                key="positive_coef"
            )
            
            st.markdown("---")
            st.markdown("**Model Summary:**")
            st.write(f"- **Type:** {config['model_type'].title()}")
            st.write(f"- **Regularization (α):** {config['alpha']}")
            st.write(f"- **Positive coefficients:** {'Yes' if config['positive_coefficients'] else 'No'}")
            st.write(f"- **Media channels:** {len(media_cols)}")
            st.write(f"- **Total features:** {len(media_cols) + len(mapping.get('organic_cols', [])) + len(mapping.get('context_cols', []))}")
    
    # --- Tab 4: Train/Test Split ---
    with tab4:
        st.subheader("Train / Test Split")
        
        df = st.session_state["mapped_data"]
        n_rows = len(df)
        
        config["time_based_split"] = st.radio(
            "Split method",
            [True, False],
            format_func=lambda x: "Time-based (recommended for time series)" if x else "Random split",
            key="split_method"
        )
        
        config["test_size"] = st.slider(
            "Test set size (%)",
            5, 40, 20, 5,
            key="test_size_slider"
        ) / 100
        
        train_size = int(n_rows * (1 - config["test_size"]))
        test_size = n_rows - train_size
        
        col1, col2 = st.columns(2)
        col1.metric("Training samples", train_size)
        col2.metric("Test samples", test_size)
        
        if config["time_based_split"] and mapping["date_col"] in df.columns:
            dates = pd.to_datetime(df[mapping["date_col"]])
            split_idx = min(train_size, len(dates) - 1)
            split_date = dates.iloc[split_idx]
            st.info(f"Split date: **{split_date.strftime('%Y-%m-%d')}** — Training up to this date, testing after.")
    
    # Save configuration
    st.markdown("---")
    if st.button("💾 Save Configuration", type="primary"):
        st.session_state["model_config"] = config
        st.success("Model configuration saved! Proceed to Model Training.")
