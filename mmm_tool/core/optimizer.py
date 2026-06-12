"""
Budget Optimizer for Marketing Mix Models.
Implements constrained optimization to allocate budget across channels
based on marginal returns (equimarginal principle).
"""
import numpy as np
import pandas as pd
from scipy.optimize import minimize, differential_evolution
from typing import Dict, List, Optional, Tuple
from .saturation import apply_saturation, hill_function
from .adstock import apply_adstock


class BudgetConstraint:
    """Defines constraints for budget optimization."""
    
    def __init__(self):
        self.total_budget: float = 0.0
        self.channel_min: Dict[str, float] = {}
        self.channel_max: Dict[str, float] = {}
        self.channel_names: List[str] = []
    
    def set_bounds(self, channel: str, min_spend: float = 0, max_spend: float = np.inf):
        """Set min/max bounds for a channel."""
        self.channel_min[channel] = min_spend
        self.channel_max[channel] = max_spend


class OptimizationResult:
    """Container for optimization results."""
    
    def __init__(self):
        self.optimal_allocation: Dict[str, float] = {}
        self.current_allocation: Dict[str, float] = {}
        self.predicted_response_optimal: float = 0.0
        self.predicted_response_current: float = 0.0
        self.improvement_pct: float = 0.0
        self.marginal_roi: Dict[str, float] = {}
        self.channel_details: List[Dict] = []


class BudgetOptimizer:
    """
    Optimize budget allocation across marketing channels.
    Uses the equimarginal principle: reallocate until marginal returns equalize.
    """
    
    def __init__(self, mmm_result, config):
        self.result = mmm_result
        self.config = config
        self.model = mmm_result.model
        self.scaler = mmm_result.scaler
    
    def _channel_response(self, spend: float, channel: str) -> float:
        """Calculate predicted response for a given spend level on a channel.

        Uses a reference range (0 to max_spend*1.5) for normalization so that
        saturation functions produce correct relative values for any single spend level.
        """
        adstock_params = self.config.adstock_params.get(channel, {"theta": 0.5, "l_max": 8})
        sat_params = self.config.saturation_params.get(channel, {"alpha": 2.0, "gamma": 0.5})

        if channel not in self.result.feature_names:
            return 0.0

        idx = self.result.feature_names.index(channel)
        coef = self.model.coef_[idx]

        # Build a reference range that includes the query point for proper normalization
        max_spend = self.result.response_curves.get(channel, {}).get("max_spend", spend * 2)
        ref_max = max(max_spend * 1.5, spend * 1.1, 1.0)
        # Create a range from 0 to ref_max with the query point included
        x_range = np.linspace(0, ref_max, 200)
        x_range = np.append(x_range, spend)
        x_range = np.sort(x_range)

        x_adstocked = apply_adstock(x_range, method=self.config.adstock_method, **adstock_params)
        x_saturated = apply_saturation(x_adstocked, method=self.config.saturation_method, **sat_params)

        # Find the response at the query spend level
        query_idx = np.searchsorted(x_range, spend)
        response_val = coef * x_saturated[query_idx]
        return float(response_val)
    
    def _total_response(self, allocations: np.ndarray, channels: List[str]) -> float:
        """Calculate total predicted response for a budget allocation."""
        total = 0.0
        for i, channel in enumerate(channels):
            total += self._channel_response(allocations[i], channel)
        return total
    
    def _objective(self, allocations: np.ndarray, channels: List[str]) -> float:
        """Negative total response (for minimization)."""
        return -self._total_response(allocations, channels)
    
    def optimize(
        self,
        total_budget: float,
        current_allocation: Dict[str, float],
        constraints: Optional[BudgetConstraint] = None,
        method: str = "SLSQP"
    ) -> OptimizationResult:
        """
        Find optimal budget allocation across channels.
        
        Args:
            total_budget: Total budget to allocate
            current_allocation: Current spend per channel
            constraints: Optional budget constraints
            method: Optimization method
        Returns:
            OptimizationResult with optimal allocation
        """
        channels = list(current_allocation.keys())
        n_channels = len(channels)
        
        # Initial allocation (current or equal split)
        x0 = np.array([current_allocation.get(ch, total_budget / n_channels) for ch in channels])
        
        # Bounds
        bounds = []
        for ch in channels:
            min_val = constraints.channel_min.get(ch, 0) if constraints else 0
            max_val = constraints.channel_max.get(ch, total_budget) if constraints else total_budget
            bounds.append((min_val, max_val))
        
        # Budget constraint: sum of allocations = total_budget
        budget_constraint = {
            "type": "eq",
            "fun": lambda x: np.sum(x) - total_budget
        }
        
        # Optimize
        try:
            result = minimize(
                self._objective,
                x0,
                args=(channels,),
                method=method,
                bounds=bounds,
                constraints=[budget_constraint],
                options={"maxiter": 1000, "ftol": 1e-10}
            )
            optimal = result.x
        except Exception:
            # Fallback to differential evolution
            try:
                result = differential_evolution(
                    self._objective,
                    bounds=bounds,
                    args=(channels,),
                    constraints=[{"type": "eq", "fun": lambda x: np.sum(x) - total_budget}],
                    maxiter=500,
                    seed=42
                )
                optimal = result.x
            except Exception:
                optimal = x0
        
        # Build result
        opt_result = OptimizationResult()
        opt_result.current_allocation = current_allocation
        opt_result.optimal_allocation = dict(zip(channels, optimal))
        
        opt_result.predicted_response_current = self._total_response(
            np.array([current_allocation[ch] for ch in channels]), channels
        )
        opt_result.predicted_response_optimal = self._total_response(optimal, channels)
        
        if opt_result.predicted_response_current > 0:
            opt_result.improvement_pct = (
                (opt_result.predicted_response_optimal - opt_result.predicted_response_current)
                / opt_result.predicted_response_current * 100
            )
        
        # Marginal ROI at optimal point
        delta = 100  # $100 increment
        for i, ch in enumerate(channels):
            current_resp = self._channel_response(optimal[i], ch)
            marginal_resp = self._channel_response(optimal[i] + delta, ch)
            opt_result.marginal_roi[ch] = (marginal_resp - current_resp) / delta if delta > 0 else 0
        
        # Channel details
        for ch in channels:
            opt_result.channel_details.append({
                "channel": ch,
                "current_spend": current_allocation.get(ch, 0),
                "optimal_spend": opt_result.optimal_allocation[ch],
                "change": opt_result.optimal_allocation[ch] - current_allocation.get(ch, 0),
                "change_pct": (
                    (opt_result.optimal_allocation[ch] - current_allocation.get(ch, 0))
                    / current_allocation[ch] * 100
                    if current_allocation.get(ch, 0) > 0 else 0
                ),
                "marginal_roi": opt_result.marginal_roi.get(ch, 0),
            })
        
        return opt_result
    
    def simulate_scenario(
        self,
        allocation: Dict[str, float]
    ) -> Dict[str, float]:
        """
        Simulate a specific budget allocation scenario.
        
        Args:
            allocation: Spend per channel
        Returns:
            Dict with predicted responses per channel and total
        """
        responses = {}
        total = 0.0
        for ch, spend in allocation.items():
            resp = self._channel_response(spend, ch)
            responses[ch] = resp
            total += resp
        
        responses["total"] = total
        responses["base"] = float(self.model.intercept_)
        responses["total_with_base"] = total + float(self.model.intercept_)
        
        return responses
