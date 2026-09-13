import { describe, expect, it } from 'vitest'
import { columnWidths, scalarWidth } from '../src/encode/tabular.ts'
import { decode, encode } from '../src/index.ts'

describe('pretty widths', () => {
  it('counts scalar values not bytes', () => {
    expect(scalarWidth('é')).toBe(1)
    expect(scalarWidth('abc')).toBe(3)
    expect(scalarWidth('Hello 世界 👋')).toBe(10)
  })
  it('takes per-column maxima', () => {
    expect(columnWidths([['1', 'Ada'], ['300', 'Bo']], 2)).toEqual([3, 3])
  })
})

describe('pretty flat tables', () => {
  it('aligns flat tabular columns and round-trips', () => {
    const data = {
      deps: [
        { name: 'react', version: '18.3.1', license: 'MIT' },
        { name: 'typescript', version: '5.4.5', license: 'Apache-2.0' },
        { name: 'vite', version: '5.2.11', license: 'MIT' },
      ],
    }
    const pretty = encode(data, { pretty: true })
    expect(pretty).toBe(
      'deps[3]{name,version,license}:\n'
      + '  react     ,18.3.1 ,MIT\n'
      + '  typescript,5.4.5  ,Apache-2.0\n'
      + '  vite      ,5.2.11 ,MIT',
    )
    expect(decode(pretty)).toEqual(decode(encode(data)))
    for (const line of pretty.split('\n'))
      expect(line.endsWith(' ')).toBe(false)
  })
})

describe('pretty nested groups', () => {
  it('spans nested groups and aligns tables on hyphen lines', () => {
    const nested = [
      { id: 1, customer: { name: 'Ada', country: 'DK' }, total: 99 },
      { id: 2, customer: { name: 'name_column_is_this_wide', country: 'country_column_is_this_wide' }, total: 149 },
    ]
    const out = encode(nested, { pretty: true })
    const lines = out.split('\n')
    const header = lines[0] ?? ''
    const row = lines[1] ?? ''
    expect(header).toContain('country                   },total}:')
    expect(header.indexOf('country')).toBe(row.indexOf('DK'))
    expect(header.indexOf('total')).toBe(row.indexOf('99'))
    expect(decode(out)).toEqual(decode(encode(nested)))

    // Root array of objects whose first field is itself a table: the header
    // rides on a `- ` hyphen line and rows sit two levels deeper.
    const hyphen = [
      { deps: [{ name: 'react', version: '1' }, { name: 'typescript', version: '2' }], n: 1 },
      { deps: [{ name: 'vue', version: '3' }, { name: 'sveltejs', version: '4' }], n: 2 },
    ]
    const hout = encode(hyphen, { pretty: true })
    const hlines = hout.split('\n')
    const commaCols = (s: string) => [...s].map((c, i) => (c === ',' ? i : -1)).filter(i => i >= 0)
    expect(hlines[1]).toMatch(/^ +- deps\[2\]/)
    expect(commaCols(hlines[1] ?? '')).toEqual(commaCols(hlines[2] ?? ''))
    expect(commaCols(hlines[1] ?? '')).toEqual(commaCols(hlines[3] ?? ''))
    expect(decode(hout)).toEqual(decode(encode(hyphen)))
  })
})

describe('pretty guarantees', () => {
  it('is safe, geometric, and a fixpoint', () => {
    const docs = [
      { id: 1, name: 'Ada', role: 'admin' },
      { id: 300, name: 'Bartholomew', role: 'ops' },
    ]
    const plain = encode(docs)
    const pretty = encode(docs, { pretty: true })
    expect(pretty).not.toBe(plain)
    expect(pretty).toBe(
      '[2]{id,name       ,role}:\n'
      + '  1   ,Ada        ,admin\n'
      + '  300 ,Bartholomew,ops',
    )
    expect(decode(pretty)).toEqual(decode(plain))
    const [header, ...rows] = pretty.split('\n')
    const cols = (s: string) => [...s].map((c, i) => (c === ',' ? i : -1)).filter(i => i >= 0)
    const want = cols(header ?? '').slice(1)
    for (const row of rows)
      expect(cols(row).slice(1)).toEqual(want)
    expect(encode(decode(pretty), { pretty: true })).toBe(pretty)
    // Scalar values, not bytes: é is two bytes and one column.
    expect(encode([{ k: 'é', n: 1 }, { k: 'abc', n: 2 }], { pretty: true }))
      .toBe('[2]{k,n}:\n  é  ,1\n  abc,2')
  })

  it('leaves a gutter wider than the data unabsorbed', () => {
    const data = {
      some_very_long_field_name_here: [
        { i: 1, ok: true },
        { i: 2, ok: false },
      ],
    }
    const pretty = encode(data, { pretty: true })
    // Header stays spec-exact; rows still align among themselves.
    expect(pretty).toBe(
      'some_very_long_field_name_here[2]{i,ok}:\n'
      + '  1,true\n'
      + '  2,false',
    )
    expect(decode(pretty)).toEqual(decode(encode(data)))
  })
})

describe('pretty docs', () => {
  it('documents the wire-format warning', async () => {
    const fs = await import('node:fs/promises')
    const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toContain('not a wire format')
  })
})

describe('pretty keyed tables', () => {
  it('aligns keyed entry rows on the entry key', () => {
    const data = {
      hosts: {
        laptop: { user: 'ada', port: 22, forward: true },
        builder: { user: 'root', port: 2222, forward: false },
        nas: { user: 'admin', port: 22, forward: false },
      },
    }
    const pretty = encode(data, { pretty: true })
    expect(pretty).toBe(
      'hosts[3:]{ user ,port,forward}:\n'
      + '  laptop:  ada  ,22  ,true\n'
      + '  builder: root ,2222,false\n'
      + '  nas:     admin,22  ,false',
    )
    expect(decode(pretty)).toEqual(decode(encode(data)))
  })
})
