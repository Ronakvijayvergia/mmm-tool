"""
Data Upload and Variable Mapping Module.
Handles file upload, auto-detection, and interactive variable categorization.
"""
import streamlit as st
import pandas as pd
import numpy as np
from typing import Dict, List, Optional
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.helpers import load_data, detect_date_column, detect_target_column, detect_spend_columns, compute_data_quality_report
from utils.synthetic_data import generate_synthetic_mmm_data


def render_data_upload():
    """Render the data upload and variable mapping interface."""
    
    st.header("📊 Data Upload & Variable Mapping")
    
    tab1, tab2 = st.tabs(["Upload Data", "Use Sample Data"])
    
    with tab1:
        uploaded_file = st.file_uploader(
            "Upload your dataset (CSV or Excel)",
            type=["csv", "xlsx", "xls"],
            help="Upload a file with columns for date, revenue/KPI, media spend, and optional context variables."
        )
        
        if uploaded_file is not None:
            try:
                df = load_data(uploaded_file)
                st.session_state["raw_data"] = df
                st.success(f"Loaded {len(df)} rows × {len(df.columns)} columns")
            except Exception as e:
                st.error(f"Error loading file: {e}")
                return
    
    with tab2:
        if st.button("Load Sample Dataset", type="primary"):
            df = generate_synthetic_mmm_data()
            st.session_state["raw_data"] = df
            st.success(f"Loaded sample dataset: {len(df)} rows × {len(df.columns)} columns")
    
    # Show data preview and mapping if data is loaded
    if "raw_data" in st.session_state:
        df = st.session_state["raw_data"]
        
        st.subheader("Data Preview")
        st.dataframe(df.head(10), use_container_width=True)
        
        # Data quality summary
        with st.expander("📋 Data Quality Report", expanded=False):
            report = compute_data_quality_report(df)
            
            col1, col2, col3 = st.columns(3)
            col1.metric("Rows", report["n_rows"])
            col2.metric("Columns", report["n_cols"])
            col3.metric("Numeric Columns", len(report["numeric_cols"]))
            
            # Missing values
            missing = {k: v for k, v in report["missing_pct"].items() if v > 0}
            if missing:
                st.warning("Missing values detected:")
                missing_df = pd.DataFrame({
                    "Column": missing.keys(),
                    "Missing %": missing.values()
                })
                st.dataframe(missing_df, use_container_width=True)
            else:
                st.success("No missing values found!")
        
        # Variable Mapping Section
        st.subheader("Variable Mapping")
        st.info("Categorize each variable to tell the model how to use it. Auto-detected suggestions are pre-selected.")
        
        # Auto-detect
        auto_date = detect_date_column(df)
        auto_target = detect_target_column(df)
        auto_spend = detect_spend_columns(df)
        
        all_cols = list(df.columns)
        numeric_cols = list(df.select_dtypes(include=[np.number]).columns)
        
        # Date column
        date_idx = all_cols.index(auto_date) if auto_date and auto_date in all_cols else 0
        date_col = st.selectbox("📅 Date Column", all_cols, index=date_idx, key="date_col_select")
        
        # Target column
        remaining = [c for c in numeric_cols if c != date_col]
        target_idx = remaining.index(auto_target) if auto_target and auto_target in remaining else 0
        target_col = st.selectbox("🎯 Target / KPI Column (Revenue, Sales, etc.)", remaining, index=target_idx, key="target_col_select")
        
        # Available columns for categorization
        available = [c for c in numeric_cols if c not in [date_col, target_col]]
        
        st.markdown("---")
        st.markdown("**Categorize your variables:**")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("**💰 Media Spend**")
            st.caption("Paid channels (TV, digital, social, etc.)")
            default_media = [c for c in auto_spend if c in available]
            media_cols = st.multiselect(
                "Select media spend columns",
                available,
                default=default_media,
                key="media_cols_select"
            )
        
        remaining_after_media = [c for c in available if c not in media_cols]
        
        with col2:
            st.markdown("**🌱 Organic Factors**")
            st.caption("Non-paid (SEO, word-of-mouth, email list)")
            organic_keywords = ['organic', 'seo', 'word_of_mouth', 'wom', 'email_list', 'subscriber', 'referral']
            default_organic = [c for c in remaining_after_media if any(kw in c.lower() for kw in organic_keywords)]
            organic_cols = st.multiselect(
                "Select organic columns",
                remaining_after_media,
                default=default_organic,
                key="organic_cols_select"
            )
        
        remaining_after_organic = [c for c in remaining_after_media if c not in organic_cols]
        
        with col3:
            st.markdown("**🌍 Context / External**")
            st.caption("Economic indicators, holidays, competitor activity")
            context_keywords = ['holiday', 'competitor', 'confidence', 'gdp', 'temperature', 'weather', 
                              'unemployment', 'inflation', 'season', 'is_', 'month', 'quarter', 'year', 'week']
            default_context = [c for c in remaining_after_organic if any(kw in c.lower() for kw in context_keywords)]
            context_cols = st.multiselect(
                "Select context columns",
                remaining_after_organic,
                default=default_context,
                key="context_cols_select"
            )
        
        # Show unmapped columns
        all_mapped = set([date_col, target_col] + media_cols + organic_cols + context_cols)
        unmapped = [c for c in all_cols if c not in all_mapped]
        if unmapped:
            with st.expander(f"⚠️ {len(unmapped)} unmapped columns (will be excluded)"):
                st.write(unmapped)
        
        # Summary
        st.markdown("---")
        st.subheader("Mapping Summary")
        
        summary_data = {
            "Category": ["Date", "Target/KPI", "Media Spend", "Organic", "Context/External"],
            "Count": [1, 1, len(media_cols), len(organic_cols), len(context_cols)],
            "Variables": [
                date_col, target_col,
                ", ".join(media_cols) if media_cols else "None",
                ", ".join(organic_cols) if organic_cols else "None",
                ", ".join(context_cols) if context_cols else "None",
            ]
        }
        st.dataframe(pd.DataFrame(summary_data), use_container_width=True, hide_index=True)
        
        # Save mapping
        if st.button("✅ Confirm Variable Mapping", type="primary"):
            # Parse date column
            try:
                df[date_col] = pd.to_datetime(df[date_col])
            except Exception:
                st.warning(f"Could not parse '{date_col}' as dates. Proceeding anyway.")
            
            st.session_state["variable_mapping"] = {
                "date_col": date_col,
                "target_col": target_col,
                "media_cols": media_cols,
                "organic_cols": organic_cols,
                "context_cols": context_cols,
            }
            st.session_state["mapped_data"] = df
            st.success("Variable mapping saved! Proceed to Feature Engineering or EDA.")
            st.balloons()
