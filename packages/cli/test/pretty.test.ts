import { describe, expect, it } from 'vitest'
import { encode } from '../../toon/src/index.ts'
import { mockStdin, runCli } from './utils.ts'

describe('toon CLI pretty', () => {
  it('aligns tabular columns with --pretty', async () => {
    const data = {
      deps: [
        { name: 'react', version: '18.3.1' },
        { name: 'typescript', version: '5.4.5' },
      ],
    }
    const restoreStdin = mockStdin(JSON.stringify(data))

    try {
      const { stdout } = await runCli(['--pretty'])

      expect(stdout).toBe(`${encode(data, { pretty: true })}\n`)
    }
    finally {
      restoreStdin()
    }
  })
})
