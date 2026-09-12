import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('Local Vercel configuration', () => {
  test('forces a complete frozen dependency install before hosted builds', () => {
    const configPath = resolve(process.cwd(), 'vercel.json')
    expect(existsSync(configPath)).toBe(true)
    if (!existsSync(configPath)) {
      return
    }

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { installCommand?: string }
    expect(config.installCommand).toBe('pnpm install --force --frozen-lockfile')
  })
})
