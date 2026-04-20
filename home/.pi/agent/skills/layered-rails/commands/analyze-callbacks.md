# Analyze Callbacks

Use for a deep callback audit across models or a specific model path.

## Pi usage

```bash
/skill:layered-rails analyze-callbacks
/skill:layered-rails analyze-callbacks app/models/user.rb
```

## Scoring

| Score | Type | Default action |
| --- | --- | --- |
| 5/5 | transformer | keep |
| 4/5 | normalizer / maintainer | usually keep |
| 3/5 | timestamp / mild bookkeeping | acceptable |
| 2/5 | observer / async trigger | review |
| 1/5 | operation / business step / side effect | extract |

## Audit flow

1. **Find callbacks** in the target scope.
2. **Read the callback bodies**, not just declarations.
3. **Score each callback** by what it actually does.
4. **Look for chains** of related callbacks on the same lifecycle event.
5. **Search for skip patterns** that suggest callback design debt.
6. **Recommend extraction targets**:
   - existing caller
   - service object
   - subscriber/event handler
   - explicit method invoked by orchestrator

Search hints:

```bash
rg -n "before_|after_|around_" app/models
rg -n "skip_callback|save\(validate: false\)" .
```

## Red flags

- multiple `after_create` or `after_commit` side effects on the same model
- mailers, deliveries, jobs, analytics, or API sync in callbacks
- callback control flags (`skip_*`, virtual attrs, special save modes)
- business operations hidden in lifecycle hooks

## Output shape

```markdown
# Callback Analysis Report

## Summary
- total callbacks by score bucket

## By model
- callback
- score
- keep/extract
- why

## Callback chains
- grouped hotspots
- suggested orchestrator

## Extraction priority
1. highest-risk side effects first
```

## Reference file

Read [`../references/core/extraction-signals.md`](../references/core/extraction-signals.md) before a deep audit.
