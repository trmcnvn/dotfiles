---
name: layered-rails
description: Layered Rails architecture guidance for Ruby on Rails apps. Use when analyzing Rails structure, reviewing changes for layer violations, running a specification test, planning gradual refactors, or spotting callback and god-object extraction candidates.
license: MIT
metadata:
  source: https://github.com/palkan/skills
  adaptation: pi
---

# Layered Rails

Pi adaptation of the layered Rails skill from `palkan/skills`.

## Pi usage

Use this skill in normal conversation, or call it directly with a subcommand:

```bash
/skill:layered-rails analyze [path]
/skill:layered-rails review [path|--staged|--branch <name>]
/skill:layered-rails spec-test <file-or-dir>
/skill:layered-rails gradual [goal]
/skill:layered-rails analyze-callbacks [path]
/skill:layered-rails analyze-gods [path-or-threshold]
```

If the appended user input starts with one of those subcommands, immediately read the matching file in `commands/` and follow it. Treat the remaining words as that command's arguments.

Subcommand map:

- `analyze` → [commands/analyze.md](commands/analyze.md)
- `review` → [commands/review.md](commands/review.md)
- `spec-test` → [commands/spec-test.md](commands/spec-test.md)
- `gradual` → [commands/gradual.md](commands/gradual.md)
- `analyze-callbacks` → [commands/analyze-callbacks.md](commands/analyze-callbacks.md)
- `analyze-gods` → [commands/analyze-gods.md](commands/analyze-gods.md)

If no subcommand is provided, act as a general layered Rails advisor.

## Core model

Rails code is split into four layers with one-way flow:

```text
Presentation → Application → Domain → Infrastructure
```

| Layer | Main concern | Typical Rails code |
| --- | --- | --- |
| Presentation | Input, auth, rendering, UX | controllers, views, serializers, form/filter objects, presenters |
| Application | Use-case orchestration | services, policies, operations |
| Domain | Business rules and state | models, value objects, domain events, query objects |
| Infrastructure | Persistence and external systems | Active Record, API clients, file storage, queue adapters |

**Core rule:** lower layers must never depend on higher layers.

## Four rules

1. **Unidirectional flow** — data moves top to bottom.
2. **No reverse dependencies** — models should not depend on request state, controllers, or Current context for business rules.
3. **Single-layer abstractions** — an object belongs to one architectural layer.
4. **Minimal connections** — avoid unnecessary cross-layer coupling.

## Common violations

| Violation | Why it hurts | Usual fix |
| --- | --- | --- |
| `Current.*` in models for business decisions | Hidden presentation dependency | Pass explicit parameters |
| `request` or `params` in services | Application layer depends on HTTP | Extract value objects in controller |
| Pricing, policy, or state logic in controllers | Presentation doing domain work | Move domain logic to model; orchestration to service/policy if needed |
| Mailers, jobs, or API calls from models | Domain triggers upper/lateral side effects | Move to orchestrator or event subscriber |
| Large flat `app/services` | Service layer becomes a junk drawer | Split by pattern and keep domain logic in models |

See:
- [Architecture layers](references/core/architecture-layers.md)
- [Specification test](references/core/specification-test.md)
- [Extraction signals](references/core/extraction-signals.md)
- [Anti-patterns](references/anti-patterns.md)

## Pattern heuristics

Use these as defaults, not dogma:

- **Models** should own business rules, calculations, validations, and state transitions.
- **Services** should orchestrate multi-step use cases and transactions.
- **Policies** should own authorization decisions.
- **Form/filter objects** should handle complex input mapping.
- **Presenters/components** should own view formatting and markup-heavy UI composition.
- **Value objects** should capture immutable domain concepts.

## When to extract

Strong signals:

- low-value callbacks (`after_commit :send_email`, `after_save :sync_to_api`)
- models with multiple responsibility clusters
- controller actions longer than roughly 10-15 meaningful lines
- services containing calculations that only use a model's own data
- concerns that group code by artifact type instead of behavior

## Output style

When using this skill:

- be concrete and file-oriented
- report only meaningful findings
- prioritize critical layer violations first
- prefer incremental fixes over grand rewrites
- preserve rich domain models; do not recommend anemic-model service sprawl

## Deep dives

If the current refs are not enough for a topic like Action Policy, ViewComponent, notifications, or AI integration, fetch the upstream markdown from `palkan/skills` with `webfetch` and continue from there.
