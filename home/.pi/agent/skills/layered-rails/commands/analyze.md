# Analyze

Use for a full layered-architecture pass over a Rails app or a specific path.

## Pi usage

```bash
/skill:layered-rails analyze
/skill:layered-rails analyze app/models
/skill:layered-rails analyze app/services/payments
```

## Goal

Assess how well the target follows layered Rails principles and identify the highest-value extraction or refactor opportunities.

## Workflow

1. **Map code to layers**
   - Presentation: controllers, views, serializers, components, presenters, form/filter objects
   - Application: services, policies, operations
   - Domain: models, value objects, query objects, concerns
   - Infrastructure: persistence, APIs, storage, background plumbing

2. **Check for critical violations**
   - `Current.*` in models
   - `request` / `params` access in services
   - business rules, calculations, or persistence plumbing in controllers/views
   - mailers, jobs, deliveries, or API calls from models
   - authorization logic buried in models or spread randomly across layers

   Search hints:

   ```bash
   rg -n "Current\." app/models
   rg -n "request\.|params\[" app/services
   rg -n "deliver_later|deliver_now|perform_later|Net::HTTP|Faraday|HTTParty|RestClient" app/models
   rg -n "admin\?|can_.*\?|policy" app/models app/controllers app/services
   ```

3. **Classify `Current` usage carefully**
   - Usually acceptable: explicit defaults, audit assignment, overridable default args
   - Usually a violation: business branching, authorization, query scoping, tenancy scoping inside model logic

4. **Inspect service-layer health**
   - flat vs namespaced
   - repeated naming patterns (`*Creator`, `*Query`, `*Form`, `*Policy`)
   - signs that `app/services` is a bag of unrelated objects
   - domain logic that should move back into models

5. **Find extraction signals**
   - score callbacks
   - inspect concerns for behavioral cohesion
   - identify large models or classes with mixed responsibilities
   - run the specification test on the top 3-5 suspicious files

6. **Look for missing patterns only where needed**
   - policies for authorization
   - form/filter objects for complex input handling
   - query/value objects for reusable domain logic
   - presenters/components when helpers are building markup

## Reporting rules

- Omit empty sections.
- Do not pad the report with “no issues found” boilerplate.
- Lead with the few issues that matter most.
- Prefer specific file paths and concrete moves.

## Output shape

```markdown
# Layered Architecture Analysis

## Summary
- overall health
- key risks
- best next steps

## Critical violations
- file, issue, impact, fix

## Structural findings
- service-layer organization
- god object candidates
- callback concerns
- missing or misused patterns

## Recommended sequence
1. fix highest-risk reverse dependencies
2. extract low-scoring callbacks
3. simplify or split the largest mixed-responsibility objects
```

## Reference files

Read these when useful:
- [`../references/core/architecture-layers.md`](../references/core/architecture-layers.md)
- [`../references/core/specification-test.md`](../references/core/specification-test.md)
- [`../references/core/extraction-signals.md`](../references/core/extraction-signals.md)
- [`../references/anti-patterns.md`](../references/anti-patterns.md)
