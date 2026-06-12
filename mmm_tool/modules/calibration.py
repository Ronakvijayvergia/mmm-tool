"""
Calibration and Validation Module.
Anchor MMM outputs with external ground truth from lift studies,
geo-experiments, and A/B tests.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.synthetic_data import generate_calibration_data


def render_calibration():
    """Render the calibration and validation interface."""
    
    st.header("🔬 Calibration & Validation")
    
    if "mmm_result" not in st.session_state:
        st.warning("Please train a model first.")
        return
    
    result = st.session_state["mmm_result"]
    mapping = st.session_state["variable_mapping"]
    media_cols = mapping["media_cols"]
    
    tab1, tab2, tab3 = st.tabs([
        "Input Ground Truth", "Calibration Analysis", "Model Validation"
    ])
    
    # --- Tab 1: Input ground truth ---
    with tab1:
        st.subheader("Input Experimental Results")
        st.caption(
            "Provide results from lift studies, geo-experiments, or A/B tests "
            "to validate and calibrate your MMM outputs."
        )
        
        col1, col2 = st.columns([1, 1])
        
        with col1:
            st.markdown("**Manual Entry:**")
            
            if "calibration_data" not in st.session_state:
                st.session_state["calibration_data"] = []
            
            with st.form("calibration_form"):
                channel = st.selectbox("Channel", media_cols, key="cal_channel")
                test_type = st.selectbox(
                    "Test type",
                    ["Geo-Experiment", "Lift Study", "A/B Test", "Matched Market Test", "Other"],
                    key="cal_test_type"
                )
                
                c1, c2, c3 = st.columns(3)
                with c1:
                    measured_roi = st.number_input("Measured ROI", min_value=0.0, value=2.0, step=0.1, key="cal_roi")
                with c2:
                    ci_lower = st.number_input("CI Lower", min_value=0.0, value=1.5, step=0.1, key="cal_ci_low")
                with c3:
                    ci_upper = st.number_input("CI Upper", min_value=0.0, value=2.5, step=0.1, key="cal_ci_high")
                
                c1, c2 = st.columns(2)
                with c1:
                    test_start = st.date_input("Test start", key="cal_start")
                with c2:
                    test_end = st.date_input("Test end", key="cal_end")
                
                notes = st.text_area("Notes (optional)", key="cal_notes")
                
                submitted = st.form_submit_button("Add Calibration Point")
                if submitted:
                    st.session_state["calibration_data"].append({
                        "channel": channel,
                        "test_type": test_type,
                        "measured_roi": measured_roi,
                        "ci_lower": ci_lower,
                        "ci_upper": ci_upper,
                        "test_start": str(test_start),
                        "test_end": str(test_end),
                        "notes": notes,
                    })
                    st.success(f"Added calibration point for {channel}")
        
        with col2:
            st.markdown("**Or upload calibration file:**")
            cal_file = st.file_uploader("Upload CSV with calibration data", type=["csv"], key="cal_upload")
            if cal_file:
                try:
                    cal_df = pd.read_csv(cal_file)
                    for _, row in cal_df.iterrows():
                        st.session_state["calibration_data"].append(row.to_dict())
                    st.success(f"Loaded {len(cal_df)} calibration points")
                except Exception as e:
                    st.error(f"Error: {e}")
            
            st.markdown("---")
            if st.button("Load Sample Calibration Data"):
                sample_cal = generate_calibration_data(media_cols)
                for _, row in sample_cal.iterrows():
                    st.session_state["calibration_data"].append(row.to_dict())
                st.success("Loaded sample calibration data")
        
        # Show current calibration data
        if st.session_state["calibration_data"]:
            st.markdown("---")
            st.subheader("Current Calibration Data")
            cal_df = pd.DataFrame(st.session_state["calibration_data"])
            st.dataframe(cal_df, use_container_width=True, hide_index=True)
            
            if st.button("Clear All Calibration Data"):
                st.session_state["calibration_data"] = []
                st.rerun()
    
    # --- Tab 2: Calibration Analysis ---
    with tab2:
        st.subheader("MMM vs Ground Truth Comparison")
        
        if not st.session_state.get("calibration_data"):
            st.info("Add calibration data in the 'Input Ground Truth' tab first.")
            return
        
        cal_df = pd.DataFrame(st.session_state["calibration_data"])
        
        # Compare MMM ROI with measured ROI
        comparison = []
        for _, row in cal_df.iterrows():
            channel = row["channel"]
            measured = row["measured_roi"]
            ci_low = row.get("ci_lower", measured * 0.7)
            ci_high = row.get("ci_upper", measured * 1.3)
            
            # Estimate MMM ROI: incremental contribution / average spend
            mmm_coef = result.coefficients.get(channel, 0)
            contrib_pct = result.contribution_pct.get(channel, 0)
            contrib_abs = result.contribution_abs.get(channel, 0)

            # Get average spend for the channel from the data
            avg_spend = 0
            if "mapped_data" in st.session_state and channel in st.session_state["mapped_data"].columns:
                avg_spend = st.session_state["mapped_data"][channel].mean()

            mmm_roi = contrib_abs / avg_spend if avg_spend > 0 else 0

            in_ci = ci_low <= mmm_roi <= ci_high
            
            comparison.append({
                "Channel": channel,
                "Measured ROI": measured,
                "CI Lower": ci_low,
                "CI Upper": ci_high,
                "MMM ROI": round(mmm_roi, 4),
                "Contribution %": round(contrib_pct, 2),
                "Status": "✅ Within CI" if in_ci else "⚠️ Outside CI",
            })
        
        comp_df = pd.DataFrame(comparison)
        st.dataframe(comp_df, use_container_width=True, hide_index=True)
        
        # Visual comparison
        fig = go.Figure()
        
        for i, row in comp_df.iterrows():
            # Measured with CI
            fig.add_trace(go.Scatter(
                x=[row["Channel"]],
                y=[row["Measured ROI"]],
                mode='markers',
                marker=dict(size=14, color='#2962FF', symbol='diamond'),
                name='Measured ROI' if i == 0 else None,
                showlegend=(i == 0),
                error_y=dict(
                    type='data',
                    symmetric=False,
                    array=[row["CI Upper"] - row["Measured ROI"]],
                    arrayminus=[row["Measured ROI"] - row["CI Lower"]],
                    color='#2962FF'
                )
            ))
        
        fig.update_layout(
            title="Measured ROI with Confidence Intervals",
            yaxis_title="ROI",
            height=400,
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Calibration quality
        n_within = sum(1 for c in comparison if "✅" in c["Status"])
        total = len(comparison)
        
        if total > 0:
            cal_score = n_within / total * 100
            st.metric("Calibration Score", f"{cal_score:.0f}%",
                     help=f"{n_within}/{total} channels within confidence intervals")
            
            if cal_score >= 80:
                st.success("Model is well-calibrated with ground truth data.")
            elif cal_score >= 50:
                st.warning("Moderate calibration. Consider adjusting hyperparameters for misaligned channels.")
            else:
                st.error("Poor calibration. The model may need significant adjustments.")
    
    # --- Tab 3: Model Validation ---
    with tab3:
        st.subheader("Holdout Validation Metrics")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown("**Test Set Performance:**")
            metrics = {
                "R-squared": result.test_r2,
                "MAPE": result.test_mape,
                "RMSE": result.test_rmse,
                "MAE": result.test_mae,
            }
            for name, value in metrics.items():
                if name == "MAPE":
                    st.metric(name, f"{value:.2%}")
                elif name == "R-squared":
                    st.metric(name, f"{value:.4f}")
                else:
                    st.metric(name, f"{value:,.0f}")
        
        with col2:
            st.markdown("**Overfitting Analysis:**")
            gap = result.train_r2 - result.test_r2
            st.metric("Train-Test R² Gap", f"{gap:.4f}")
            
            if gap < 0.05:
                st.success("No significant overfitting detected.")
            elif gap < 0.15:
                st.warning("Some overfitting. Consider increasing regularization.")
            else:
                st.error("Significant overfitting detected!")
            
            st.markdown("**Recommendations:**")
            if result.test_mape > 0.15:
                st.write("- Consider adding more features or adjusting transformations")
            if gap > 0.1:
                st.write("- Increase regularization strength (α)")
                st.write("- Remove highly correlated features")
            if result.test_r2 > 0.7 and gap < 0.1:
                st.write("- Model appears well-fitted and generalizable")
                st.write("- Proceed to budget optimization with confidence")
