import type { ResolvedEncodeOptions } from '../src/types'
import type { TestCase } from './types'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DELIMITER, encode } from '../src/index'
import { loadFixtures } from './utils'

// Loaded via `JSON.parse`: a Vite JSON-to-literal transform would turn the
// prototype-safety fixtures' `__proto__` keys into prototype assignments.
const fixtureFiles = loadFixtures('encode', [
  'primitives',
  'objects',
  'objects-keyed',
  'arrays-primitive',
  'arrays-tabular',
  'arrays-nested',
  'arrays-objects',
  'delimiters',
  'whitespace',
])

for (const fixtures of fixtureFiles) {
  describe(fixtures.description, () => {
    for (const test of fixtures.tests) {
      it(test.name, () => {
        const resolvedOptions = resolveEncodeOptions(test.options)

        if (test.shouldError) {
          expect(() => encode(test.input, resolvedOptions))
            .toThrow()
        }
        else {
          const result = encode(test.input, resolvedOptions)
          expect(result).toBe(test.expected)
        }
      })
    }
  })
}

function resolveEncodeOptions(options?: TestCase['options']): ResolvedEncodeOptions {
  return {
    indentSize: options?.indentSize ?? 2,
    delimiter: options?.delimiter ?? DEFAULT_DELIMITER,
    pretty: options?.pretty ?? false,
  }
}

describe('pretty defaults', () => {
  it('is off by default and leaves tables byte-identical', () => {
    const data = { deps: [{ name: 'react', version: '18.3.1' }, { name: 'typescript', version: '5.4.5' }] }
    expect(encode(data)).toBe('deps[2]{name,version}:\n  react,18.3.1\n  typescript,5.4.5')
    expect(encode(data, {})).toBe(encode(data, { pretty: false }))
  })
})
