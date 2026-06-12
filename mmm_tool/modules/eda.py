"""
Exploratory Data Analysis Module.
Interactive visualizations for understanding data relationships,
detecting multicollinearity, and identifying patterns.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.helpers import compute_vif, compute_correlation_matrix, stationarity_test


def render_eda():
    """Render the EDA interface."""
    
    st.header("🔍 Exploratory Data Analysis")
    
    if "variable_mapping" not in st.session_state:
        st.warning("Please complete Data Upload & Variable Mapping first.")
        return
    
    df = st.session_state["mapped_data"].copy()
    mapping = st.session_state["variable_mapping"]
    
    date_col = mapping["date_col"]
    target_col = mapping["target_col"]
    media_cols = mapping["media_cols"]
    organic_cols = mapping["organic_cols"]
    context_cols = mapping["context_cols"]
    all_features = media_cols + organic_cols + context_cols
    
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "Time Series", "Correlations", "Scatter Analysis",
        "Distribution", "Stationarity"
    ])
    
    # --- Tab 1: Time Series ---
    with tab1:
        st.subheader("Time Series Overview")
        
        # Target variable over time
        if date_col in df.columns:
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=df[date_col], y=df[target_col],
                mode='lines', name=target_col,
                line=dict(color='#2962FF', width=2)
            ))
            
            # Add trend line (drop NaN to avoid biasing the fit)
            trend_series = df[target_col].dropna()
            x_numeric_full = np.arange(len(df))
            x_numeric_valid = x_numeric_full[df[target_col].notna()]
            z = np.polyfit(x_numeric_valid, trend_series.values, 1)
            p = np.poly1d(z)
            fig.add_trace(go.Scatter(
                x=df[date_col], y=p(x_numeric_full),
                mode='lines', name='Trend',
                line=dict(color='red', width=1, dash='dash')
            ))
            
            fig.update_layout(
                title=f"{target_col} Over Time",
                xaxis_title="Date", yaxis_title=target_col,
                height=400, template="plotly_white"
            )
            st.plotly_chart(fig, use_container_width=True)
        
        # Media spend over time
        if media_cols:
            st.markdown("**Media Spend Trends:**")
            selected_media = st.multiselect(
                "Select channels to plot",
                media_cols,
                default=media_cols[:3],
                key="ts_media_select"
            )
            
            if selected_media:
                fig = go.Figure()
                colors = px.colors.qualitative.Set2
                for i, col in enumerate(selected_media):
                    fig.add_trace(go.Scatter(
                        x=df[date_col], y=df[col],
                        mode='lines', name=col,
                        line=dict(color=colors[i % len(colors)], width=1.5)
                    ))
                fig.update_layout(
                    title="Media Spend Over Time",
                    xaxis_title="Date", yaxis_title="Spend",
                    height=400, template="plotly_white"
                )
                st.plotly_chart(fig, use_container_width=True)
    
    # --- Tab 2: Correlations ---
    with tab2:
        st.subheader("Correlation Analysis")
        
        # Correlation heatmap
        corr_cols = [target_col] + [c for c in all_features if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        
        if len(corr_cols) >= 2:
            corr_matrix = df[corr_cols].corr()
            
            fig = go.Figure(data=go.Heatmap(
                z=corr_matrix.values,
                x=corr_matrix.columns,
                y=corr_matrix.columns,
                colorscale='RdBu_r',
                zmin=-1, zmax=1,
                text=np.round(corr_matrix.values, 2),
                texttemplate='%{text}',
                textfont={"size": 9},
            ))
            fig.update_layout(
                title="Correlation Heatmap",
                height=600, width=700,
                template="plotly_white"
            )
            st.plotly_chart(fig, use_container_width=True)
            
            # VIF Analysis for multicollinearity
            st.markdown("---")
            st.subheader("Variance Inflation Factor (VIF)")
            st.caption("VIF > 5 suggests multicollinearity. VIF > 10 indicates severe multicollinearity.")
            
            vif_cols = [c for c in all_features if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
            if len(vif_cols) >= 2:
                try:
                    vif_df = compute_vif(df, vif_cols)
                    
                    # Color code VIF values
                    def vif_status(v):
                        if v > 10: return "🔴 Severe"
                        elif v > 5: return "🟡 Moderate"
                        else: return "🟢 OK"
                    
                    vif_df["Status"] = vif_df["VIF"].apply(vif_status)
                    st.dataframe(vif_df, use_container_width=True, hide_index=True)
                    
                    high_vif = vif_df[vif_df["VIF"] > 5]
                    if len(high_vif) > 0:
                        st.warning(f"⚠️ {len(high_vif)} variable(s) have high VIF. Consider removing or combining correlated features.")
                except Exception as e:
                    st.error(f"VIF calculation error: {e}")
    
    # --- Tab 3: Scatter Analysis ---
    with tab3:
        st.subheader("Spend vs. Revenue Analysis")
        st.caption("Examine relationships between media spend and the target variable.")
        
        scatter_cols = [c for c in all_features if c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
        
        col1, col2 = st.columns(2)
        with col1:
            x_var = st.selectbox("X-axis variable", scatter_cols, key="scatter_x")
        with col2:
            y_var = st.selectbox("Y-axis variable", [target_col] + scatter_cols, key="scatter_y")
        
        color_var = st.selectbox(
            "Color by (optional)",
            ["None"] + [c for c in df.columns if df[c].nunique() <= 12],
            key="scatter_color"
        )
        
        if x_var and y_var:
            fig = px.scatter(
                df, x=x_var, y=y_var,
                color=color_var if color_var != "None" else None,
                trendline="ols",
                title=f"{x_var} vs {y_var}",
                template="plotly_white",
                opacity=0.6
            )
            fig.update_layout(height=500)
            st.plotly_chart(fig, use_container_width=True)
            
            # Correlation value
            corr = df[x_var].corr(df[y_var])
            st.metric(f"Pearson Correlation", f"{corr:.3f}")
        
        # Multi-scatter matrix
        if media_cols and st.checkbox("Show scatter matrix (media vs target)", key="show_scatter_matrix"):
            scatter_subset = [target_col] + media_cols[:4]
            fig = px.scatter_matrix(
                df[scatter_subset],
                dimensions=scatter_subset,
                title="Scatter Matrix: Media Spend vs Revenue",
                template="plotly_white",
                opacity=0.4,
                height=700
            )
            st.plotly_chart(fig, use_container_width=True)
    
    # --- Tab 4: Distribution ---
    with tab4:
        st.subheader("Variable Distributions")
        
        dist_cols = st.multiselect(
            "Select variables",
            [target_col] + all_features,
            default=[target_col] + media_cols[:2],
            key="dist_cols"
        )
        
        if dist_cols:
            n_cols = min(3, len(dist_cols))
            cols = st.columns(n_cols)
            
            for i, col_name in enumerate(dist_cols):
                with cols[i % n_cols]:
                    fig = px.histogram(
                        df, x=col_name, nbins=30,
                        title=f"Distribution: {col_name}",
                        template="plotly_white",
                        marginal="box"
                    )
                    fig.update_layout(height=350, showlegend=False)
                    st.plotly_chart(fig, use_container_width=True)
                    
                    # Summary stats
                    stats = df[col_name].describe()
                    st.caption(f"Mean: {stats['mean']:,.1f} | Std: {stats['std']:,.1f} | Skew: {df[col_name].skew():.2f}")
    
    # --- Tab 5: Stationarity ---
    with tab5:
        st.subheader("Stationarity Analysis")
        st.caption("Check if time series variables are stationary — important for time-series modeling.")
        
        stat_cols = st.multiselect(
            "Select variables to test",
            [target_col] + all_features,
            default=[target_col],
            key="stat_cols"
        )
        
        if stat_cols and st.button("Run Stationarity Tests", key="run_stat_test"):
            results = []
            for col_name in stat_cols:
                if col_name in df.columns and pd.api.types.is_numeric_dtype(df[col_name]):
                    series = df[col_name].dropna()
                    if len(series) > 10:
                        test_result = stationarity_test(series)
                        results.append({
                            "Variable": col_name,
                            "Has Trend": "Yes" if test_result["has_trend"] else "No",
                            "Trend P-value": test_result["trend_p_value"],
                            "Variance Ratio": test_result["variance_ratio"],
                            "Stationary": "✅ Yes" if test_result["is_stationary"] else "❌ No",
                            "Recommendation": "OK" if test_result["is_stationary"] else "Consider differencing"
                        })
            
            if results:
                st.dataframe(pd.DataFrame(results), use_container_width=True, hide_index=True)
                
                non_stationary = [r for r in results if "❌" in r["Stationary"]]
                if non_stationary:
                    st.info(
                        f"💡 {len(non_stationary)} variable(s) appear non-stationary. "
                        "You can apply differencing in the Feature Engineering tab."
                    )
