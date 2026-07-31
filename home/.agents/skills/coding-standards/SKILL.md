---
name: coding-standards
description: Language-specific coding standards. Use when reading or editing source code, or when another skill needs the user's coding standards.
---

# Coding Standards

Identify every implementation language in the changed surface and read each available matching reference completely before editing:

| Language | Files | Reference |
|---|---|---|
| TypeScript | `.ts`, `.tsx` | [`references/typescript.md`](references/typescript.md) |
| TypeScript with Effect | `.ts`, `.tsx` using `effect` | [`references/typescript.md`](references/typescript.md) and [`references/typescript-effect.md`](references/typescript-effect.md) |
| Rust | `.rs` | [`references/rust.md`](references/rust.md) |

Apply the reference to the complete behavior being changed while preserving compatible repository conventions. For languages without a reference, follow the repository's local standards and existing patterns.
