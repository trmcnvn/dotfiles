# The Specification Test

## Core idea

If the specification for an object needs to describe behavior outside that object's layer, the code is carrying responsibilities that should move.

The easiest way to see that is to sketch the tests the object would need.

## How to use it

1. Identify the object's layer.
2. Write the describe/context skeleton for its public behavior.
3. Mark each test context:
   - `✓` fits the layer
   - `⚠️` borderline
   - `✗` belongs in another layer
4. Extract the `✗` concerns downward or sideways into the right abstraction.

## What each layer should mostly test

| Layer | Test focus |
| --- | --- |
| Presentation | auth, params, response codes, redirects, rendering |
| Application | orchestration, transactions, collaborator calls |
| Domain | calculations, validations, state transitions, business rules |
| Infrastructure | persistence and adapter behavior |

## Example: fat controller

```ruby
class OrdersController < ApplicationController
  def create
    @order = Order.new(order_params)
    @order.total = @order.items.sum(&:subtotal)
    @order.total *= 0.9 if current_user.vip?
    WarehouseApi.create_order(@order)

    if @order.save
      OrderMailer.confirmation(@order).deliver_later
      redirect_to @order
    else
      render :new
    end
  end
end
```

The controller spec skeleton would need:

- ✓ unauthenticated request handling
- ✓ bad params / error response handling
- ✗ VIP discount behavior
- ✗ pricing math
- ✗ warehouse sync behavior
- ✗ email delivery behavior

That tells you pricing belongs in domain code, sync belongs in infrastructure/application orchestration, and email delivery belongs outside the controller.

## Example: anemic service

```ruby
class CalculateOrderTotalService
  def call(order)
    order.items.sum(&:subtotal) * discount_for(order)
  end
end
```

If the service spec is mostly about an order's own pricing rules, the behavior likely belongs on `Order` or a domain object close to it.

## Existing tests matter too

When real tests already exist, inspect them for symptoms:

- heavy factory setup for what should be unit logic
- request specs proving pricing or validation rules
- model tests stubbing mailers or APIs
- callback bypasses or save hacks in setup

Those testing pains often mirror the layer problem.

## Good extraction result

After extraction:

- controller tests get shorter
- service tests mostly assert orchestration
- model tests become faster and more focused
- external side effects move to subscribers/jobs/deliveries with their own tests
