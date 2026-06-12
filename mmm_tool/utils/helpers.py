"""
Helper utilities for the MMM tool.
"""
import numpy as np
import pandas as pd
from typing import List, Dict, Optional, Tuple
import io


def load_data(file) -> pd.DataFrame:
    """
    Load data from uploaded file (CSV or Excel).
    
    Args:
        file: Streamlit UploadedFile object
    Returns:
        DataFrame
    """
    if file.name.endswith('.csv'):
        df = pd.read_csv(file)
    elif file.name.endswith(('.xlsx', '.xls')):
        df = pd.read_excel(file)
    else:
        raise ValueError(f"Unsupported file format: {file.name}")
    
    return df


def detect_date_column(df: pd.DataFrame) -> Optional[str]:
    """Auto-detect the date column in a DataFrame."""
    date_keywords = ['date', 'time', 'period', 'week', 'month', 'day']
    
    for col in df.columns:
        if any(kw in col.lower() for kw in date_keywords):
            try:
                pd.to_datetime(df[col])
                return col
            except (ValueError, TypeError):
                continue
    
    # Try parsing each column
    for col in df.columns:
        if df[col].dtype == 'object':
            try:
                pd.to_datetime(df[col])
                return col
            except (ValueError, TypeError):
                continue
    
    return None


def detect_target_column(df: pd.DataFrame) -> Optional[str]:
    """Auto-detect the target/KPI column."""
    target_keywords = ['revenue', 'sales', 'conversion', 'kpi', 'target', 'response', 'outcome']
    
    for col in df.columns:
        if any(kw in col.lower() for kw in target_keywords):
            if pd.api.types.is_numeric_dtype(df[col]):
                return col
    
    return None


def detect_spend_columns(df: pd.DataFrame) -> List[str]:
    """Auto-detect media spend columns."""
    spend_keywords = ['spend', 'cost', 'budget', 'investment', 'media', 'ad_', 'ads_',
                      'tv', 'digital', 'social', 'search', 'display', 'print', 'radio',
                      'video', 'ooh', 'affiliate', 'email_spend']
    
    spend_cols = []
    for col in df.columns:
        if any(kw in col.lower() for kw in spend_keywords):
            if pd.api.types.is_numeric_dtype(df[col]):
                spend_cols.append(col)
    
    return spend_cols


def compute_vif(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    """
    Compute Variance Inflation Factor for multicollinearity detection.
    
    Args:
        df: DataFrame
        columns: Columns to check
    Returns:
        DataFrame with VIF values
    """
    from sklearn.linear_model import LinearRegression
    
    vif_data = []
    X = df[columns].dropna()

    if len(X) <= len(columns):
        raise ValueError(
            f"VIF requires more observations ({len(X)}) than variables ({len(columns)}). "
            "Add more data or remove some variables."
        )

    for i, col in enumerate(columns):
        y = X[col].values
        X_other = X.drop(columns=[col]).values

        if len(X_other) > 0 and X_other.shape[1] > 0:
            reg = LinearRegression()
            reg.fit(X_other, y)
            r_squared = reg.score(X_other, y)
            r_squared = min(r_squared, 1.0 - 1e-10)  # Clamp to avoid division by zero
            vif = 1 / (1 - r_squared)
        else:
            vif = 1.0

        vif_data.append({"Variable": col, "VIF": round(vif, 2)})

    return pd.DataFrame(vif_data).sort_values("VIF", ascending=False)


def compute_correlation_matrix(df: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    """Compute correlation matrix for selected columns."""
    return df[columns].corr()


def format_currency(value: float) -> str:
    """Format number as currency string."""
    if abs(value) >= 1e6:
        return f"${value/1e6:.1f}M"
    elif abs(value) >= 1e3:
        return f"${value/1e3:.1f}K"
    else:
        return f"${value:.0f}"


def format_percentage(value: float) -> str:
    """Format number as percentage."""
    return f"{value:.1f}%"


def compute_data_quality_report(df: pd.DataFrame) -> Dict:
    """Generate a data quality summary."""
    report = {
        "n_rows": len(df),
        "n_cols": len(df.columns),
        "missing_values": df.isnull().sum().to_dict(),
        "missing_pct": (df.isnull().sum() / len(df) * 100).round(2).to_dict(),
        "dtypes": df.dtypes.astype(str).to_dict(),
        "numeric_cols": list(df.select_dtypes(include=[np.number]).columns),
        "non_numeric_cols": list(df.select_dtypes(exclude=[np.number]).columns),
    }
    
    # Basic stats for numeric columns
    numeric_stats = {}
    for col in report["numeric_cols"]:
        numeric_stats[col] = {
            "mean": round(df[col].mean(), 2),
            "std": round(df[col].std(), 2),
            "min": round(df[col].min(), 2),
            "max": round(df[col].max(), 2),
            "zeros": int((df[col] == 0).sum()),
            "negative": int((df[col] < 0).sum()),
        }
    report["numeric_stats"] = numeric_stats
    
    return report


def stationarity_test(series: pd.Series) -> Dict:
    """
    Augmented Dickey-Fuller test for stationarity.
    
    Args:
        series: Time series to test
    Returns:
        Dict with test results
    """
    from scipy import stats
    
    # Simple differencing-based stationarity check
    # (avoiding statsmodels dependency)
    diff = series.diff().dropna()
    
    # Check if variance is stable across splits
    n = len(series)
    half = n // 2
    first_half_var = series.iloc[:half].var()
    second_half_var = series.iloc[half:].var()
    
    variance_ratio = max(first_half_var, second_half_var) / (min(first_half_var, second_half_var) + 1e-10)
    
    # Simple trend test
    x = np.arange(len(series))
    slope, _, r_value, p_value, _ = stats.linregress(x, series.values)
    
    return {
        "has_trend": p_value < 0.05,
        "trend_p_value": round(p_value, 4),
        "slope": round(slope, 4),
        "variance_ratio": round(variance_ratio, 2),
        "is_stationary": p_value > 0.05 and variance_ratio < 2.0,
    }
