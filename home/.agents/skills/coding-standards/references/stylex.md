# StyleX authoring

Use this reference when authoring, reviewing, or refactoring StyleX styles, tokens, themes, or component styling APIs. Follow the parent coding standards for TypeScript safety, component ownership, and verification.

## Establish compatibility

Check the installed StyleX version, compiler configuration, React version, and browser targets before choosing APIs. In particular, verify support for `defineConsts`, relational selectors and markers, `viewTransitionClass`, and `positionTry`. Do not copy an experimental React import without checking the installed release's exports and types.

Reuse existing tokens, breakpoints, and themes before defining new ones. Keep style declarations statically analyzable by the StyleX compiler; use dynamic style functions for runtime values.

## Create and apply styles

Create styles with `stylex.create()`. Each namespace contains CSS properties. Prefer longhand properties and single-value shorthands over multi-value shorthands. Numeric length values are pixels by default; unitless properties remain unitless. Use explicit strings for other units.

```tsx
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  container: {
    display: 'flex',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'navy',
  },
});

function Heading() {
  return (
    <div {...stylex.props(styles.container)}>
      <h1 {...stylex.props(styles.title)}>Hello</h1>
    </div>
  );
}
```

Convert styles to element props with `stylex.props()`. Pass multiple styles or arrays to compose them. The last style wins for conflicting properties. Express conditional styling in JavaScript:

```tsx
<div
  {...stylex.props(
    styles.base,
    isActive && styles.active,
    isDisabled && styles.disabled,
    variant === 'primary' ? styles.primary : styles.secondary,
  )}
/>

<div {...stylex.props([styles.base, styles.highlighted])} />
```

Use `null` to unset a property during composition. This removes the StyleX declaration; it does not necessarily reset inherited values or other CSS to their browser defaults.

```tsx
const styles = stylex.create({
  base: { margin: 16, padding: 16 },
  reset: { margin: null, padding: null },
});

<div {...stylex.props(styles.base, styles.reset)} />
```

Do not add separate `className` or DOM `style` props to an element with a `stylex.props()` spread. Avoid prop spreads that silently overwrite the generated props. Compose all StyleX styles in a single call instead.

## Component style APIs and TypeScript

Use `StyleXStyles` and `StyleXStylesWithout`, not `StaticStyles` or `StaticStylesWithout`. A component may accept StyleX styles as a prop; this is distinct from passing a raw inline-style object to a DOM element. Apply local styles first and caller styles last when callers are allowed to override defaults.

```tsx
import * as stylex from '@stylexjs/stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  style?: StyleXStyles;
};

const styles = stylex.create({
  card: { padding: 16, borderRadius: 8 },
});

function Card({ children, style }: Props) {
  return <div {...stylex.props(styles.card, style)}>{children}</div>;
}
```

Constrain the style API when callers should control only specific properties:

```tsx
import type { StyleXStyles, StyleXStylesWithout } from '@stylexjs/stylex';

type ColorProps = {
  style?: StyleXStyles<{
    color?: string;
    backgroundColor?: string;
  }>;
};

type RestrictedProps = {
  style?: StyleXStylesWithout<{
    margin: unknown;
    padding: unknown;
    width: unknown;
    height: unknown;
  }>;
};
```

The exclusion example lists specific properties; it is not a comprehensive ban on layout properties or their longhand equivalents. Match constraints to the actual component contract.

Use `VarGroup` for variable-group types according to the installed API. Do not confuse a variable group with the applied styles returned by `stylex.createTheme()`; apply the latter using `stylex.props()`.

## Pseudo-classes and pseudo-elements

Nest pseudo-classes inside property values. Each conditional value requires a `default` entry; use `null` when no default declaration should apply.

```tsx
const styles = stylex.create({
  button: {
    backgroundColor: {
      default: 'lightblue',
      ':hover': 'blue',
      ':active': 'darkblue',
      ':focus-visible': 'royalblue',
      ':disabled': 'gray',
    },
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
  },
});
```

Use state pseudo-classes such as `:hover`, `:active`, `:focus`, `:focus-visible`, and `:focus-within`. Preserve a visible keyboard-focus indication. Prefer JavaScript-selected styles over structural pseudo-classes such as `:first-child` and `:nth-child` to limit generated selector variants.

Unlike pseudo-classes, pseudo-elements are top-level keys within a namespace:

```tsx
const styles = stylex.create({
  input: {
    color: 'black',
    '::placeholder': {
      color: 'gray',
      fontStyle: 'italic',
    },
    '::selection': {
      backgroundColor: 'yellow',
    },
  },
});
```

Prefer actual HTML elements over `::before` and `::after` to limit selector variants and keep meaningful content accessible. Choose appropriate semantics; mark purely decorative elements as hidden from assistive technology when needed.

## Media queries and other conditions

Nest `@media`, `@supports`, and `@container` queries inside property values, not at the namespace's top level. Include `default`, using `null` when appropriate.

```tsx
const styles = stylex.create({
  container: {
    flexDirection: {
      default: 'column',
      '@media (min-width: 768px)': 'row',
    },
    padding: {
      default: 8,
      '@media (min-width: 768px)': 16,
      '@media (min-width: 1024px)': 24,
    },
  },
});
```

For app-wide breakpoints, define shared query constants with `stylex.defineConsts()` and use them as computed condition keys.

## Constants and variables

Use `stylex.defineConsts()` for shared static values that do not need theming or runtime overrides, including media queries, fixed colors, font sizes, and animation values. Prefer it over `defineVars()` for these values.

Use `stylex.defineVars()` only when values need theming or runtime overrides. CSS variable length values need explicit units, such as `'16px'`.

For both APIs:

- Declare groups in `.stylex.ts` or `.stylex.js` files.
- Use named exports, never default exports.
- Export only StyleX constant or variable groups from these files; keep components, helpers, themes, and other exports elsewhere.
- Do not import ordinary JavaScript constants into static style declarations in place of StyleX constants or variables.

```tsx
// constants.stylex.ts
import * as stylex from '@stylexjs/stylex';

export const breakpoints = stylex.defineConsts({
  tablet: '@media (min-width: 768px)',
  desktop: '@media (min-width: 1024px)',
});

export const spacing = stylex.defineConsts({
  small: 8,
  medium: 16,
  large: 24,
});

export const zIndices = stylex.defineConsts({
  modal: 1000,
  tooltip: 1100,
  toast: 1200,
});
```

```tsx
// tokens.stylex.ts
import * as stylex from '@stylexjs/stylex';

export const colors = stylex.defineVars({
  primary: 'blue',
  secondary: 'gray',
  text: 'black',
  background: 'white',
});
```

```tsx
import * as stylex from '@stylexjs/stylex';
import { breakpoints, spacing } from './constants.stylex';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  container: {
    backgroundColor: colors.background,
    color: colors.text,
    padding: {
      default: spacing.small,
      [breakpoints.tablet]: spacing.medium,
      [breakpoints.desktop]: spacing.large,
    },
  },
});
```

## Themes

Use `stylex.createTheme()` to override a variable group for a DOM subtree. Themes do not need to live in `.stylex.ts` files and may be passed between components. Descendants inherit the overridden CSS variables unless a nearer theme overrides them.

```tsx
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors } from './tokens.stylex';

const darkTheme = stylex.createTheme(colors, {
  primary: 'lightblue',
  secondary: 'gray',
  text: 'white',
  background: '#1a1a1a',
});

function ThemeProvider({
  isDark,
  children,
}: {
  isDark: boolean;
  children: ReactNode;
}) {
  return <div {...stylex.props(isDark && darkTheme)}>{children}</div>;
}
```

## Dynamic styles

Use arrow-function namespaces for runtime values instead of inline DOM styles or unresolvable static imports. Keep finite variants as static namespaces selected with JavaScript.

```tsx
const styles = stylex.create({
  bar: (width: number) => ({ width }),
  positioned: (x: number, y: number) => ({
    transform: `translate(${x}px, ${y}px)`,
  }),
});

<div {...stylex.props(styles.bar(100))} />
<div {...stylex.props(styles.positioned(mouseX, mouseY))} />
```

## Relational selectors

Use `stylex.when.ancestor()`, `stylex.when.descendant()`, `stylex.when.anySibling()`, `stylex.when.siblingBefore()`, or `stylex.when.siblingAfter()` when styles depend on another element's state. Mark the observed element using `stylex.defaultMarker()` or a custom marker from `stylex.defineMarker()`. Check the installed API for custom-marker arguments and selector support.

```tsx
const styles = stylex.create({
  card: {
    transform: {
      default: 'translateX(0)',
      [stylex.when.ancestor(':hover')]: 'translateX(10px)',
    },
  },
});

<div {...stylex.props(stylex.defaultMarker())}>
  <div {...stylex.props(styles.card)}>Hover the parent to move me</div>
</div>
```

## Browser fallbacks

Use `stylex.firstThatWorks()` for ordered CSS value fallbacks, with the preferred value first. It handles CSS value support, not arbitrary feature detection or JavaScript polyfills.

```tsx
const styles = stylex.create({
  header: {
    position: stylex.firstThatWorks('sticky', '-webkit-sticky', 'fixed'),
    display: stylex.firstThatWorks('grid', 'flex'),
  },
});
```

Choose fallbacks whose layout and behavior remain usable; a syntactically supported value alone does not establish compatibility.

## Keyframe animations

Define animations with `stylex.keyframes()` and apply them through longhand animation properties. Account for reduced-motion preferences.

```tsx
const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  animated: {
    animationName: fadeIn,
    animationDuration: {
      default: '0.3s',
      '@media (prefers-reduced-motion: reduce)': '0s',
    },
    animationTimingFunction: 'ease-out',
  },
});
```

Keyframes may also use percentage keys such as `'0%'` and `'100%'`.

## View transitions

Where supported, use `stylex.viewTransitionClass()` to customize View Transition API animations. Its `group`, `imagePair`, `old`, and `new` entries style the corresponding view-transition pseudo-elements.

```tsx
const fadeInUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(-30px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const transitionClass = stylex.viewTransitionClass({
  old: { animationDuration: '0.3s' },
  new: { animationName: fadeInUp, animationDuration: '0.3s' },
});

// ViewTransition must come from the API supported by the installed React release.
<ViewTransition default={transitionClass}>{children}</ViewTransition>
```

Verify React integration, browser support, and reduced-motion behavior before shipping. Do not assume the `unstable_ViewTransition` export exists in every React version.

## Anchor positioning

Where supported, use `stylex.positionTry()` to define CSS anchor-positioning fallbacks and reference the result through `positionTryFallbacks`.

```tsx
const fallback = stylex.positionTry({
  positionAnchor: '--anchor',
  top: '0',
  left: '0',
  width: '100px',
  height: '100px',
});

const styles = stylex.create({
  tooltip: {
    positionTryFallbacks: fallback,
  },
});
```

This declares a fallback, not a complete anchored tooltip. Configure the anchor and positioned element separately, and verify overflow behavior and usability in browsers without anchor-positioning support.

## Completion check

Complete when every applicable rule above has been checked:

- Styles use `create()` and are applied/composed through `props()` without competing DOM `style` or `className` props.
- Merge order, caller overrides, conditional variants, and `null` unsets match the intended contract.
- Pseudo-classes and queries are property-level conditions with defaults; pseudo-elements use namespace-level keys.
- Shared constants and variables follow file/export rules, and only values that need theming or runtime overrides use variables.
- Dynamic values use style functions; component style types express the intended allowed overrides.
- Selected APIs are supported by the installed compiler, library, React release, and browser targets.
- The real StyleX build and relevant typecheck/lint checks pass, or failures are reported with evidence.
- Changed UI has been checked at relevant breakpoints and interaction states, including keyboard focus, disabled states, themes, reduced motion, and fallbacks where applicable.

## Resources

- Official documentation: https://stylexjs.com
- API reference: https://stylexjs.com/docs/api
- Source and release history: https://github.com/facebook/stylex
