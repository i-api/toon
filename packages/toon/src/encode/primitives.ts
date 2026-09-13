import type { FieldNode } from '../types.ts'
import type { EncodablePrimitive } from './raw-string.ts'
import { COMMA, DEFAULT_DELIMITER, DOUBLE_QUOTE, NULL_LITERAL } from '../constants.ts'
import { escapeString } from '../shared/string-utils.ts'
import { isSafeUnquoted, isValidUnquotedKey } from '../shared/validation.ts'
import { isRawString } from './raw-string.ts'

// #region Primitive encoding

export function encodePrimitive(value: EncodablePrimitive, delimiter?: string): string {
  if (isRawString(value)) {
    return value.value
  }

  if (value === null) {
    return NULL_LITERAL
  }

  if (typeof value === 'boolean') {
    return String(value)
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return encodeStringLiteral(value, delimiter)
}

export function encodeStringLiteral(value: string, delimiter: string = DEFAULT_DELIMITER): string {
  if (isSafeUnquoted(value, delimiter)) {
    return value
  }

  return `${DOUBLE_QUOTE}${escapeString(value)}${DOUBLE_QUOTE}`
}

// #endregion

// #region Key encoding

export function encodeKey(key: string): string {
  if (isValidUnquotedKey(key)) {
    return key
  }

  return `${DOUBLE_QUOTE}${escapeString(key)}${DOUBLE_QUOTE}`
}

// #endregion

// #region Value joining

export function encodeAndJoinPrimitives(values: readonly EncodablePrimitive[], delimiter: string = DEFAULT_DELIMITER): string {
  return values.map(v => encodePrimitive(v, delimiter)).join(delimiter)
}

// #endregion

// #region Header formatters

export function formatHeader(
  length: number,
  options?: {
    key?: string
    fields?: readonly FieldNode[]
    delimiter?: string
    /** Keyed tabular header: emit the colon marker after the length. */
    keyed?: boolean
  },
): string {
  const key = options?.key
  const fields = options?.fields
  const delimiter = options?.delimiter ?? COMMA

  let header = ''

  if (key != null) {
    header += encodeKey(key)
  }

  header += `[${length}${options?.keyed ? ':' : ''}${delimiter !== DEFAULT_DELIMITER ? delimiter : ''}]`

  if (fields) {
    header += `{${formatFieldSegment(fields, delimiter)}}`
  }

  header += ':'

  return header
}

function formatFieldSegment(fields: readonly FieldNode[], delimiter: string): string {
  return fields
    .map(field => encodeKey(field.name) + (field.children ? `{${formatFieldSegment(field.children, delimiter)}}` : ''))
    .join(delimiter)
}

/**
 * Header variant that pads each leaf field name so it sits over its column.
 * Pads go after leaf names only, never after group names (a group's alignment
 * is the alignment of the leaves inside it); the last leaf is never padded.
 */
export function formatHeaderWithPads(
  length: number,
  options: {
    key?: string
    fields: readonly FieldNode[]
    delimiter?: string
    /** Keyed tabular header: emit the colon marker after the length. */
    keyed?: boolean
    pads: readonly number[]
    lead: number
  },
): string {
  const delimiter = options.delimiter ?? COMMA

  let header = ''

  if (options.key != null) {
    header += encodeKey(options.key)
  }

  header += `[${length}${options.keyed ? ':' : ''}${delimiter !== DEFAULT_DELIMITER ? delimiter : ''}]`
  header += formatFieldSegmentWithPads(options.fields, delimiter, options.pads, options.lead)
  header += ':'

  return header
}

export function formatFieldSegmentWithPads(
  fields: readonly FieldNode[],
  delimiter: string,
  pads: readonly number[],
  lead: number,
): string {
  const cursor = { i: 0 }
  return `{${' '.repeat(lead)}${renderPaddedFields(fields, delimiter, pads, cursor)}}`
}

function renderPaddedFields(
  fields: readonly FieldNode[],
  delimiter: string,
  pads: readonly number[],
  cursor: { i: number },
): string {
  return fields
    .map((field, fi) => {
      const prefix = fi > 0 ? delimiter : ''
      if (field.children) {
        return `${prefix}${encodeKey(field.name)}{${renderPaddedFields(field.children, delimiter, pads, cursor)}}`
      }
      const pad = ' '.repeat(pads[cursor.i] ?? 0)
      cursor.i += 1
      return `${prefix}${encodeKey(field.name)}${pad}`
    })
    .join('')
}

// #endregion
