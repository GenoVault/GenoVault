// Згенеровано `scripts/sync-idl.mjs` — руками не правити.
//
// Тип і значення — це той самий текст, і розійтися їм нема як. Дві окремі
// форми (тип з `target/types`, значення з конверсії IDL) не збігаються:
// `Program` камелкейсить `pda.seeds[].path`, а згенерований тип лишає його
// в snake_case, і значення перестає присвоюватись власному типу.
//
// Джерело: `anchor build` → `target/types/genovault.ts`.

export type Genovault = {
  "address": "9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb",
  "metadata": {
    "name": "genovault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Конфіденційний маркетплейс медичних і геномних даних"
  },
  "docs": [
    "Програма GenoVault.",
    "",
    "Рецепт «частоти й розподіли» (`T018`) живе в `encrypted-ixs` трьома",
    "контурами, і тут розгортаються їхні визначення обчислень. Виклик",
    "`frequencies_init` поки не належить жодному прогону — він доводить, що",
    "ланцюг «черга обчислень → вузли → callback» замикається на цьому",
    "репозиторії. Замовлення прогону з перевіркою згоди й депозитом приходить",
    "у `T024`, згортка батчів і розкриття — у `T025`-`T026`."
  ],
  "instructions": [
    {
      "name": "frequenciesInit",
      "docs": [
        "Створює порожній накопичувач частот.",
        "",
        "Прогону ця інструкція поки не належить: `Run`, перевірка згоди й",
        "депозит приходять у `T024`, згортка батчів і розкриття — у",
        "`T025`-`T026`. Вона стоїть тут із тієї ж причини, з якої тут раніше",
        "стояв каркасний `probe_sum`: доводить, що ланцюг «програма → черга",
        "обчислень → MPC-вузли → callback» замикається на цьому репозиторії.",
        "Різниця в тому, що тепер це справжній рецепт із каталогу, а не",
        "заглушка, яка додає два числа."
      ],
      "discriminator": [
        123,
        84,
        5,
        59,
        85,
        227,
        151,
        19
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        }
      ]
    },
    {
      "name": "frequenciesInitCallback",
      "discriminator": [
        31,
        140,
        237,
        214,
        12,
        89,
        178,
        210
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "frequenciesInitOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "initFrequenciesFoldCompDef",
      "docs": [
        "Визначення для `frequencies_fold` — згортки батча записів."
      ],
      "discriminator": [
        110,
        173,
        96,
        122,
        135,
        73,
        248,
        104
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesInitCompDef",
      "docs": [
        "Розгортання визначення обчислення для `frequencies_init`.",
        "",
        "Визначень три, бо в Arcium кожен контур — окремий акаунт, і без нього",
        "обчислення не поставити в чергу. Розгортаються один раз на мережу."
      ],
      "discriminator": [
        24,
        212,
        59,
        31,
        215,
        115,
        51,
        47
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesRevealCompDef",
      "docs": [
        "Визначення для `frequencies_reveal` — розкриття звіту покупцю."
      ],
      "discriminator": [
        200,
        153,
        93,
        20,
        151,
        150,
        143,
        184
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Одноразове розгортання платформи (`FR-019`).",
        "",
        "Повторний виклик падає на `init`: конфігурація існує в єдиному",
        "екземплярі, і мовчазне перезаписування комісії було б рівно тим, від",
        "чого захищає межа `MAX_FEE_BPS`."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Наявність конфіденційного розширення звіряється в `T054`, коли мінт",
            "з'явиться; робити це зараз означало б тягнути `anchor-spl` заради",
            "перевірки, яку нічим перевірити."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "registerDataset",
      "docs": [
        "Реєстрація датасету (`FR-001`, `FR-003`)."
      ],
      "discriminator": [
        66,
        242,
        18,
        29,
        168,
        185,
        60,
        26
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "args.dataset_id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "registerDatasetArgs"
            }
          }
        }
      ]
    },
    {
      "name": "retireDataset",
      "docs": [
        "Зняття датасету з каталогу. Акаунт лишається — на нього посилаються",
        "завершені прогони."
      ],
      "discriminator": [
        1,
        77,
        209,
        206,
        77,
        226,
        191,
        65
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "revokeConsent",
      "docs": [
        "Відкликання згоди однією дією (`FR-007`). Діє на прогони, замовлені",
        "після нього; завершені лишаються дійсними."
      ],
      "discriminator": [
        36,
        0,
        100,
        148,
        132,
        131,
        112,
        76
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "consent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setConsent",
      "docs": [
        "Нова версія згоди (`FR-005`). Попередня лишається окремим акаунтом,",
        "на який посилається нова."
      ],
      "discriminator": [
        14,
        133,
        0,
        23,
        25,
        119,
        120,
        4
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "previousConsent",
          "docs": [
            "Попередня версія згоди — або `None` для першої.",
            "",
            "Акаунт приймається як `Option`, а не як окремий набір інструкцій: так",
            "ланцюг версій будує сама програма, і клієнт не може зв'язати нову",
            "згоду з довільною чужою."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "consent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version.saturating_add(1)",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "setConsentArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setDatasetPrice",
      "docs": [
        "Ціна за 1000 записів (`FR-015`)."
      ],
      "discriminator": [
        5,
        50,
        239,
        209,
        99,
        201,
        98,
        78
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pricePer1k",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateDatasetContent",
      "docs": [
        "Нова версія вмісту (`FR-003`). Стара не зникає: на неї посилаються",
        "прогони, що вже пройшли, і подія в журналі."
      ],
      "discriminator": [
        20,
        239,
        191,
        8,
        40,
        101,
        254,
        111
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "contentHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "recordCountClaimed",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "arciumSignerAccount",
      "discriminator": [
        214,
        157,
        122,
        114,
        117,
        44,
        214,
        74
      ]
    },
    {
      "name": "consent",
      "discriminator": [
        2,
        14,
        104,
        76,
        209,
        11,
        26,
        235
      ]
    },
    {
      "name": "dataset",
      "discriminator": [
        242,
        85,
        87,
        90,
        234,
        188,
        241,
        17
      ]
    },
    {
      "name": "platformConfig",
      "discriminator": [
        160,
        78,
        128,
        0,
        248,
        83,
        230,
        160
      ]
    }
  ],
  "events": [
    {
      "name": "accumulatorCreated",
      "discriminator": [
        247,
        191,
        106,
        20,
        140,
        47,
        244,
        214
      ]
    },
    {
      "name": "consentRevoked",
      "discriminator": [
        56,
        245,
        136,
        57,
        212,
        252,
        122,
        43
      ]
    },
    {
      "name": "consentSet",
      "discriminator": [
        0,
        184,
        244,
        94,
        206,
        150,
        13,
        187
      ]
    },
    {
      "name": "datasetPriceChanged",
      "discriminator": [
        101,
        127,
        237,
        146,
        167,
        217,
        21,
        5
      ]
    },
    {
      "name": "datasetRegistered",
      "discriminator": [
        43,
        77,
        43,
        103,
        58,
        158,
        218,
        56
      ]
    },
    {
      "name": "datasetRetired",
      "discriminator": [
        208,
        10,
        201,
        202,
        110,
        58,
        4,
        105
      ]
    },
    {
      "name": "datasetVersionAdded",
      "discriminator": [
        22,
        58,
        46,
        90,
        78,
        130,
        84,
        130
      ]
    },
    {
      "name": "platformInitialized",
      "discriminator": [
        16,
        222,
        212,
        5,
        213,
        140,
        112,
        162
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "abortedComputation",
      "msg": "Обчислення перервано"
    },
    {
      "code": 6001,
      "name": "feeBpsTooHigh",
      "msg": "Комісія платформи перевищує дозволену межу"
    },
    {
      "code": 6002,
      "name": "datasetIdLength",
      "msg": "Ідентифікатор датасету порожній або довший за 32 байти"
    },
    {
      "code": 6003,
      "name": "emptyDataset",
      "msg": "Датасет без записів не реєструється"
    },
    {
      "code": 6004,
      "name": "emptyContentHash",
      "msg": "Відбиток вмісту порожній"
    },
    {
      "code": 6005,
      "name": "notDatasetOwner",
      "msg": "Ви не власник цього датасету"
    },
    {
      "code": 6006,
      "name": "datasetNotActive",
      "msg": "Датасет знято з каталогу"
    },
    {
      "code": 6007,
      "name": "datasetContentUnchanged",
      "msg": "Вміст датасету не змінився — нова версія не потрібна"
    },
    {
      "code": 6008,
      "name": "datasetVersionOverflow",
      "msg": "Лічильник версій датасету переповнився"
    },
    {
      "code": 6009,
      "name": "consentAllowsNothing",
      "msg": "Згода, яка нічого не дозволяє, — це відкликання, а не згода"
    },
    {
      "code": 6010,
      "name": "consentExpiryInPast",
      "msg": "Строк дії згоди вже минув на момент її запису"
    },
    {
      "code": 6011,
      "name": "consentAlreadyRevoked",
      "msg": "Згоду вже відкликано"
    },
    {
      "code": 6012,
      "name": "consentIsRevoked",
      "msg": "Згоду відкликано"
    },
    {
      "code": 6013,
      "name": "consentExpired",
      "msg": "Строк дії згоди минув"
    },
    {
      "code": 6014,
      "name": "unknownUseType",
      "msg": "Невідомий тип використання"
    },
    {
      "code": 6015,
      "name": "unknownBuyerCategory",
      "msg": "Невідома категорія покупця"
    },
    {
      "code": 6016,
      "name": "useTypeForbidden",
      "msg": "Цей тип використання прямо заборонений власником"
    },
    {
      "code": 6017,
      "name": "useTypeNotAllowed",
      "msg": "Цей тип використання не дозволений згодою"
    },
    {
      "code": 6018,
      "name": "buyerCategoryNotAllowed",
      "msg": "Ця категорія покупця не дозволена згодою"
    },
    {
      "code": 6019,
      "name": "consentVersionOverflow",
      "msg": "Лічильник версій згоди переповнився"
    },
    {
      "code": 6020,
      "name": "previousConsentMissing",
      "msg": "Не передано попередню версію згоди"
    },
    {
      "code": 6021,
      "name": "runWithoutDatasets",
      "msg": "Прогін без жодного датасету"
    },
    {
      "code": 6022,
      "name": "runTooManyDatasets",
      "msg": "У прогоні забагато датасетів"
    },
    {
      "code": 6023,
      "name": "runDuplicateDataset",
      "msg": "Датасет повторюється у складі прогону"
    },
    {
      "code": 6024,
      "name": "runNotAccepted",
      "msg": "Прогін не в статусі «прийнято»"
    },
    {
      "code": 6025,
      "name": "runNotRunning",
      "msg": "Прогін не виконується"
    },
    {
      "code": 6026,
      "name": "runIsFinal",
      "msg": "Прогін уже в кінцевому статусі"
    },
    {
      "code": 6027,
      "name": "runResultAlreadyRecorded",
      "msg": "Результат прогону вже записано"
    },
    {
      "code": 6028,
      "name": "runResultMissing",
      "msg": "Результату прогону ще немає"
    },
    {
      "code": 6029,
      "name": "runAlreadySettled",
      "msg": "Усім датасетам прогону вже нараховано"
    },
    {
      "code": 6030,
      "name": "runSettlementExceedsEscrow",
      "msg": "Нарахування перевищує заблоковане в депозиті"
    },
    {
      "code": 6031,
      "name": "runSettlementOverflow",
      "msg": "Переповнення суми нарахувань"
    },
    {
      "code": 6032,
      "name": "runSettlementIncomplete",
      "msg": "Нараховано не всім датасетам прогону"
    }
  ],
  "types": [
    {
      "name": "accumulatorCreated",
      "docs": [
        "Порожній накопичувач, зашифрований ключем MXE.",
        "",
        "Розшифрувати його не може ніхто, крім кластера: подія існує, щоб клієнт мав",
        "що передати першій згортці, а не щоб хтось прочитав вміст."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertexts",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "activation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "activationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "deactivationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          }
        ]
      }
    },
    {
      "name": "arciumSignerAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bn254g2blsPublicKey",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "array": [
              "u8",
              64
            ]
          }
        ]
      }
    },
    {
      "name": "circuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "local",
            "fields": [
              {
                "defined": {
                  "name": "localCircuitSource"
                }
              }
            ]
          },
          {
            "name": "onChain",
            "fields": [
              {
                "defined": {
                  "name": "onChainCircuitSource"
                }
              }
            ]
          },
          {
            "name": "offChain",
            "fields": [
              {
                "defined": {
                  "name": "offChainCircuitSource"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "clockAccount",
      "docs": [
        "An account storing the current network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "currentEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "startEpochTimestamp",
            "type": {
              "defined": {
                "name": "timestamp"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "cluster",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tdInfo",
            "type": {
              "option": {
                "defined": {
                  "name": "nodeMetadata"
                }
              }
            }
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "clusterSize",
            "type": "u16"
          },
          {
            "name": "activation",
            "type": {
              "defined": {
                "name": "activation"
              }
            }
          },
          {
            "name": "maxCapacity",
            "type": "u64"
          },
          {
            "name": "cuPrice",
            "type": "u64"
          },
          {
            "name": "cuPriceProposals",
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          },
          {
            "name": "lastUpdatedEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "nodes",
            "type": {
              "vec": {
                "defined": {
                  "name": "nodeRef"
                }
              }
            }
          },
          {
            "name": "pendingNodes",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "blsPublicKey",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "bn254g2blsPublicKey"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "currentEpochTotalRewards",
            "type": "u64"
          },
          {
            "name": "rewardsEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "leaderSelector",
            "type": {
              "defined": {
                "name": "leaderSelector"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computationDefinitionAccount",
      "docs": [
        "An account representing a [ComputationDefinition] in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deactivationSlot",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "cuAmount",
            "type": "u64"
          },
          {
            "name": "definition",
            "type": {
              "defined": {
                "name": "computationDefinitionMeta"
              }
            }
          },
          {
            "name": "circuitSource",
            "type": {
              "defined": {
                "name": "circuitSource"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "computationDefinitionMeta",
      "docs": [
        "A computation definition for execution in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circuitLen",
            "type": "u32"
          },
          {
            "name": "signature",
            "type": {
              "defined": {
                "name": "computationSignature"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computationSignature",
      "docs": [
        "The signature of a computation defined in a [ComputationDefinition]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "parameters",
            "type": {
              "vec": {
                "defined": {
                  "name": "parameter"
                }
              }
            }
          },
          {
            "name": "outputs",
            "type": {
              "vec": {
                "defined": {
                  "name": "output"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "consent",
      "docs": [
        "Версія згоди (`FR-005`).",
        "",
        "Seeds: `[\"consent\", dataset, version]`. Кожна версія — окремий акаунт із",
        "посиланням на попередню: перезапис зробив би вимогу «історія без",
        "можливості перезапису» недоказовою. Поточну версію датасету зберігає сам",
        "`Dataset.consent_version`, тож адреса чинної згоди деривується без пошуку."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "version",
            "docs": [
              "Починається з 1; 0 у `Dataset.consent_version` означає «згоди немає»."
            ],
            "type": "u32"
          },
          {
            "name": "allowedUses",
            "docs": [
              "Що дозволено."
            ],
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "docs": [
              "Що заборонено попри дозвіл. Не надлишкове поле: воно дає висловити",
              "«дозволено все, крім фарма-комерційного», не перелічуючи решту, і",
              "новий тип використання у словнику не стає дозволеним заднім числом."
            ],
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "docs": [
              "`None` — без строку. Строк перевіряється часом ланцюга, не клієнта."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "revokedAt",
            "docs": [
              "Проставляється відкликанням і більше не змінюється (`FR-007`)."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "prevVersion",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "consentRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "consent",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "revokedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "consentSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "consent",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previousVersion",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "allowedUses",
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "dataset",
      "docs": [
        "Ончейн-ідентичність датасету (`FR-003`).",
        "",
        "Seeds: `[\"dataset\", owner, dataset_id]`.",
        "",
        "`content_hash` і `version` тут — **поточні**. Історію доводить не цей",
        "акаунт, а `Run`: кожен прогін пише версію й відбиток, по яких ішов",
        "(`FR-004`), тож завершений прогін не можна заднім числом переприв'язати до",
        "іншого вмісту, скільки б разів датасет не оновлювали після нього."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "version",
            "docs": [
              "Зростає з кожною зміною вмісту; починається з 1."
            ],
            "type": "u32"
          },
          {
            "name": "contentHash",
            "docs": [
              "sha-256 шифротексту. Оператор бачить лише його — ключа він не має",
              "(`FR-004a`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "docs": [
              "Скільки записів заявив власник. Скільки увійшло насправді — рахує MPC",
              "(`FR-018a`), і саме те число йде в оплату."
            ],
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "docs": [
              "Ціна за 1000 записів (`FR-015`)."
            ],
            "type": "u64"
          },
          {
            "name": "consentVersion",
            "docs": [
              "Номер чинної версії згоди; 0 — згоди ще немає. Тримається тут, щоб",
              "адреса чинного `Consent` деривувалась без пошуку по ланцюгу версій."
            ],
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "datasetStatus"
              }
            }
          },
          {
            "name": "verifiedBadge",
            "type": {
              "option": {
                "defined": {
                  "name": "verificationBadge"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "datasetPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "previousPricePer1k",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "datasetRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "datasetRetired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "datasetStatus",
      "docs": [
        "Стан датасету в каталозі.",
        "",
        "Це **не** заміна згоді. Згода відповідає на питання «на що можна», статус —",
        "на питання «чи є цей датасет узагалі». Власник, який продає дані далі не",
        "хоче, має обидва важелі, і плутати їх не варто: відкликання згоди лишає",
        "датасет у каталозі видимим, зняття прибирає його з обігу."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "retired"
          }
        ]
      }
    },
    {
      "name": "datasetVersionAdded",
      "docs": [
        "Подія на кожну версію — це і є «стару не перезаписано» (`FR-003`).",
        "",
        "Акаунт тримає лише поточний стан; попередній відбиток лишається в журналі",
        "разом із номером версії, і `Run` кожного прогону вказує на ту версію, по",
        "якій ішов."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previousContentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "The network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          "u64"
        ]
      }
    },
    {
      "name": "feePool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "frequenciesInitOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "mxeEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "24"
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "leaderChoice",
      "docs": [
        "The computation chosen by a node to be executed when the node is leader."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offset",
            "type": "u64"
          },
          {
            "name": "slotIdx",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "leaderInfo",
      "docs": [
        "The information about a node."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "count",
            "type": "u64"
          },
          {
            "name": "lastCounterPlusOne",
            "type": "u64"
          },
          {
            "name": "choice",
            "type": {
              "defined": {
                "name": "leaderChoice"
              }
            }
          }
        ]
      }
    },
    {
      "name": "leaderSelector",
      "docs": [
        "To select a Leader.",
        "Uses the greatest divisors method: https://en.wikipedia.org/wiki/D%27Hondt_method"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stakingEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "info",
            "type": {
              "vec": {
                "defined": {
                  "name": "leaderInfo"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "localCircuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "mxeKeygen"
          },
          {
            "name": "mxeKeyRecoveryInit"
          },
          {
            "name": "mxeKeyRecoveryFinalize"
          }
        ]
      }
    },
    {
      "name": "mxeAccount",
      "docs": [
        "A MPC Execution Environment."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "padding",
            "type": "u8"
          },
          {
            "name": "cluster",
            "type": "u32"
          },
          {
            "name": "keygenOffset",
            "type": "u64"
          },
          {
            "name": "keyRecoveryInitOffset",
            "type": "u64"
          },
          {
            "name": "mxeProgramId",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "utilityPubkeys",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "utilityPubkeys"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "lutOffsetSlot",
            "type": "u64"
          },
          {
            "name": "computationDefinitions",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "mxeStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "currentEpochRecoveryRewards",
            "type": "u64"
          },
          {
            "name": "recoveryRewardsEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          }
        ]
      }
    },
    {
      "name": "mxeEncryptedStruct",
      "generics": [
        {
          "kind": "const",
          "name": "len",
          "type": "usize"
        }
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": "u128"
          },
          {
            "name": "ciphertexts",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                {
                  "generic": "len"
                }
              ]
            }
          }
        ]
      }
    },
    {
      "name": "mxeStatus",
      "docs": [
        "The status of an MXE."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "migration"
          }
        ]
      }
    },
    {
      "name": "nodeMetadata",
      "docs": [
        "location as [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) country code"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ip",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "peerId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "location",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "nodeRef",
      "docs": [
        "A reference to a node in the cluster.",
        "The offset is to derive the Node Account."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "vote",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "source",
            "type": "string"
          },
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "onChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isCompleted",
            "type": "bool"
          },
          {
            "name": "uploadAuth",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "output",
      "docs": [
        "An output of a computation.",
        "We currently don't support encrypted outputs yet since encrypted values are passed via",
        "data objects."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextPoint"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          }
        ]
      }
    },
    {
      "name": "parameter",
      "docs": [
        "A parameter of a computation.",
        "We differentiate between plaintext and encrypted parameters and data objects.",
        "Plaintext parameters are directly provided as their value.",
        "Encrypted parameters are provided as an offchain reference to the data.",
        "Data objects are provided as a reference to the data object account."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "arcisSignature"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          },
          {
            "name": "plaintextPoint"
          }
        ]
      }
    },
    {
      "name": "platformConfig",
      "docs": [
        "Конфігурація платформи — єдиний акаунт на всю програму.",
        "",
        "Seeds: `[\"config\"]`. Без `authority` тут не було б кому оновлювати",
        "комісію й ставити систему на паузу; без `mint` розрахунки не мали б",
        "спільної валюти, і кожен прогін міг би бути в іншому токені."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Хто має право змінювати цю конфігурацію."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "Мінт, у якому йдуть депозити, нарахування й комісія."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Комісія платформи в базисних пунктах."
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Пауза: нові прогони не приймаються. Уже прийняті доводяться до кінця —",
              "інакше пауза стала б способом не платити власникам за виконану роботу."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "platformInitialized",
      "docs": [
        "Публічна поява платформи: після цієї події будь-хто знає комісію й мінт,",
        "не читаючи наш інтерфейс (`FR-019`, `FR-026`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "registerDatasetArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "setConsentArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allowedUses",
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "setUnset",
      "docs": [
        "Utility struct to store a value that needs to be set by a certain number of participants (keys",
        "in our case). Once all participants have set the value, the value is considered set and we only",
        "store it once."
      ],
      "generics": [
        {
          "kind": "type",
          "name": "t"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "set",
            "fields": [
              {
                "generic": "t"
              }
            ]
          },
          {
            "name": "unset",
            "fields": [
              {
                "generic": "t"
              },
              {
                "vec": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "signedComputationOutputs",
      "generics": [
        {
          "kind": "type",
          "name": "o"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "success",
            "fields": [
              {
                "generic": "o"
              },
              {
                "array": [
                  "u8",
                  64
                ]
              }
            ]
          },
          {
            "name": "failure"
          },
          {
            "name": "markerForIdlBuildDoNotUseThis",
            "fields": [
              {
                "generic": "o"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "timestamp",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "utilityPubkeys",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "x25519Pubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ed25519VerifyingKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "elgamalPubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pubkeyValidityProof",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "verificationBadge",
      "docs": [
        "Позначка підтвердження організації (`FR-024`).",
        "",
        "`FR-024a` вимагає називати її тим, чим вона є: це довіра до оператора",
        "платформи, а не криптографічний доказ. Тому тут лежить не «доказ», а хто",
        "саме й коли поставив позначку — щоб покупець судив про джерело сам.",
        "Ставить її `T060`; до того поле лишається `None`, і картка датасету має",
        "показувати різницю, а не мовчати про неї."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "verifiedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
}

export const IDL: Genovault = {
  "address": "9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb",
  "metadata": {
    "name": "genovault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Конфіденційний маркетплейс медичних і геномних даних"
  },
  "docs": [
    "Програма GenoVault.",
    "",
    "Рецепт «частоти й розподіли» (`T018`) живе в `encrypted-ixs` трьома",
    "контурами, і тут розгортаються їхні визначення обчислень. Виклик",
    "`frequencies_init` поки не належить жодному прогону — він доводить, що",
    "ланцюг «черга обчислень → вузли → callback» замикається на цьому",
    "репозиторії. Замовлення прогону з перевіркою згоди й депозитом приходить",
    "у `T024`, згортка батчів і розкриття — у `T025`-`T026`."
  ],
  "instructions": [
    {
      "name": "frequenciesInit",
      "docs": [
        "Створює порожній накопичувач частот.",
        "",
        "Прогону ця інструкція поки не належить: `Run`, перевірка згоди й",
        "депозит приходять у `T024`, згортка батчів і розкриття — у",
        "`T025`-`T026`. Вона стоїть тут із тієї ж причини, з якої тут раніше",
        "стояв каркасний `probe_sum`: доводить, що ланцюг «програма → черга",
        "обчислень → MPC-вузли → callback» замикається на цьому репозиторії.",
        "Різниця в тому, що тепер це справжній рецепт із каталогу, а не",
        "заглушка, яка додає два числа."
      ],
      "discriminator": [
        123,
        84,
        5,
        59,
        85,
        227,
        151,
        19
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "signPdaAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  65,
                  114,
                  99,
                  105,
                  117,
                  109,
                  83,
                  105,
                  103,
                  110,
                  101,
                  114,
                  65,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "mempoolAccount",
          "writable": true
        },
        {
          "name": "executingPool",
          "writable": true
        },
        {
          "name": "computationAccount",
          "writable": true
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "clusterAccount",
          "writable": true
        },
        {
          "name": "poolAccount",
          "writable": true,
          "address": "G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC"
        },
        {
          "name": "clockAccount",
          "writable": true,
          "address": "7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        }
      ],
      "args": [
        {
          "name": "computationOffset",
          "type": "u64"
        }
      ]
    },
    {
      "name": "frequenciesInitCallback",
      "discriminator": [
        31,
        140,
        237,
        214,
        12,
        89,
        178,
        210
      ],
      "accounts": [
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "compDefAccount"
        },
        {
          "name": "mxeAccount"
        },
        {
          "name": "computationAccount"
        },
        {
          "name": "clusterAccount"
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "output",
          "type": {
            "defined": {
              "name": "signedComputationOutputs",
              "generics": [
                {
                  "kind": "type",
                  "type": {
                    "defined": {
                      "name": "frequenciesInitOutput"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      "name": "initFrequenciesFoldCompDef",
      "docs": [
        "Визначення для `frequencies_fold` — згортки батча записів."
      ],
      "discriminator": [
        110,
        173,
        96,
        122,
        135,
        73,
        248,
        104
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesInitCompDef",
      "docs": [
        "Розгортання визначення обчислення для `frequencies_init`.",
        "",
        "Визначень три, бо в Arcium кожен контур — окремий акаунт, і без нього",
        "обчислення не поставити в чергу. Розгортаються один раз на мережу."
      ],
      "discriminator": [
        24,
        212,
        59,
        31,
        215,
        115,
        51,
        47
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesRevealCompDef",
      "docs": [
        "Визначення для `frequencies_reveal` — розкриття звіту покупцю."
      ],
      "discriminator": [
        200,
        153,
        93,
        20,
        151,
        150,
        143,
        184
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "mxeAccount",
          "writable": true
        },
        {
          "name": "compDefAccount",
          "writable": true
        },
        {
          "name": "addressLookupTable",
          "writable": true
        },
        {
          "name": "lutProgram",
          "address": "AddressLookupTab1e1111111111111111111111111"
        },
        {
          "name": "arciumProgram",
          "address": "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Одноразове розгортання платформи (`FR-019`).",
        "",
        "Повторний виклик падає на `init`: конфігурація існує в єдиному",
        "екземплярі, і мовчазне перезаписування комісії було б рівно тим, від",
        "чого захищає межа `MAX_FEE_BPS`."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Наявність конфіденційного розширення звіряється в `T054`, коли мінт",
            "з'явиться; робити це зараз означало б тягнути `anchor-spl` заради",
            "перевірки, яку нічим перевірити."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "registerDataset",
      "docs": [
        "Реєстрація датасету (`FR-001`, `FR-003`)."
      ],
      "discriminator": [
        66,
        242,
        18,
        29,
        168,
        185,
        60,
        26
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "args.dataset_id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "registerDatasetArgs"
            }
          }
        }
      ]
    },
    {
      "name": "retireDataset",
      "docs": [
        "Зняття датасету з каталогу. Акаунт лишається — на нього посилаються",
        "завершені прогони."
      ],
      "discriminator": [
        1,
        77,
        209,
        206,
        77,
        226,
        191,
        65
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "revokeConsent",
      "docs": [
        "Відкликання згоди однією дією (`FR-007`). Діє на прогони, замовлені",
        "після нього; завершені лишаються дійсними."
      ],
      "discriminator": [
        36,
        0,
        100,
        148,
        132,
        131,
        112,
        76
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "consent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "setConsent",
      "docs": [
        "Нова версія згоди (`FR-005`). Попередня лишається окремим акаунтом,",
        "на який посилається нова."
      ],
      "discriminator": [
        14,
        133,
        0,
        23,
        25,
        119,
        120,
        4
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "previousConsent",
          "docs": [
            "Попередня версія згоди — або `None` для першої.",
            "",
            "Акаунт приймається як `Option`, а не як окремий набір інструкцій: так",
            "ланцюг версій будує сама програма, і клієнт не може зв'язати нову",
            "згоду з довільною чужою."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "consent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  115,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "dataset"
              },
              {
                "kind": "account",
                "path": "dataset.consent_version.saturating_add(1)",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "setConsentArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setDatasetPrice",
      "docs": [
        "Ціна за 1000 записів (`FR-015`)."
      ],
      "discriminator": [
        5,
        50,
        239,
        209,
        99,
        201,
        98,
        78
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pricePer1k",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateDatasetContent",
      "docs": [
        "Нова версія вмісту (`FR-003`). Стара не зникає: на неї посилаються",
        "прогони, що вже пройшли, і подія в журналі."
      ],
      "discriminator": [
        20,
        239,
        191,
        8,
        40,
        101,
        254,
        111
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "dataset"
          ]
        },
        {
          "name": "dataset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "dataset.dataset_id",
                "account": "dataset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "contentHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "recordCountClaimed",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "arciumSignerAccount",
      "discriminator": [
        214,
        157,
        122,
        114,
        117,
        44,
        214,
        74
      ]
    },
    {
      "name": "consent",
      "discriminator": [
        2,
        14,
        104,
        76,
        209,
        11,
        26,
        235
      ]
    },
    {
      "name": "dataset",
      "discriminator": [
        242,
        85,
        87,
        90,
        234,
        188,
        241,
        17
      ]
    },
    {
      "name": "platformConfig",
      "discriminator": [
        160,
        78,
        128,
        0,
        248,
        83,
        230,
        160
      ]
    }
  ],
  "events": [
    {
      "name": "accumulatorCreated",
      "discriminator": [
        247,
        191,
        106,
        20,
        140,
        47,
        244,
        214
      ]
    },
    {
      "name": "consentRevoked",
      "discriminator": [
        56,
        245,
        136,
        57,
        212,
        252,
        122,
        43
      ]
    },
    {
      "name": "consentSet",
      "discriminator": [
        0,
        184,
        244,
        94,
        206,
        150,
        13,
        187
      ]
    },
    {
      "name": "datasetPriceChanged",
      "discriminator": [
        101,
        127,
        237,
        146,
        167,
        217,
        21,
        5
      ]
    },
    {
      "name": "datasetRegistered",
      "discriminator": [
        43,
        77,
        43,
        103,
        58,
        158,
        218,
        56
      ]
    },
    {
      "name": "datasetRetired",
      "discriminator": [
        208,
        10,
        201,
        202,
        110,
        58,
        4,
        105
      ]
    },
    {
      "name": "datasetVersionAdded",
      "discriminator": [
        22,
        58,
        46,
        90,
        78,
        130,
        84,
        130
      ]
    },
    {
      "name": "platformInitialized",
      "discriminator": [
        16,
        222,
        212,
        5,
        213,
        140,
        112,
        162
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "abortedComputation",
      "msg": "Обчислення перервано"
    },
    {
      "code": 6001,
      "name": "feeBpsTooHigh",
      "msg": "Комісія платформи перевищує дозволену межу"
    },
    {
      "code": 6002,
      "name": "datasetIdLength",
      "msg": "Ідентифікатор датасету порожній або довший за 32 байти"
    },
    {
      "code": 6003,
      "name": "emptyDataset",
      "msg": "Датасет без записів не реєструється"
    },
    {
      "code": 6004,
      "name": "emptyContentHash",
      "msg": "Відбиток вмісту порожній"
    },
    {
      "code": 6005,
      "name": "notDatasetOwner",
      "msg": "Ви не власник цього датасету"
    },
    {
      "code": 6006,
      "name": "datasetNotActive",
      "msg": "Датасет знято з каталогу"
    },
    {
      "code": 6007,
      "name": "datasetContentUnchanged",
      "msg": "Вміст датасету не змінився — нова версія не потрібна"
    },
    {
      "code": 6008,
      "name": "datasetVersionOverflow",
      "msg": "Лічильник версій датасету переповнився"
    },
    {
      "code": 6009,
      "name": "consentAllowsNothing",
      "msg": "Згода, яка нічого не дозволяє, — це відкликання, а не згода"
    },
    {
      "code": 6010,
      "name": "consentExpiryInPast",
      "msg": "Строк дії згоди вже минув на момент її запису"
    },
    {
      "code": 6011,
      "name": "consentAlreadyRevoked",
      "msg": "Згоду вже відкликано"
    },
    {
      "code": 6012,
      "name": "consentIsRevoked",
      "msg": "Згоду відкликано"
    },
    {
      "code": 6013,
      "name": "consentExpired",
      "msg": "Строк дії згоди минув"
    },
    {
      "code": 6014,
      "name": "unknownUseType",
      "msg": "Невідомий тип використання"
    },
    {
      "code": 6015,
      "name": "unknownBuyerCategory",
      "msg": "Невідома категорія покупця"
    },
    {
      "code": 6016,
      "name": "useTypeForbidden",
      "msg": "Цей тип використання прямо заборонений власником"
    },
    {
      "code": 6017,
      "name": "useTypeNotAllowed",
      "msg": "Цей тип використання не дозволений згодою"
    },
    {
      "code": 6018,
      "name": "buyerCategoryNotAllowed",
      "msg": "Ця категорія покупця не дозволена згодою"
    },
    {
      "code": 6019,
      "name": "consentVersionOverflow",
      "msg": "Лічильник версій згоди переповнився"
    },
    {
      "code": 6020,
      "name": "previousConsentMissing",
      "msg": "Не передано попередню версію згоди"
    },
    {
      "code": 6021,
      "name": "runWithoutDatasets",
      "msg": "Прогін без жодного датасету"
    },
    {
      "code": 6022,
      "name": "runTooManyDatasets",
      "msg": "У прогоні забагато датасетів"
    },
    {
      "code": 6023,
      "name": "runDuplicateDataset",
      "msg": "Датасет повторюється у складі прогону"
    },
    {
      "code": 6024,
      "name": "runNotAccepted",
      "msg": "Прогін не в статусі «прийнято»"
    },
    {
      "code": 6025,
      "name": "runNotRunning",
      "msg": "Прогін не виконується"
    },
    {
      "code": 6026,
      "name": "runIsFinal",
      "msg": "Прогін уже в кінцевому статусі"
    },
    {
      "code": 6027,
      "name": "runResultAlreadyRecorded",
      "msg": "Результат прогону вже записано"
    },
    {
      "code": 6028,
      "name": "runResultMissing",
      "msg": "Результату прогону ще немає"
    },
    {
      "code": 6029,
      "name": "runAlreadySettled",
      "msg": "Усім датасетам прогону вже нараховано"
    },
    {
      "code": 6030,
      "name": "runSettlementExceedsEscrow",
      "msg": "Нарахування перевищує заблоковане в депозиті"
    },
    {
      "code": 6031,
      "name": "runSettlementOverflow",
      "msg": "Переповнення суми нарахувань"
    },
    {
      "code": 6032,
      "name": "runSettlementIncomplete",
      "msg": "Нараховано не всім датасетам прогону"
    }
  ],
  "types": [
    {
      "name": "accumulatorCreated",
      "docs": [
        "Порожній накопичувач, зашифрований ключем MXE.",
        "",
        "Розшифрувати його не може ніхто, крім кластера: подія існує, щоб клієнт мав",
        "що передати першій згортці, а не щоб хтось прочитав вміст."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertexts",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "activation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "activationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "deactivationEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          }
        ]
      }
    },
    {
      "name": "arciumSignerAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bn254g2blsPublicKey",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "array": [
              "u8",
              64
            ]
          }
        ]
      }
    },
    {
      "name": "circuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "local",
            "fields": [
              {
                "defined": {
                  "name": "localCircuitSource"
                }
              }
            ]
          },
          {
            "name": "onChain",
            "fields": [
              {
                "defined": {
                  "name": "onChainCircuitSource"
                }
              }
            ]
          },
          {
            "name": "offChain",
            "fields": [
              {
                "defined": {
                  "name": "offChainCircuitSource"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "clockAccount",
      "docs": [
        "An account storing the current network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "startEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "currentEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "startEpochTimestamp",
            "type": {
              "defined": {
                "name": "timestamp"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "cluster",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tdInfo",
            "type": {
              "option": {
                "defined": {
                  "name": "nodeMetadata"
                }
              }
            }
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "clusterSize",
            "type": "u16"
          },
          {
            "name": "activation",
            "type": {
              "defined": {
                "name": "activation"
              }
            }
          },
          {
            "name": "maxCapacity",
            "type": "u64"
          },
          {
            "name": "cuPrice",
            "type": "u64"
          },
          {
            "name": "cuPriceProposals",
            "type": {
              "array": [
                "u64",
                32
              ]
            }
          },
          {
            "name": "lastUpdatedEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "nodes",
            "type": {
              "vec": {
                "defined": {
                  "name": "nodeRef"
                }
              }
            }
          },
          {
            "name": "pendingNodes",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "blsPublicKey",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "bn254g2blsPublicKey"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "currentEpochTotalRewards",
            "type": "u64"
          },
          {
            "name": "rewardsEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "leaderSelector",
            "type": {
              "defined": {
                "name": "leaderSelector"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computationDefinitionAccount",
      "docs": [
        "An account representing a [ComputationDefinition] in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deactivationSlot",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "cuAmount",
            "type": "u64"
          },
          {
            "name": "definition",
            "type": {
              "defined": {
                "name": "computationDefinitionMeta"
              }
            }
          },
          {
            "name": "circuitSource",
            "type": {
              "defined": {
                "name": "circuitSource"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                24
              ]
            }
          }
        ]
      }
    },
    {
      "name": "computationDefinitionMeta",
      "docs": [
        "A computation definition for execution in a MXE."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "circuitLen",
            "type": "u32"
          },
          {
            "name": "signature",
            "type": {
              "defined": {
                "name": "computationSignature"
              }
            }
          }
        ]
      }
    },
    {
      "name": "computationSignature",
      "docs": [
        "The signature of a computation defined in a [ComputationDefinition]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "parameters",
            "type": {
              "vec": {
                "defined": {
                  "name": "parameter"
                }
              }
            }
          },
          {
            "name": "outputs",
            "type": {
              "vec": {
                "defined": {
                  "name": "output"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "consent",
      "docs": [
        "Версія згоди (`FR-005`).",
        "",
        "Seeds: `[\"consent\", dataset, version]`. Кожна версія — окремий акаунт із",
        "посиланням на попередню: перезапис зробив би вимогу «історія без",
        "можливості перезапису» недоказовою. Поточну версію датасету зберігає сам",
        "`Dataset.consent_version`, тож адреса чинної згоди деривується без пошуку."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "version",
            "docs": [
              "Починається з 1; 0 у `Dataset.consent_version` означає «згоди немає»."
            ],
            "type": "u32"
          },
          {
            "name": "allowedUses",
            "docs": [
              "Що дозволено."
            ],
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "docs": [
              "Що заборонено попри дозвіл. Не надлишкове поле: воно дає висловити",
              "«дозволено все, крім фарма-комерційного», не перелічуючи решту, і",
              "новий тип використання у словнику не стає дозволеним заднім числом."
            ],
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "docs": [
              "`None` — без строку. Строк перевіряється часом ланцюга, не клієнта."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "revokedAt",
            "docs": [
              "Проставляється відкликанням і більше не змінюється (`FR-007`)."
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "prevVersion",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "consentRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "consent",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "revokedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "consentSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "consent",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previousVersion",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "allowedUses",
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "dataset",
      "docs": [
        "Ончейн-ідентичність датасету (`FR-003`).",
        "",
        "Seeds: `[\"dataset\", owner, dataset_id]`.",
        "",
        "`content_hash` і `version` тут — **поточні**. Історію доводить не цей",
        "акаунт, а `Run`: кожен прогін пише версію й відбиток, по яких ішов",
        "(`FR-004`), тож завершений прогін не можна заднім числом переприв'язати до",
        "іншого вмісту, скільки б разів датасет не оновлювали після нього."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "version",
            "docs": [
              "Зростає з кожною зміною вмісту; починається з 1."
            ],
            "type": "u32"
          },
          {
            "name": "contentHash",
            "docs": [
              "sha-256 шифротексту. Оператор бачить лише його — ключа він не має",
              "(`FR-004a`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "docs": [
              "Скільки записів заявив власник. Скільки увійшло насправді — рахує MPC",
              "(`FR-018a`), і саме те число йде в оплату."
            ],
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "docs": [
              "Ціна за 1000 записів (`FR-015`)."
            ],
            "type": "u64"
          },
          {
            "name": "consentVersion",
            "docs": [
              "Номер чинної версії згоди; 0 — згоди ще немає. Тримається тут, щоб",
              "адреса чинного `Consent` деривувалась без пошуку по ланцюгу версій."
            ],
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "datasetStatus"
              }
            }
          },
          {
            "name": "verifiedBadge",
            "type": {
              "option": {
                "defined": {
                  "name": "verificationBadge"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "datasetPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "previousPricePer1k",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "datasetRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "datasetRetired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "datasetStatus",
      "docs": [
        "Стан датасету в каталозі.",
        "",
        "Це **не** заміна згоді. Згода відповідає на питання «на що можна», статус —",
        "на питання «чи є цей датасет узагалі». Власник, який продає дані далі не",
        "хоче, має обидва важелі, і плутати їх не варто: відкликання згоди лишає",
        "датасет у каталозі видимим, зняття прибирає його з обігу."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "retired"
          }
        ]
      }
    },
    {
      "name": "datasetVersionAdded",
      "docs": [
        "Подія на кожну версію — це і є «стару не перезаписано» (`FR-003`).",
        "",
        "Акаунт тримає лише поточний стан; попередній відбиток лишається в журналі",
        "разом із номером версії, і `Run` кожного прогону вказує на ту версію, по",
        "якій ішов."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previousContentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "The network epoch"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          "u64"
        ]
      }
    },
    {
      "name": "feePool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "frequenciesInitOutput",
      "docs": [
        "The output of the callback instruction. Provided as a struct with ordered fields",
        "as anchor does not support tuples and tuple structs yet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "mxeEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "24"
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "leaderChoice",
      "docs": [
        "The computation chosen by a node to be executed when the node is leader."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offset",
            "type": "u64"
          },
          {
            "name": "slotIdx",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "leaderInfo",
      "docs": [
        "The information about a node."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "count",
            "type": "u64"
          },
          {
            "name": "lastCounterPlusOne",
            "type": "u64"
          },
          {
            "name": "choice",
            "type": {
              "defined": {
                "name": "leaderChoice"
              }
            }
          }
        ]
      }
    },
    {
      "name": "leaderSelector",
      "docs": [
        "To select a Leader.",
        "Uses the greatest divisors method: https://en.wikipedia.org/wiki/D%27Hondt_method"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stakingEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          },
          {
            "name": "info",
            "type": {
              "vec": {
                "defined": {
                  "name": "leaderInfo"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "localCircuitSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "mxeKeygen"
          },
          {
            "name": "mxeKeyRecoveryInit"
          },
          {
            "name": "mxeKeyRecoveryFinalize"
          }
        ]
      }
    },
    {
      "name": "mxeAccount",
      "docs": [
        "A MPC Execution Environment."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "padding",
            "type": "u8"
          },
          {
            "name": "cluster",
            "type": "u32"
          },
          {
            "name": "keygenOffset",
            "type": "u64"
          },
          {
            "name": "keyRecoveryInitOffset",
            "type": "u64"
          },
          {
            "name": "mxeProgramId",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "utilityPubkeys",
            "type": {
              "defined": {
                "name": "setUnset",
                "generics": [
                  {
                    "kind": "type",
                    "type": {
                      "defined": {
                        "name": "utilityPubkeys"
                      }
                    }
                  }
                ]
              }
            }
          },
          {
            "name": "lutOffsetSlot",
            "type": "u64"
          },
          {
            "name": "computationDefinitions",
            "type": {
              "vec": "u32"
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "mxeStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "currentEpochRecoveryRewards",
            "type": "u64"
          },
          {
            "name": "recoveryRewardsEpoch",
            "type": {
              "defined": {
                "name": "epoch"
              }
            }
          }
        ]
      }
    },
    {
      "name": "mxeEncryptedStruct",
      "generics": [
        {
          "kind": "const",
          "name": "len",
          "type": "usize"
        }
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": "u128"
          },
          {
            "name": "ciphertexts",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                {
                  "generic": "len"
                }
              ]
            }
          }
        ]
      }
    },
    {
      "name": "mxeStatus",
      "docs": [
        "The status of an MXE."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "migration"
          }
        ]
      }
    },
    {
      "name": "nodeMetadata",
      "docs": [
        "location as [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) country code"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ip",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "peerId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "location",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "nodeRef",
      "docs": [
        "A reference to a node in the cluster.",
        "The offset is to derive the Node Account."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "vote",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "source",
            "type": "string"
          },
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "onChainCircuitSource",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isCompleted",
            "type": "bool"
          },
          {
            "name": "uploadAuth",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "output",
      "docs": [
        "An output of a computation.",
        "We currently don't support encrypted outputs yet since encrypted values are passed via",
        "data objects."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextPoint"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          }
        ]
      }
    },
    {
      "name": "parameter",
      "docs": [
        "A parameter of a computation.",
        "We differentiate between plaintext and encrypted parameters and data objects.",
        "Plaintext parameters are directly provided as their value.",
        "Encrypted parameters are provided as an offchain reference to the data.",
        "Data objects are provided as a reference to the data object account."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "plaintextBool"
          },
          {
            "name": "plaintextU8"
          },
          {
            "name": "plaintextU16"
          },
          {
            "name": "plaintextU32"
          },
          {
            "name": "plaintextU64"
          },
          {
            "name": "plaintextU128"
          },
          {
            "name": "ciphertext"
          },
          {
            "name": "arcisX25519Pubkey"
          },
          {
            "name": "arcisSignature"
          },
          {
            "name": "plaintextFloat"
          },
          {
            "name": "plaintextI8"
          },
          {
            "name": "plaintextI16"
          },
          {
            "name": "plaintextI32"
          },
          {
            "name": "plaintextI64"
          },
          {
            "name": "plaintextI128"
          },
          {
            "name": "plaintextPoint"
          }
        ]
      }
    },
    {
      "name": "platformConfig",
      "docs": [
        "Конфігурація платформи — єдиний акаунт на всю програму.",
        "",
        "Seeds: `[\"config\"]`. Без `authority` тут не було б кому оновлювати",
        "комісію й ставити систему на паузу; без `mint` розрахунки не мали б",
        "спільної валюти, і кожен прогін міг би бути в іншому токені."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Хто має право змінювати цю конфігурацію."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "Мінт, у якому йдуть депозити, нарахування й комісія."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Комісія платформи в базисних пунктах."
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Пауза: нові прогони не приймаються. Уже прийняті доводяться до кінця —",
              "інакше пауза стала б способом не платити власникам за виконану роботу."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "platformInitialized",
      "docs": [
        "Публічна поява платформи: після цієї події будь-хто знає комісію й мінт,",
        "не читаючи наш інтерфейс (`FR-019`, `FR-026`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "registerDatasetArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "datasetId",
            "type": "string"
          },
          {
            "name": "contentHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recordCountClaimed",
            "type": "u64"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "setConsentArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allowedUses",
            "type": "u32"
          },
          {
            "name": "forbiddenUses",
            "type": "u32"
          },
          {
            "name": "buyerCategories",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "setUnset",
      "docs": [
        "Utility struct to store a value that needs to be set by a certain number of participants (keys",
        "in our case). Once all participants have set the value, the value is considered set and we only",
        "store it once."
      ],
      "generics": [
        {
          "kind": "type",
          "name": "t"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "set",
            "fields": [
              {
                "generic": "t"
              }
            ]
          },
          {
            "name": "unset",
            "fields": [
              {
                "generic": "t"
              },
              {
                "vec": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "signedComputationOutputs",
      "generics": [
        {
          "kind": "type",
          "name": "o"
        }
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "success",
            "fields": [
              {
                "generic": "o"
              },
              {
                "array": [
                  "u8",
                  64
                ]
              }
            ]
          },
          {
            "name": "failure"
          },
          {
            "name": "markerForIdlBuildDoNotUseThis",
            "fields": [
              {
                "generic": "o"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "timestamp",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "utilityPubkeys",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "x25519Pubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ed25519VerifyingKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "elgamalPubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pubkeyValidityProof",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "verificationBadge",
      "docs": [
        "Позначка підтвердження організації (`FR-024`).",
        "",
        "`FR-024a` вимагає називати її тим, чим вона є: це довіра до оператора",
        "платформи, а не криптографічний доказ. Тому тут лежить не «доказ», а хто",
        "саме й коли поставив позначку — щоб покупець судив про джерело сам.",
        "Ставить її `T060`; до того поле лишається `None`, і картка датасету має",
        "показувати різницю, а не мовчати про неї."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "verifiedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
}
