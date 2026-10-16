# Testing

## Strategy

- Every caller-visible feature gets a happy-path test through its real public entrypoint, plus expected error paths at the highest reliable interface. Report why when end-to-end coverage is impractical.
- No module mocking (`vi.mock`, `jest.mock`). Substitute through service Layers, SQLite or another real local substitute, or faithful in-memory implementations.
- Assert observable outcomes: returned values and errors, persisted state, emitted events, rendered responses, records in a recording implementation. Spy only when the interaction itself is the behavior.
- Consider property tests for invariants, transitions, normalization, ordering, idempotence, and round trips. Use Effect's FastCheck integration with arbitraries derived from owning schemas, kept beside the domain module (`invoice-number.arbitrary.ts`).
- Valid generated data goes through production constructors. Rejection tests build invalid external representations independently of the schema under test.
- When inference is public behavior, add compile-time tests covering input, success, error, and requirement channels, including rejected calls.

## Effect runtime

- Use `it.effect` by default and `it.live` only when real time is the behavior under test.
- Drive sleeps, schedules, retries, and timeouts with `TestClock.adjust` / `TestClock.setTime`. Fork the sleeping effect before advancing the clock.
- Synchronize explicitly: `Deferred` for one-shot signals, `Queue` for handing work across fibers, `Latch` for reusable gates, `Ref` for observed state.
- Assert interruption and finalization when they are part of the contract.
- Streams: `Stream.fromIterable` for finite fixtures (append `Stream.never` for open subscriptions), a test-owned `Queue` with `Stream.fromQueue` for interactive driving, and `Stream.take(n)` before collecting an open stream.

```ts
it.effect("finds a user", () =>
  Effect.gen(function* () {
    const users = yield* UserRepo.Service
    const result = yield* users.find(UserId.make("u1"))
    expect(Option.isSome(result)).toBe(true)
  }).pipe(Effect.provide(UserRepo.layerTest)),
)
```

## Test implementations

Keep one-off fakes local to their test. Export a reusable implementation only when its complete behavior is useful across tests, named for that behavior (`InMemoryCache`, `RecordingEmailSender`, `FailingEmailSender`). Call it in-memory only when it preserves the full observable contract.

When reusable state, failure injection, or inspection is needed, expose a `TestService` alongside the real tag from one acquisition:

```ts
export interface TestInterface extends Interface {
  readonly sentMessages: () => Effect.Effect<ReadonlyArray<Message>>
  readonly failNextSend: (error: SendError) => Effect.Effect<void>
}

export class TestService extends Context.Service<TestService, TestInterface>()(
  "@app/Notifier/Test",
) {}

export const layerTest = Layer.effectContext(
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<Message>>([])
    const nextFailure = yield* Ref.make(Option.none<SendError>())

    const service = TestService.of({
      send: Effect.fn("Notifier.Test.send")(function* (message) {
        const failure = yield* Ref.getAndSet(nextFailure, Option.none())
        if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
        yield* Ref.update(sent, (messages) => [...messages, message])
      }),
      sentMessages: () => Ref.get(sent),
      failNextSend: (error) => Ref.set(nextFailure, Option.some(error)),
    })

    return Context.empty().pipe(
      Context.add(Service, service),
      Context.add(TestService, service),
    )
  }),
)
```

`Layer.mock` fits a tiny local partial implementation whose omitted members fail loudly. Do not add production branches, exports, or flags only for tests. Supply test configuration with `ConfigProvider.layer(ConfigProvider.fromUnknown(...))`.
