import type { Depth, FieldNode, JsonArray, JsonObject, JsonValue, ResolvedEncodeOptions } from '../types.ts'
import type { EncodablePrimitive } from './raw-string.ts'
import { COMMA, LIST_ITEM_MARKER, LIST_ITEM_PREFIX } from '../constants.ts'
import { isArrayOfArrays, isArrayOfObjects, isArrayOfPrimitives, isEmptyObject, isEncodablePrimitive, isJsonArray, isJsonObject } from './normalize.ts'
import { encodeAndJoinPrimitives, encodeKey, encodePrimitive, formatHeader, formatHeaderWithPads } from './primitives.ts'
import { collectRowLeaves, columnWidths, countLeaves, extractKeyedTabularFields, extractTabularFields, headerLeafPads, joinPaddedCells, measureFieldList, scalarWidth } from './tabular.ts'

// #region Encode normalized JsonValue

export function* encodeJsonValue(value: JsonValue, options: ResolvedEncodeOptions, depth: Depth): Generator<string> {
  if (isEncodablePrimitive(value)) {
    const encodedPrimitive = encodePrimitive(value, options.delimiter)

    if (encodedPrimitive !== '')
      yield encodedPrimitive

    return
  }

  if (isJsonArray(value)) {
    yield* encodeArrayLines(undefined, value, depth, options)
  }
  else if (isJsonObject(value)) {
    // A keyed-eligible root object uses the keyless keyed header.
    const keyedFields = extractKeyedTabularFields(value)
    if (keyedFields) {
      yield* encodeKeyedObjectLines(undefined, value, keyedFields, depth, options)
      return
    }

    yield* encodeObjectLines(value, depth, options)
  }
}

// #endregion

// #region Object encoding

function* encodeObjectLines(
  value: JsonObject,
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  for (const [key, val] of Object.entries(value)) {
    yield* encodeKeyValuePairLines(key, val, depth, options)
  }
}

function* encodeKeyValuePairLines(
  key: string,
  value: JsonValue,
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  const encodedKey = encodeKey(key)

  if (isEncodablePrimitive(value)) {
    yield indentedLine(depth, `${encodedKey}: ${encodePrimitive(value, options.delimiter)}`, options.indentSize)
  }
  else if (isJsonArray(value)) {
    yield* encodeArrayLines(key, value, depth, options)
  }
  else if (isJsonObject(value)) {
    const keyedFields = extractKeyedTabularFields(value)
    if (keyedFields) {
      yield* encodeKeyedObjectLines(key, value, keyedFields, depth, options)
      return
    }

    yield indentedLine(depth, `${encodedKey}:`, options.indentSize)
    if (!isEmptyObject(value)) {
      yield* encodeObjectLines(value, depth + 1, options)
    }
  }
}

// #endregion

// #region Keyed tabular objects

function* encodeKeyedObjectLines(
  key: string | undefined,
  value: JsonObject,
  fields: readonly FieldNode[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  const entries = Object.entries(value)
  const leaves = countLeaves(fields)
  if (!options.pretty || leaves < 2) {
    const header = formatHeader(entries.length, { key, fields, delimiter: options.delimiter, keyed: true })
    yield indentedLine(depth, header, options.indentSize)
    yield* encodeKeyedEntryRowsLines(entries, fields, depth + 1, options)
    return
  }

  // Pretty: the entry key is a column too. Its widest rendering decides the
  // gutter the cells start after; a negative gutter is closed by leading
  // padding after `{`, which §12 trims like any other field-list space.
  const keys = entries.map(([entryKey]) => encodeKey(entryKey))
  const keyWidth = Math.max(...keys.map(scalarWidth))
  const grid = collectCellGrid(entries.map(([, entryValue]) => entryValue as JsonObject), fields, options.delimiter)
  const braceCol = depth * options.indentSize + headerPrefixWidth(key, entries.length, true, options.delimiter)
  const rowCol = (depth + 1) * options.indentSize + keyWidth + 2
  const { header, rows: body } = prettyTable(key, entries.length, true, fields, grid, keys, keyWidth, braceCol, rowCol, options.delimiter)
  yield indentedLine(depth, header, options.indentSize)

  for (const line of body) {
    yield indentedLine(depth + 1, line, options.indentSize)
  }
}

function* encodeKeyedEntryRowsLines(
  entries: readonly [string, JsonValue][],
  fields: readonly FieldNode[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  for (const [entryKey, entryValue] of entries) {
    const leaves = collectRowLeaves(entryValue as JsonObject, fields)
    yield indentedLine(depth, `${encodeKey(entryKey)}: ${encodeAndJoinPrimitives(leaves, options.delimiter)}`, options.indentSize)
  }
}

// #endregion

// #region Array encoding

function* encodeArrayLines(
  key: string | undefined,
  value: JsonArray,
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  if (value.length === 0) {
    const line = key != null ? `${encodeKey(key)}: []` : '[]'
    yield indentedLine(depth, line, options.indentSize)
    return
  }

  if (isArrayOfPrimitives(value)) {
    const arrayLine = encodeInlineArrayLine(value, options.delimiter, key)
    yield indentedLine(depth, arrayLine, options.indentSize)
    return
  }

  if (isArrayOfArrays(value)) {
    const allPrimitiveArrays = value.every(arr => isArrayOfPrimitives(arr))
    if (allPrimitiveArrays) {
      yield* encodeArrayOfArraysAsListItemsLines(key, value, depth, options)
      return
    }
  }

  if (isArrayOfObjects(value)) {
    const fields = extractTabularFields(value)
    if (fields) {
      yield* encodeArrayOfObjectsAsTabularLines(key, value, fields, depth, options)
    }
    else {
      yield* encodeMixedArrayAsListItemsLines(key, value, depth, options)
    }
    return
  }

  yield* encodeMixedArrayAsListItemsLines(key, value, depth, options)
}

// #endregion

// #region Array of arrays (list form)

function* encodeArrayOfArraysAsListItemsLines(
  prefix: string | undefined,
  values: readonly JsonArray[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  const header = formatHeader(values.length, { key: prefix, delimiter: options.delimiter })
  yield indentedLine(depth, header, options.indentSize)

  for (const arr of values) {
    if (isArrayOfPrimitives(arr)) {
      const arrayLine = encodeInlineArrayLine(arr, options.delimiter)
      yield indentedListItem(depth + 1, arrayLine, options.indentSize)
    }
  }
}

function encodeInlineArrayLine(values: readonly EncodablePrimitive[], delimiter: string, prefix?: string): string {
  const header = formatHeader(values.length, { key: prefix, delimiter })
  const joinedValue = encodeAndJoinPrimitives(values, delimiter)

  if (values.length === 0)
    return header

  return `${header} ${joinedValue}`
}

// #endregion

// #region Array of objects (tabular form)

function* encodeArrayOfObjectsAsTabularLines(
  prefix: string | undefined,
  rows: readonly JsonObject[],
  fields: readonly FieldNode[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  const leaves = countLeaves(fields)
  if (!options.pretty || leaves < 2) {
    const header = formatHeader(rows.length, { key: prefix, fields, delimiter: options.delimiter })
    yield indentedLine(depth, header, options.indentSize)

    yield* writeTabularRowsLines(rows, fields, depth + 1, options)
    return
  }

  // Pretty: render every cell first, measure columns, widen for the header,
  // then emit header and rows together so the names sit over their columns.
  const grid = collectCellGrid(rows, fields, options.delimiter)
  const braceCol = depth * options.indentSize + headerPrefixWidth(prefix, rows.length, false, options.delimiter)
  const rowCol = (depth + 1) * options.indentSize
  const { header, rows: body } = prettyTable(prefix, rows.length, false, fields, grid, undefined, 0, braceCol, rowCol, options.delimiter)
  yield indentedLine(depth, header, options.indentSize)

  for (const line of body) {
    yield indentedLine(depth + 1, line, options.indentSize)
  }
}

/** Rendered width of everything before the field list's opening brace. */
function headerPrefixWidth(key: string | undefined, length: number, keyed: boolean, delimiter: string): number {
  let w = 0
  if (key != null)
    w += scalarWidth(encodeKey(key))
  w += 1 + String(length).length + 1
  if (keyed)
    w += 1
  if (delimiter !== COMMA)
    w += 1
  return w
}

// #region Pretty tables (shared)

// Pretty tables are measured, not derived: the header's brace column and the
// rows' first-cell column are passed in, because a header does not always sit
// at its depth's indentation (a nested table sits shallower than its rows,
// and a hyphen-line header sits after `- `). Deriving from depth gets the
// root case right and both of those wrong.

/** Encodes one row's leaf cells per row of a table. */
function collectCellGrid(rows: readonly JsonObject[], fields: readonly FieldNode[], delimiter: string): string[][] {
  return rows.map(row =>
    collectRowLeaves(row, fields).map(value => encodePrimitive(value, delimiter)),
  )
}

interface PrettyTable {
  /** Header line without indentation. */
  header: string
  /** Row lines without indentation. */
  rows: string[]
}

/**
 * Aligns one table's header and rows. Renders cells first, measures scalar
 * column widths, widens for the header, then returns both together so names
 * sit over the columns they name. Pure: callers add indentation.
 */
function prettyTable(
  prefix: string | undefined,
  count: number,
  keyed: boolean,
  fields: readonly FieldNode[],
  grid: string[][],
  keys: readonly string[] | undefined,
  keyWidth: number,
  braceCol: number,
  rowCol: number,
  delimiter: string,
): PrettyTable {
  const leaves = countLeaves(fields)
  const widths = columnWidths(grid, leaves)
  const { spans } = measureFieldList(fields, delimiter)
  const gutter = braceCol + (spans[0]?.start ?? 1) - rowCol
  const { pads, lead, padHeader } = headerLeafPads(spans, widths, gutter)
  const header = padHeader
    ? formatHeaderWithPads(count, { key: prefix, fields, delimiter, keyed, pads, lead })
    : formatHeader(count, { key: prefix, fields, delimiter, keyed })
  const rows: string[] = []
  if (keyed) {
    for (let r = 0; r < grid.length; r++) {
      // The spec-exact single space after the colon is emitted first and the
      // key-alignment padding follows it, so the line's prefix is unchanged.
      const keyPad = ' '.repeat(keyWidth - scalarWidth(keys![r]!))
      rows.push(`${keys![r]}: ${keyPad}${joinPaddedCells(grid[r]!, widths, delimiter)}`)
    }
  }
  else {
    for (const cells of grid) {
      rows.push(joinPaddedCells(cells, widths, delimiter))
    }
  }
  return { header, rows }
}

// #endregion

function* writeTabularRowsLines(
  rows: readonly JsonObject[],
  fields: readonly FieldNode[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  for (const row of rows) {
    const leaves = collectRowLeaves(row, fields)
    yield indentedLine(depth, encodeAndJoinPrimitives(leaves, options.delimiter), options.indentSize)
  }
}

// #endregion

// #region Array of objects (list form)

function* encodeMixedArrayAsListItemsLines(
  prefix: string | undefined,
  items: readonly JsonValue[],
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  const header = formatHeader(items.length, { key: prefix, delimiter: options.delimiter })
  yield indentedLine(depth, header, options.indentSize)

  for (const item of items) {
    yield* encodeListItemValueLines(item, depth + 1, options)
  }
}

function* encodeObjectAsListItemLines(
  obj: JsonObject,
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  if (isEmptyObject(obj)) {
    yield indentedLine(depth, LIST_ITEM_MARKER, options.indentSize)
    return
  }

  const entries = Object.entries(obj)
  const [firstKey, firstValue] = entries[0]!
  const restEntries = entries.slice(1)

  if (isJsonArray(firstValue) && isArrayOfObjects(firstValue)) {
    const fields = extractTabularFields(firstValue)
    if (fields) {
      // A hyphen-line header sits after `- `, so its brace column is measured
      // from the line, never derived from the depth alone.
      const braceCol = depth * options.indentSize + scalarWidth(LIST_ITEM_PREFIX) + headerPrefixWidth(firstKey, firstValue.length, false, options.delimiter)
      const rowCol = (depth + 2) * options.indentSize
      if (options.pretty && countLeaves(fields) >= 2) {
        const grid = collectCellGrid(firstValue, fields, options.delimiter)
        const { header, rows: body } = prettyTable(firstKey, firstValue.length, false, fields, grid, undefined, 0, braceCol, rowCol, options.delimiter)
        yield indentedListItem(depth, header, options.indentSize)
        for (const line of body)
          yield indentedLine(depth + 2, line, options.indentSize)
      }
      else {
        const header = formatHeader(firstValue.length, { key: firstKey, fields, delimiter: options.delimiter })
        yield indentedListItem(depth, header, options.indentSize)
        yield* writeTabularRowsLines(firstValue, fields, depth + 2, options)
      }

      if (restEntries.length > 0) {
        const restObj: JsonObject = Object.fromEntries(restEntries)
        yield* encodeObjectLines(restObj, depth + 1, options)
      }
      return
    }
  }

  // Keyed first field: header on the hyphen line, entry rows at depth +2, siblings at +1.
  if (isJsonObject(firstValue)) {
    const keyedFields = extractKeyedTabularFields(firstValue)
    if (keyedFields) {
      const keyedEntries = Object.entries(firstValue)
      const braceCol = depth * options.indentSize + scalarWidth(LIST_ITEM_PREFIX) + headerPrefixWidth(firstKey, keyedEntries.length, true, options.delimiter)
      if (options.pretty && countLeaves(keyedFields) >= 2) {
        const keys = keyedEntries.map(([entryKey]) => encodeKey(entryKey))
        const keyWidth = Math.max(...keys.map(scalarWidth))
        const grid = collectCellGrid(keyedEntries.map(([, entryValue]) => entryValue as JsonObject), keyedFields, options.delimiter)
        const rowCol = (depth + 2) * options.indentSize + keyWidth + 2
        const { header, rows: body } = prettyTable(firstKey, keyedEntries.length, true, keyedFields, grid, keys, keyWidth, braceCol, rowCol, options.delimiter)
        yield indentedListItem(depth, header, options.indentSize)
        for (const line of body)
          yield indentedLine(depth + 2, line, options.indentSize)
      }
      else {
        const header = formatHeader(keyedEntries.length, { key: firstKey, fields: keyedFields, delimiter: options.delimiter, keyed: true })
        yield indentedListItem(depth, header, options.indentSize)
        yield* encodeKeyedEntryRowsLines(keyedEntries, keyedFields, depth + 2, options)
      }

      if (restEntries.length > 0) {
        const restObj: JsonObject = Object.fromEntries(restEntries)
        yield* encodeObjectLines(restObj, depth + 1, options)
      }
      return
    }
  }

  const encodedKey = encodeKey(firstKey)

  if (isEncodablePrimitive(firstValue)) {
    const encodedValue = encodePrimitive(firstValue, options.delimiter)
    yield indentedListItem(depth, `${encodedKey}: ${encodedValue}`, options.indentSize)
  }
  else if (isJsonArray(firstValue)) {
    if (firstValue.length === 0) {
      yield indentedListItem(depth, `${encodedKey}: []`, options.indentSize)
    }
    else if (isArrayOfPrimitives(firstValue)) {
      const arrayLine = encodeInlineArrayLine(firstValue, options.delimiter)
      yield indentedListItem(depth, `${encodedKey}${arrayLine}`, options.indentSize)
    }
    else {
      // Non-inline array items sit at depth + 2, below the hyphen line.
      const header = formatHeader(firstValue.length, { delimiter: options.delimiter })
      yield indentedListItem(depth, `${encodedKey}${header}`, options.indentSize)

      for (const item of firstValue) {
        yield* encodeListItemValueLines(item, depth + 2, options)
      }
    }
  }
  else if (isJsonObject(firstValue)) {
    yield indentedListItem(depth, `${encodedKey}:`, options.indentSize)
    if (!isEmptyObject(firstValue)) {
      yield* encodeObjectLines(firstValue, depth + 2, options)
    }
  }

  if (restEntries.length > 0) {
    const restObj: JsonObject = Object.fromEntries(restEntries)
    yield* encodeObjectLines(restObj, depth + 1, options)
  }
}

// #endregion

// #region List item encoding helpers

function* encodeListItemValueLines(
  value: JsonValue,
  depth: Depth,
  options: ResolvedEncodeOptions,
): Generator<string> {
  if (isEncodablePrimitive(value)) {
    yield indentedListItem(depth, encodePrimitive(value, options.delimiter), options.indentSize)
  }
  else if (isJsonArray(value)) {
    if (isArrayOfPrimitives(value)) {
      const arrayLine = encodeInlineArrayLine(value, options.delimiter)
      yield indentedListItem(depth, arrayLine, options.indentSize)
    }
    else {
      const header = formatHeader(value.length, { delimiter: options.delimiter })
      yield indentedListItem(depth, header, options.indentSize)
      for (const item of value) {
        yield* encodeListItemValueLines(item, depth + 1, options)
      }
    }
  }
  else if (isJsonObject(value)) {
    yield* encodeObjectAsListItemLines(value, depth, options)
  }
}

// #endregion

// #region Indentation helpers

function indentedLine(depth: Depth, content: string, indentSize: number): string {
  const indentation = ' '.repeat(indentSize * depth)
  return indentation + content
}

function indentedListItem(depth: Depth, content: string, indentSize: number): string {
  return indentedLine(depth, LIST_ITEM_PREFIX + content, indentSize)
}

// #endregion
