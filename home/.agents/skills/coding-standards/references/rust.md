# Rust

Use these rules when reading or editing `.rs` files, Cargo manifests, build scripts, or Rust-facing FFI. Match the repository's supported Rust version, lint policy, runtime, error crates, feature strategy, and public API conventions before introducing a local pattern.

| Rule | Standard |
|---|---|
| Ownership | Borrow when observation is enough; transfer or clone ownership deliberately. |
| Type modeling | Use enums and newtypes to make invalid states and unit mix-ups unrepresentable. |
| Errors | Return `Result` for recoverable failures and reserve panics for bugs or documented invariants. |
| APIs | Follow Rust naming and conversion conventions; expose the smallest stable surface. |
| Traits | Implement standard traits eagerly when their semantics are truthful. |
| Iteration | Prefer iterator and pattern APIs that express ownership and exhaustiveness directly. |
| Resources | Use RAII and explicit ownership; provide explicit shutdown when `Drop` cannot report or must not block. |
| Async | Keep blocking work off executors, bound concurrency, and design for cancellation. |
| Unsafe | Keep unsafe code minimal, documented, and enclosed by a sound safe abstraction. |
| Cargo | Keep dependencies and features minimal; features are additive and public changes respect SemVer. |
| Tests | Test public behavior, invariants, error paths, documentation, and relevant feature combinations. |
| Tooling | Let `rustfmt`, rustc, and Clippy enforce mechanical and idiomatic checks. |
| Performance | Measure optimized builds; improve algorithms and allocations only where evidence identifies a hot path. |

## Ownership and borrowing

Design ownership around the caller's needs:

- accept `&T`, `&str`, or `&[T]` when the callee only observes a value;
- accept `&mut T` when mutation should remain owned by the caller;
- accept `T` when the operation consumes, stores, transfers, or may avoid cloning it;
- return owned values when the result must outlive local inputs;
- use `Cow` only when callers materially benefit from a borrow-or-own result;
- add explicit lifetime parameters only when they describe a real relationship the compiler cannot elide.

Prefer borrowed input forms that accept more callers:

```rust
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().map(|byte| u64::from(*byte)).sum()
}
```

A call to `clone` is an explicit ownership and potential allocation decision. Clone where ownership is required and the cost is acceptable; do not clone merely to silence the borrow checker. Restructure scopes, borrow fields independently, or move ownership when those choices better express the design. Do not contort APIs or introduce shared ownership solely to eliminate a cheap, clear clone.

Use `Rc` for single-threaded shared ownership and `Arc` for cross-thread shared ownership only when there are genuinely multiple owners. Interior mutability (`Cell`, `RefCell`, `Mutex`, `RwLock`, atomics) represents real shared mutation and requires an explicit synchronization or runtime-borrowing policy.

## Type modeling

Use the type system to encode domain distinctions and legal states.

### Newtypes

A type alias does not create a static distinction. Use a newtype when values share a representation but must not be mixed, when construction has an invariant, or when the inner representation should stay private.

```rust
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct UserId(u64);

impl UserId {
    pub fn new(value: u64) -> Option<Self> {
        (value != 0).then_some(Self(value))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}
```

Keep fields private when constructors or invariants matter. Implement `From` only for infallible, lossless, obvious conversions; use `TryFrom` for validation and named methods for contextual, lossy, or surprising conversions.

### Enums and state

Use enums when variants carry different data or permit different operations. Avoid boolean flags plus optional fields that admit contradictory values.

```rust
enum JobState {
    Pending,
    Running { started_at: Instant },
    Failed { error: JobError },
    Complete { output: JobOutput },
}
```

Match internal closed enums exhaustively. Use wildcard arms only when the input is intentionally open, such as a public `#[non_exhaustive]` enum from another crate, and give unknown variants an explicit policy.

Use `Option<T>` for ordinary absence and `Result<T, E>` when the caller needs a reason. Prefer a dedicated enum or options type over boolean parameters whose meaning is unclear at the call site.

Builders earn their place for complex construction with many optional values or staged validation. Keep direct constructors for simple required inputs. Use typestate only when compile-time transition safety offsets the API and compile-time complexity.

## Errors and panics

Recoverable failures return `Result<T, E>`. Use `?` to propagate while preserving the original source and add context at the boundary that understands the failed operation.

Library APIs expose concrete, documented error types that callers can inspect without parsing messages. Application entrypoints may use an established report-style error when only logging and termination remain. Keep error variants as precise as caller recovery and observability require.

```rust
#[derive(Debug)]
pub enum LoadConfigError {
    Read(std::io::Error),
    Parse(ParseConfigError),
}
```

Implement `Display` and `std::error::Error` for public error types, normally through the repository's established derive crate when one already exists. Preserve underlying sources. Classify errors by variants or fields, never by matching display text.

Use `panic!`, `unreachable!`, or assertions for programmer bugs, violated internal invariants, and states that safe callers cannot produce. Do not use them for expected I/O, input, configuration, protocol, or persistence failures.

Avoid `unwrap` and `expect` in production paths unless the invariant is immediate and evident. When one is justified, use `expect` with a message that states why the value must exist rather than restating what failed:

```rust
let root = roots.first().expect("validated configuration has at least one root");
```

Tests, examples, and one-shot startup code may use `unwrap` when failure is intentionally fatal and additional error handling would obscure the example or boundary.

## Public API design

Follow standard Rust naming:

- types and traits use `UpperCamelCase`;
- functions, methods, modules, and variables use `snake_case`;
- constants use `SCREAMING_SNAKE_CASE`;
- getters use `name()`, not `get_name()`;
- conversions use `as_`, `to_`, and `into_` according to borrowing and ownership;
- collection iteration methods use `iter`, `iter_mut`, and `into_iter`.

Functions with a clear receiver are methods. Constructors are inherent associated functions such as `new`, `with_capacity`, or a domain-specific name. Do not use out-parameters when returning a value is clearer.

Expose only what callers need. Start private, then use `pub(crate)` or narrower visibility before `pub`. Keep public struct fields private when future evolution or invariants matter. Use intentional crate-root re-exports for the supported public surface; avoid external glob imports.

Implement common traits when their meaning is correct and unsurprising: `Debug`, `Clone`, `Copy`, `Default`, `Eq`, `Ord`, `Hash`, `Display`, `FromIterator`, `Extend`, `AsRef`, and conversions. Do not derive ordering, hashing, copying, or defaults when the generated semantics misrepresent the domain.

Use `Deref` and `DerefMut` only for smart-pointer-like types. Operator overloads must have conventional meaning. Prefer static dispatch with generics when it improves reuse without obscuring the API; use `dyn Trait` for runtime heterogeneity or when compile-time/code-size trade-offs justify it.

For public libraries:

- use `#[non_exhaustive]` when downstream exhaustive construction or matching would prevent intended evolution;
- seal traits when downstream implementations would prevent compatible evolution;
- avoid tightening generic bounds or changing public representations in compatible releases;
- treat changes to public items, trait methods, enum variants, features, MSRV, and layout guarantees as SemVer decisions.

## Modules and dependencies

Organize modules around cohesive concepts, not arbitrary file-size limits. Keep implementation details private and place tests near private behavior only when that behavior cannot be exercised meaningfully through the public surface.

Use the standard library and existing dependencies before adding a crate. Add a dependency only when its maintained implementation, interoperability, or risk reduction outweighs compile time, supply-chain, feature, and API costs. Disable dependency default features only with evidence and inspect the resolved feature graph when behavior is surprising.

Avoid global mutable state. Prefer explicit ownership and dependency construction at the application boundary. Use `OnceLock`, `LazyLock`, or an established equivalent only for genuinely process-wide immutable initialization or carefully synchronized state.

## Iterators, collections, and patterns

Use `iter`, `iter_mut`, or `into_iter` to communicate borrowing, mutation, or ownership. Prefer iterator adapters when they make the transformation clearer; prefer a loop when control flow, early exits, mutation, or diagnostics are clearer imperatively.

Iterator adapters are lazy. Consume them deliberately and do not collect an intermediate collection unless ownership, reuse, sorting, random access, or an API boundary requires one.

```rust
let active_names: Vec<_> = users
    .iter()
    .filter(|user| user.is_active())
    .map(|user| user.name.as_str())
    .collect();
```

Use pattern matching to make variants and destructuring explicit. Prefer exhaustive `match` for closed domain state, `if let` for one interesting variant, and `let ... else` for an early-exit precondition. Avoid wildcard patterns that conceal newly added internal variants.

Choose collections by access pattern and measured needs. Use entry APIs for one-lookup map updates, reserve capacity when size is known, and avoid indexing when lookup can fail—use `get`, iteration, or pattern APIs that expose absence.

## Resources and cleanup

Tie resource lifetime to ownership and RAII. A type that owns a file, socket, lock, temporary directory, subscription, or native handle releases it on every exit path.

`Drop` cannot report failure and should not perform surprising blocking work. When shutdown can fail, must flush, or may block, provide an explicit `close`, `shutdown`, or `finish` operation and keep `Drop` as a safe fallback.

Do not leak resources intentionally with `mem::forget`, `Box::leak`, or detached tasks unless process-lifetime ownership is the deliberate contract.

## Concurrency and async Rust

Prefer message passing or ownership transfer over shared mutable state when it keeps invariants local. When sharing state, choose synchronization from the access pattern and keep critical sections short.

- Do not hold a standard-library lock guard across `.await`.
- Use an async mutex across `.await` only when the protected resource truly requires it.
- Bound queues, task fan-out, and parallel work; define the backpressure policy.
- Keep CPU-heavy and blocking I/O off async executor threads.
- Use `spawn_blocking` for bounded blocking work that eventually finishes; use dedicated threads or a CPU pool for long-lived or heavily parallel CPU work.
- Retain and await task handles unless a supervisor explicitly owns detached work.
- Propagate cancellation and define graceful shutdown: signal children, stop intake, and await completion.

Cancellation occurs at `.await`. Before using `select!`, timeouts, or racing futures, verify that dropping and recreating each pending operation cannot lose data or violate an invariant. When polling order is biased, prove that always-ready branches cannot starve shutdown or lower-priority work.

Use the runtime already selected by the repository. Do not introduce runtime-specific types into domain APIs unless the runtime is intentionally part of the public contract.

## Unsafe Rust and FFI

Prefer safe Rust. Introduce `unsafe` only when required for FFI, low-level ownership, performance proven by measurement, or an abstraction impossible to express safely.

For every unsafe operation:

- keep the unsafe block as small as practical;
- state the exact `SAFETY:` invariants that make the operation valid;
- validate all safe inputs before entering the block;
- keep invariant-bearing fields private to the owning module;
- expose a safe API only when safe callers cannot trigger undefined behavior;
- document `# Safety` requirements on every `unsafe fn` and unsafe trait;
- audit `unsafe impl Send` and `Sync` against every field and future mutation path;
- add tests around boundary cases, while recognizing tests cannot prove soundness.

```rust
// SAFETY: `index < bytes.len()` was checked above, so the element is initialized
// and within the same allocation.
let byte = unsafe { *bytes.get_unchecked(index) };
```

Unsafe soundness depends on surrounding safe code that maintains its invariants. Treat the whole owning module—not only the block—as the audit boundary. For FFI, use explicit `repr(C)` only where layout is part of the contract, validate pointers and lengths, define ownership transfer, and prevent unwinding across boundaries that do not support it.

## Cargo features and compatibility

Cargo features are additive capabilities. Enabling one must not disable or silently replace another feature's behavior. Avoid mutually exclusive features; split crates or choose behavior at runtime when practical.

- Keep default features small and stable; removing one from the default set may be breaking.
- Use `dep:` when an optional dependency is an implementation detail rather than a public feature name.
- Document public features and required combinations.
- Test the supported matrix: default, no-default, all-features when compatible, and important combinations.
- Inspect activation with `cargo tree -e features` when needed.
- Do not move existing public APIs behind a feature in a compatible release.

Respect the repository's minimum supported Rust version. Raising it is a compatibility decision for published libraries.

## Documentation

Public libraries have useful crate-level documentation and rustdoc for caller-facing items. Documentation explains the contract rather than translating syntax into prose.

Include sections when applicable:

- `# Errors` for recoverable failure conditions;
- `# Panics` for documented panic conditions;
- `# Safety` for caller obligations of unsafe APIs;
- examples that demonstrate normal use and compile as doctests.

Use intra-doc links for related types and operations. Keep implementation details private or hidden rather than documenting an unstable internal surface. Update release notes for significant published API or behavior changes.

## Testing

Test observable behavior at the narrowest interface that provides the required confidence:

- unit tests for pure logic, private invariants, and edge cases;
- integration tests through the public crate or application boundary;
- doctests for public API examples;
- property tests for parsers, roundtrips, state transitions, and algebraic invariants when generated cases add meaningful coverage;
- concurrency model tests when ordering, synchronization, or cancellation is the behavior under test;
- platform and feature-matrix tests for supported configurations.

Assert returned values, errors, state, output, or interactions visible through a real boundary. Avoid sleeps in concurrent tests; use barriers, channels, paused time, or runtime-specific deterministic controls. Do not add production abstractions solely to permit mocking.

## Formatting, linting, and verification

Use default `rustfmt` unless the repository documents another style. Do not hand-format against `rustfmt` or create unrelated formatting churn.

Run the repository's established checks. When it has no wrapper, the relevant baseline is:

```bash
cargo fmt --check
cargo check --all-targets
cargo clippy --all-targets -- -D warnings
cargo test
```

Add the repository's supported feature combinations, targets, documentation build, or MSRV check when the changed behavior depends on them. Use Clippy from the same toolchain as the build. Enable `clippy::pedantic` selectively and never enable the entire `restriction` group; allow a lint locally with a reason when the lint conflicts with clearer or more correct code.

Treat compiler and Clippy warnings as design feedback, not commands to add clones, allocations, casts, or complexity blindly.

## Performance

Optimize only with evidence from representative release builds. Improve algorithms, data structures, I/O shape, and avoided work before low-level micro-optimizations.

Measure allocations and copies before changing ownership for speed. Reserve collection capacity when the size is known, avoid unnecessary intermediate collections, and use borrowing to avoid copies where it keeps the API clear. Document non-obvious hot-path code with the measurement and workload that justify it.

Do not add unsafe code for performance without a benchmark demonstrating material benefit and tests covering the safe abstraction.

## Completion check

Before completing a Rust change, verify that:

- ownership, borrowing, and cloning match the value's real lifetime and cost;
- types encode relevant distinctions and closed states are exhaustive;
- recoverable failures use `Result` while panics represent documented invariants or bugs;
- public APIs follow Rust naming, trait, visibility, documentation, and compatibility conventions;
- resources, threads, tasks, queues, and shutdown have explicit owners and bounds;
- async cancellation and blocking behavior are safe;
- every unsafe operation has documented invariants enclosed by a sound module boundary;
- dependencies and features are necessary, additive, documented, and tested in supported combinations;
- tests exercise the changed behavior and invariants at the appropriate boundary;
- performance claims come from representative optimized measurements; and
- formatting, compilation, Clippy, tests, and applicable documentation or feature checks pass.
