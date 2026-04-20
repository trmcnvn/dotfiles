# Architecture Layers

## Four layers

Layered Rails keeps code moving one way:

```text
Presentation → Application → Domain → Infrastructure
```

| Layer | Responsibility | Common Rails examples |
| --- | --- | --- |
| Presentation | Handle input, auth, response, UI composition | controllers, views, serializers, presenters, form/filter objects |
| Application | Coordinate use cases | services, policies, operations |
| Domain | Own rules, state, and calculations | models, value objects, query objects, domain events |
| Infrastructure | Talk to databases and external systems | Active Record, API clients, storage, queues |

## Four rules

### 1. Unidirectional flow

Information can move downward. Lower layers should not reach upward for context.

### 2. No reverse dependencies

Domain and infrastructure code should not depend on controllers, request objects, or presentation-time state.

Bad:

```ruby
class HandleWebhook
  def initialize(request:)
    @request = request
  end
end

class Order < ApplicationRecord
  def approve!
    self.approved_by = Current.user
  end
end
```

Better:

```ruby
class HandleWebhook
  def initialize(event:)
    @event = event
  end
end

class Order < ApplicationRecord
  def approve!(by:)
    self.approved_by = by
  end
end
```

### 3. Single-layer abstractions

An object should mainly belong to one layer. If its tests or dependencies span multiple layers, it is probably misplaced.

### 4. Minimal connections

Every extra cross-layer dependency increases coupling. Keep collaboration paths short and explicit.

## Layer instincts

### Presentation

Should mostly deal with:
- auth and permissions entry points
- params parsing
- rendering, redirects, status codes
- view formatting and component composition

Should not own:
- pricing rules
- domain calculations
- persistence orchestration across many entities
- external API plumbing

### Application

Should mostly deal with:
- use-case orchestration
- transaction boundaries
- calling the right domain objects
- coordinating notifications or jobs after state changes

Should not own:
- raw request parsing
- business rules that only concern one model

### Domain

Should mostly deal with:
- invariants and validations
- calculations
- state transitions
- business meaning

Should not own:
- mail delivery
- request context
- API client calls
- incidental UI formatting

### Infrastructure

Should mostly deal with:
- persistence
- technical adapters
- external integrations

Should not own:
- business policy or application flow

## Quick checks

Ask these often:

- Would this code still make sense with no HTTP request around?
- Does this class need Current/request/session to do domain work?
- Are tests for this class mostly about another layer's concerns?
- Is this service orchestrating, or quietly becoming a dumping ground for domain logic?
