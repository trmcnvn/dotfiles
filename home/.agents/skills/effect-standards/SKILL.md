---
name: effect-standards
description: Correct-by-construction Effect v4 standards for TypeScript. Use when writing, reviewing, or refactoring Effect code, or when another skill needs the user's Effect standards.
---

# Effect Standards

Build **correct by construction**: parse data into meaningful types, make expected failures explicit, keep effects behind cohesive services, and test through real interfaces.

## Decision priority

1. Preserve correctness, safety, and debuggability.
2. Apply these standards to new code and the complete behavior being changed.
3. Follow compatible repository conventions; contain incompatible older patterns at the nearest edge.
4. Leave unrelated behavior unchanged unless a migration was requested.

## Workflow

1. **Establish local rules.** Read the nearest `AGENTS.md`, package config, lint config, and the pinned `effect` (and Alchemy) versions. Verify APIs in the pinned package source rather than from memory.
2. **Trace the behavior.** Follow each caller-visible operation from input through every decision and effect to its result, and load every matching reference below.
3. **Design from public types inward.** Fix inputs, outputs, expected errors, and service interfaces first. Keep domain calculations pure and framework types private to their owner. Reuse existing services, schemas, and errors; add an abstraction only when deleting it would spread complexity into callers.
4. **Implement every path**, including expected failures, boundary translation, and resource cleanup.
5. **Verify** with the repository's typecheck, test, and lint commands, then re-check each changed symbol against the loaded references.

## References

- [`services.md`](references/services.md): services, Layers, `Effect.fn`, runtime wiring, test Layers, module ownership.
- [`schemas.md`](references/schemas.md): parsing, provenance, decoders, records, brands, variants, boundary optionality.
- [`errors.md`](references/errors.md): tagged errors, defects, absence, `catchTags` translation.
- [`durable-objects.md`](references/durable-objects.md): Alchemy two-phase constructors, Durable Objects as HTTP services, execution-scoped clients.
- [`testing.md`](references/testing.md): `it.effect`, `TestClock`, synchronization, test implementations.
- [`concurrency.md`](references/concurrency.md): `Schedule`, retry, polling workers, streams, caching, request batching.
- [`platform.md`](references/platform.md): `HttpClient`, `Config`, secrets, observability, persistence, idempotency.

## Imports

Import stable modules as named namespaces from the package root, combined in one declaration:

```ts
import { Config, Effect, Option } from "effect"
```

Import unstable modules from their narrow public entrypoint:

```ts
import { HttpServerResponse } from "effect/unstable/http"
```

Never use leaf-module imports such as `import * as Effect from "effect/Effect"`. Use the same form in source and tests. Use `import type` for type-only edges and import project code directly from its owning file; barrels exist only as intentional package entrypoints.

## `Effect.gen` vs `.pipe`

Business logic goes inside a generator; cross-cutting policy goes outside it.

| Situation | Use |
| --- | --- |
| Retrieving services, sequential steps, branching, loops, early return | `Effect.gen` or generator-based `Effect.fn` |
| Error translation, retry, timeout, tracing, logging, dependency provision, Layer composition | `.pipe(...)` or `Effect.fn` whole-function transforms |
| One pure result transformation | `.pipe(Effect.map(...))` |
| Several dependent `map` / `flatMap` / `andThen` steps | Rewrite as a generator |

```ts
const fetchUserPosts = Effect.fn("UserService.fetchUserPosts")(
  function* (userId: UserId) {
    const database = yield* UserDatabase.Service
    const cache = yield* UserCache.Service
    const cached = yield* cache.getUserPosts(userId)

    if (Option.isSome(cached)) return cached.value

    const posts = yield* database.findPostsByUser(userId)
    yield* cache.setUserPosts(userId, posts)
    return posts
  },
  Effect.retry(userPostsRetryPolicy),
)
```

Pass pipeable combinators to `Effect.fn` directly; do not wrap them in `(effect) => effect.pipe(...)` unless combining several or needing the original arguments. A yielded Effect may use `.pipe` for a local translation; once that pipe coordinates further effects or branches on domain outcomes, move it into the generator.

## Optional values

Represent every optional field, property, parameter, and return value with `Option.Option<A>`. Do not use `null`, `undefined`, `A | null`, `A | undefined`, or optional properties inside the application. Decode nullable or missing external input into `Option` at the boundary (see [`schemas.md`](references/schemas.md#optionality)) and encode back only when an external contract requires it.

```ts
interface Invoice {
  readonly body: Option.Option<string>
}

const withBody = Option.some("Invoice details")
const withoutBody = Option.none<string>()
```

Prefer a separate operation or a named options value over an optional parameter when absence changes behavior.

## Type safety

- Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noFallthroughCasesInSwitch` in new or changed configs.
- Prefer `readonly` fields and `ReadonlyArray`; localize mutation inside Adapters or performance-sensitive internals.
- Preserve the strongest established type. Never widen a known value to `unknown`, `object`, or `Record<string, unknown>`, and never assert it back (`as unknown as T`, `as any as T`).
- No `any` or non-null assertions. Every cast other than `as const` needs a `// SAFETY:` comment naming the runtime evidence and the compiler limitation, kept to the smallest owner.
- Exported interface methods and exported functions returning objects, unions, or collections state their return types. Derive types from owning schemas.
- Brand every entity ID and mixable unit (`UserId`, `Milliseconds`, `UsdCents`) and use refined types for constrained scalars. Model lifecycle states as tagged unions and handle closed unions exhaustively. Replace behavior-controlling booleans with named options or domain values.

## Comments and JSDoc

Every exported symbol and public class member has JSDoc at its original declaration stating the sharpest caller-visible fact the signature cannot show. Add prose only for constraints, expected failures, side effects, invariants, or safety justifications. Reserve `@throws` for defects; describe typed errors in `@returns`. Use durable domain vocabulary; keep ticket names and planning language out of public names and docs.
