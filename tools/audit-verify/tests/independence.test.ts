import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

/**
 * Незалежність звіряча — властивість, яку тримає тест, а не звичка.
 *
 * `tools/audit-verify` навмисно не залежить від `packages/sdk`, `shared` і
 * `crypto`: перевірка, що користується нашим кодом, доводить, що наш декодер
 * узгоджений із нашим кодувальником, і рівно нічого більше (`FR-025`).
 *
 * Рівно один виняток — і він тут же й закріплений: наші пакети стоять у
 * `devDependencies`, щоб **тести** могли звірити дві незалежні реалізації між
 * собою. Це не пом'якшення правила, а його перевірка: розкладку, яку звіряч
 * відтворив сам, треба з чимось зіставити, інакше «зійшлося» означає лише
 * «сам із собою». У рантайм звіряча жоден із них не потрапляє, і саме це
 * стереже перший тест файлу.
 */

const SOURCE_DIR = fileURLToPath(new URL('../src/', import.meta.url))

async function sources(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await sources(path)))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('звіряч не бачить нашого коду', () => {
  it('жоден файл `src/` не імпортує пакетів GenoVault', async () => {
    const files = await sources(SOURCE_DIR)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      if (/from\s+['"]@genovault\//.test(text) || /import\(['"]@genovault\//.test(text)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('у залежностях рантайму немає наших пакетів', () => {
    const runtime = Object.keys(manifest.dependencies)
    expect(runtime.filter((name) => name.startsWith('@genovault/'))).toEqual([])
  })
})
