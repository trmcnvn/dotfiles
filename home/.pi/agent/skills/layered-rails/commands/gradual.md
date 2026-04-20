# Gradual

Use for planning incremental adoption of layered Rails patterns.

## Pi usage

```bash
/skill:layered-rails gradual
/skill:layered-rails gradual introduce authorization
/skill:layered-rails gradual extract callbacks from User
/skill:layered-rails gradual reduce god objects
```

## Goal

Produce a phased plan that improves architecture without a big-bang rewrite.

## Process

1. **Understand the goal**
   - authorization → policies
   - fat controllers → form/filter/service extraction
   - callbacks → caller/service/subscriber extraction
   - god objects → split responsibility clusters
   - notifications → move side effects to orchestrators/subscribers
   - no explicit goal → full roadmap

2. **Assess current style**
   - DHH-style / minimal abstractions
   - partially layered
   - already layered but inconsistent

3. **Find existing conventions to build on**
   - base service classes
   - policy/form/query directories
   - naming conventions
   - existing component/presenter patterns

4. **Search only where the goal points**
   - auth checks, callbacks, large controllers/models, helper markup builders, etc.

5. **Trace call chains**
   - do not recommend new abstractions until you know where current orchestration lives

6. **Create phases**
   - high value, low risk first
   - one pattern family per phase
   - include “stop here if...” guidance so teams can choose the depth they want

## Planning rules

- do not over-engineer a small app
- respect existing conventions if they are coherent
- keep each phase small enough to ship independently
- prefer concrete files and examples over abstract advice

## Output shape

```markdown
# Gradual Layerification Plan

## Current state
- architecture style
- relevant findings

## Phase 1
- goal
- files
- before/after sketch
- why first
- stop here if...

## Phase 2
...

## Not recommended now
- patterns that are not worth the cost yet
```

## Reference files

Read these when useful:
- [`../references/core/architecture-layers.md`](../references/core/architecture-layers.md)
- [`../references/core/extraction-signals.md`](../references/core/extraction-signals.md)
- [`../references/anti-patterns.md`](../references/anti-patterns.md)
