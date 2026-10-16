# Scheduling, streams, and caching

## Schedule and retry

- `Effect.retry` retries typed failures, not defects or interruption. `Effect.repeat` repeats successes. The source runs once before the schedule steps; `Schedule.recurs(3)` means three more.
- `Schedule.spaced` waits after completion; `Schedule.fixed` keeps a cadence; `Schedule.exponential` / `Schedule.fibonacci` back off. Add `Schedule.jittered` and bound with `Schedule.upTo({ times })`.
- Retry only at the narrowest boundary with proven idempotency. Keep exhausted failures typed and visible; report them with a trailing `Effect.tapError`, or use `Effect.retryOrElse` for a truthful fallback.
- Use `Effect.timeout` for real deadlines, `Effect.delay` to start later, and `Effect.sleep` only when waiting is the behavior.

Honor provider retry hints by taking the larger delay:

```ts
interface RateLimited {
  readonly retryAfter: Option.Option<Duration.Duration>
}

const providerRetrySchedule: Schedule.Schedule<RateLimited, RateLimited> =
  Schedule.exponential("200 millis").pipe(
    Schedule.jittered,
    Schedule.upTo({ times: 5 }),
    Schedule.passthrough,
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.succeed(
        Option.match(input.retryAfter, {
          onNone: () => duration,
          onSome: (retryAfter) => Duration.max(duration, retryAfter),
        }),
      ),
    ),
  )
```

## Workers

Polling workers log expected pass failures and continue; defects still reach supervision:

```ts
const run = runPass().pipe(
  Effect.tapError((error) => Effect.logError("Worker.pass_failed", error)),
  Effect.ignore,
  Effect.repeat(Schedule.spaced("1 second")),
)
```

Batch workers isolate each item with the same `tapError` + `Effect.ignore` shape inside `Effect.forEach(items, fn, { concurrency, discard: true })`, but only when policy retries or deliberately skips the item. Use cause-level recovery only at supervision boundaries, excluding interrupts with `Cause.hasInterrupts`.

## Streams

Use streams for many-valued, time-ordered sources; use `Effect.repeat` for repeated work that emits nothing.

- Sources: `Stream.fromIterable`, `Queue` + `Stream.fromQueue` for callbacks, `PubSub` + `Stream.fromPubSub` for broadcast, `SubscriptionRef` for latest value plus changes, `Stream.paginate` for paged APIs, `Stream.unwrap` when building requires services.
- Transform with `Stream.map` / `Stream.mapEffect(fn, { concurrency })`; add `unordered: true` only when order is irrelevant.
- `Stream.runCollect` only for finite streams. Rely on natural backpressure; `Stream.buffer` needs an explicit strategy and bounded growth.
- Service interfaces expose `Stream`s; queues and refs stay private to the implementation.
- Long-lived consumers live in a Layer and fork into its scope:

```ts
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const gateway = yield* Gateway.Service

    yield* gateway.events.pipe(
      Stream.filter(isMessageEvent),
      Stream.runForEach(handleEvent),
      Effect.forkScoped,
    )
  }),
)
```

## Caching and batching

Use `Cache` instead of hand-rolled `Map`/TTL/in-flight maps. Build it once in its owning Layer or scope.

- Same key repeatedly or concurrently: `Cache.make({ capacity, lookup, timeToLive })`; concurrent misses share one lookup.
- Per-result TTL: `Cache.makeWith(lookup, { capacity, timeToLive: (exit) => ... })`, giving transient failures `Duration.zero`.
- One unkeyed value: `Effect.cached` / `Effect.cachedWithTTL`. Resources needing cleanup: `ScopedCache`.
- Many keys with a batch backend: `Effect.request` + `RequestResolver` (bounded with `RequestResolver.batchN`). Per-item backend only: `Effect.forEach(..., { concurrency })`.
- Request-bound handles belong to the invocation, not an isolate-wide cache; see [`durable-objects.md`](durable-objects.md#execution-scoped-clients).
