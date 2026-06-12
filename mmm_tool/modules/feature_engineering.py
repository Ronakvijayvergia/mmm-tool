"""
Feature Engineering Module.
Advanced data manipulation: transformations, variable combinations,
ceilings/floors, and feature selection.
"""
import streamlit as st
import pandas as pd
import numpy as np
from typing import List, Dict


def render_feature_engineering():
    """Render the feature engineering interface."""
    
    st.header("🔧 Feature Engineering")
    
    if "variable_mapping" not in st.session_state:
        st.warning("Please complete Data Upload & Variable Mapping first.")
        return
    
    df = st.session_state["mapped_data"].copy()
    mapping = st.session_state["variable_mapping"]
    
    numeric_cols = list(df.select_dtypes(include=[np.number]).columns)
    feature_cols = mapping["media_cols"] + mapping["organic_cols"] + mapping["context_cols"]
    feature_cols = [c for c in feature_cols if c in df.columns]
    
    # Track transformations applied
    if "transformations_log" not in st.session_state:
        st.session_state["transformations_log"] = []
    
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "Transformations", "Combine Variables", "Ceilings & Floors",
        "Feature Selection", "Preview & Apply"
    ])
    
    # --- Tab 1: Transformations ---
    with tab1:
        st.subheader("Variable Transformations")
        st.caption("Apply mathematical transformations to improve model accuracy.")
        
        transform_col = st.selectbox("Select variable to transform", feature_cols, key="transform_col")
        
        transform_type = st.selectbox(
            "Transformation type",
            ["Log (ln)", "Log1p (ln(1+x))", "Square Root", "Box-Cox Normalization",
             "Min-Max Normalize (0-1)", "Z-Score Standardize", "First Difference (Δ)",
             "Percentage Change", "Moving Average"],
            key="transform_type"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            new_col_name = st.text_input(
                "New column name",
                value=f"{transform_col}_{transform_type.split(' ')[0].lower()}",
                key="new_col_name"
            )
        with col2:
            if transform_type == "Moving Average":
                window_size = st.number_input("Window size", min_value=2, max_value=52, value=4, key="ma_window")
        
        if st.button("Apply Transformation", key="apply_transform"):
            try:
                series = df[transform_col].astype(float)
                
                if transform_type == "Log (ln)":
                    df[new_col_name] = np.log(series.clip(lower=1e-10))
                elif transform_type == "Log1p (ln(1+x))":
                    df[new_col_name] = np.log1p(series.clip(lower=0))
                elif transform_type == "Square Root":
                    df[new_col_name] = np.sqrt(series.clip(lower=0))
                elif transform_type == "Box-Cox Normalization":
                    from scipy import stats
                    positive_mask = series > 0
                    positive_vals = series[positive_mask]
                    if len(positive_vals) > 0:
                        transformed, _ = stats.boxcox(positive_vals.values)
                        df[new_col_name] = np.nan
                        df.loc[positive_mask, new_col_name] = pd.Series(
                            transformed, index=series[positive_mask].index
                        ).values
                    else:
                        df[new_col_name] = series
                elif transform_type == "Min-Max Normalize (0-1)":
                    min_val, max_val = series.min(), series.max()
                    df[new_col_name] = (series - min_val) / (max_val - min_val + 1e-10)
                elif transform_type == "Z-Score Standardize":
                    df[new_col_name] = (series - series.mean()) / (series.std() + 1e-10)
                elif transform_type == "First Difference (Δ)":
                    df[new_col_name] = series.diff()
                elif transform_type == "Percentage Change":
                    df[new_col_name] = series.pct_change() * 100
                elif transform_type == "Moving Average":
                    df[new_col_name] = series.rolling(window=window_size, min_periods=1).mean()
                
                st.session_state["mapped_data"] = df
                st.session_state["transformations_log"].append(
                    f"Applied {transform_type} to {transform_col} → {new_col_name}"
                )
                st.success(f"Created '{new_col_name}' using {transform_type}")
                
                # Show before/after
                preview = pd.DataFrame({
                    "Original": df[transform_col].head(10),
                    "Transformed": df[new_col_name].head(10)
                })
                st.dataframe(preview, use_container_width=True)
                
            except Exception as e:
                st.error(f"Transformation failed: {e}")
    
    # --- Tab 2: Combine Variables ---
    with tab2:
        st.subheader("Combine Variables")
        st.caption("Create composite variables by combining existing ones across date ranges.")
        
        combine_cols = st.multiselect(
            "Select columns to combine",
            feature_cols,
            key="combine_cols"
        )
        
        combine_method = st.selectbox(
            "Combination method",
            ["Sum", "Average", "Weighted Average", "Product", "Ratio (A/B)"],
            key="combine_method"
        )
        
        # Date range filter
        use_date_range = st.checkbox("Apply to specific date range only", key="use_date_range")
        
        if use_date_range and mapping["date_col"] in df.columns:
            date_series = pd.to_datetime(df[mapping["date_col"]])
            col1, col2 = st.columns(2)
            with col1:
                start_date = st.date_input("Start date", value=date_series.min(), key="combine_start")
            with col2:
                end_date = st.date_input("End date", value=date_series.max(), key="combine_end")
        
        combined_name = st.text_input(
            "Name for combined variable",
            value="combined_variable",
            key="combined_name"
        )
        
        if combine_method == "Weighted Average" and len(combine_cols) > 0:
            st.markdown("**Set weights:**")
            weights = {}
            cols = st.columns(min(len(combine_cols), 4))
            for i, col in enumerate(combine_cols):
                with cols[i % len(cols)]:
                    weights[col] = st.number_input(f"Weight for {col}", value=1.0, step=0.1, key=f"weight_{col}")
        
        if st.button("Create Combined Variable", key="create_combined") and len(combine_cols) >= 2:
            try:
                subset = df[combine_cols].astype(float)
                
                if use_date_range and mapping["date_col"] in df.columns:
                    date_series = pd.to_datetime(df[mapping["date_col"]])
                    mask = (date_series >= pd.Timestamp(start_date)) & (date_series <= pd.Timestamp(end_date))
                else:
                    mask = pd.Series(True, index=df.index)
                
                if combine_method == "Sum":
                    df[combined_name] = 0.0
                    df.loc[mask, combined_name] = subset.loc[mask].sum(axis=1)
                elif combine_method == "Average":
                    df[combined_name] = 0.0
                    df.loc[mask, combined_name] = subset.loc[mask].mean(axis=1)
                elif combine_method == "Weighted Average":
                    w = np.array([weights.get(c, 1.0) for c in combine_cols])
                    w_sum = w.sum()
                    if w_sum == 0:
                        st.error("Weights sum to zero. Please set at least one non-zero weight.")
                        return
                    w = w / w_sum
                    df[combined_name] = 0.0
                    df.loc[mask, combined_name] = (subset.loc[mask] * w).sum(axis=1)
                elif combine_method == "Product":
                    df[combined_name] = 1.0
                    df.loc[mask, combined_name] = subset.loc[mask].prod(axis=1)
                elif combine_method == "Ratio (A/B)" and len(combine_cols) == 2:
                    df[combined_name] = 0.0
                    denom = subset.loc[mask, combine_cols[1]].replace(0, np.nan)
                    df.loc[mask, combined_name] = subset.loc[mask, combine_cols[0]] / denom
                
                st.session_state["mapped_data"] = df
                st.session_state["transformations_log"].append(
                    f"Combined {combine_cols} using {combine_method} → {combined_name}"
                )
                st.success(f"Created '{combined_name}'")
                st.dataframe(df[[mapping["date_col"], combined_name]].head(10), use_container_width=True)
                
            except Exception as e:
                st.error(f"Combination failed: {e}")
    
    # --- Tab 3: Ceilings & Floors ---
    with tab3:
        st.subheader("Ceilings & Floors")
        st.caption("Set bounds on variables to simulate constraints (e.g., max budget, minimum spend).")
        
        cap_col = st.selectbox("Select variable", feature_cols, key="cap_col")
        
        if cap_col:
            current_min = float(df[cap_col].min())
            current_max = float(df[cap_col].max())
            current_mean = float(df[cap_col].mean())
            
            st.write(f"Current range: **{current_min:,.2f}** to **{current_max:,.2f}** (mean: {current_mean:,.2f})")
            
            col1, col2 = st.columns(2)
            with col1:
                use_floor = st.checkbox("Set floor (minimum)", key="use_floor")
                if use_floor:
                    floor_val = st.number_input("Floor value", value=current_min, key="floor_val")
            
            with col2:
                use_ceiling = st.checkbox("Set ceiling (maximum)", key="use_ceiling")
                if use_ceiling:
                    ceiling_val = st.number_input("Ceiling value", value=current_max, key="ceiling_val")
            
            if st.button("Apply Bounds", key="apply_bounds"):
                original = df[cap_col].copy()
                if use_floor:
                    df[cap_col] = df[cap_col].clip(lower=floor_val)
                if use_ceiling:
                    df[cap_col] = df[cap_col].clip(upper=ceiling_val)
                
                changed = (original != df[cap_col]).sum()
                st.session_state["mapped_data"] = df
                st.session_state["transformations_log"].append(
                    f"Applied bounds to {cap_col}: floor={floor_val if use_floor else 'N/A'}, ceiling={ceiling_val if use_ceiling else 'N/A'}"
                )
                st.success(f"Bounds applied. {changed} values clipped.")
    
    # --- Tab 4: Feature Selection ---
    with tab4:
        st.subheader("Feature Selection")
        st.caption("Choose which variables to include in the model.")
        
        st.markdown("**Media Channels (currently selected):**")
        all_numeric = list(df.select_dtypes(include=[np.number]).columns)
        available_for_media = [c for c in all_numeric if c != mapping["target_col"]]
        
        updated_media = st.multiselect(
            "Media spend variables",
            available_for_media,
            default=mapping["media_cols"],
            key="updated_media"
        )
        
        remaining = [c for c in available_for_media if c not in updated_media]
        
        updated_organic = st.multiselect(
            "Organic variables",
            remaining,
            default=[c for c in mapping["organic_cols"] if c in remaining],
            key="updated_organic"
        )
        
        remaining2 = [c for c in remaining if c not in updated_organic]
        
        updated_context = st.multiselect(
            "Context/External variables",
            remaining2,
            default=[c for c in mapping["context_cols"] if c in remaining2],
            key="updated_context"
        )
        
        if st.button("Update Feature Selection", key="update_features"):
            st.session_state["variable_mapping"]["media_cols"] = updated_media
            st.session_state["variable_mapping"]["organic_cols"] = updated_organic
            st.session_state["variable_mapping"]["context_cols"] = updated_context
            st.success("Feature selection updated!")
    
    # --- Tab 5: Preview & Apply ---
    with tab5:
        st.subheader("Transformation Log & Preview")
        
        if st.session_state["transformations_log"]:
            st.markdown("**Applied transformations:**")
            for i, log_entry in enumerate(st.session_state["transformations_log"], 1):
                st.write(f"{i}. {log_entry}")
        else:
            st.info("No transformations applied yet.")
        
        st.markdown("---")
        st.subheader("Current Dataset Preview")
        st.dataframe(df.head(15), use_container_width=True)
        
        st.write(f"**Shape:** {df.shape[0]} rows × {df.shape[1]} columns")
        
        # Option to download transformed data
        csv = df.to_csv(index=False)
        st.download_button(
            label="📥 Download Transformed Data",
            data=csv,
            file_name="transformed_data.csv",
            mime="text/csv"
        )
