; extend

(
  (style_element
    (start_tag
      (attribute
        (quoted_attribute_value (attribute_value) @_lang)))
    (raw_text) @injection.content)
  (#match? @_lang "postcss")
  (#set! injection.language "css")
)
