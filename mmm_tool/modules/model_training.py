"""
Model Training and Results Module.
Trains the MMM and displays comprehensive results and diagnostics.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.mmm_model import MMMConfig, MarketingMixModel


def render_model_training():
    """Render the model training interface."""
    
    st.header("🚀 Model Training & Results")
    
    if "variable_mapping" not in st.session_state:
        st.warning("Please complete Data Upload & Variable Mapping first.")
        return
    
    if "model_config" not in st.session_state:
        st.warning("Please complete Model Configuration first.")
        return
    
    mapping = st.session_state["variable_mapping"]
    config_dict = st.session_state["model_config"]
    df = st.session_state["mapped_data"].copy()
    
    # Build MMMConfig
    mmm_config = MMMConfig()
    mmm_config.date_col = mapping["date_col"]
    mmm_config.target_col = mapping["target_col"]
    mmm_config.media_cols = mapping["media_cols"]
    mmm_config.organic_cols = mapping["organic_cols"]
    mmm_config.context_cols = mapping["context_cols"]
    mmm_config.adstock_method = config_dict.get("adstock_method", "geometric")
    mmm_config.saturation_method = config_dict.get("saturation_method", "hill")
    mmm_config.adstock_params = config_dict.get("adstock_params", {})
    mmm_config.saturation_params = config_dict.get("saturation_params", {})
    mmm_config.model_type = config_dict.get("model_type", "ridge")
    mmm_config.alpha = config_dict.get("alpha", 1.0)
    mmm_config.l1_ratio = config_dict.get("l1_ratio", 0.5)
    mmm_config.positive_coefficients = config_dict.get("positive_coefficients", True)
    mmm_config.test_size = config_dict.get("test_size", 0.2)
    mmm_config.time_based_split = config_dict.get("time_based_split", True)
    mmm_config.set_default_hyperparams(mmm_config.media_cols)
    
    # Train button
    if st.button("🏋️ Train Model", type="primary"):
        with st.spinner("Training Marketing Mix Model..."):
            try:
                model = MarketingMixModel(mmm_config)
                result = model.fit(df)
                
                st.session_state["mmm_model"] = model
                st.session_state["mmm_result"] = result
                st.success("Model trained successfully!")
            except Exception as e:
                st.error(f"Training failed: {e}")
                import traceback
                st.code(traceback.format_exc())
                return
    
    # Display results if model is trained
    if "mmm_result" not in st.session_state:
        st.info("Click 'Train Model' to begin training.")
        return
    
    result = st.session_state["mmm_result"]
    
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "Performance", "Actual vs Predicted",
        "Decomposition", "Response Curves", "Diagnostics"
    ])
    
    # --- Tab 1: Performance Metrics ---
    with tab1:
        st.subheader("Model Performance Metrics")
        
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Train R²", f"{result.train_r2:.4f}")
        col2.metric("Test R²", f"{result.test_r2:.4f}")
        col3.metric("Train MAPE", f"{result.train_mape:.2%}")
        col4.metric("Test MAPE", f"{result.test_mape:.2%}")
        
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Train RMSE", f"{result.train_rmse:,.0f}")
        col2.metric("Test RMSE", f"{result.test_rmse:,.0f}")
        col3.metric("Train MAE", f"{result.train_mae:,.0f}")
        col4.metric("NRMSE", f"{result.nrmse:.4f}")
        
        # Quality assessment
        st.markdown("---")
        st.subheader("Model Quality Assessment")
        
        assessments = []
        if result.test_r2 > 0.8:
            assessments.append("✅ Excellent fit (R² > 0.80)")
        elif result.test_r2 > 0.6:
            assessments.append("🟡 Good fit (R² 0.60-0.80)")
        else:
            assessments.append("🔴 Poor fit (R² < 0.60) — consider adjusting features or hyperparameters")
        
        if result.test_mape < 0.1:
            assessments.append("✅ Low prediction error (MAPE < 10%)")
        elif result.test_mape < 0.2:
            assessments.append("🟡 Moderate prediction error (MAPE 10-20%)")
        else:
            assessments.append("🔴 High prediction error (MAPE > 20%)")
        
        overfit_gap = result.train_r2 - result.test_r2
        if overfit_gap < 0.05:
            assessments.append("✅ No significant overfitting")
        elif overfit_gap < 0.15:
            assessments.append("🟡 Some overfitting detected — consider more regularization")
        else:
            assessments.append("🔴 Significant overfitting — increase regularization or reduce features")
        
        for a in assessments:
            st.write(a)
    
    # --- Tab 2: Actual vs Predicted ---
    with tab2:
        st.subheader("Actual vs Predicted")
        
        # Time series plot
        fig = go.Figure()
        
        if len(result.dates_train) > 0:
            fig.add_trace(go.Scatter(
                x=result.dates_train, y=result.y_train,
                mode='lines', name='Actual (Train)',
                line=dict(color='#2962FF', width=1.5)
            ))
            fig.add_trace(go.Scatter(
                x=result.dates_train, y=result.y_train_pred,
                mode='lines', name='Predicted (Train)',
                line=dict(color='#FF6D00', width=1.5, dash='dot')
            ))
            fig.add_trace(go.Scatter(
                x=result.dates_test, y=result.y_test,
                mode='lines', name='Actual (Test)',
                line=dict(color='#2E7D32', width=1.5)
            ))
            fig.add_trace(go.Scatter(
                x=result.dates_test, y=result.y_test_pred,
                mode='lines', name='Predicted (Test)',
                line=dict(color='#C62828', width=1.5, dash='dot')
            ))
            
            # Add train/test boundary
            if len(result.dates_test) > 0:
                fig.add_vline(
                    x=result.dates_test[0],
                    line_dash="dash", line_color="gray",
                    annotation_text="Train/Test Split"
                )
        else:
            x_train = list(range(len(result.y_train)))
            x_test = list(range(len(result.y_train), len(result.y_train) + len(result.y_test)))
            fig.add_trace(go.Scatter(x=x_train, y=result.y_train, mode='lines', name='Actual (Train)'))
            fig.add_trace(go.Scatter(x=x_train, y=result.y_train_pred, mode='lines', name='Predicted (Train)'))
            fig.add_trace(go.Scatter(x=x_test, y=result.y_test, mode='lines', name='Actual (Test)'))
            fig.add_trace(go.Scatter(x=x_test, y=result.y_test_pred, mode='lines', name='Predicted (Test)'))
        
        fig.update_layout(
            title="Actual vs Predicted Revenue",
            xaxis_title="Date",
            yaxis_title=mapping["target_col"],
            height=450,
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Residuals plot
        residuals_train = result.y_train - result.y_train_pred
        residuals_test = result.y_test - result.y_test_pred
        
        fig2 = make_subplots(rows=1, cols=2, subplot_titles=("Train Residuals", "Test Residuals"))
        fig2.add_trace(go.Histogram(x=residuals_train, name="Train", marker_color='#2962FF', opacity=0.7), row=1, col=1)
        fig2.add_trace(go.Histogram(x=residuals_test, name="Test", marker_color='#C62828', opacity=0.7), row=1, col=2)
        fig2.update_layout(height=300, template="plotly_white", showlegend=False)
        st.plotly_chart(fig2, use_container_width=True)
    
    # --- Tab 3: Decomposition ---
    with tab3:
        st.subheader("Channel Contribution Decomposition")
        
        # Percentage contributions
        contrib = result.contribution_pct
        
        # Waterfall chart
        categories = list(contrib.keys())
        values = list(contrib.values())
        
        # Sort by contribution (excluding base)
        sorted_items = sorted(
            [(k, v) for k, v in contrib.items() if k != "base"],
            key=lambda x: x[1], reverse=True
        )
        
        if "base" in contrib:
            sorted_items.append(("base", contrib["base"]))
        
        fig = go.Figure(go.Bar(
            x=[item[1] for item in sorted_items],
            y=[item[0] for item in sorted_items],
            orientation='h',
            marker_color=['#2962FF' if item[0] in mapping["media_cols"] 
                         else '#2E7D32' if item[0] in mapping.get("organic_cols", [])
                         else '#FF6D00' if item[0] == "base"
                         else '#9E9E9E' for item in sorted_items],
            text=[f"{item[1]:.1f}%" for item in sorted_items],
            textposition='auto'
        ))
        fig.update_layout(
            title="Channel Contribution (%)",
            xaxis_title="Contribution (%)",
            height=max(400, len(sorted_items) * 35),
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Pie chart
        media_contribs = {k: v for k, v in contrib.items() if k in mapping["media_cols"]}
        if media_contribs:
            fig_pie = go.Figure(data=[go.Pie(
                labels=list(media_contribs.keys()),
                values=list(media_contribs.values()),
                hole=0.4,
                textinfo='label+percent',
            )])
            fig_pie.update_layout(title="Media Channel Share", height=400, template="plotly_white")
            st.plotly_chart(fig_pie, use_container_width=True)
        
        # Coefficients table
        st.markdown("---")
        st.subheader("Model Coefficients")
        coef_df = pd.DataFrame({
            "Variable": list(result.coefficients.keys()),
            "Coefficient": [round(v, 6) for v in result.coefficients.values()],
            "Contribution %": [round(contrib.get(k, 0), 2) for k in result.coefficients.keys()],
        }).sort_values("Contribution %", ascending=False)
        st.dataframe(coef_df, use_container_width=True, hide_index=True)
    
    # --- Tab 4: Response Curves ---
    with tab4:
        st.subheader("Response Curves (Diminishing Returns)")
        st.caption("Shows how revenue responds to increasing spend in each channel.")
        
        if result.response_curves:
            selected_channels = st.multiselect(
                "Select channels",
                list(result.response_curves.keys()),
                default=list(result.response_curves.keys())[:4],
                key="response_curve_select"
            )
            
            if selected_channels:
                fig = go.Figure()
                colors = px.colors.qualitative.Set2
                
                for i, ch in enumerate(selected_channels):
                    curve = result.response_curves[ch]
                    fig.add_trace(go.Scatter(
                        x=curve["spend"],
                        y=curve["response"],
                        mode='lines',
                        name=ch,
                        line=dict(color=colors[i % len(colors)], width=2)
                    ))
                    
                    # Mark current spend level
                    fig.add_trace(go.Scatter(
                        x=[curve["current_spend"]],
                        y=[np.interp(curve["current_spend"], curve["spend"], curve["response"])],
                        mode='markers',
                        name=f'{ch} (current)',
                        marker=dict(size=12, symbol='diamond', color=colors[i % len(colors)]),
                        showlegend=False
                    ))
                
                fig.update_layout(
                    title="Channel Response Curves",
                    xaxis_title="Spend Level",
                    yaxis_title="Predicted Response",
                    height=500,
                    template="plotly_white"
                )
                st.plotly_chart(fig, use_container_width=True)
                
                st.info(
                    "💡 Diamond markers show current average spend levels. "
                    "Flatter curves = higher saturation. Steep curves = room for growth."
                )
    
    # --- Tab 5: Diagnostics ---
    with tab5:
        st.subheader("Model Diagnostics")
        
        # Coefficient summary
        st.markdown("**Non-zero coefficients:**")
        nonzero = {k: v for k, v in result.coefficients.items() if abs(v) > 1e-8}
        zero = {k: v for k, v in result.coefficients.items() if abs(v) <= 1e-8}
        
        st.write(f"Active features: {len(nonzero)} / {len(result.coefficients)}")
        if zero:
            st.write(f"Zeroed-out features: {list(zero.keys())}")
        
        # Actual vs Predicted scatter
        all_actual = np.concatenate([result.y_train, result.y_test])
        all_pred = np.concatenate([result.y_train_pred, result.y_test_pred])
        
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=all_actual, y=all_pred,
            mode='markers', name='Data points',
            marker=dict(color='#2962FF', opacity=0.5)
        ))
        
        # Perfect prediction line
        min_val = min(all_actual.min(), all_pred.min())
        max_val = max(all_actual.max(), all_pred.max())
        fig.add_trace(go.Scatter(
            x=[min_val, max_val], y=[min_val, max_val],
            mode='lines', name='Perfect Prediction',
            line=dict(color='red', dash='dash')
        ))
        
        fig.update_layout(
            title="Actual vs Predicted (Scatter)",
            xaxis_title="Actual",
            yaxis_title="Predicted",
            height=450,
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Model summary JSON
        with st.expander("📄 Full Model Summary (JSON)"):
            import json
            st.json(result.summary())
