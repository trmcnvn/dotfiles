# Extraction Signals

## Callback scoring

| Score | Meaning | Default move |
| --- | --- | --- |
| 5/5 | transformer or required derived value | keep |
| 4/5 | normalizer or consistency maintainer | usually keep |
| 3/5 | light bookkeeping | acceptable |
| 2/5 | observer / async trigger | review |
| 1/5 | business step / side effect / orchestration | extract |

Examples to keep:

```ruby
before_validation :normalize_email
before_save :set_word_count
```

Examples to extract:

```ruby
after_commit :send_welcome_email
after_save :sync_to_crm
after_create :create_default_workspace
```

## God-object signals

Strong signals:
- high line count plus high churn
- many unrelated public methods
- clusters like auth + billing + notifications in one class
- many callbacks, scopes, concerns, or delegation targets
- conditionals everywhere based on role or state

Useful splits:
- behavioral concerns for truly shared behavior
- value objects for grouped domain data
- delegate/associated objects for a distinct subdomain
- services for orchestration, not core business rules
- state machines for dense transition logic

## Concern health

Healthy concern:
- represents one behavior
- can be reasoned about in isolation
- is reusable across multiple models

Unhealthy concern:
- groups code by artifact type instead of behavior
- exists only to make a huge model look shorter
- hides many assumptions about the host class

## Service-layer signals

A service is probably okay when it:
- coordinates multiple objects
- defines transaction boundaries
- decides call order for a use case

A service is probably misplaced when it:
- only calculates data from one model's own fields
- mirrors a single model method with no orchestration value
- accumulates many unrelated helper methods

## Controller fat signals

Extract when you see:
- pricing or discount logic
- multi-step domain branching
- external API calls
- many model mutations in one action
- long actions whose tests mostly describe non-HTTP behavior

Keep in controller:
- auth and authorization entry points
- params parsing
- rendering and redirects
- choosing which application/domain object to invoke

## Testing signals

Mis-layered code often shows up as:
- request specs testing pricing, validation, or state rules
- model specs stubbing mailers and APIs
- lots of callback skipping in test setup
- slow or brittle tests for small pieces of business logic
