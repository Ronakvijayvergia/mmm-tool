"""
MMM Budget Optimization Module.

Given fitted response curves per channel, allocates a total budget
across channels to maximize total predicted response (sales).

Supported optimization algorithms:
  1. Gradient-Based (L-BFGS-B via scipy)
  2. Differential Evolution (global search via scipy)
  3. Linear Programming (piecewise-linear approximation via PuLP)
  4. Genetic Algorithm (DEAP)
  5. Grid Search / Exhaustive (for small problems)
"""

import numpy as np
from typing import Dict, List, Tuple, Optional, Callable
from dataclasses import dataclass, field
import warnings

warnings.filterwarnings("ignore")

from core_engine import (
    ResponseFunction,
    simulate_steady_state,
    generate_response_curve,
    ChannelConfig,
)


@dataclass
class OptimizationResult:
    """Stores budget optimization results."""
    algorithm: str
    total_budget: float
    channel_allocations: Dict[str, float]
    channel_responses: Dict[str, float]
    total_response: float
    channel_marginal_roi: Dict[str, float]
    convergence_info: Dict = field(default_factory=dict)


class BudgetOptimizer:
    """
    Multi-algorithm budget optimizer for MMM.

    Takes channel configurations (with fitted parameters) and
    finds the budget allocation that maximizes total response.
    """

    ALGORITHMS = [
        "L-BFGS-B (Gradient)",
        "Differential Evolution",
        "Linear Programming",
        "Genetic Algorithm (DEAP)",
        "Grid Search",
    ]

    def __init__(
        self,
        channel_configs: List[ChannelConfig],
        min_spends: Dict[str, float] = None,
        max_spends: Dict[str, float] = None,
    ):
        """
        Args:
            channel_configs: Fitted channel configurations with response params.
            min_spends: Minimum spend per channel (constraints).
            max_spends: Maximum spend per channel (constraints).
        """
        self.channel_configs = channel_configs
        self.n_channels = len(channel_configs)
        self.channel_names = [c.name for c in channel_configs]
        self.min_spends = min_spends or {c.name: 0.0 for c in channel_configs}
        self.max_spends = max_spends or {c.name: np.inf for c in channel_configs}

    def _channel_response(self, spend_level: float, config: ChannelConfig) -> float:
        """Compute response for a single channel at a given spend level."""
        # Get steady-state transformed spend
        transformed = simulate_steady_state(
            spend_level,
            adstock_type=config.adstock_type,
            adstock_params=config.adstock_params,
            lag=config.lag,
        )
        response = ResponseFunction.evaluate(
            config.func_type, np.array([transformed]), config.func_params
        )
        return float(response[0])

    def _total_response(self, spends: np.ndarray) -> float:
        """Sum of responses across all channels."""
        total = 0.0
        for i, config in enumerate(self.channel_configs):
            total += self._channel_response(spends[i], config)
        return total

    def _negative_total_response(self, spends: np.ndarray) -> float:
        """Negative total response (for minimization-based optimizers)."""
        return -self._total_response(spends)

    def _get_bounds(self, total_budget: float) -> List[Tuple[float, float]]:
        """Get (min, max) bounds for each channel spend."""
        bounds = []
        for config in self.channel_configs:
            lo = self.min_spends.get(config.name, 0.0)
            hi = min(self.max_spends.get(config.name, total_budget), total_budget)
            bounds.append((lo, hi))
        return bounds

    # ─── 1. Gradient-Based (L-BFGS-B) ────────────────────────
    def optimize_lbfgsb(self, total_budget: float) -> OptimizationResult:
        """
        Gradient-based optimization via scipy L-BFGS-B.
        Uses budget equality constraint via SLSQP fallback.
        Efficient for smooth, differentiable response curves.
        """
        from scipy.optimize import minimize

        bounds = self._get_bounds(total_budget)
        x0 = np.full(self.n_channels, total_budget / self.n_channels)

        # Budget constraint: sum(spends) = total_budget
        constraints = [{"type": "eq", "fun": lambda x: np.sum(x) - total_budget}]

        result = minimize(
            self._negative_total_response,
            x0,
            method="SLSQP",  # Supports equality constraints
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000, "ftol": 1e-10},
        )

        return self._build_result(
            "L-BFGS-B (Gradient)", total_budget, result.x,
            {"success": result.success, "message": result.message, "nit": result.nit}
        )

    # ─── 2. Differential Evolution ───────────────────────────
    def optimize_de(self, total_budget: float, maxiter: int = 200) -> OptimizationResult:
        """
        Global search via scipy differential_evolution.
        Good for non-convex problems with interactions.
        """
        from scipy.optimize import differential_evolution

        bounds = self._get_bounds(total_budget)

        # Penalize constraint violation
        def objective(x):
            penalty = 1e6 * (np.sum(x) - total_budget) ** 2
            return self._negative_total_response(x) + penalty

        result = differential_evolution(
            objective,
            bounds=bounds,
            maxiter=maxiter,
            seed=42,
            tol=1e-8,
            polish=True,
        )

        # Rescale to exactly meet budget
        alloc = result.x * (total_budget / np.sum(result.x))

        return self._build_result(
            "Differential Evolution", total_budget, alloc,
            {"success": result.success, "message": result.message, "nit": result.nit}
        )

    # ─── 3. Linear Programming (piecewise-linear) ────────────
    def optimize_lp(self, total_budget: float, n_segments: int = 20) -> OptimizationResult:
        """
        LP approximation: discretize each channel's response curve
        into piecewise-linear segments, then solve LP.
        """
        from pulp import LpMaximize, LpProblem, LpVariable, lpSum, value

        prob = LpProblem("MMM_Budget_Optimization", LpMaximize)

        # For each channel, create segments
        all_vars = {}
        objective_terms = []

        for i, config in enumerate(self.channel_configs):
            ch = config.name
            max_spend = min(
                self.max_spends.get(ch, total_budget),
                total_budget,
            )
            spend_points = np.linspace(0, max_spend, n_segments + 1)

            for j in range(n_segments):
                s_lo = spend_points[j]
                s_hi = spend_points[j + 1]
                r_lo = self._channel_response(s_lo, config)
                r_hi = self._channel_response(s_hi, config)

                segment_width = s_hi - s_lo
                marginal_rate = (r_hi - r_lo) / max(segment_width, 1e-10)

                var = LpVariable(f"{ch}_seg_{j}", lowBound=0, upBound=segment_width)
                all_vars[(ch, j)] = var
                objective_terms.append(marginal_rate * var)

        prob += lpSum(objective_terms)

        # Budget constraint
        prob += lpSum(list(all_vars.values())) <= total_budget

        # Min/max spend per channel
        for i, config in enumerate(self.channel_configs):
            ch = config.name
            ch_vars = [all_vars[(ch, j)] for j in range(n_segments)]
            if ch in self.min_spends and self.min_spends[ch] > 0:
                prob += lpSum(ch_vars) >= self.min_spends[ch]

        prob.solve()

        # Extract allocations
        allocations = {}
        for config in self.channel_configs:
            ch = config.name
            ch_spend = sum(
                value(all_vars[(ch, j)]) or 0 for j in range(n_segments)
            )
            allocations[ch] = ch_spend

        alloc_array = np.array([allocations[c.name] for c in self.channel_configs])

        return self._build_result(
            "Linear Programming", total_budget, alloc_array,
            {"status": prob.status}
        )

    # ─── 4. Genetic Algorithm (DEAP) ─────────────────────────
    def optimize_ga(
        self,
        total_budget: float,
        pop_size: int = 100,
        n_gen: int = 50,
    ) -> OptimizationResult:
        """
        Genetic Algorithm via DEAP.
        Good for complex constraint landscapes and non-convex problems.
        """
        import random
        from deap import base, creator, tools, algorithms

        # Clear any previous DEAP creator definitions
        if "FitnessMax" in creator.__dict__:
            del creator.FitnessMax
        if "Individual" in creator.__dict__:
            del creator.Individual

        creator.create("FitnessMax", base.Fitness, weights=(1.0,))
        creator.create("Individual", list, fitness=creator.FitnessMax)

        toolbox = base.Toolbox()

        # Individual: random splits of budget
        def init_individual():
            splits = np.random.dirichlet(np.ones(self.n_channels))
            return creator.Individual(splits * total_budget)

        toolbox.register("individual", init_individual)
        toolbox.register("population", tools.initRepeat, list, toolbox.individual)

        def evaluate(ind):
            spends = np.array(ind, dtype=float)
            # Clamp negatives first
            spends = np.maximum(spends, 0)
            # Enforce budget constraint
            total = np.sum(spends)
            if total > 0:
                spends = spends * (total_budget / total)
            else:
                spends = np.full(self.n_channels, total_budget / self.n_channels)
            # Enforce bounds
            for j in range(self.n_channels):
                ch = self.channel_configs[j].name
                spends[j] = np.clip(
                    spends[j],
                    self.min_spends.get(ch, 0),
                    self.max_spends.get(ch, total_budget),
                )
            return (self._total_response(spends),)

        toolbox.register("evaluate", evaluate)
        toolbox.register("mate", tools.cxBlend, alpha=0.5)
        toolbox.register("mutate", tools.mutGaussian, mu=0, sigma=total_budget * 0.05, indpb=0.3)
        toolbox.register("select", tools.selTournament, tournsize=3)

        random.seed(42)
        pop = toolbox.population(n=pop_size)
        result_pop, logbook = algorithms.eaSimple(
            pop, toolbox, cxpb=0.7, mutpb=0.2, ngen=n_gen, verbose=False
        )

        best = tools.selBest(result_pop, 1)[0]
        alloc = np.maximum(np.array(best, dtype=float), 0)
        total = np.sum(alloc)
        if total > 0:
            alloc = alloc * (total_budget / total)
        else:
            alloc = np.full(self.n_channels, total_budget / self.n_channels)

        return self._build_result(
            "Genetic Algorithm (DEAP)", total_budget, alloc,
            {"n_gen": n_gen, "pop_size": pop_size}
        )

    # ─── 5. Grid Search ──────────────────────────────────────
    def optimize_grid(
        self,
        total_budget: float,
        n_points: int = 10,
    ) -> OptimizationResult:
        """
        Exhaustive grid search over budget splits.
        Only practical for 2-3 channels (exponential scaling).
        For >3 channels, uses random sampling as approximation.
        """
        if self.n_channels <= 3:
            from itertools import product
            fractions = np.linspace(0, 1, n_points)

            best_response = -np.inf
            best_alloc = np.zeros(self.n_channels)

            if self.n_channels == 2:
                for f1 in fractions:
                    f2 = 1 - f1
                    if f2 < 0:
                        continue
                    alloc = np.array([f1, f2]) * total_budget
                    resp = self._total_response(alloc)
                    if resp > best_response:
                        best_response = resp
                        best_alloc = alloc.copy()
            elif self.n_channels == 3:
                for f1 in fractions:
                    for f2 in fractions:
                        f3 = 1 - f1 - f2
                        if f3 < 0:
                            continue
                        alloc = np.array([f1, f2, f3]) * total_budget
                        resp = self._total_response(alloc)
                        if resp > best_response:
                            best_response = resp
                            best_alloc = alloc.copy()
        else:
            # Random sampling for many channels
            np.random.seed(42)
            n_samples = n_points ** min(self.n_channels, 4)
            n_samples = min(n_samples, 10000)

            best_response = -np.inf
            best_alloc = np.zeros(self.n_channels)

            for _ in range(n_samples):
                fracs = np.random.dirichlet(np.ones(self.n_channels))
                alloc = fracs * total_budget
                resp = self._total_response(alloc)
                if resp > best_response:
                    best_response = resp
                    best_alloc = alloc.copy()

        return self._build_result(
            "Grid Search", total_budget, best_alloc,
            {"n_evaluations": n_points if self.n_channels <= 3 else n_samples}
        )

    # ─── Result Builder ───────────────────────────────────────
    def _build_result(
        self,
        algorithm: str,
        total_budget: float,
        allocations: np.ndarray,
        convergence_info: dict,
    ) -> OptimizationResult:
        """Build an OptimizationResult from raw optimization output."""
        alloc_dict = {}
        resp_dict = {}
        mroi_dict = {}

        for i, config in enumerate(self.channel_configs):
            spend = max(allocations[i], 0)
            alloc_dict[config.name] = spend
            resp_dict[config.name] = self._channel_response(spend, config)

            # Marginal ROI at this spend level
            transformed = simulate_steady_state(
                spend, config.adstock_type, config.adstock_params, config.lag
            )
            marginal = ResponseFunction.marginal(
                config.func_type, np.array([transformed]), config.func_params
            )
            mroi_dict[config.name] = float(marginal[0])

        total_resp = sum(resp_dict.values())

        return OptimizationResult(
            algorithm=algorithm,
            total_budget=total_budget,
            channel_allocations=alloc_dict,
            channel_responses=resp_dict,
            total_response=total_resp,
            channel_marginal_roi=mroi_dict,
            convergence_info=convergence_info,
        )

    # ─── Main Dispatcher ──────────────────────────────────────
    def optimize(self, algorithm: str, total_budget: float, **kwargs) -> OptimizationResult:
        """Route to the appropriate optimization algorithm."""
        if algorithm == "L-BFGS-B (Gradient)":
            return self.optimize_lbfgsb(total_budget)
        elif algorithm == "Differential Evolution":
            return self.optimize_de(total_budget, **kwargs)
        elif algorithm == "Linear Programming":
            return self.optimize_lp(total_budget, **kwargs)
        elif algorithm == "Genetic Algorithm (DEAP)":
            return self.optimize_ga(total_budget, **kwargs)
        elif algorithm == "Grid Search":
            return self.optimize_grid(total_budget, **kwargs)
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")
