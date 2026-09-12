import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_MARKERS, MIN_COHORT } from '../src/dataset-metadata.ts'
import {
  AGE_MAX,
  AGE_MIN,
  decodeFrequenciesParams,
  encodeFrequenciesFilters,
  encodeFrequenciesParams,
  FILTER_ANY,
  FREQUENCIES_RECIPE_ID,
  findRecipe,
  frequenciesParamsSchema,
  RECIPE_PARAMS_LEN,
  RECIPES,
} from '../src/recipes.ts'

const circuit = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../encrypted-ixs/src/lib.rs'),
  'utf8',
)

describe('каталог рецептів', () => {
  it('містить рівно те, що вміє рахувати конфіденційний шар', () => {
    // SPEC називає чотири рецепти першої версії, реалізований поки один.
    // Записаний наперед рядок віддав би покупцю квоту на прогін, який ніхто не
    // виконає: ціну рахує цей каталог, а публікує обчислення `T025`.
    expect(RECIPES.map((recipe) => recipe.name)).toEqual(['frequencies'])
  })

  it('знаходить рецепт за номером і не вигадує відсутній', () => {
    expect(findRecipe(FREQUENCIES_RECIPE_ID)?.name).toBe('frequencies')
    expect(findRecipe(2)).toBeUndefined()
  })

  it('профіль і поріг когорти збігаються з контуром', () => {
    const recipe = findRecipe(FREQUENCIES_RECIPE_ID)
    expect(recipe?.markers).toBe(MAX_MARKERS)
    expect(recipe?.minCohort).toBe(MIN_COHORT)
  })

  it('FILTER_ANY збігається з контуром', () => {
    expect(circuit).toMatch(new RegExp(`FILTER_ANY:\\s*u8\\s*=\\s*${FILTER_ANY};`))
  })

  it('номер рецепта не змінюється мовчки', () => {
    // Номер лягає в `Run.recipe_id` ончейн. Зміна перетворила б уже записані
    // прогони на прогони іншого рецепта.
    expect(FREQUENCIES_RECIPE_ID).toBe(1)
  })
})

describe('параметри «частот і розподілів»', () => {
  it('без параметрів дає найширшу когорту', () => {
    expect(frequenciesParamsSchema.parse({})).toEqual({
      minAge: AGE_MIN,
      maxAge: AGE_MAX,
      sex: 'any',
      affected: 'any',
    })
  })

  it('відхиляє перевернуте вікове вікно', () => {
    expect(() => frequenciesParamsSchema.parse({ minAge: 60, maxAge: 40 })).toThrow()
  })

  it('приймає вікно з одного року', () => {
    expect(frequenciesParamsSchema.parse({ minAge: 40, maxAge: 40 }).minAge).toBe(40)
  })

  it('відхиляє вік поза u8', () => {
    expect(() => frequenciesParamsSchema.parse({ maxAge: 256 })).toThrow()
    expect(() => frequenciesParamsSchema.parse({ minAge: -1 })).toThrow()
  })

  it('відхиляє параметр, якого рецепт не оголошував', () => {
    // Інакше покупець побачив би ціну за фільтр, який мовчки не спрацює.
    expect(() => frequenciesParamsSchema.parse({ ancestry: 'eu' })).toThrow()
  })

  it('кодує фільтри так, як їх читає контур', () => {
    expect(encodeFrequenciesFilters(frequenciesParamsSchema.parse({}))).toEqual({
      minAge: 0,
      maxAge: 255,
      sexFilter: FILTER_ANY,
      affectedFilter: FILTER_ANY,
    })

    expect(
      encodeFrequenciesFilters(
        frequenciesParamsSchema.parse({
          sex: 'male',
          affected: 'affected',
          minAge: 30,
          maxAge: 50,
        }),
      ),
    ).toEqual({ minAge: 30, maxAge: 50, sexFilter: 1, affectedFilter: 1 })

    expect(
      encodeFrequenciesFilters(
        frequenciesParamsSchema.parse({ sex: 'female', affected: 'unaffected' }),
      ),
    ).toMatchObject({ sexFilter: 0, affectedFilter: 0 })
  })

  it('стать кодується так само, як її рахує накопичувач', () => {
    // `male` у контурі це `Σ sex`, тобто 1 — чоловік. Переплутати ці два біти
    // означає порахувати не ту когорту, не впавши ніде.
    expect(circuit).toMatch(/acc\.male \+= if counted \{ record\.sex \}/)
    expect(encodeFrequenciesFilters(frequenciesParamsSchema.parse({ sex: 'male' })).sexFilter).toBe(
      1,
    )
  })
})

describe('розкладка `Run.recipe_params`', () => {
  it('чотири байти фільтрів, далі нулі до кінця', () => {
    const raw = encodeFrequenciesParams(
      frequenciesParamsSchema.parse({
        minAge: 18,
        maxAge: 65,
        sex: 'female',
        affected: 'affected',
      }),
    )

    expect(raw).toHaveLength(RECIPE_PARAMS_LEN)
    expect(Array.from(raw.slice(0, 4))).toEqual([18, 65, 0, 1])
    // Непорожній хвіст програма відхиляє (`FrequenciesParams::decode`): вона
    // читає перші чотири байти й вимагає, щоб решта нічого не означала.
    expect(Array.from(raw.slice(4)).every((byte) => byte === 0)).toBe(true)
  })

  it('порядок байтів не переставляє фільтри місцями', () => {
    // Зсув на одиницю поміняв би стать на ураженість, нічого не зламавши, —
    // тому тут перевіряються два фільтри з різними значеннями.
    const raw = encodeFrequenciesParams(
      frequenciesParamsSchema.parse({ sex: 'male', affected: 'unaffected' }),
    )

    expect(raw[2]).toBe(1)
    expect(raw[3]).toBe(0)
  })

  it('значення за замовчуванням — вікно на весь діапазон і обидва «будь-який»', () => {
    const raw = encodeFrequenciesParams(frequenciesParamsSchema.parse({}))

    expect(Array.from(raw.slice(0, 4))).toEqual([AGE_MIN, AGE_MAX, FILTER_ANY, FILTER_ANY])
  })
})

describe('розбір `Run.recipe_params` назад', () => {
  it('round-trip зберігає всі чотири поля', () => {
    for (const params of [
      { minAge: 18, maxAge: 65, sex: 'female', affected: 'affected' },
      { minAge: 0, maxAge: 255, sex: 'male', affected: 'unaffected' },
      {},
    ] as const) {
      const parsed = frequenciesParamsSchema.parse(params)
      expect(decodeFrequenciesParams(encodeFrequenciesParams(parsed))).toEqual(parsed)
    }
  })

  it('невідомий байт фільтра читається як «будь-який», а не валить екран', () => {
    // Такого байта в акаунті не буває — програма їх перевіряє. Але екран, який
    // не відкривається через байт, гірший за екран, який показує ширший фільтр.
    const raw = new Uint8Array(RECIPE_PARAMS_LEN)
    raw[2] = 9
    raw[3] = 9

    expect(decodeFrequenciesParams(raw)).toMatchObject({ sex: 'any', affected: 'any' })
  })
})
