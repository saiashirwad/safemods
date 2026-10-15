import { Effect, Option, Order } from "effect"
import type { Node } from "typescript/unstable/ast"
import type * as Finding from "../Finding.ts"
import type { ProjectSnapshot } from "../Workspace/index.ts"

export interface Selection<A> extends Finding.Location {
  readonly value: A
  readonly project: ProjectSnapshot
}

export type Query<A, E = never, R = never> = Effect.Effect<ReadonlyArray<Selection<A>>, E, R>

const byPosition = (left: Selection<unknown>, right: Selection<unknown>): number =>
  Order.String(left.project.project.id, right.project.project.id) ||
  Order.String(left.fileName, right.fileName) ||
  left.start - right.start ||
  left.end - right.end

export const sorted = <A>(selections: ReadonlyArray<Selection<A>>): ReadonlyArray<Selection<A>> =>
  [...selections].sort(byPosition)

export const mapValues = <A, B, E, R>(
  self: Query<A, E, R>,
  f: (selection: Selection<A>) => B,
): Query<B, E, R> =>
  Effect.map(self, (all) => all.map((selection) => ({ ...selection, value: f(selection) })))

export const keepDefined = <A, B, E, R, E2, R2>(
  self: Query<A, E, R>,
  f: (selection: Selection<A>) => Effect.Effect<B | undefined, E2, R2>,
): Query<B, E | E2, R | R2> =>
  Effect.flatMap(self, (all) =>
    Effect.map(
      Effect.forEach(
        all,
        (selection) =>
          Effect.map(f(selection), (value) => value === undefined ? [] : [{ ...selection, value }]),
        { concurrency: "unbounded" },
      ),
      (kept) => kept.flat(),
    ))

export function filter<A, B extends A>(
  refinement: (selection: Selection<A>) => selection is Selection<B>,
): <E, R>(self: Query<A, E, R>) => Query<B, E, R>
export function filter<A>(
  predicate: (selection: Selection<A>) => boolean,
): <E, R>(self: Query<A, E, R>) => Query<A, E, R>
export function filter<A>(predicate: (selection: Selection<A>) => boolean) {
  return <E, R>(self: Query<A, E, R>): Query<A, E, R> =>
    Effect.map(self, (all) => all.filter(predicate))
}

export const where =
  <A, E2, R2>(test: (selection: Selection<A>) => Effect.Effect<boolean, E2, R2>) =>
  <E, R>(self: Query<A, E, R>): Query<A, E | E2, R | R2> =>
    keepDefined(
      self,
      (selection) => Effect.map(test(selection), (keep) => (keep ? selection.value : undefined)),
    )

export const selectionOf = <A extends Node>(
  project: ProjectSnapshot,
  node: A,
): Option.Option<Selection<A>> =>
  Option.map(project.fileNameOf(node.getSourceFile()), (fileName) => ({
    value: node,
    project,
    fileName,
    start: node.getStart(node.getSourceFile()),
    end: node.getEnd(),
  }))
