# Anti-Patterns

## Current in models

Bad:

```ruby
class Post < ApplicationRecord
  def destroy_with_audit
    self.deleted_by = Current.user
    destroy
  end
end
```

Why it hurts:
- hidden dependency on request-time state
- background jobs or other async paths may have no `Current`
- testing gets harder

Prefer:

```ruby
class Post < ApplicationRecord
  def destroy_with_audit(by:)
    self.deleted_by = by
    destroy
  end
end
```

## Request objects in services

Bad:

```ruby
class HandleWebhook
  def initialize(request:)
    @request = request
  end
end
```

Prefer extracting a value object or normalized input in the controller first.

## Notifications or integrations in models

Bad:

```ruby
class License < ApplicationRecord
  def prolong
    update!(status: :active)
    LicenseMailer.renewed(self).deliver_later
  end
end
```

Why it hurts:
- domain object now owns side effects outside domain state
- every caller pays for the side effect, even unexpected ones

Prefer moving the side effect to the existing orchestrator or an explicit event/subscriber.

## Business logic in controllers

Bad:

```ruby
class OrdersController < ApplicationController
  def create
    @order = Order.new(order_params)
    @order.total = @order.items.sum(&:subtotal)
    @order.total *= 0.9 if current_user.vip?
    @order.save!
  end
end
```

Prefer keeping HTTP concerns in the controller and moving business rules to the domain model or a nearby domain object.

## Anemic-model service sprawl

Bad smell:
- models only declare associations and validations
- services own pricing, discounting, state rules, or other model-native logic
- `app/services` becomes a flat pile of calculators and wrappers

Prefer rich domain models plus small orchestration services.

## Code-slicing concerns

Bad concern:
- groups “contact stuff” or “billing stuff” only to shorten a model
- not clearly reusable as a behavior
- still tightly coupled to one model's internals

Prefer a value object, associated object, or leaving the code in the model until a real behavior boundary emerges.

## Helper-built markup

Bad smell:
- helpers with many `tag.*` or `content_tag` calls
- big nested HTML structures hidden in Ruby

Prefer components or templates where markup is visible and view-specific logic is isolated.

## Anemic jobs

Bad:

```ruby
class NotifyRecipientsJob < ApplicationJob
  def perform(record)
    record.notify_recipients
  end
end
```

If the job is only async transport for one method call, consider whether the abstraction earns its cost.

## Testing the wrong layer

Bad smell:
- controller tests asserting pricing math
- request specs verifying domain invariants
- model specs mocking mail delivery and external APIs

Prefer testing each layer's own responsibility and letting extracted collaborators own their own tests.
