# Specification Test

Use for a focused layer-responsibility check on one file or directory.

## Pi usage

```bash
/skill:layered-rails spec-test app/controllers/orders_controller.rb
/skill:layered-rails spec-test app/services/
```

## Principle

Generate the test skeleton the code would need. Layer violations become obvious when the test contexts belong to another layer.

If a controller spec needs many pricing, persistence, or external-API contexts, too much logic is stuck in the controller.

## Process

1. **Identify the target layer**
   - controller/view/component/presenter → presentation
   - service/policy/operation → application
   - model/value object/query object → domain
   - adapter/client/storage code → infrastructure

2. **Generate a test skeleton**
   - focus on public behavior only
   - skip declarative noise like simple associations and enums
   - mark each context:
     - `✓` belongs in this layer
     - `⚠️` borderline, smells off
     - `✗` belongs elsewhere

3. **Find existing tests**
   - inspect matching `spec/` or `test/` files if present
   - compare actual test structure to the ideal skeleton
   - call out heavy setup, brittle mocks, or callback workarounds as symptoms

4. **Recommend extractions**
   - for each `✗` or important `⚠️`, name the target layer or pattern
   - show how the original test becomes simpler after extraction

## Guidance by layer

| Layer | Should mainly test |
| --- | --- |
| Presentation | auth, params, status codes, redirects, rendering |
| Application | orchestration, transaction flow, correct collaborators |
| Domain | business rules, calculations, validations, state transitions |
| Infrastructure | persistence and external system behavior |

## Output shape

```markdown
# Specification Test: path/to/file.rb

**Layer:** Domain
**Primary concern:** business rules

## Test skeleton
- ✓ contexts that belong here
- ⚠️ contexts that are borderline
- ✗ contexts that should move elsewhere

## Existing test analysis
- actual test structure
- symptoms of misplaced responsibilities

## Extraction recommendations
1. move X to Y
2. simplify original test to assert delegation/orchestration only
```

## Reference file

Read [`../references/core/specification-test.md`](../references/core/specification-test.md) before doing a deep pass.
