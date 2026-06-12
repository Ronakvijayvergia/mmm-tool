"""
Core Marketing Mix Model.
Implements the full MMM pipeline: adstock -> saturation -> regression.
Based on Meta Robyn methodology, implemented in Python.
"""
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, ElasticNet
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import r2_score, mean_absolute_error, mean_absolute_percentage_error, mean_squared_error
from typing import Dict, List, Optional, Tuple, Any
import warnings
import json
from datetime import datetime

from .adstock import apply_adstock, get_adstock_weights
from .saturation import apply_saturation, hill_function


class MMMConfig:
    """Configuration for MMM model parameters."""
    
    def __init__(self):
        self.date_col: str = "date"
        self.target_col: str = "revenue"
        self.media_cols: List[str] = []
        self.organic_cols: List[str] = []
        self.context_cols: List[str] = []
        self.prophet_vars: List[str] = ["trend", "season", "holiday"]
        
        # Adstock settings per channel
        self.adstock_method: str = "geometric"  # geometric, weibull_cdf, weibull_pdf
        self.adstock_params: Dict[str, Dict] = {}
        
        # Saturation settings per channel
        self.saturation_method: str = "hill"
        self.saturation_params: Dict[str, Dict] = {}
        
        # Model settings
        self.model_type: str = "ridge"  # ridge, elasticnet
        self.alpha: float = 1.0  # Regularization strength
        self.l1_ratio: float = 0.5  # For ElasticNet
        self.positive_coefficients: bool = True
        
        # Train/test
        self.test_size: float = 0.2
        self.time_based_split: bool = True
        
        # Calibration
        self.calibration_data: Optional[Dict] = None
    
    def set_default_hyperparams(self, media_cols: List[str]):
        """Set default hyperparameters for all media channels."""
        for col in media_cols:
            if col not in self.adstock_params:
                self.adstock_params[col] = {"theta": 0.5, "l_max": 8}
            if col not in self.saturation_params:
                self.saturation_params[col] = {"alpha": 2.0, "gamma": 0.5}


class MMMResult:
    """Container for MMM results."""
    
    def __init__(self):
        self.model = None
        self.scaler = None
        self.coefficients: Dict[str, float] = {}
        self.intercept: float = 0.0
        self.feature_names: List[str] = []
        
        # Performance metrics
        self.train_r2: float = 0.0
        self.test_r2: float = 0.0
        self.train_mape: float = 0.0
        self.test_mape: float = 0.0
        self.train_rmse: float = 0.0
        self.test_rmse: float = 0.0
        self.train_mae: float = 0.0
        self.test_mae: float = 0.0
        self.nrmse: float = 0.0
        
        # Decomposition
        self.contribution_pct: Dict[str, float] = {}
        self.contribution_abs: Dict[str, float] = {}
        
        # Data
        self.y_train: np.ndarray = np.array([])
        self.y_test: np.ndarray = np.array([])
        self.y_train_pred: np.ndarray = np.array([])
        self.y_test_pred: np.ndarray = np.array([])
        self.dates_train: np.ndarray = np.array([])
        self.dates_test: np.ndarray = np.array([])
        
        # Transformed features
        self.X_train_transformed: pd.DataFrame = pd.DataFrame()
        self.X_test_transformed: pd.DataFrame = pd.DataFrame()
        
        # Response curves data
        self.response_curves: Dict[str, Dict] = {}
        
        # Config used
        self.config: Optional[MMMConfig] = None
        self.training_date: str = datetime.now().isoformat()
    
    def summary(self) -> Dict:
        """Return summary dict of results."""
        return {
            "train_r2": round(self.train_r2, 4),
            "test_r2": round(self.test_r2, 4),
            "train_mape": round(self.train_mape, 4),
            "test_mape": round(self.test_mape, 4),
            "train_rmse": round(self.train_rmse, 4),
            "test_rmse": round(self.test_rmse, 4),
            "nrmse": round(self.nrmse, 4),
            "coefficients": {k: round(v, 6) for k, v in self.coefficients.items()},
            "contribution_pct": {k: round(v, 2) for k, v in self.contribution_pct.items()},
        }


class MarketingMixModel:
    """
    Full Marketing Mix Model pipeline.
    
    Workflow:
    1. Apply adstock transformations to media variables
    2. Apply saturation transformations  
    3. Fit regularized regression
    4. Decompose contributions
    5. Generate response curves
    """
    
    def __init__(self, config: MMMConfig):
        self.config = config
        self.result = MMMResult()
        self._fitted = False
    
    def _apply_transformations(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply adstock and saturation transformations to media columns."""
        df_transformed = df.copy()
        
        for col in self.config.media_cols:
            if col not in df_transformed.columns:
                continue
                
            x = df_transformed[col].values.astype(float)
            
            # Step 1: Adstock
            adstock_params = self.config.adstock_params.get(col, {"theta": 0.5, "l_max": 8})
            x_adstocked = apply_adstock(x, method=self.config.adstock_method, **adstock_params)
            
            # Step 2: Saturation
            sat_params = self.config.saturation_params.get(col, {"alpha": 2.0, "gamma": 0.5})
            x_saturated = apply_saturation(x_adstocked, method=self.config.saturation_method, **sat_params)
            
            df_transformed[col] = x_saturated
        
        return df_transformed
    
    def _prepare_features(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
        """Prepare feature matrix and target."""
        feature_cols = self.config.media_cols + self.config.organic_cols + self.config.context_cols
        feature_cols = [c for c in feature_cols if c in df.columns]
        
        X = df[feature_cols].copy()
        y = df[self.config.target_col].copy()
        
        # Handle missing values
        X = X.fillna(0)
        n_missing = y.isna().sum()
        if n_missing > 0:
            warnings.warn(f"Target column has {n_missing} missing values — dropping those rows.")
            valid_mask = y.notna()
            X = X.loc[valid_mask]
            y = y.loc[valid_mask]
        
        return X, y
    
    def _split_data(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Split data into train and test sets."""
        n = len(df)
        
        if self.config.time_based_split:
            split_idx = int(n * (1 - self.config.test_size))
            train_df = df.iloc[:split_idx].copy()
            test_df = df.iloc[split_idx:].copy()
        else:
            from sklearn.model_selection import train_test_split
            train_df, test_df = train_test_split(df, test_size=self.config.test_size, random_state=42)
        
        return train_df, test_df
    
    def fit(self, df: pd.DataFrame) -> MMMResult:
        """
        Fit the Marketing Mix Model.
        
        Args:
            df: DataFrame with date, target, and feature columns
        Returns:
            MMMResult object with all outputs
        """
        # Store config
        self.result.config = self.config
        
        # Apply transformations
        df_transformed = self._apply_transformations(df)
        
        # Split data
        train_df, test_df = self._split_data(df_transformed)
        
        # Prepare features
        X_train, y_train = self._prepare_features(train_df)
        X_test, y_test = self._prepare_features(test_df)
        
        self.result.feature_names = list(X_train.columns)
        
        # Scale features
        self.result.scaler = StandardScaler()
        X_train_scaled = pd.DataFrame(
            self.result.scaler.fit_transform(X_train),
            columns=X_train.columns,
            index=X_train.index
        )
        X_test_scaled = pd.DataFrame(
            self.result.scaler.transform(X_test),
            columns=X_test.columns,
            index=X_test.index
        )
        
        self.result.X_train_transformed = X_train_scaled
        self.result.X_test_transformed = X_test_scaled
        
        # Fit model
        if self.config.model_type == "ridge":
            model = Ridge(
                alpha=self.config.alpha,
                positive=self.config.positive_coefficients,
                fit_intercept=True
            )
        else:
            model = ElasticNet(
                alpha=self.config.alpha,
                l1_ratio=self.config.l1_ratio,
                positive=self.config.positive_coefficients,
                fit_intercept=True,
                max_iter=10000
            )
        
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model.fit(X_train_scaled, y_train)
        
        self.result.model = model
        self.result.intercept = float(model.intercept_)
        self.result.coefficients = dict(zip(X_train.columns, model.coef_))
        
        # Predictions
        y_train_pred = model.predict(X_train_scaled)
        y_test_pred = model.predict(X_test_scaled)
        
        self.result.y_train = y_train.values
        self.result.y_test = y_test.values
        self.result.y_train_pred = y_train_pred
        self.result.y_test_pred = y_test_pred
        
        # Dates
        if self.config.date_col in train_df.columns:
            self.result.dates_train = train_df[self.config.date_col].values
            self.result.dates_test = test_df[self.config.date_col].values
        
        # Metrics
        self.result.train_r2 = r2_score(y_train, y_train_pred)
        self.result.test_r2 = r2_score(y_test, y_test_pred)
        
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.result.train_mape = mean_absolute_percentage_error(y_train, y_train_pred)
            self.result.test_mape = mean_absolute_percentage_error(y_test, y_test_pred)
        
        self.result.train_rmse = np.sqrt(mean_squared_error(y_train, y_train_pred))
        self.result.test_rmse = np.sqrt(mean_squared_error(y_test, y_test_pred))
        self.result.train_mae = mean_absolute_error(y_train, y_train_pred)
        self.result.test_mae = mean_absolute_error(y_test, y_test_pred)
        
        y_range = y_train.max() - y_train.min()
        self.result.nrmse = self.result.train_rmse / y_range if y_range > 0 else 0
        
        # Decomposition
        self._compute_decomposition(X_train_scaled, y_train)
        
        # Response curves
        self._compute_response_curves(df)
        
        self._fitted = True
        return self.result
    
    def _compute_decomposition(self, X_scaled: pd.DataFrame, y: pd.Series):
        """Compute channel contribution decomposition."""
        model = self.result.model
        
        # Absolute contribution = coefficient * mean(feature)
        total_predicted = model.predict(X_scaled).mean()
        base = model.intercept_
        
        contributions = {}
        for col in X_scaled.columns:
            contrib = model.coef_[list(X_scaled.columns).index(col)] * X_scaled[col].mean()
            contributions[col] = float(contrib)
        
        # Add base/intercept
        contributions["base"] = float(base)
        
        self.result.contribution_abs = contributions
        
        # Percentage contribution — use actual values relative to total predicted
        total_predicted = sum(contributions.values())
        if total_predicted != 0:
            self.result.contribution_pct = {
                k: v / total_predicted * 100 for k, v in contributions.items()
            }
        else:
            self.result.contribution_pct = {k: 0 for k in contributions}
    
    def _compute_response_curves(self, df: pd.DataFrame):
        """Compute response curves for each media channel."""
        for col in self.config.media_cols:
            if col not in df.columns:
                continue

            x_raw = df[col].values.astype(float)
            x_range = np.linspace(0, x_raw.max() * 1.5, 200)

            adstock_params = self.config.adstock_params.get(col, {"theta": 0.5, "l_max": 8})
            sat_params = self.config.saturation_params.get(col, {"alpha": 2.0, "gamma": 0.5})

            # Apply adstock then saturation (matching training pipeline)
            x_adstocked = apply_adstock(x_range, method=self.config.adstock_method, **adstock_params)
            x_saturated = apply_saturation(x_adstocked, method=self.config.saturation_method, **sat_params)

            # Scale by coefficient (use the coefficient directly on the saturated value,
            # not the scaler transform — the scaler was for the regression, so we compute
            # contribution as coef * saturated_value to show the shape of diminishing returns)
            coef_idx = self.result.feature_names.index(col) if col in self.result.feature_names else None
            if coef_idx is not None:
                coef = self.result.model.coef_[coef_idx]
                response = coef * x_saturated
            else:
                response = x_saturated

            self.result.response_curves[col] = {
                "spend": x_range.tolist(),
                "response": response.tolist(),
                "current_spend": float(x_raw.mean()),
                "max_spend": float(x_raw.max()),
            }
    
    def predict(self, df: pd.DataFrame) -> np.ndarray:
        """Generate predictions for new data."""
        if not self._fitted:
            raise ValueError("Model must be fitted before prediction")
        
        df_transformed = self._apply_transformations(df)
        X, _ = self._prepare_features(df_transformed)
        X_scaled = self.result.scaler.transform(X)
        
        return self.result.model.predict(X_scaled)
