# Review

Use for a layered Rails review of changed files or a specific file.

## Pi usage

```bash
/skill:layered-rails review
/skill:layered-rails review app/models/order.rb
/skill:layered-rails review --staged
/skill:layered-rails review --branch main
```

## Review flow

1. **Identify the diff scope**
   - prefer the explicit file/path if provided
   - otherwise inspect uncommitted or staged changes

2. **Map each touched file to its layer**
   - note where flow is clean and where it reverses upward

3. **Apply boundary checks**
   - models do not use `Current.*` for business rules
   - services do not accept or inspect request objects
   - controllers stay on HTTP/auth/response concerns
   - views/helpers do not perform domain decisions or infrastructure work
   - models do not directly trigger mailers, deliveries, jobs, or external APIs unless there is a very deliberate event boundary

4. **Run a light specification test**
   - ask what the changed file would need tests for
   - if many contexts belong to another layer, call that out

5. **Check extraction signals**
   - new callbacks score 4-5/5, not 1-2/5
   - new concerns are behavioral, not code-slicing
   - changes do not worsen a known god object
   - services are orchestrators, not calculators for model-owned rules

6. **Trace the call chain before recommending a move**
   - if a model triggers a notification, find the existing orchestrator first
   - prefer moving side effects to an existing service, form object, controller, or subscriber

## Severity

### Critical

- reverse dependency across layers
- `Current` in models for business logic, authorization, or query scoping
- request objects inside services
- controller actions doing domain calculations or orchestration-heavy work

### Warning

- low-scoring callbacks
- anemic-model drift
- code-slicing concerns
- large flat service layer

### Suggestion

- cleaner pattern choice
- naming/convention improvements
- better extraction target

## Output shape

```markdown
## Layered Rails Review

### Files reviewed
- path (layer)

### Issues
🔴 Critical
- location
- problem
- impact
- concrete fix

⚠️ Warning
- location
- issue
- recommendation

💡 Suggestion
- optional improvement

### Summary
- what is already good
- what must change first
```

## Reference files

Read these when useful:
- [`../references/core/specification-test.md`](../references/core/specification-test.md)
- [`../references/core/extraction-signals.md`](../references/core/extraction-signals.md)
- [`../references/anti-patterns.md`](../references/anti-patterns.md)
