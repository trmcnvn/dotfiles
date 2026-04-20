# Analyze God Objects

Use for finding oversized, mixed-responsibility objects in Rails code.

## Pi usage

```bash
/skill:layered-rails analyze-gods
/skill:layered-rails analyze-gods app/models
/skill:layered-rails analyze-gods 300
```

Treat a numeric argument as a line-count threshold. Otherwise treat it as a path/scope.

## Signals

Quantitative signals:
- high line count
- many methods
- many associations, scopes, callbacks, or concerns
- high churn over time

Qualitative signals:
- mixed responsibility clusters
- heavy conditionals or branching by role/state
- domain + presentation + infrastructure logic in one class
- many unrelated callers relying on the same object

## Workflow

1. **Identify candidates** by size in the target scope.
2. **Cross-check churn** if history is available.
3. **Read the top candidates** and group methods into responsibility clusters.
4. **Spot layer leakage** inside each object.
5. **Recommend decomposition** only where the clusters are real.

Useful extractions:
- behavioral concerns
- value objects
- associated/delegate objects
- services for orchestration
- state machines for dense transition logic

## Output shape

```markdown
# God Object Analysis

## Summary
- candidates
- critical vs warning

## Candidate: app/models/user.rb
- metrics
- responsibility clusters
- layer leaks
- recommended extraction order

## Priority matrix
- what to tackle now
- what to monitor only
```

## Reference file

Read [`../references/core/extraction-signals.md`](../references/core/extraction-signals.md) before a deep pass.
