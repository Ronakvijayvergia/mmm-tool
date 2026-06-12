# MMM Core Engine

Complete Marketing Mix Modeling implementation in Python, based on Meta Robyn methodology.

## Files

### `__init__.py`
Empty init file for Python package structure.

### `adstock.py` (123 lines)
**Adstock Transformations for carryover effects**

Implements temporal decay patterns for media spend:

- **geometric_adstock()** - Exponential decay model with theta parameter (0-1)
- **weibull_adstock_cdf()** - CDF-based flexible decay pattern
- **weibull_adstock_pdf()** - PDF-based allowing delayed peaks (branding)
- **apply_adstock()** - Universal wrapper supporting all methods
- **get_adstock_weights()** - Extract weight distribution for visualization

Parameters:
- `theta`: Decay rate (0-1), higher = longer carryover
- `shape` / `scale`: Weibull parameters for flexible curve shapes
- `l_max`: Maximum lag length (typically 8-12 weeks)

### `saturation.py` (135 lines)
**Saturation/Diminishing Returns Curves**

Models non-linear response to increasing spend:

- **hill_function()** - Meta Robyn's primary saturation model (S-curve)
- **power_curve()** - Simple concave y=x^alpha function
- **logistic_saturation()** - Classic logistic S-curve
- **michaelis_menten()** - Enzyme kinetics adaptation
- **apply_saturation()** - Unified wrapper for all methods
- **marginal_response()** - Derivative curve (ROI of next dollar)
- **compute_mroi()** - Marginal ROI calculation

Parameters:
- `alpha`: Shape/steepness parameter (controls curve slope)
- `gamma`: Half-saturation point (EC50 - spend level at 50% max response)

### `mmm_model.py` (360 lines)
**Core Marketing Mix Model**

Complete MMM pipeline with transformations and fitting:

**Classes:**
- **MMMConfig** - Configuration object for model parameters
  - Media, organic, and context column definitions
  - Adstock/saturation settings per channel
  - Model type (Ridge/ElasticNet), regularization strength
  - Train/test split configuration

- **MMMResult** - Container for all model outputs
  - Coefficients, intercept, feature names
  - Performance metrics (R², MAPE, RMSE, MAE, NRMSE)
  - Contribution decomposition (% and absolute)
  - Train/test predictions and dates
  - Response curves for each channel
  - summary() method for quick overview

- **MarketingMixModel** - Main fitting engine
  - fit(df) - Applies transformations, splits data, trains model
  - _apply_transformations() - Adstock → Saturation pipeline
  - _prepare_features() - Feature matrix construction
  - _split_data() - Time-based or random splitting
  - _compute_decomposition() - Channel contribution analysis
  - _compute_response_curves() - Response surface generation
  - predict(df) - Generate predictions on new data

Workflow:
1. Apply adstock transformations (exponential carryover)
2. Apply saturation transformations (diminishing returns)
3. Fit Ridge or ElasticNet regression with scaling
4. Compute contributions via coefficient × feature decomposition
5. Generate response curves for optimization

### `optimizer.py` (205 lines)
**Budget Optimization Engine**

Allocates budget across channels based on marginal returns (equimarginal principle):

**Classes:**
- **BudgetConstraint** - Define bounds and limits
  - set_bounds() - Set min/max spend per channel

- **OptimizationResult** - Results container
  - optimal_allocation vs current_allocation
  - improvement_pct - Expected uplift from reallocation
  - marginal_roi - ROI of next dollar per channel
  - channel_details - Detailed breakdown for each channel

- **BudgetOptimizer** - Optimization engine
  - optimize() - Find optimal allocation given total budget
    - Uses SLSQP (Lagrangian), falls back to differential_evolution
    - Respects min/max constraints per channel
    - Budget constraint: sum(spend) = total_budget
  - simulate_scenario() - What-if analysis for custom allocations

Methods:
- _channel_response() - Predicted response for single channel spend
- _total_response() - Aggregated response across all channels
- _objective() - Maximization target (negative for minimization)

## Usage Example

```python
from mmm_tool.core.mmm_model import MarketingMixModel, MMMConfig
from mmm_tool.core.optimizer import BudgetOptimizer

# Configure model
config = MMMConfig()
config.date_col = "date"
config.target_col = "revenue"
config.media_cols = ["tv", "radio", "digital"]
config.organic_cols = ["seasonality"]
config.set_default_hyperparams(config.media_cols)

# Fit model
model = MarketingMixModel(config)
result = model.fit(df)

print(result.summary())
# {'train_r2': 0.85, 'test_r2': 0.82, ...}

# Optimize budget
optimizer = BudgetOptimizer(result, config)
opt_result = optimizer.optimize(
    total_budget=100000,
    current_allocation={"tv": 40000, "radio": 30000, "digital": 30000}
)

print(opt_result.improvement_pct)  # Expected uplift %
print(opt_result.optimal_allocation)  # Recommended allocation
```

## Key Concepts

### Adstock
Models how media effects persist over time through consumer memory/behavior:
- TV: Longer decay (theta ~0.7-0.8) due to branding effects
- Radio: Medium decay (theta ~0.5-0.6)
- Digital: Shorter decay (theta ~0.3-0.4) due to direct response

### Saturation (Hill Curve)
Models diminishing returns - law of diminishing marginal utility:
- First dollar is most effective
- Each additional dollar has lower ROI
- At very high spend, response plateaus

### Contributions
Decomposition shows % impact of each channel:
- contribution = coefficient × mean(adstocked_saturated_spend)
- Accounts for channel effectiveness AND spend levels

### Marginal ROI
Expected revenue from next $1 of spend per channel:
- Used to identify under/over-invested channels
- Optimal allocation = equimarginal principle (all channels have equal MROI)

## Technical Details

- **Scaling**: StandardScaler normalizes features for Ridge/ElasticNet
- **Regularization**: Ridge (L2) default prevents overfitting
- **Positivity**: Enforces non-negative coefficients (intuitive: more spend → more impact)
- **Metrics**:
  - R²: Explained variance (0-1, higher better)
  - MAPE: Mean Absolute Percentage Error (%)
  - RMSE: Root Mean Squared Error
  - NRMSE: Normalized RMSE (RMSE / range)

## Dependencies

- numpy, pandas - Data handling
- scipy - Weibull distributions, optimization
- scikit-learn - Ridge/ElasticNet regression, scaling, metrics

## Total Code

- 823 lines of production Python
- Comprehensive docstrings and type hints
- Validated syntax and imports
