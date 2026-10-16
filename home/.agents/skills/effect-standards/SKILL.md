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
2. **Trace the behavior.** Follow each caller-visible operation from input through every decision and effect to its result.
3. **Design from public types inward.** Fix inputs, outputs, expected errors, and service interfaces first. Keep domain calculations pure and framework types private to their owner. Reuse existing services, schemas, and errors; add an abstraction only when deleting it would spread complexity into callers.
4. **Implement every path**, including expected failures, boundary translation, and resource cleanup.
5. **Verify** with the repository's typecheck, test, and lint commands, then re-check each changed symbol against this skill.

## Imports

Import stable modules as named namespaces from the package root, and unstable modules from their narrow public entrypoint:

```ts
import { Config, Effect, Option } from "effect"
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
    const database = yield* UserDatabase
    const cache = yield* UserCache
    const cached = yield* cache.getUserPosts(userId)

    if (Option.isSome(cached)) return cached.value

    const posts = yield* database.findPostsByUser(userId)
    yield* cache.setUserPosts(userId, posts)
    return posts
  },
  Effect.retry(userPostsRetryPolicy),
)
```

Pass pipeable combinators to `Effect.fn` directly; use an `(effect, ...args) => effect.pipe(...)` transform only when combining several or needing the original arguments. A yielded Effect may use `.pipe` for a local translation; once that pipe coordinates further effects or branches on domain outcomes, move it into the generator. Use `Effect.fnUntraced` only for internal helpers.

## Optional values

Represent every optional field, property, parameter, and return value with `Option.Option<A>`. Do not use `null`, `undefined`, `A | null`, `A | undefined`, or optional properties inside the application. Decode nullable or missing input into `Option` at the boundary and encode back only when an external contract requires it:

- `Schema.OptionFromOptionalKey(s)`: absent key.
- `Schema.OptionFromNullOr(s)`: explicit `null`.
- `Schema.OptionFromUndefinedOr(s)` / `Schema.OptionFromOptional(s)`: explicit `undefined`.
- `Schema.OptionFromNullishOr(s)` / `Schema.OptionFromOptionalNullOr(s)`: mixed nullish encodings.

Return `Option` when absence is an ordinary result and a typed not-found error when the operation requires the value. Prefer a separate operation or named options value over an optional parameter when absence changes behavior.

## Types and schemas

- Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noFallthroughCasesInSwitch`. Prefer `readonly` and `ReadonlyArray`.
- Preserve the strongest established type. Never widen a known value to `unknown`, `object`, or `Record<string, unknown>`, and never assert it back (`as unknown as T`). No `any` or non-null assertions. Every cast other than `as const` needs a `// SAFETY:` comment naming the runtime evidence and compiler limitation.
- Brand every entity ID and mixable unit (`UserId`, `UsdCents`); model lifecycle states as tagged unions handled exhaustively; replace behavior-controlling booleans with named options or domain values.
- Model records as `Schema.Struct` plus a same-name `interface ... extends Schema.Schema.Type<typeof X> {}`. Use `Schema.TaggedUnion` for wire/persisted unions and `Data.TaggedEnum` for internal algebras. Add `.annotate({ identifier })` only when tooling consumes it.

### Parsing

| Input | Handling |
| --- | --- |
| Unknown: raw bodies, SQL rows, storage, untyped callbacks | `Schema.decodeUnknownEffect`, private to the owning Adapter. SQL generics are not runtime evidence. |
| Known encoded type matching the codec's `Encoded` | `Schema.decodeEffect`; never cast to make a decoder fit. |
| Established domain value | Pass it unchanged; no re-parse or encode/decode round trip. |
| Newly computed value with new constraints | The owning constructor or a typed `Schema.decodeTo` composition. |

Parse once at the nearest Adapter and re-parse wherever data re-enters (database reads, cache hits, events, workflow replay). Inner code never sees request payloads, rows, env strings, or vendor records. Instantiate codecs once beside their owner and export a unary `parseX(input)` with the real input type instead of the decoder factory. Do not write tests that merely restate a schema's declared constraints.

## Errors

Every known failure appears in the error channel as a tagged error; defects (violated invariants, impossible branches) die. Wrap Promise and platform APIs with `Effect.tryPromise` in their owning Adapter.

```ts
export class UserStoreUnavailable extends Schema.TaggedError<UserStoreUnavailable>()(
  "UserStoreUnavailable",
  { operation: Schema.String, message: Schema.String, cause: Schema.Defect() },
) {}
```

- Carry context as typed fields (operation, safe IDs, classified `reason`, retry info). Messages start with a stable searchable phrase and say what failed and how to recover. Classify by tag, never message text.
- Keep failure modes granular. Public errors use stable codes and redact secrets and internals; `Schema.Defect()` does not redact.
- Translate at the owner that knows the policy with `Effect.catchTags`, listing each known source, passing already-correct errors through, and adding no catch-all so new tags become type errors. No `instanceof` branches; `Effect.mapError` only when the whole channel means one thing.
- Cause-level recovery belongs only at supervision boundaries. A timeout or lost response on a mutation is uncertainty, not failure.

## Services and Layers

A service owns a real capability: persistence, credentials, I/O, resources, configuration, time, randomness, reusable effect sequencing, or real implementation variation. Prefer built-ins (`Clock`, `Random`, `Config`, `HttpClient`, `FileSystem`). Keep parsed inputs, pure calculations, and forwarding wrappers as values. Name capabilities with stable domain nouns (`UserStore`, `EmailSender`) and put specifics in operation names.

```ts
export interface Interface {
  readonly operation: (input: Input) => Effect.Effect<Output, OperationError>
}

export class Service extends Context.Service<Service, Interface>()("@app/Capability") {}

export const make = Effect.gen(function* () {
  const dependency = yield* Dependency.Service
  const operation = Effect.fn("Capability.operation")(function* (input: Input) {
    return yield* dependency.operation(input)
  })
  return Service.of({ operation })
})

export const layerWithoutDependencies = Layer.effect(Service, make)
export const layer = layerWithoutDependencies.pipe(Layer.provide(Dependency.layer))

export * as Capability from "./capability.js"
```

- Consumers yield `Capability.Service`. Only the owning module and tests call `make`; runtime code imports Layers.
- Yield stable dependencies while building the Layer; yield request-scoped context inside the method. Never export `makeXLayer(service)` factories that take services as arguments.
- `Layer.provide` hides a dependency, `Layer.provideMerge` re-exposes it, `Layer.mergeAll` combines independent Layers. Long-lived fibers and stream consumers fork into the Layer scope with `Effect.forkScoped`.

## Alchemy and Durable Objects

Alchemy's outer init Effect runs at planning and cold start; returned handlers run only at runtime. Provide infrastructure-backed Layers to the outer Effect, yield services there, and close over them. Acquire state-backed resources (SQL clients, migrations) only inside the runtime Effect.

Treat each Durable Object as an independent HTTP service exposing an Effect HTTP API through `fetch`:

- No typed Alchemy RPC. Bindings, namespaces, stubs, and `Cloudflare.toHttpClient` stay inside composition roots and client implementations.
- Pair an `AccountClient` service module (what the app yields) with an `AccountServer` Durable Object. The client's `make` yields the Durable Object service directly and closes over its namespace.
- Key every instance by its canonical branded ID (`AccountServer` by `AccountId`); client methods accept domain IDs.
- Version every route from `/v1`, with no unversioned aliases.

Build stubs and their HTTP clients inside the current invocation, never across invocations. For several targets per invocation, combine Alchemy's execution memo with an unbounded `Cache` and suspend the namespace lookup; keep the resolver private to the client:

```ts
const accountHttpClients = yield* makeExecutionMemo(
  Cache.make<AccountId, AccountHttpClient>({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (id) =>
      Effect.suspend(() =>
        HttpApiClient.makeWith(AccountHttpApi, {
          baseUrl: "http://account.internal",
          httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
        }),
      ),
  }),
)

const accountHttpClient = (id: AccountId) =>
  Effect.flatMap(accountHttpClients, (clients) => Cache.get(clients, id))
```

With one target per invocation, memoize the suspended client directly. `Layer.suspend`, isolate-scoped Layers, and global caches have the wrong lifetime.

## Concurrency and caching

- `Effect.retry` retries typed failures; `Effect.repeat` repeats successes. Back off with `Schedule.exponential` + `Schedule.jittered` + `Schedule.upTo({ times })`. Retry only where idempotency is proven, and keep exhausted failures typed.
- Polling workers: `pass.pipe(Effect.tapError(log), Effect.ignore, Effect.repeat(Schedule.spaced(...)))`.
- Streams for many-valued sources; service interfaces expose `Stream`s while queues and refs stay private. `Stream.runCollect` only on finite streams.
- Use `Cache` instead of hand-rolled maps (concurrent misses share one lookup), `Effect.cached` for one value, and `Effect.request` + `RequestResolver` for batch backends.

## Platform boundaries

- Outgoing HTTP uses `HttpClient`: classify status with `filterStatusOk` before `schemaBodyJson`, use `retryTransient` for transport/429/5xx, and translate every failure into a typed error.
- Read configuration once at the composition root with `Config`; credentials use `Config.redacted` and stay `Redacted` until the final I/O. Module imports are inert.
- Treat personal data as private; annotate diagnostics with operation, safe IDs, and error tags.
- Persistence modules keep tables and queries private and decode stored data on every read. Close transactions before network calls. Every duplicate-execution path needs an explicit idempotency strategy.

## Testing

- Test caller-visible behavior through real public entrypoints. No `vi.mock`/`jest.mock`; substitute through Layers, SQLite, or faithful in-memory implementations, and assert observable outcomes.
- Use `it.effect`; drive time with `TestClock` (fork the sleeper first); synchronize with `Deferred`, `Queue`, `Latch`, and `Ref`.
- Reusable test implementations cross the production `Service` tag, with controls on a separate `TestService` supplied from the same `Layer.effectContext`. Name them for behavior (`RecordingEmailSender`). Use FastCheck arbitraries derived from schemas for invariants and round trips.

## Comments and JSDoc

Every exported symbol has JSDoc at its original declaration stating the sharpest caller-visible fact the signature cannot show. Reserve `@throws` for defects; describe typed errors in `@returns`. Keep ticket names and planning language out of public names and docs.
