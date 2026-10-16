# Errors

## Expected failures and defects

Every known failure (domain, parsing, authorization, integration, I/O, persistence, configuration) appears in the error channel as a tagged error, even when the immediate caller cannot recover. The outermost boundary turns it into an HTTP response, exit code, retry decision, or dead letter.

Defects are violated invariants, impossible branches, `notYetImplemented` paths, and catastrophic runtime conditions; let them die. Wrap Promise and platform APIs with `Effect.tryPromise` in their owning Adapter so rejections become typed errors before crossing its interface.

## Tagged errors

Use the pinned Schema tagged-error constructor (`Schema.TaggedError` in current v4; older prereleases use `Schema.TaggedErrorClass`):

```ts
export class UserStoreUnavailable extends Schema.TaggedError<UserStoreUnavailable>()(
  "UserStoreUnavailable",
  {
    operation: Schema.Literal("findActiveByEmail"),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}
```

- Carry context as typed fields: operation, safe domain IDs, a classified `reason`, and retry information. Do not bury it in prose.
- Messages say what failed, why when known, and how to recover. Start with a stable literal phrase so a search finds the definition. Classify by tag and fields, never by message text.
- Keep failure modes granular and union them at the operation boundary. Broad `AppError` types belong only near entrypoints and rendering.
- Public errors use stable literal codes and per-variant detail schemas. Internal errors keep richer safe context; public adapters redact secrets and internals. `Schema.Defect()` does not redact.

## Absence

Return `Option` when absence is an ordinary result. Return a typed not-found error when the operation requires the value.

## Translation

Translate only at the owner that knows the protocol or recovery policy. For tagged error channels use `Effect.catchTags`, listing each known source, passing already-correct errors through, and adding no catch-all:

```ts
const registerAccount = Effect.fn("AccountRegistry.registerAccount")(
  function* (account: Account) {
    return yield* registry.registerAccount(account)
  },
  Effect.catchTags({
    RegisterAccountError: (error) => Effect.fail(error),
    SchemaError: () => Effect.fail(new RegisterAccountError({ reason: "StoredDataInvalid" })),
    SqlError: () => Effect.fail(new RegisterAccountError({ reason: "PersistenceFailed" })),
  }),
)
```

A newly introduced tag left untranslated should be a type error until someone chooses its policy. Do not branch on `instanceof` or collapse distinct tags with a broad `Effect.mapError`. Use `mapError` only when the whole channel genuinely means one thing.

Keep defects and interruption distinct from expected failures; cause-level recovery (`Effect.catchCauseIf`) belongs only at supervision boundaries. A timeout or lost response on a mutation is uncertainty, not proof of failure.
