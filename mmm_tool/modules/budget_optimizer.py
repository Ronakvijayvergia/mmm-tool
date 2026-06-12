"""
Budget Optimizer Module.
Interactive dashboard for budget allocation optimization
with sliders, scenario simulation, and real-time predictions.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.optimizer import BudgetOptimizer, BudgetConstraint


def render_budget_optimizer():
    """Render the budget optimizer dashboard."""
    
    st.header("💰 Budget Optimizer")
    
    if "mmm_result" not in st.session_state or "mmm_model" not in st.session_state:
        st.warning("Please train a model first in the Model Training section.")
        return
    
    result = st.session_state["mmm_result"]
    model = st.session_state["mmm_model"]
    mapping = st.session_state["variable_mapping"]
    config = model.config
    
    media_cols = mapping["media_cols"]
    df = st.session_state["mapped_data"]
    
    if not media_cols:
        st.warning("No media channels defined.")
        return
    
    # Current allocation
    current_allocation = {}
    for col in media_cols:
        if col in df.columns:
            current_allocation[col] = float(df[col].mean())
    
    total_current = sum(current_allocation.values())
    
    tab1, tab2, tab3 = st.tabs([
        "Optimize Budget", "Scenario Simulator", "Comparison"
    ])
    
    # --- Tab 1: Optimize ---
    with tab1:
        st.subheader("Budget Optimization")
        st.caption(
            "Find the optimal budget allocation based on marginal returns. "
            "The optimizer reallocates budget to equalize marginal ROI across channels."
        )
        
        col1, col2 = st.columns([1, 1])
        
        with col1:
            st.markdown("**Budget Settings:**")
            total_budget = st.number_input(
                "Total Budget ($)",
                min_value=1000.0,
                value=float(round(total_current)),
                step=1000.0,
                key="total_budget"
            )
            
            st.markdown("**Channel Constraints:**")
            constraints = BudgetConstraint()
            constraints.total_budget = total_budget
            
            for col in media_cols:
                current = current_allocation.get(col, 0)
                with st.expander(f"📊 {col} (current: ${current:,.0f})"):
                    c1, c2 = st.columns(2)
                    with c1:
                        min_spend = st.number_input(
                            f"Min", min_value=0.0,
                            value=0.0,
                            step=100.0,
                            key=f"min_{col}"
                        )
                    with c2:
                        max_spend = st.number_input(
                            f"Max", min_value=0.0,
                            value=float(total_budget),
                            step=100.0,
                            key=f"max_{col}"
                        )
                    constraints.set_bounds(col, min_spend, max_spend)
        
        with col2:
            if st.button("🔍 Find Optimal Allocation", type="primary"):
                with st.spinner("Optimizing..."):
                    try:
                        optimizer = BudgetOptimizer(result, config)
                        opt_result = optimizer.optimize(
                            total_budget=total_budget,
                            current_allocation=current_allocation,
                            constraints=constraints
                        )
                        st.session_state["optimization_result"] = opt_result
                    except Exception as e:
                        st.error(f"Optimization failed: {e}")
                        return
            
            if "optimization_result" in st.session_state:
                opt_result = st.session_state["optimization_result"]
                
                # Summary metrics
                st.metric(
                    "Predicted Improvement",
                    f"{opt_result.improvement_pct:+.1f}%",
                    help="Expected improvement in response from reallocation"
                )
                
                # Allocation comparison table
                comparison_data = []
                for detail in opt_result.channel_details:
                    comparison_data.append({
                        "Channel": detail["channel"],
                        "Current ($)": f"${detail['current_spend']:,.0f}",
                        "Optimal ($)": f"${detail['optimal_spend']:,.0f}",
                        "Change": f"${detail['change']:+,.0f}",
                        "Change %": f"{detail['change_pct']:+.1f}%",
                        "Marginal ROI": f"{detail['marginal_roi']:.4f}",
                    })
                
                st.dataframe(
                    pd.DataFrame(comparison_data),
                    use_container_width=True,
                    hide_index=True
                )
                
                # Visual comparison
                fig = go.Figure()
                channels = [d["channel"] for d in opt_result.channel_details]
                current_vals = [d["current_spend"] for d in opt_result.channel_details]
                optimal_vals = [d["optimal_spend"] for d in opt_result.channel_details]
                
                fig.add_trace(go.Bar(
                    name='Current', x=channels, y=current_vals,
                    marker_color='#90CAF9', text=[f"${v:,.0f}" for v in current_vals],
                    textposition='auto'
                ))
                fig.add_trace(go.Bar(
                    name='Optimal', x=channels, y=optimal_vals,
                    marker_color='#2962FF', text=[f"${v:,.0f}" for v in optimal_vals],
                    textposition='auto'
                ))
                
                fig.update_layout(
                    title="Current vs Optimal Budget Allocation",
                    yaxis_title="Budget ($)",
                    barmode='group',
                    height=400,
                    template="plotly_white"
                )
                st.plotly_chart(fig, use_container_width=True)
    
    # --- Tab 2: Scenario Simulator ---
    with tab2:
        st.subheader("Budget Scenario Simulator")
        st.caption("Adjust sliders to simulate different budget allocations and see predicted impact in real-time.")
        
        optimizer = BudgetOptimizer(result, config)
        
        st.markdown("**Adjust channel budgets:**")
        
        scenario_allocation = {}
        slider_cols = st.columns(min(3, len(media_cols)))
        
        for i, col in enumerate(media_cols):
            current = current_allocation.get(col, 0)
            max_val = current * 3 if current > 0 else 10000
            with slider_cols[i % len(slider_cols)]:
                scenario_allocation[col] = st.slider(
                    f"{col}",
                    min_value=0.0,
                    max_value=float(max_val),
                    value=float(current),
                    step=float(max(100, current * 0.01)),
                    key=f"scenario_{col}",
                    format="$%,.0f"
                )
        
        scenario_total = sum(scenario_allocation.values())
        
        col1, col2 = st.columns(2)
        with col1:
            st.metric("Scenario Total Budget", f"${scenario_total:,.0f}")
            st.metric("vs Current", f"${scenario_total - total_current:+,.0f}")
        
        # Simulate
        scenario_response = optimizer.simulate_scenario(scenario_allocation)
        current_response = optimizer.simulate_scenario(current_allocation)
        
        with col2:
            response_change = scenario_response["total"] - current_response["total"]
            pct_change = (response_change / current_response["total"] * 100) if current_response["total"] != 0 else 0
            st.metric("Predicted Response Change", f"{pct_change:+.1f}%")
        
        # Channel-level comparison
        st.markdown("---")
        st.markdown("**Channel-Level Impact:**")
        
        impact_data = []
        for col in media_cols:
            impact_data.append({
                "Channel": col,
                "Current Spend": f"${current_allocation.get(col, 0):,.0f}",
                "Scenario Spend": f"${scenario_allocation[col]:,.0f}",
                "Current Response": f"{current_response.get(col, 0):.2f}",
                "Scenario Response": f"{scenario_response.get(col, 0):.2f}",
                "Delta": f"{scenario_response.get(col, 0) - current_response.get(col, 0):+.2f}",
            })
        
        st.dataframe(pd.DataFrame(impact_data), use_container_width=True, hide_index=True)
        
        # Waterfall of changes
        fig = go.Figure(go.Waterfall(
            name="Response Change",
            orientation="v",
            x=media_cols,
            y=[scenario_response.get(col, 0) - current_response.get(col, 0) for col in media_cols],
            connector={"line": {"color": "rgb(63, 63, 63)"}},
            increasing={"marker": {"color": "#2E7D32"}},
            decreasing={"marker": {"color": "#C62828"}},
            text=[f"{scenario_response.get(col, 0) - current_response.get(col, 0):+.2f}" for col in media_cols],
        ))
        fig.update_layout(
            title="Predicted Response Change by Channel",
            yaxis_title="Response Change",
            height=400,
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # --- Tab 3: Comparison ---
    with tab3:
        st.subheader("Allocation Comparison Dashboard")
        
        if "optimization_result" not in st.session_state:
            st.info("Run the optimizer first to see comparisons.")
            return
        
        opt_result = st.session_state["optimization_result"]
        
        # Side by side pie charts
        fig = make_subplots(
            rows=1, cols=2,
            specs=[[{"type": "pie"}, {"type": "pie"}]],
            subplot_titles=("Current Allocation", "Optimal Allocation")
        )
        
        channels = list(opt_result.current_allocation.keys())
        current_vals = list(opt_result.current_allocation.values())
        optimal_vals = list(opt_result.optimal_allocation.values())
        
        fig.add_trace(go.Pie(
            labels=channels, values=current_vals,
            hole=0.4, textinfo='label+percent',
            name="Current"
        ), row=1, col=1)
        
        fig.add_trace(go.Pie(
            labels=channels, values=optimal_vals,
            hole=0.4, textinfo='label+percent',
            name="Optimal"
        ), row=1, col=2)
        
        fig.update_layout(height=400, template="plotly_white")
        st.plotly_chart(fig, use_container_width=True)
        
        # Marginal ROI comparison
        st.markdown("---")
        st.subheader("Marginal ROI at Optimal Allocation")
        st.caption("At the optimal point, marginal ROIs should be approximately equal across channels.")
        
        mroi_data = opt_result.marginal_roi
        fig = go.Figure(go.Bar(
            x=list(mroi_data.keys()),
            y=list(mroi_data.values()),
            marker_color='#2962FF',
            text=[f"{v:.4f}" for v in mroi_data.values()],
            textposition='auto'
        ))
        fig.update_layout(
            title="Marginal ROI by Channel",
            yaxis_title="Marginal ROI",
            height=350,
            template="plotly_white"
        )
        st.plotly_chart(fig, use_container_width=True)
