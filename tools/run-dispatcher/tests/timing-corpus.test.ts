import { describe, expect, it } from 'vitest'
import { RECIPE_BATCH } from '../src/layout.ts'
import { planCorpus, TimingCorpusError } from '../src/timing-corpus.ts'

/**
 * Корпус `SC-003` коштує пів години прогонів, і зібраний не так він виглядає
 * правильним рівно доти, доки вимір не спробує з нього щось сказати.
 *
 * Тому три властивості перевіряються до першої транзакції: хвилі мають із чим
 * порівнюватись, драбина має бути драбиною, а щаблі — кратними батчу. Останнє
 * не педантизм: контур має сталу довжину й розшифровує весь батч незалежно від
 * того, скільки в ньому живих записів, тож неповний останній батч коштує як
 * повний і псує саме ту сталість, заради якої драбина існує.
 */

describe('план корпусу', () => {
  it('засіває один датасет на розмір, а не на прогін', () => {
    // Хвилі ганяють кілька прогонів по тому самому шифротексту, і розмір хвиль
    // збігається зі щаблем драбини — датасетів має вийти три, а не чотири.
    expect(
      planCorpus({ ladderSizes: [40, 80, 160], waveRecords: 80, waveLevels: [1, 2, 4] }),
    ).toEqual([40, 80, 160])
  })

  it('додає розмір хвиль, якщо його немає серед щаблів', () => {
    expect(planCorpus({ ladderSizes: [40, 160], waveRecords: 80, waveLevels: [1, 2] })).toEqual([
      40, 80, 160,
    ])
  })

  it('відмовляє, коли прискорення нема з чим порівнювати', () => {
    expect(() =>
      planCorpus({ ladderSizes: [40, 80], waveRecords: 80, waveLevels: [2, 4] }),
    ).toThrow(TimingCorpusError)
  })

  it('відмовляє на драбині з одного щабля', () => {
    expect(() => planCorpus({ ladderSizes: [80], waveRecords: 80, waveLevels: [1, 2] })).toThrow(
      TimingCorpusError,
    )
  })

  it('відмовляє на щаблі, не кратному батчу', () => {
    expect(RECIPE_BATCH).toBe(4)
    expect(() =>
      planCorpus({ ladderSizes: [40, 82], waveRecords: 80, waveLevels: [1, 2] }),
    ).toThrow(TimingCorpusError)
    expect(() =>
      planCorpus({ ladderSizes: [40, 80], waveRecords: 82, waveLevels: [1, 2] }),
    ).toThrow(TimingCorpusError)
  })
})
