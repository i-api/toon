import type { FieldNode, JsonObject, JsonValue } from '../types.ts'
import type { EncodablePrimitive } from './raw-string.ts'
import { isEmptyObject, isEncodablePrimitive, isJsonObject } from './normalize.ts'
import { encodeKey } from './primitives.ts'

/** Classifies rows into a tabular field list, or undefined when they are not uniformly tabular. */
export function extractTabularFields(rows: readonly JsonObject[]): FieldNode[] | undefined {
  if (rows.length === 0)
    return

  const firstKeys = Object.keys(rows[0]!)
  if (firstKeys.length === 0)
    return

  // All objects must have the same set of keys (order per object may vary).
  for (const row of rows) {
    if (Object.keys(row).length !== firstKeys.length) {
      return
    }

    for (const key of firstKeys) {
      if (!Object.hasOwn(row, key)) {
        return
      }
    }
  }

  const fieldNodes: FieldNode[] = []
  for (const key of firstKeys) {
    const fieldNode = classifyColumn(key, rows.map(row => row[key]!))
    if (!fieldNode) {
      return
    }
    fieldNodes.push(fieldNode)
  }

  return fieldNodes
}

/** Classifies an object's values as a keyed tabular field list (>=2 uniform non-empty object entries), or undefined. */
export function extractKeyedTabularFields(value: JsonObject): FieldNode[] | undefined {
  const entryValues = Object.values(value)

  if (entryValues.length < 2) {
    return
  }

  if (!entryValues.every(entryValue => isJsonObject(entryValue) && !isEmptyObject(entryValue))) {
    return
  }

  return extractTabularFields(entryValues as JsonObject[])
}

/**
 * Width of an already-encoded cell in Unicode scalar values.
 *
 * Scalar count (not bytes, not display width) keeps every conforming encoder
 * byte-identical without a Unicode width table. It matches display width for
 * the ASCII data tables are mostly made of; CJK/emoji columns will not
 * visually align and that is documented, not hidden.
 */
export function scalarWidth(s: string): number {
  return [...s].length
}

/** Per-column maxima over a row-major grid of encoded cells. */
export function columnWidths(grid: readonly (readonly string[])[], leaves: number): number[] {
  if (leaves === 0)
    return []
  const out = Array.from({ length: leaves }).fill(0) as number[]
  for (const row of grid) {
    for (let j = 0; j < leaves; j++) {
      const w = scalarWidth(row[j] ?? '')
      if (w > out[j]!)
        out[j] = w
    }
  }
  return out
}

/** Number of leaf cells one row of this field list produces. */
export function countLeaves(fields: readonly FieldNode[]): number {
  let n = 0
  for (const field of fields) {
    n += field.children ? countLeaves(field.children) : 1
  }
  return n
}

export interface LeafSpan {
  /** Scalar offset of the leaf name's first char from the outer `{` (which sits at 0). */
  start: number
  /** Scalar offset one past the leaf name's last char. */
  end: number
}

/**
 * Renders the unpadded `{...}` field list and records each leaf name's span.
 * The measuring pass and the emitting pass must agree character-for-character,
 * so the emitter pads these same names in place and never re-measures them.
 */
export function measureFieldList(
  fields: readonly FieldNode[],
  delimiter: string,
): { text: string, spans: LeafSpan[] } {
  let text = '{'
  const spans: LeafSpan[] = []
  const render = (nodes: readonly FieldNode[]): void => {
    nodes.forEach((field, fi) => {
      if (fi > 0)
        text += delimiter
      const name = encodeKey(field.name)
      if (field.children) {
        text += `${name}{`
        render(field.children)
        text += '}'
      }
      else {
        const end = scalarWidth(text) + scalarWidth(name)
        spans.push({ start: end - scalarWidth(name), end })
        text += name
      }
    })
  }
  render(fields)
  text += '}'
  return { text, spans }
}

export interface HeaderPads {
  /** Spaces appended after each leaf name; the last entry is always 0. */
  pads: number[]
  /** Spaces inserted right after the outer `{`, closing a negative gutter. */
  lead: number
  /** False when the gutter exceeds the row width: emit the header spec-exact. */
  padHeader: boolean
}

/**
 * Decides leaf pads from measured spans plus column widths, widening widths
 * where a name plus its following syntax exceeds the data beneath.
 * Leaf 0 also absorbs the gutter; a negative gutter is closed by lead; an
 * excessive gutter refuses header padding while rows still align.
 * Mutates `widths` (widening only).
 */
export function headerLeafPads(
  spans: readonly LeafSpan[],
  widths: number[],
  gutter: number,
): HeaderPads {
  const n = spans.length
  if (n === 0)
    return { pads: [], lead: 0, padHeader: false }
  let lead = 0
  let g = gutter
  if (g < 0) {
    lead = -g
    g += lead
  }
  let rowWidth = n - 1
  for (const w of widths) rowWidth += w
  if (g > rowWidth)
    return { pads: Array.from({ length: n }).fill(0) as number[], lead: 0, padHeader: false }
  const pads = Array.from({ length: n }).fill(0) as number[]
  for (let j = 0; j < n - 1; j++) {
    const nameWidth = spans[j]!.end - spans[j]!.start
    const syntax = spans[j + 1]!.start - spans[j]!.end
    const owed = j === 0 ? g : 0
    const needed = nameWidth + syntax - 1 + owed
    if (widths[j]! < needed)
      widths[j] = needed
    pads[j] = widths[j]! - syntax + 1 - owed - nameWidth
  }
  pads[n - 1] = 0
  return { pads, lead, padHeader: true }
}

/** Joins encoded cells with the delimiter, padding every column but the last. */
export function joinPaddedCells(cells: readonly string[], widths: readonly number[], delimiter: string): string {
  return cells.map((cell, j) => {
    if (j + 1 >= cells.length)
      return cell
    return cell + ' '.repeat(Math.max(0, (widths[j] ?? 0) - scalarWidth(cell)))
  }).join(delimiter)
}

/** Reads one row's leaf cells in the field order `extractTabularFields` produced. */
export function collectRowLeaves(row: JsonObject, fields: readonly FieldNode[]): EncodablePrimitive[] {
  const leaves: EncodablePrimitive[] = []
  collectLeafValues(row, fields, leaves)
  return leaves
}

function classifyColumn(name: string, values: readonly JsonValue[]): FieldNode | undefined {
  // Uniform-primitive column: a bare leaf field.
  if (values.every(value => isEncodablePrimitive(value))) {
    return { name }
  }

  // Nested-uniform column: non-empty objects sharing one key set, classified recursively.
  if (!values.every(value => isJsonObject(value) && !isEmptyObject(value))) {
    return
  }

  const children = extractTabularFields(values as JsonObject[])
  if (!children) {
    return
  }

  return { name, children }
}

function collectLeafValues(row: JsonObject, fields: readonly FieldNode[], leaves: EncodablePrimitive[]): void {
  for (const field of fields) {
    const value = row[field.name]
    if (field.children) {
      collectLeafValues(value as JsonObject, field.children, leaves)
    }
    else {
      leaves.push(value as EncodablePrimitive)
    }
  }
}
