# From Weeks to Hours: Building a Post-MMM Response Curve Tool with AI

If you've worked in marketing analytics, you know the pain of building diminishing return curves and budget optimizers from scratch.

In a traditional setup, here's what that process looked like:

A data scientist or analyst would spend 2-3 days just setting up the mathematical framework — coding Hill functions, logarithmic curves, power transformations, exponential saturation models — and making sure the calculus for marginal returns was correct. Then another few days wiring up adstock transformations with geometric decay and Weibull distributions, including steady-state approximations so the curves reflect real-world carryover effects.

Then comes the optimization layer. Implementing even one budget allocation algorithm (say, L-BFGS-B) that respects channel-level constraints takes careful work. We built five — including differential evolution, linear programming, a genetic algorithm, and grid search — each with its own strengths depending on the problem shape.

After all that math, you still need the visualization layer. Dark-themed matplotlib charts, overlay comparisons, marginal response curves, allocation bar charts — all formatted so a non-technical stakeholder can actually read them.

And finally, the UI. Building an interactive Streamlit dashboard with five tabs — a guided walkthrough with LaTeX equations and worked examples, a channel configuration panel, curve visualizations, an optimizer, and an export module — that's typically a sprint's worth of front-end work.

All told, a tool like this would traditionally take a small team 2-4 weeks of dedicated effort. You'd need a data scientist comfortable with marketing science, a Python developer for the app layer, and probably a few rounds of QA to catch math errors and edge cases.

I built this entire tool in about 5 hours, working with Claude.

Is it perfect? No. There might be rough edges in places. But it covers 6 response function types, adstock modeling, 5 optimization algorithms, dark-mode interactive dashboards, and a full educational guide tab with theory, equations, and a practical worked example — all QA'd for mathematical accuracy.

This isn't about AI replacing analysts. It's about where we are in this journey. The foundational thinking — knowing what a Hill curve means, understanding why adstock matters, deciding which optimization approach fits your business — that still requires human expertise. AI didn't decide what to build. It accelerated the building.

A few years ago, this would have been a proposal, a sprint plan, and a team effort. Today it's an evening project.

That's where we are. And we're just getting started.

---

*The tool is open source: [github.com/Ronakvijayvergia/DiminishingReturnTool](https://github.com/Ronakvijayvergia/DiminishingReturnTool)*
