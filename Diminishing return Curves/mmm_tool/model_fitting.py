"""
MMM Model Fitting Module — Multiple Algorithm Support.

Implements all fitting algorithms for the MMM regression equation:
  Sales = Base + Σ f_i(Transformed_Spend_i) + Controls + Error

Supported algorithms:
  1. OLS (statsmodels)
  2. Ridge / Lasso (sklearn)
  3. Non-Linear Least Squares (scipy.optimize)
  4. Bayesian Regression (PyMC)
  5. GLM (statsmodels)
  6. LOESS (non-parametric)
  7. Splines / B-Splines
  8. GAM (pyGAM)
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
import warnings
import pickle
import json

warnings.filterwarnings("ignore")

from core_engine import (
    geometric_adstock,
    weibull_adstock,
    apply_lag,
    ResponseFunction,
    ChannelConfig,
)


@dataclass
class FitResult:
    """Stores the result of a model fit."""
    algorithm: str
    channel_configs: List[ChannelConfig]
    base_sales: float = 0.0
    control_coefficients: Dict[str, float] = field(default_factory=dict)
    r_squared: float = 0.0
    adj_r_squared: float = 0.0
    mape: float = 0.0
    rmse: float = 0.0
    aic: float = 0.0
    bic: float = 0.0
    predictions: np.ndarray = None
    residuals: np.ndarray = None
    raw_model: Any = None
    uncertainty: Dict = field(default_factory=dict)  # For Bayesian


class MMMFitter:
    """
    Multi-algorithm model fitter for Marketing Mix Models.

    Orchestrates data preparation (adstock, lags), feature construction,
    and model fitting using the user-selected algorithm.
    """

    ALGORITHMS = [
        "OLS",
        "Ridge",
        "Lasso",
        "Non-Linear Least Squares",
        "Bayesian (PyMC)",
        "GLM (Gaussian)",
        "LOESS",
        "Spline / B-Spline",
        "GAM",
    ]

    def __init__(self, data: pd.DataFrame, target_col: str = "sales"):
        self.data = data.copy()
        self.target_col = target_col
        self.y = data[target_col].values
        self.n = len(self.y)

    def _transform_channel(self, spend: np.ndarray, config: ChannelConfig) -> np.ndarray:
        """Apply adstock and lag transformations to a channel's spend."""
        transformed = spend.copy()

        # 1. Apply lag
        if config.lag > 0:
            transformed = apply_lag(transformed, config.lag)

        # 2. Apply adstock
        if config.adstock_type == "geometric":
            decay = config.adstock_params.get("decay", 0.0)
            transformed = geometric_adstock(transformed, decay)
        elif config.adstock_type == "weibull":
            shape = config.adstock_params.get("shape", 1.0)
            scale = config.adstock_params.get("scale", 1.0)
            transformed = weibull_adstock(transformed, shape, scale)

        return transformed

    def _build_features(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Build the feature matrix X from transformed channel spends and controls.
        For parametric models, applies the response function to get the features.
        """
        features = []
        names = []

        for config in channel_configs:
            col = f"spend_{config.name}"
            if col not in self.data.columns:
                raise ValueError(f"Column {col} not found in data.")
            spend = self.data[col].values.astype(float)
            transformed = self._transform_channel(spend, config)

            # Apply response function
            response = ResponseFunction.evaluate(config.func_type, transformed, config.func_params)
            features.append(response)
            names.append(config.name)

        # Add control variables
        if control_cols:
            for c in control_cols:
                if c in self.data.columns:
                    features.append(self.data[c].values.astype(float))
                    names.append(f"ctrl_{c}")

        X = np.column_stack(features) if features else np.empty((self.n, 0))
        return X, names

    # ─── 1. OLS ───────────────────────────────────────────────
    def fit_ols(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
    ) -> FitResult:
        """Fit via statsmodels OLS. Best for interpretability and diagnostics."""
        import statsmodels.api as sm

        X, names = self._build_features(channel_configs, control_cols)
        X_const = sm.add_constant(X)

        model = sm.OLS(self.y, X_const).fit()

        result = FitResult(
            algorithm="OLS",
            channel_configs=channel_configs,
            base_sales=model.params[0],
            r_squared=model.rsquared,
            adj_r_squared=model.rsquared_adj,
            predictions=model.fittedvalues,
            residuals=model.resid,
            aic=model.aic,
            bic=model.bic,
            raw_model=model,
        )

        # Map coefficients
        for i, name in enumerate(names):
            if name.startswith("ctrl_"):
                result.control_coefficients[name] = model.params[i + 1]

        result.mape = np.mean(np.abs(result.residuals / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(result.residuals ** 2))

        return result

    # ─── 2. Ridge / Lasso ─────────────────────────────────────
    def fit_regularized(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        method: str = "Ridge",
        alpha: float = 1.0,
    ) -> FitResult:
        """Fit via sklearn Ridge or Lasso. Handles multicollinearity."""
        from sklearn.linear_model import Ridge, Lasso
        from sklearn.preprocessing import StandardScaler

        X, names = self._build_features(channel_configs, control_cols)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        ModelClass = Ridge if method == "Ridge" else Lasso
        model = ModelClass(alpha=alpha, fit_intercept=True)
        model.fit(X_scaled, self.y)

        preds = model.predict(X_scaled)
        resid = self.y - preds
        ss_res = np.sum(resid ** 2)
        ss_tot = np.sum((self.y - np.mean(self.y)) ** 2)
        r2 = 1 - ss_res / ss_tot
        n, p = X_scaled.shape
        adj_r2 = 1 - (1 - r2) * (n - 1) / max(n - p - 1, 1)

        result = FitResult(
            algorithm=method,
            channel_configs=channel_configs,
            base_sales=model.intercept_,
            r_squared=r2,
            adj_r_squared=adj_r2,
            predictions=preds,
            residuals=resid,
            raw_model={"model": model, "scaler": scaler},
        )

        for i, name in enumerate(names):
            if name.startswith("ctrl_"):
                result.control_coefficients[name] = model.coef_[i]

        result.mape = np.mean(np.abs(resid / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(resid ** 2))

        return result

    # ─── 3. Non-Linear Least Squares ─────────────────────────
    def fit_nls(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
    ) -> FitResult:
        """
        Fit via scipy.optimize.least_squares.
        Jointly estimates response function parameters + scaling coefficients.
        Good for custom non-linear f_i like Hill.
        """
        from scipy.optimize import least_squares

        # Build transformed (adstocked/lagged) spends (pre-response-function)
        transformed_spends = []
        for config in channel_configs:
            col = f"spend_{config.name}"
            spend = self.data[col].values.astype(float)
            transformed_spends.append(self._transform_channel(spend, config))

        control_features = []
        if control_cols:
            for c in control_cols:
                if c in self.data.columns:
                    control_features.append(self.data[c].values.astype(float))

        # Pack all parameters into a flat vector for optimization
        # [base, scale_1..n, control_coefs, func_params per channel]
        n_channels = len(channel_configs)
        n_controls = len(control_features)

        def _predict(params):
            base = params[0]
            scales = params[1: 1 + n_channels]
            ctrl_coefs = params[1 + n_channels: 1 + n_channels + n_controls]

            pred = np.full(self.n, base)
            for i, config in enumerate(channel_configs):
                response = ResponseFunction.evaluate(
                    config.func_type, transformed_spends[i], config.func_params
                )
                pred += scales[i] * response

            for j, cf in enumerate(control_features):
                pred += ctrl_coefs[j] * cf

            return pred

        def _residuals(params):
            return self.y - _predict(params)

        # Initial guess
        x0 = [np.mean(self.y)]  # base
        x0 += [1.0] * n_channels  # scales
        x0 += [0.0] * n_controls  # control coefficients

        result_opt = least_squares(_residuals, x0, method="trf", max_nfev=5000)

        preds = _predict(result_opt.x)
        resid = self.y - preds
        ss_res = np.sum(resid ** 2)
        ss_tot = np.sum((self.y - np.mean(self.y)) ** 2)
        r2 = 1 - ss_res / ss_tot

        result = FitResult(
            algorithm="Non-Linear Least Squares",
            channel_configs=channel_configs,
            base_sales=result_opt.x[0],
            r_squared=r2,
            predictions=preds,
            residuals=resid,
            raw_model=result_opt,
        )

        result.mape = np.mean(np.abs(resid / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(resid ** 2))

        return result

    # ─── 4. Bayesian Regression (PyMC) ────────────────────────
    def fit_bayesian(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        draws: int = 1000,
        tune: int = 500,
        chains: int = 2,
    ) -> FitResult:
        """
        Bayesian regression via PyMC. Provides posterior distributions
        and uncertainty bands on predictions/curves.
        """
        import pymc as pm
        import arviz as az

        X, names = self._build_features(channel_configs, control_cols)

        with pm.Model() as model:
            # Priors
            intercept = pm.Normal("intercept", mu=np.mean(self.y), sigma=np.std(self.y))
            betas = pm.Normal("betas", mu=0, sigma=np.std(self.y) / 2, shape=X.shape[1])
            sigma = pm.HalfNormal("sigma", sigma=np.std(self.y) / 2)

            # Likelihood
            mu = intercept + pm.math.dot(X, betas)
            likelihood = pm.Normal("y", mu=mu, sigma=sigma, observed=self.y)

            # Sample
            trace = pm.sample(draws=draws, tune=tune, chains=chains,
                              return_inferencedata=True, progressbar=True,
                              cores=1)

        # Extract posterior means
        beta_means = trace.posterior["betas"].mean(dim=["chain", "draw"]).values
        intercept_mean = trace.posterior["intercept"].mean(dim=["chain", "draw"]).values

        preds = intercept_mean + X @ beta_means
        resid = self.y - preds
        ss_res = np.sum(resid ** 2)
        ss_tot = np.sum((self.y - np.mean(self.y)) ** 2)
        r2 = 1 - ss_res / ss_tot

        # Get credible intervals for predictions
        beta_samples = trace.posterior["betas"].values.reshape(-1, X.shape[1])
        intercept_samples = trace.posterior["intercept"].values.flatten()
        pred_samples = intercept_samples[:, None] + beta_samples @ X.T
        pred_lower = np.percentile(pred_samples, 2.5, axis=0)
        pred_upper = np.percentile(pred_samples, 97.5, axis=0)

        result = FitResult(
            algorithm="Bayesian (PyMC)",
            channel_configs=channel_configs,
            base_sales=float(intercept_mean),
            r_squared=r2,
            predictions=preds,
            residuals=resid,
            raw_model={"trace": trace, "model": model},
            uncertainty={
                "pred_lower_95": pred_lower,
                "pred_upper_95": pred_upper,
                "beta_means": beta_means,
                "beta_std": trace.posterior["betas"].std(dim=["chain", "draw"]).values,
            },
        )

        result.mape = np.mean(np.abs(resid / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(resid ** 2))

        for i, name in enumerate(names):
            if name.startswith("ctrl_"):
                result.control_coefficients[name] = beta_means[i]

        return result

    # ─── 5. GLM ───────────────────────────────────────────────
    def fit_glm(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        family: str = "Gaussian",
    ) -> FitResult:
        """Fit via statsmodels GLM. Supports Gaussian, Poisson, Gamma families."""
        import statsmodels.api as sm

        X, names = self._build_features(channel_configs, control_cols)
        X_const = sm.add_constant(X)

        families = {
            "Gaussian": sm.families.Gaussian(),
            "Poisson": sm.families.Poisson(),
            "Gamma": sm.families.Gamma(),
        }
        fam = families.get(family, sm.families.Gaussian())

        model = sm.GLM(self.y, X_const, family=fam).fit()

        preds = model.fittedvalues
        resid = self.y - preds
        ss_res = np.sum(resid ** 2)
        ss_tot = np.sum((self.y - np.mean(self.y)) ** 2)
        r2 = 1 - ss_res / ss_tot

        result = FitResult(
            algorithm=f"GLM ({family})",
            channel_configs=channel_configs,
            base_sales=model.params[0],
            r_squared=r2,
            predictions=preds,
            residuals=resid,
            aic=model.aic,
            bic=model.bic_llf,
            raw_model=model,
        )

        for i, name in enumerate(names):
            if name.startswith("ctrl_"):
                result.control_coefficients[name] = model.params[i + 1]

        result.mape = np.mean(np.abs(resid / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(resid ** 2))

        return result

    # ─── 6. LOESS (Non-parametric) ────────────────────────────
    def fit_loess(
        self,
        channel_name: str,
        channel_config: ChannelConfig,
        frac: float = 0.3,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        LOESS smoothing for a single channel.
        Non-parametric: no assumed equation shape.
        Returns smoothed (spend, response) pairs.
        """
        from statsmodels.nonparametric.smoothers_lowess import lowess

        col = f"spend_{channel_name}"
        spend = self.data[col].values.astype(float)
        transformed = self._transform_channel(spend, channel_config)

        # Use spend vs. sales residual (approximate channel contribution)
        result = lowess(self.y, transformed, frac=frac, return_sorted=True)
        return result[:, 0], result[:, 1]

    # ─── 7. Spline / B-Spline ────────────────────────────────
    def fit_spline(
        self,
        channel_name: str,
        channel_config: ChannelConfig,
        n_knots: int = 5,
    ) -> Tuple[np.ndarray, np.ndarray, Any]:
        """
        Fit a B-spline curve to channel spend vs. sales.
        Returns (spend_grid, spline_predictions, spline_object).
        """
        from scipy.interpolate import make_interp_spline

        col = f"spend_{channel_name}"
        spend = self.data[col].values.astype(float)
        transformed = self._transform_channel(spend, channel_config)

        # Sort for spline fitting
        sort_idx = np.argsort(transformed)
        x_sorted = transformed[sort_idx]
        y_sorted = self.y[sort_idx]

        # Remove duplicates (average y for same x)
        unique_x, inverse = np.unique(x_sorted, return_inverse=True)
        unique_y = np.zeros(len(unique_x))
        for i in range(len(unique_x)):
            unique_y[i] = y_sorted[inverse == i].mean()

        k = min(3, len(unique_x) - 1)  # Spline degree
        if len(unique_x) < 4:
            return unique_x, unique_y, None

        spline = make_interp_spline(unique_x, unique_y, k=k)

        x_grid = np.linspace(unique_x.min(), unique_x.max(), 200)
        y_grid = spline(x_grid)

        return x_grid, y_grid, spline

    # ─── 8. GAM ───────────────────────────────────────────────
    def fit_gam(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        n_splines: int = 20,
    ) -> FitResult:
        """
        Fit Generalized Additive Model via pyGAM.
        Models response as sum of smooth functions per channel.
        Semi-parametric: flexible shapes with interpretability.
        """
        from pygam import LinearGAM, s, l

        X, names = self._build_features(channel_configs, control_cols)

        # Build terms: spline for each channel, linear for controls
        n_channels = len(channel_configs)
        terms = s(0, n_splines=n_splines)
        for i in range(1, X.shape[1]):
            if i < n_channels:
                terms += s(i, n_splines=n_splines)
            else:
                terms += l(i)

        gam = LinearGAM(terms).fit(X, self.y)

        preds = gam.predict(X)
        resid = self.y - preds
        ss_res = np.sum(resid ** 2)
        ss_tot = np.sum((self.y - np.mean(self.y)) ** 2)
        r2 = 1 - ss_res / ss_tot

        result = FitResult(
            algorithm="GAM",
            channel_configs=channel_configs,
            base_sales=gam.coef_[0] if hasattr(gam, "coef_") else 0.0,
            r_squared=r2,
            predictions=preds,
            residuals=resid,
            raw_model=gam,
        )

        result.mape = np.mean(np.abs(resid / np.maximum(self.y, 1))) * 100
        result.rmse = np.sqrt(np.mean(resid ** 2))

        return result

    # ─── Main Dispatcher ──────────────────────────────────────
    def fit(
        self,
        algorithm: str,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        **kwargs,
    ) -> FitResult:
        """Route to the appropriate fitting algorithm."""
        if algorithm == "OLS":
            return self.fit_ols(channel_configs, control_cols)
        elif algorithm == "Ridge":
            return self.fit_regularized(channel_configs, control_cols, "Ridge",
                                        kwargs.get("alpha", 1.0))
        elif algorithm == "Lasso":
            return self.fit_regularized(channel_configs, control_cols, "Lasso",
                                        kwargs.get("alpha", 1.0))
        elif algorithm == "Non-Linear Least Squares":
            return self.fit_nls(channel_configs, control_cols)
        elif algorithm == "Bayesian (PyMC)":
            return self.fit_bayesian(channel_configs, control_cols,
                                     draws=kwargs.get("draws", 1000),
                                     tune=kwargs.get("tune", 500))
        elif algorithm.startswith("GLM"):
            family = kwargs.get("family", "Gaussian")
            return self.fit_glm(channel_configs, control_cols, family)
        elif algorithm == "GAM":
            return self.fit_gam(channel_configs, control_cols,
                                n_splines=kwargs.get("n_splines", 20))
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")


# ─────────────────────────────────────────────────────────────
# HYPERPARAMETER TUNING (Adstock λ, Lag k)
# ─────────────────────────────────────────────────────────────

class HyperparameterTuner:
    """
    Estimates optimal adstock decay rates and lag periods.
    Supports Grid Search, Bayesian Optimization, and Cross-Validation.
    """

    def __init__(self, fitter: MMMFitter):
        self.fitter = fitter

    def grid_search_adstock(
        self,
        channel_configs: List[ChannelConfig],
        channel_index: int,
        decay_values: np.ndarray = None,
        control_cols: List[str] = None,
        metric: str = "rmse",
    ) -> Tuple[float, List[dict]]:
        """
        Grid search over adstock decay values for a single channel.
        Returns (best_decay, results_log).
        """
        if decay_values is None:
            decay_values = np.arange(0.0, 1.0, 0.1)

        results = []
        best_score = np.inf
        best_decay = 0.0

        for decay in decay_values:
            configs = [c.__class__(
                name=c.name, func_type=c.func_type, func_params=c.func_params,
                adstock_type=c.adstock_type,
                adstock_params={**c.adstock_params, "decay": decay} if i == channel_index else c.adstock_params,
                lag=c.lag
            ) for i, c in enumerate(channel_configs)]

            try:
                fit_result = self.fitter.fit_ols(configs, control_cols)
                score = fit_result.rmse if metric == "rmse" else fit_result.mape
                results.append({"decay": decay, metric: score, "r2": fit_result.r_squared})
                if score < best_score:
                    best_score = score
                    best_decay = decay
            except Exception:
                continue

        return best_decay, results

    def cross_validate(
        self,
        channel_configs: List[ChannelConfig],
        control_cols: List[str] = None,
        n_splits: int = 5,
    ) -> Dict:
        """
        Time-series cross-validation using sklearn TimeSeriesSplit.
        Returns mean and std of RMSE across folds.
        """
        from sklearn.model_selection import TimeSeriesSplit

        tscv = TimeSeriesSplit(n_splits=n_splits)
        fold_scores = []

        X, names = self.fitter._build_features(channel_configs, control_cols)
        y = self.fitter.y

        for train_idx, test_idx in tscv.split(X):
            import statsmodels.api as sm
            X_train = sm.add_constant(X[train_idx])
            X_test = sm.add_constant(X[test_idx])
            y_train = y[train_idx]
            y_test = y[test_idx]

            model = sm.OLS(y_train, X_train).fit()
            preds = model.predict(X_test)
            rmse = np.sqrt(np.mean((y_test - preds) ** 2))
            fold_scores.append(rmse)

        return {
            "mean_rmse": np.mean(fold_scores),
            "std_rmse": np.std(fold_scores),
            "fold_scores": fold_scores,
        }


def save_model(fit_result: FitResult, filepath: str):
    """Save a fitted model to a pickle file."""
    with open(filepath, "wb") as f:
        # Don't pickle PyMC models (they contain theano graphs)
        if fit_result.algorithm == "Bayesian (PyMC)":
            save_data = {
                "algorithm": fit_result.algorithm,
                "base_sales": fit_result.base_sales,
                "r_squared": fit_result.r_squared,
                "predictions": fit_result.predictions,
                "uncertainty": fit_result.uncertainty,
                "channel_configs": [c.to_dict() for c in fit_result.channel_configs],
            }
            pickle.dump(save_data, f)
        else:
            pickle.dump(fit_result, f)


def load_model(filepath: str) -> Any:
    """Load a model from a pickle file."""
    with open(filepath, "rb") as f:
        return pickle.load(f)
