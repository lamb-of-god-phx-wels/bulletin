/**
 * Nominal branding helpers.
 *
 * A branded type `Brand<Base, Tag>` is structurally identical to `Base` at
 * runtime, but is a distinct type at compile-time.  Cross-assignment between
 * different branded types is a compile-time error.
 */

// The symbol is only used as a phantom type key; it is never accessed at
// runtime.  Using a unique symbol (not just `symbol`) means two Brand<string,
// "A"> declarations with different `declare const` symbols are still
// structurally distinct, which is what we want for the cross-assignment tests.
declare const __brand: unique symbol;

export type Brand<Base, Tag extends string> = Base & {
  readonly [__brand]: Tag;
};
