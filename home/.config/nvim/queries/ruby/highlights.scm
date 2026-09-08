;; extends

; assignment lhs member writes should highlight like variables/properties, not calls.
(assignment
  left: (call
    receiver: (_)
    method: (identifier) @variable.member)
  (#set! priority 130))

; Dot-call members on object chains should be variable/member-like (white).
; Keep bare calls yellow; only override calls with non-constant receivers.
(
  (call
    receiver: [
      (self)
      (instance_variable)
      (identifier)
      (call)
    ]
    method: (identifier) @variable.member)
  (#set! priority 130)
)

; Instance/class vars should follow builtin variable styling (same as self/super).
((instance_variable) @variable.builtin
  (#set! priority 140))

((class_variable) @variable.builtin
  (#set! priority 140))

; Hash label keys should be variable-like (white), not symbol-colored.
(hash_key_symbol) @variable.member

; Force hash label colons to operator color (red), matching `direction: nil`.
(pair
  ":" @operator
  (#set! priority 130))

(keyword_pattern
  ":" @operator
  (#set! priority 130))
