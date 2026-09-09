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
    "Рецепт «частоти й розподіли» (`T018`, `T019`) живе в `encrypted-ixs`",
    "чотирма контурами, і тут розгортаються їхні визначення обчислень. Прогін",
    "проходить їх по черзі: `dispatch_init` створює накопичувач, `dispatch_fold`",
    "згортає батчі з буферного акаунта, `dispatch_close_dataset` оголошує внесок",
    "кожного датасету пулу (`T025`), `dispatch_reveal` віддає звіт під ключем",
    "покупця, і з нього ж програма рахує нарахування, комісію й повернення",
    "різниці (`T026`)."
  ],
  "instructions": [
    {
      "name": "closeAccumulator",
      "docs": [
        "Повертає rent за накопичувач, коли він більше нікому не потрібен."
      ],
      "discriminator": [
        83,
        157,
        172,
        124,
        244,
        5,
        181,
        192
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeBatchBuffer",
      "docs": [
        "Повертає rent за буфер, коли пул вичерпано або прогін завершився."
      ],
      "discriminator": [
        59,
        94,
        58,
        87,
        100,
        86,
        9,
        116
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "dispatchCloseDataset",
      "docs": [
        "Публікація в Arcium: оголошення внеску поточного датасету (`FR-018a`)."
      ],
      "discriminator": [
        117,
        133,
        215,
        173,
        221,
        43,
        61,
        240
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "dispatchFold",
      "docs": [
        "Публікація в Arcium: згортка батча з буферного акаунта."
      ],
      "discriminator": [
        23,
        95,
        246,
        22,
        242,
        200,
        20,
        178
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
        },
        {
          "name": "live",
          "type": "u8"
        }
      ]
    },
    {
      "name": "dispatchInit",
      "docs": [
        "Публікація в Arcium: порожній накопичувач під цей прогін (`FR-010`).",
        "",
        "Нулі, зашифровані ключем MXE, може зробити тільки сам MXE — програма",
        "цього ключа не має, і в цьому суть (`FR-004a`)."
      ],
      "discriminator": [
        96,
        178,
        174,
        61,
        145,
        114,
        30,
        22
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "dispatchReveal",
      "docs": [
        "Публікація в Arcium: розкриття звіту покупцю (`T026`, `FR-014`).",
        "",
        "Останній контур рецепта. Дозволено лише коли пул вичерпано: розкрити",
        "звіт, не закривши останній датасет, означало б заплатити всім, крім",
        "його власника."
      ],
      "discriminator": [
        84,
        244,
        129,
        157,
        5,
        37,
        119,
        203
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "result",
          "docs": [
            "Акаунт під звіт створюється тут, до постановки в чергу: callback",
            "платника не має, а віддавати результат нікуди — це втратити прогін, за",
            "який уже заплачено.",
            "",
            "`init`, а не `init_if_needed`: другого розкриття не буває. Невдале",
            "обчислення переводить прогін у `failed` (`accept_reveal`), а зайнятий",
            "накопичувач не дає поставити в чергу ще одне — тож акаунт або",
            "створюється один раз, або не створюється взагалі. Два `init_if_needed` в",
            "одній структурі до того ж не вміщаються в 4 КіБ кадру `try_accounts` на",
            "SBF, і збірка каже про це рядком «overwrites values in the frame»."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "finalizeRun",
      "docs": [
        "Повертає покупцю різницю між депозитом і фактичною ціною і закриває",
        "прогін (`FR-016`, `SC-006`)."
      ],
      "discriminator": [
        79,
        6,
        112,
        246,
        170,
        39,
        103,
        158
      ],
      "accounts": [
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "buyerTokens",
          "docs": [
            "Різниця повертається покупцю, і тільки йому: `authority` тут — умова, а",
            "не зручність. Без неї той, хто кличе інструкцію, назвав би своїм",
            "токен-акаунтом будь-який."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "frequenciesCloseDatasetCallback",
      "discriminator": [
        157,
        186,
        184,
        117,
        243,
        179,
        214,
        218
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesCloseDatasetOutput"
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
      "name": "frequenciesFoldCallback",
      "discriminator": [
        134,
        49,
        189,
        24,
        38,
        50,
        166,
        233
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesFoldOutput"
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "frequenciesRevealCallback",
      "discriminator": [
        64,
        48,
        3,
        147,
        27,
        42,
        40,
        84
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "result",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesRevealOutput"
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
      "name": "growBatchBuffer",
      "docs": [
        "Дорощує буферний акаунт на один крок. Шість викликів на прогін: акаунт,",
        "створений через CPI, не буває більшим за 10 КіБ, а батч — 70 656 байтів."
      ],
      "discriminator": [
        76,
        232,
        217,
        127,
        199,
        8,
        111,
        94
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesCloseDatasetCompDef",
      "docs": [
        "Визначення для `frequencies_close_dataset` — оголошення внеску датасету."
      ],
      "discriminator": [
        99,
        139,
        207,
        152,
        85,
        92,
        20,
        42
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
        "Визначень чотири, бо в Arcium кожен контур — окремий акаунт, і без",
        "нього обчислення не поставити в чергу. Розгортаються один раз на мережу."
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
      "name": "initializeVault",
      "docs": [
        "Сейф платформи — токен-акаунт під депозити (`FR-016`). Одноразово,",
        "після `initialize`."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
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
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openRun",
      "docs": [
        "Відкриває прогін під публікацію: накопичувач і буферний акаунт (`T025`).",
        "",
        "Платить диспетчер, і rent за буфер (~0,49 SOL) повертається йому ж на",
        "`close_batch_buffer`."
      ],
      "discriminator": [
        252,
        181,
        149,
        94,
        46,
        20,
        82,
        14
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "docs": [
            "Буфер під один батч. Створюється на 10 КіБ і доростає окремими",
            "інструкціями: акаунт, створений через CPI, не буває більшим за межу",
            "приросту за одну інструкцію, а батч у неї не вміщається всемеро.",
            "",
            "Структурою його не описати: черга обчислень читає з нього сирі слова."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
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
      "name": "requestRun",
      "docs": [
        "Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`).",
        "",
        "Склад пулу їде в `remaining_accounts` парами «датасет + чинна згода».",
        "Одна транзакція, бо момент замовлення має бути точкою: `FR-007` каже,",
        "що відкликання діє на прогони, замовлені **після** нього."
      ],
      "discriminator": [
        39,
        201,
        180,
        168,
        53,
        199,
        162,
        3
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "buyerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Сейф платформи. Один на всі прогони — див. `PlatformConfig::VAULT_SEED`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
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
              "name": "requestRunArgs"
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
      "name": "settleDataset",
      "docs": [
        "Нарахування власнику одного датасету прогону (`FR-018b`).",
        "",
        "Порціями по одному, бо 50 власників в одну транзакцію не вміщаються.",
        "Кличе будь-хто: суми рахуються з `Run` чистими функціями, і той, хто",
        "покличе це для всіх датасетів, зробить рівно те, чого від нього хотіли."
      ],
      "discriminator": [
        195,
        34,
        225,
        110,
        108,
        106,
        124,
        230
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Платить за акаунти балансів, якщо їх ще немає. Підпис тут не дає жодних",
            "прав: суми рахуються з `Run`, і покликати це може будь-хто."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "dataset",
          "docs": [
            "Датасет із того самого рядка прогону. Потрібен рівно заради власника:",
            "ціна й внесок уже лежать у `Run` і навмисно не перечитуються звідси —",
            "власник вільний змінити ціну після замовлення, а умови прогону — ні."
          ]
        },
        {
          "name": "ownerBalance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "dataset.owner",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "platformBalance",
          "docs": [
            "Комісія платформи лягає на такий самий баланс, як у власника даних:",
            "окремий шлях для неї був би місцем, де платформа рухає гроші не так, як",
            "усі."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config.authority",
                "account": "platformConfig"
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
          "name": "index",
          "type": "u32"
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
    },
    {
      "name": "writeBatch",
      "docs": [
        "Кладе шматок шифротексту в буфер. Конверт їде в ланцюг транзакціями по",
        "~950 байтів — інших у Solana не буває."
      ],
      "discriminator": [
        241,
        101,
        221,
        8,
        160,
        229,
        116,
        203
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
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
      "name": "ownerBalance",
      "discriminator": [
        126,
        78,
        65,
        151,
        163,
        196,
        116,
        207
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
    },
    {
      "name": "run",
      "discriminator": [
        199,
        54,
        155,
        86,
        235,
        115,
        246,
        189
      ]
    },
    {
      "name": "runAccumulator",
      "discriminator": [
        117,
        151,
        93,
        153,
        172,
        56,
        93,
        82
      ]
    },
    {
      "name": "runResult",
      "discriminator": [
        201,
        22,
        203,
        115,
        112,
        189,
        94,
        243
      ]
    }
  ],
  "events": [
    {
      "name": "batchFolded",
      "discriminator": [
        25,
        15,
        197,
        37,
        100,
        2,
        119,
        137
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
      "name": "datasetContributionDeclared",
      "discriminator": [
        207,
        89,
        133,
        7,
        250,
        169,
        91,
        59
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
      "name": "datasetSettled",
      "discriminator": [
        173,
        151,
        250,
        76,
        70,
        145,
        84,
        202
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
    },
    {
      "name": "runCompleted",
      "discriminator": [
        233,
        115,
        120,
        101,
        166,
        52,
        138,
        133
      ]
    },
    {
      "name": "runComputationAborted",
      "discriminator": [
        222,
        130,
        122,
        214,
        32,
        82,
        37,
        53
      ]
    },
    {
      "name": "runOpened",
      "discriminator": [
        160,
        77,
        88,
        236,
        193,
        43,
        178,
        255
      ]
    },
    {
      "name": "runRequested",
      "discriminator": [
        79,
        164,
        142,
        242,
        233,
        74,
        92,
        174
      ]
    },
    {
      "name": "runRevealRefused",
      "discriminator": [
        163,
        119,
        76,
        239,
        62,
        182,
        108,
        231
      ]
    },
    {
      "name": "runRevealed",
      "discriminator": [
        190,
        16,
        32,
        166,
        94,
        147,
        248,
        140
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
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
    },
    {
      "code": 6033,
      "name": "platformPaused",
      "msg": "Платформу поставлено на паузу — нові прогони не приймаються"
    },
    {
      "code": 6034,
      "name": "unknownRecipe",
      "msg": "Такого рецепта немає в каталозі"
    },
    {
      "code": 6035,
      "name": "runAccountsMalformed",
      "msg": "Склад прогону передано неповними парами «датасет + згода»"
    },
    {
      "code": 6036,
      "name": "consentMissing",
      "msg": "Власник ще не задав згоди для цього датасету"
    },
    {
      "code": 6037,
      "name": "consentDatasetMismatch",
      "msg": "Передана згода належить іншому датасету"
    },
    {
      "code": 6038,
      "name": "consentVersionStale",
      "msg": "Передана згода не є чинною версією"
    },
    {
      "code": 6039,
      "name": "runEscrowOverflow",
      "msg": "Вартість прогону не вміщається в u64"
    },
    {
      "code": 6040,
      "name": "runEscrowAboveMax",
      "msg": "Вартість прогону перевищує названу покупцем межу"
    },
    {
      "code": 6041,
      "name": "runNotDispatcher",
      "msg": "Цю дію може виконати лише диспетчер прогону"
    },
    {
      "code": 6042,
      "name": "recipeParamsInvalid",
      "msg": "Параметри рецепта не проходять перевірку"
    },
    {
      "code": 6043,
      "name": "accumulatorBusy",
      "msg": "Попереднє обчислення прогону ще не повернулось"
    },
    {
      "code": 6044,
      "name": "accumulatorNotReady",
      "msg": "Накопичувач прогону ще не створено"
    },
    {
      "code": 6045,
      "name": "accumulatorAlreadyReady",
      "msg": "Накопичувач прогону вже створено"
    },
    {
      "code": 6046,
      "name": "accumulatorOffsetMismatch",
      "msg": "Callback належить іншому обчисленню"
    },
    {
      "code": 6047,
      "name": "batchBufferMalformed",
      "msg": "Буферний акаунт не має заголовка"
    },
    {
      "code": 6048,
      "name": "batchBufferForeignRun",
      "msg": "Буферний акаунт належить іншому прогону"
    },
    {
      "code": 6049,
      "name": "batchBufferTooSmall",
      "msg": "Буферний акаунт ще не дорощено до розміру батча"
    },
    {
      "code": 6050,
      "name": "batchBufferNotGrowing",
      "msg": "Буферний акаунт уже такого розміру або більший"
    },
    {
      "code": 6051,
      "name": "batchWriteOutOfBounds",
      "msg": "Запис виходить за межі буферного акаунта"
    },
    {
      "code": 6052,
      "name": "batchLiveOutOfRange",
      "msg": "У батчі має бути від 1 до 32 живих записів"
    },
    {
      "code": 6053,
      "name": "runPoolExhausted",
      "msg": "Усі датасети прогону вже закриті"
    },
    {
      "code": 6054,
      "name": "runPoolNotExhausted",
      "msg": "У прогоні лишились незакриті датасети"
    },
    {
      "code": 6055,
      "name": "runFoldOverflow",
      "msg": "Лічильник згорнутих батчів переповнився"
    },
    {
      "code": 6056,
      "name": "lamportsOverflow",
      "msg": "Переповнення балансу при поверненні rent"
    },
    {
      "code": 6057,
      "name": "runRevealAlreadyDone",
      "msg": "Звіт прогону вже розкрито"
    },
    {
      "code": 6058,
      "name": "runDatasetIndexOutOfRange",
      "msg": "У прогоні немає датасету під таким індексом"
    },
    {
      "code": 6059,
      "name": "runDatasetMismatch",
      "msg": "Переданий датасет не той, що стоїть під цим індексом у прогоні"
    },
    {
      "code": 6060,
      "name": "runRecordsBelowContributions",
      "msg": "Записів у звіті менше, ніж оголошено внесками датасетів"
    },
    {
      "code": 6061,
      "name": "ownerBalanceOverflow",
      "msg": "Переповнення балансу нарахувань власника"
    },
    {
      "code": 6062,
      "name": "runResultForeignRun",
      "msg": "Результат прогону належить іншому прогону"
    }
  ],
  "types": [
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
      "name": "batchFolded",
      "docs": [
        "Батч пішов у MPC. Несе рівно те, чим третя сторона звіряє журнал (`FR-025`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "live",
            "type": "u8"
          },
          {
            "name": "foldedBatches",
            "type": "u32"
          },
          {
            "name": "foldedHash",
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
      "name": "datasetContributionDeclared",
      "docs": [
        "Внесок датасету, оголошений усередині MPC (`FR-018a`).",
        "",
        "`below_floor` окремо від нульового внеску навмисно: «не дав жодного запису",
        "під фільтр» і «дав, але замало, щоб про це говорити» — різні речі для",
        "власника, який дивиться на свій екран нарахувань, і однакові для гаманця."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "belowFloor",
            "type": "bool"
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
      "name": "datasetSettled",
      "docs": [
        "Нарахування одному власнику (`FR-018b`).",
        "",
        "Несе всі три числа, з яких порахована частка, а не тільки підсумок: `FR-018`",
        "прямо вимагає, щоб власник бачив, з чого вона вийшла. Без `records_included`",
        "прогону «мій внесок — 1 000 записів» не пояснює нічого."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "runRecordsIncluded",
            "type": "u32"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "net",
            "type": "u64"
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
      "name": "frequenciesCloseDatasetOutput",
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
                "name": "frequenciesCloseDatasetOutputStruct0"
              }
            }
          }
        ]
      }
    },
    {
      "name": "frequenciesCloseDatasetOutputStruct0",
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
          },
          {
            "name": "field1",
            "type": "u32"
          },
          {
            "name": "field2",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "frequenciesFoldOutput",
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
      "name": "frequenciesRevealOutput",
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
                "name": "frequenciesRevealOutputStruct0"
              }
            }
          }
        ]
      }
    },
    {
      "name": "frequenciesRevealOutputStruct0",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "sharedEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "24"
                  }
                ]
              }
            }
          },
          {
            "name": "field1",
            "type": "u32"
          },
          {
            "name": "field2",
            "type": "u32"
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
      "name": "ownerBalance",
      "docs": [
        "Нарахування власника (`FR-020`).",
        "",
        "Seeds: `[\"balance\", owner]`.",
        "",
        "Один акаунт на власника, а не на пару «власник + прогін»: токени рухаються",
        "рівно двічі — внесок покупця в сейф і виведення власника з сейфа, — і саме",
        "тому `SC-007` (розподіл між 50 власниками < 30 с) досяжний без петлі з 50",
        "переказів. Розшифровку «звідки взялась ця сума» дають події прогонів, а не",
        "окремі акаунти під кожну з них.",
        "",
        "Тут же лежить і комісія платформи: її балансом володіє `PlatformConfig.",
        "authority`, і жодного окремого шляху для неї не існує. Виняток був би",
        "місцем, де платформа рухає гроші не так, як усі."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "accrued",
            "docs": [
              "Скільки нараховано за весь час."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "docs": [
              "Скільки з нарахованого вже виведено (`T049`)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
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
      "name": "requestRunArgs",
      "docs": [
        "Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`) — `T024`.",
        "",
        "# Чому це одна транзакція",
        "",
        "Склад прогону їде в `remaining_accounts` парами «датасет + його чинна",
        "згода», і пул на 50 датасетів — це 100 акаунтів, тобто транзакція з",
        "таблицею пошуку адрес. Порційне складання прогону кількома транзакціями",
        "коштувало б дешевше клієнту й дорожче змісту: `FR-007` каже, що відкликання",
        "діє на прогони, **замовлені після нього**, а `SC-005` міряє це в секундах.",
        "Замовлення, розтягнуте на чотири транзакції, робить «замовлений після»",
        "питанням без однієї відповіді — власник відкликає згоду між порціями, і",
        "половина пулу перевірена за старим станом.",
        "",
        "# Що саме перевіряється",
        "",
        "Згода перевіряється тут, а не при публікації в MPC, з тієї ж причини: момент",
        "замовлення має бути точкою. Публікація (`T025`) читає вже перевірений `Run`.",
        "",
        "Ціну й обсяг бере програма з акаунтів датасетів, а не з аргументів: число,",
        "яке передав би покупець, він же й занизив би. Покупець передає лише стелю",
        "`max_escrow` — і це не формальність, а захист від того, що власник підняв",
        "ціну між квотою і підписом: транзакція має впасти, а не мовчки списати",
        "більше, ніж покупець бачив.",
        "",
        "# Чого тут немає",
        "",
        "Перевірки, що шифротекст лежить у сховищі: програма про сховище не знає й",
        "знати не може. Її робить квота (`ciphertext-missing`), а прогін по датасету",
        "без байтів впаде на публікації й поверне депозит повністю (`FR-016`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "docs": [
              "Обраний покупцем; він же в seeds, тож два прогони не сплутати."
            ],
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "useType",
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "maxEscrow",
            "docs": [
              "Стеля, вище якої покупець не згоден. Зазвичай — число з квоти."
            ],
            "type": "u64"
          },
          {
            "name": "buyerX25519",
            "docs": [
              "Ключ шифрування покупця, на який MPC зашифрує звіт (`T026`).",
              "",
              "Приїжджає із замовленням, а не з публікації, з тієї ж причини, з якої",
              "параметри рецепта лежать у `Run`: диспетчер, який називає читача звіту,",
              "назве себе. Перевірити ключ програма не може ніяк — тому він мусить",
              "прийти від того єдиного, хто не має причин себе обманути."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "dispatcher",
            "docs": [
              "Кому покупець доручає довести прогін до кінця (`T025`).",
              "",
              "Публікація в MPC — це сотні транзакцій на прогін, і підписувати їх у",
              "вкладці браузера неможливо. Але й брати це повноваження собі платформа",
              "не має права: воно приходить звідси, від покупця, разом із замовленням.",
              "Диспетчер не рухає грошей і не міняє умов — він або доводить прогін до",
              "кінця, або ні."
            ],
            "type": "pubkey"
          },
          {
            "name": "recipeParams",
            "docs": [
              "Параметри рецепта: для «частот» — вікові межі й фільтри статі та",
              "ураженості. Перевіряються тут, бо після оплати вже пізно."
            ],
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
      "name": "run",
      "docs": [
        "Замовлений прогін (`FR-013`, `FR-016`).",
        "",
        "Seeds: `[\"run\", buyer, nonce]`.",
        "",
        "Склад прогону лежить тут списком, а не відновлюється скануванням",
        "програмних акаунтів: `FR-025` вимагає, щоб третя сторона звіряла журнал з",
        "мережею, і читання одного акаунта — це те, що вона зробить без нашого коду."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "dispatcher",
            "docs": [
              "Хто має право подавати шифротекст і ставити обчислення в чергу",
              "(`T025`). Називає його **покупець** при замовленні: 313 підписів на",
              "прогін у вкладці браузера — не продукт, а повноваження, взяте",
              "платформою собі, — не те, що покупець комусь давав. Диспетчер не",
              "рухає грошей, не міняє згоди й не змінює складу прогону: усе, що він",
              "може, — довести цей прогін до кінця або не довести."
            ],
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Обраний покупцем; він же в seeds, тож два прогони не сплутати."
            ],
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "recipeParams",
            "docs": [
              "Параметри рецепта, заявлені при замовленні: для «частот» це вікові межі",
              "й фільтри статі та ураженості.",
              "",
              "Лежать тут, а не в аргументах публікації, бо запит покупця — частина",
              "умов прогону. Власник звіряє їх зі своєю згодою (`FR-006`), незалежний",
              "звіряч журналу — з тим, що пішло в MPC (`FR-025`), і ні перше, ні друге",
              "неможливе, якщо диспетчер може підставити інший фільтр після",
              "замовлення."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "useType",
            "docs": [
              "Тип використання і категорія покупця, заявлені при замовленні: саме",
              "вони перевірялись проти згоди кожного датасету."
            ],
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "buyerX25519",
            "docs": [
              "Ключ шифрування покупця, на який MPC зашифрує звіт (`T026`).",
              "",
              "Приходить із замовленням, від самого покупця, і саме тому виняток про",
              "диспетчера лишається безпечним: якби ключ називала публікація, диспетчер",
              "підставив би свій і прочитав звіт, за який заплатив хтось інший.",
              "Перевірити його програма не може ніяк — тому він і мусить приїхати від",
              "того єдиного, хто не має причин себе обманути."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "datasets",
            "type": {
              "vec": {
                "defined": {
                  "name": "runDataset"
                }
              }
            }
          },
          {
            "name": "feeBps",
            "docs": [
              "Комісія на момент замовлення (`FR-019`). Копія, а не посилання на",
              "конфігурацію: інакше зміна комісії переписувала б умови вже",
              "замовленого прогону."
            ],
            "type": "u16"
          },
          {
            "name": "escrowAmount",
            "docs": [
              "Верхня оцінка, заблокована в депозиті (`FR-015a`)."
            ],
            "type": "u64"
          },
          {
            "name": "settledCount",
            "docs": [
              "Скільки датасетів уже отримали нарахування."
            ],
            "type": "u32"
          },
          {
            "name": "settledAmount",
            "docs": [
              "Скільки з депозиту вже роздано власникам."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "runStatus"
              }
            }
          },
          {
            "name": "resultHash",
            "docs": [
              "Відбиток результату; з'являється, коли повернувся callback MPC."
            ],
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Скільки записів увійшло в когорту — оголошено відкрито при розкритті",
              "(`T026`). За цим числом рахується оплата, і приховати його від програми",
              "означало б не мати чим платити."
            ],
            "type": "u32"
          },
          {
            "name": "suppressed",
            "docs": [
              "Когорта виявилась меншою за `MIN_COHORT`, і рецепт віддав нулі",
              "(`FR-012`). Прогін відбувся, платити нема за що, депозит повертається",
              "повністю."
            ],
            "type": "bool"
          },
          {
            "name": "datasetCursor",
            "docs": [
              "Який датасет пулу згортається зараз. Рухає його тільки закриття",
              "датасету в MPC — саме тому ончейн-порядок не може розійтись із тим, у",
              "якому рахував рецепт."
            ],
            "type": "u32"
          },
          {
            "name": "foldedBatches",
            "docs": [
              "Скільки батчів згорнуто за весь прогін."
            ],
            "type": "u32"
          },
          {
            "name": "foldedHash",
            "docs": [
              "Ланцюжок відбитків усього, що пішло в MPC (`T025`).",
              "",
              "Програма не бачить сховища й не може звірити байти з",
              "`Dataset.content_hash`: потокового sha256 через транзакції не існує, а",
              "цілий конверт на 21 МБ у одну не влазить. Тому ланцюг не перевіряє —",
              "він **свідчить**: кожна згортка вплітає сюди датасет, кількість живих",
              "записів і самі байти батча. Третя сторона бере шифротекст зі сховища",
              "(він публічний), ріже його тим самим батчем і рахує той самий ланцюжок.",
              "Розбіжність означає, що згорнули не той датасет, — і це видно без",
              "доступу до нашого коду (`FR-025`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "runAccumulator",
      "docs": [
        "Накопичувач частот між згортками (`T025`).",
        "",
        "Seeds: `[\"acc\", run]`.",
        "",
        "# Чому окремий акаунт, а не поле в `Run`",
        "",
        "`Run` читає незалежний звіряч журналу (`FR-025`), і 784 байти непрозорого",
        "шифротексту в ньому не доводять йому нічого — зате коштують rent кожному",
        "прогону, включно з тими, що впали одразу після замовлення. Окремий акаунт",
        "живе рівно від публікації обчислення до розкриття, а на закритті rent",
        "повертається тому, хто його вніс.",
        "",
        "# Чому не аргументом від клієнта",
        "",
        "Підмінити накопичувач неможливо — він під ключем MXE, — але **повторити**",
        "старий можна: згорнути той самий батч двічі або підсунути накопичувач",
        "іншого прогону. Черга обчислень цього не забороняє, а результат виглядав би",
        "цілком валідним. Ланцюг мусить пам'ятати, який накопичувач чинний, інакше",
        "«скільки записів увійшло» перестає бути фактом."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Нонс шифру, що лежить у `ciphertexts`. Свіжий на кожну згортку: Rescue",
              "працює в режимі CTR, і повторений нонс за того самого ключа MXE дав би",
              "повторену гаму."
            ],
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
                24
              ]
            }
          },
          {
            "name": "ready",
            "docs": [
              "Чи вже повернувся `frequencies_init`. До того згортати нема в що."
            ],
            "type": "bool"
          },
          {
            "name": "pending",
            "docs": [
              "Акаунт обчислення, яке зараз у польоті.",
              "",
              "Адреса, а не зсув: callback приходить окремою транзакцією і зсуву в",
              "аргументах не має — зате має сам акаунт обчислення, тож звірити є з чим.",
              "",
              "Без цього поля дві згортки могли б піти в чергу одночасно, прочитати той",
              "самий накопичувач і повернутись по черзі — друга мовчки затерла б першу,",
              "і батч зник би з когорти, не зникнувши з рахунку покупця."
            ],
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
      "name": "runCompleted",
      "docs": [
        "Прогін закрито: всім нараховано, різницю повернуто (`SC-006`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "settledAmount",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "runComputationAborted",
      "docs": [
        "Обчислення повернулось невдачею — прогін переходить у `failed`.",
        "",
        "Не помилка транзакції: відкат лишив би накопичувач назавжди зайнятим, і",
        "прогін застряг би в `running` без жодного способу повернути депозит.",
        "`FR-016` каже повернути його повністю, а для цього потрібен саме кінцевий",
        "статус."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "computation",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "runDataset",
      "docs": [
        "Один датасет у складі прогону (`T026`).",
        "",
        "# Чому не просто адреса",
        "",
        "Нарахування рахується з трьох чисел, і жодне з них не можна брати «зараз»:",
        "",
        "- **ціна** мусить бути тією, що діяла при замовленні. Власник вільний",
        "підняти `price_per_1k` наступного дня, і депозит, порахований учора, не",
        "зобов'язаний його витримати. Копія тут — те саме рішення, що й копія",
        "`fee_bps` у `Run`.",
        "- **внесок** оголошується всередині MPC (`FR-018a`) і приходить callback'ом",
        "закриття датасету. Подією його не втримати: подія — свідчення, а платити",
        "треба з того, що лежить в акаунті.",
        "- **прапорець нарахування** окремо від `settled_count`: лічильник не",
        "заважає нарахувати одному й тому самому датасету двічі, а порційність",
        "виплат саме й означає, що порядок викликів обирає не програма."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "pricePer1k",
            "docs": [
              "Ціна за 1000 записів на момент замовлення (`FR-015`)."
            ],
            "type": "u64"
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Скільки записів дав цей датасет — оголошено всередині MPC.",
              "Нуль, поки датасет не закрито, і нуль назавжди, якщо внесок не дотягнув",
              "до порога."
            ],
            "type": "u32"
          },
          {
            "name": "belowFloor",
            "docs": [
              "Внесок був меншим за `MIN_CONTRIBUTION` і тому оголошений нулем.",
              "",
              "Окремо від нульового внеску, бо для власника, який дивиться на екран",
              "нарахувань (`FR-018b`), «не дав жодного запису під фільтр» і «дав, але",
              "замало, щоб про це говорити» — різні речі. Для гаманця однакові."
            ],
            "type": "bool"
          },
          {
            "name": "settled",
            "docs": [
              "Нарахування вже зроблено."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "runOpened",
      "docs": [
        "Прогін готовий приймати шифротекст."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "accumulator",
            "type": "pubkey"
          },
          {
            "name": "buffer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "runRequested",
      "docs": [
        "Прогін прийнято: склад, умови й заблокована сума — усе публічне.",
        "",
        "Подія несе рівно те, чим третя сторона звіряє журнал із мережею (`FR-025`),",
        "і нічого понад: складу пулу й суми депозиту вистачає, щоб перерахувати",
        "розподіл, коли він настане."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "dispatcher",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "recipeParams",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "useType",
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "datasets",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "escrowAmount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "runResult",
      "docs": [
        "Результат прогону, зашифрований на ключ покупця (`T026`, `FR-014`).",
        "",
        "Seeds: `[\"result\", run]`.",
        "",
        "# Чому акаунт, а не подія",
        "",
        "Подія коштувала б нуль rent і жила б рівно доти, доки RPC тримає логи.",
        "Покупець, який не забрав звіт вчасно, втратив би його назавжди: MPC стану",
        "не зберігає, накопичувач на той момент уже закритий, і перерахувати нема з",
        "чого — довелось би замовляти й оплачувати прогін удруге. Акаунт коштує",
        "~0,006 SOL і читається з ланцюга будь-коли й без нашого API — рівно те, що",
        "потрібно `FR-025` і звіряцу з `T031`.",
        "",
        "# Що тут відкрито, а що ні",
        "",
        "Відкрито `records_included` — за ним рахується оплата, і приховати його від",
        "програми означало б не мати чим платити. Сам звіт зашифрований на ключ",
        "покупця: ні платформа, ні власник датасету, ні диспетчер його не читають.",
        "Приватність **сум платежів** — окрема задача (`FR-021`, `T054`-`T055`); на",
        "M1 суми публічні, і це сказано вголос у віхах."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "docs": [
              "Ключ, яким MXE зашифрував звіт на покупця. Разом із нонсом його",
              "вистачає, щоб покупець розшифрував звіт своїм ключем і більше нічим."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
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
                24
              ]
            }
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Розмір когорти — те саме число, що в `Run.records_included`."
            ],
            "type": "u32"
          },
          {
            "name": "suppressed",
            "docs": [
              "Когорта менша за `MIN_COHORT`: звіт складається з нулів (`FR-012`)."
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
      "name": "runRevealRefused",
      "docs": [
        "Розкриття повернулось зі сторожем `unclosed = 1`.",
        "",
        "Означає, що останній датасет пулу не закрито в MPC: його записи вже в",
        "когорті, але внеску на них ніхто не оголосив, і частка мовчки розтеклася б",
        "між рештою власників. Ончейн ми цього не допускаємо (`dispatch_reveal`",
        "вимагає вичерпаного пулу), тож сюди можна потрапити тільки якщо ончейн-облік",
        "розійшовся з тим, що рахував рецепт. Платити з таких чисел не можна — прогін",
        "іде в `failed`, депозит повертається повністю (`FR-016`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "computation",
            "type": "pubkey"
          },
          {
            "name": "unclosed",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "runRevealed",
      "docs": [
        "Звіт готовий: покупець може його забрати, програма — рахувати оплату."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "suppressed",
            "type": "bool"
          },
          {
            "name": "resultHash",
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
      "name": "runStatus",
      "docs": [
        "Статуси прогону (`FR-013`) — рівно ті п'ять, що названі у SPEC.",
        "",
        "Порційність виплат навмисно **не** стала шостим статусом: її тримає",
        "лічильник `settled_count`. Інакше «завершено» означало б «обчислення",
        "скінчилось», а не «всім заплачено», і слово розходилось би зі змістом."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "accepted"
          },
          {
            "name": "running"
          },
          {
            "name": "completed"
          },
          {
            "name": "rejected"
          },
          {
            "name": "failed"
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
      "name": "sharedEncryptedStruct",
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
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
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
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
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
    "Рецепт «частоти й розподіли» (`T018`, `T019`) живе в `encrypted-ixs`",
    "чотирма контурами, і тут розгортаються їхні визначення обчислень. Прогін",
    "проходить їх по черзі: `dispatch_init` створює накопичувач, `dispatch_fold`",
    "згортає батчі з буферного акаунта, `dispatch_close_dataset` оголошує внесок",
    "кожного датасету пулу (`T025`), `dispatch_reveal` віддає звіт під ключем",
    "покупця, і з нього ж програма рахує нарахування, комісію й повернення",
    "різниці (`T026`)."
  ],
  "instructions": [
    {
      "name": "closeAccumulator",
      "docs": [
        "Повертає rent за накопичувач, коли він більше нікому не потрібен."
      ],
      "discriminator": [
        83,
        157,
        172,
        124,
        244,
        5,
        181,
        192
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeBatchBuffer",
      "docs": [
        "Повертає rent за буфер, коли пул вичерпано або прогін завершився."
      ],
      "discriminator": [
        59,
        94,
        58,
        87,
        100,
        86,
        9,
        116
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "dispatchCloseDataset",
      "docs": [
        "Публікація в Arcium: оголошення внеску поточного датасету (`FR-018a`)."
      ],
      "discriminator": [
        117,
        133,
        215,
        173,
        221,
        43,
        61,
        240
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "dispatchFold",
      "docs": [
        "Публікація в Arcium: згортка батча з буферного акаунта."
      ],
      "discriminator": [
        23,
        95,
        246,
        22,
        242,
        200,
        20,
        178
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
        },
        {
          "name": "live",
          "type": "u8"
        }
      ]
    },
    {
      "name": "dispatchInit",
      "docs": [
        "Публікація в Arcium: порожній накопичувач під цей прогін (`FR-010`).",
        "",
        "Нулі, зашифровані ключем MXE, може зробити тільки сам MXE — програма",
        "цього ключа не має, і в цьому суть (`FR-004a`)."
      ],
      "discriminator": [
        96,
        178,
        174,
        61,
        145,
        114,
        30,
        22
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "dispatchReveal",
      "docs": [
        "Публікація в Arcium: розкриття звіту покупцю (`T026`, `FR-014`).",
        "",
        "Останній контур рецепта. Дозволено лише коли пул вичерпано: розкрити",
        "звіт, не закривши останній датасет, означало б заплатити всім, крім",
        "його власника."
      ],
      "discriminator": [
        84,
        244,
        129,
        157,
        5,
        37,
        119,
        203
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "result",
          "docs": [
            "Акаунт під звіт створюється тут, до постановки в чергу: callback",
            "платника не має, а віддавати результат нікуди — це втратити прогін, за",
            "який уже заплачено.",
            "",
            "`init`, а не `init_if_needed`: другого розкриття не буває. Невдале",
            "обчислення переводить прогін у `failed` (`accept_reveal`), а зайнятий",
            "накопичувач не дає поставити в чергу ще одне — тож акаунт або",
            "створюється один раз, або не створюється взагалі. Два `init_if_needed` в",
            "одній структурі до того ж не вміщаються в 4 КіБ кадру `try_accounts` на",
            "SBF, і збірка каже про це рядком «overwrites values in the frame»."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "finalizeRun",
      "docs": [
        "Повертає покупцю різницю між депозитом і фактичною ціною і закриває",
        "прогін (`FR-016`, `SC-006`)."
      ],
      "discriminator": [
        79,
        6,
        112,
        246,
        170,
        39,
        103,
        158
      ],
      "accounts": [
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "buyerTokens",
          "docs": [
            "Різниця повертається покупцю, і тільки йому: `authority` тут — умова, а",
            "не зручність. Без неї той, хто кличе інструкцію, назвав би своїм",
            "токен-акаунтом будь-який."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "frequenciesCloseDatasetCallback",
      "discriminator": [
        157,
        186,
        184,
        117,
        243,
        179,
        214,
        218
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesCloseDatasetOutput"
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
      "name": "frequenciesFoldCallback",
      "discriminator": [
        134,
        49,
        189,
        24,
        38,
        50,
        166,
        233
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesFoldOutput"
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
      "name": "frequenciesRevealCallback",
      "discriminator": [
        64,
        48,
        3,
        147,
        27,
        42,
        40,
        84
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
        },
        {
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "result",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
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
                      "name": "frequenciesRevealOutput"
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
      "name": "growBatchBuffer",
      "docs": [
        "Дорощує буферний акаунт на один крок. Шість викликів на прогін: акаунт,",
        "створений через CPI, не буває більшим за 10 КіБ, а батч — 70 656 байтів."
      ],
      "discriminator": [
        76,
        232,
        217,
        127,
        199,
        8,
        111,
        94
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initFrequenciesCloseDatasetCompDef",
      "docs": [
        "Визначення для `frequencies_close_dataset` — оголошення внеску датасету."
      ],
      "discriminator": [
        99,
        139,
        207,
        152,
        85,
        92,
        20,
        42
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
        "Визначень чотири, бо в Arcium кожен контур — окремий акаунт, і без",
        "нього обчислення не поставити в чергу. Розгортаються один раз на мережу."
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
      "name": "initializeVault",
      "docs": [
        "Сейф платформи — токен-акаунт під депозити (`FR-016`). Одноразово,",
        "після `initialize`."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
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
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openRun",
      "docs": [
        "Відкриває прогін під публікацію: накопичувач і буферний акаунт (`T025`).",
        "",
        "Платить диспетчер, і rent за буфер (~0,49 SOL) повертається йому ж на",
        "`close_batch_buffer`."
      ],
      "discriminator": [
        252,
        181,
        149,
        94,
        46,
        20,
        82,
        14
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "writable": true,
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "docs": [
            "Буфер під один батч. Створюється на 10 КіБ і доростає окремими",
            "інструкціями: акаунт, створений через CPI, не буває більшим за межу",
            "приросту за одну інструкцію, а батч у неї не вміщається всемеро.",
            "",
            "Структурою його не описати: черга обчислень читає з нього сирі слова."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
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
      "name": "requestRun",
      "docs": [
        "Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`).",
        "",
        "Склад пулу їде в `remaining_accounts` парами «датасет + чинна згода».",
        "Одна транзакція, бо момент замовлення має бути точкою: `FR-007` каже,",
        "що відкликання діє на прогони, замовлені **після** нього."
      ],
      "discriminator": [
        39,
        201,
        180,
        168,
        53,
        199,
        162,
        3
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "buyerTokens",
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Сейф платформи. Один на всі прогони — див. `PlatformConfig::VAULT_SEED`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
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
              "name": "requestRunArgs"
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
      "name": "settleDataset",
      "docs": [
        "Нарахування власнику одного датасету прогону (`FR-018b`).",
        "",
        "Порціями по одному, бо 50 власників в одну транзакцію не вміщаються.",
        "Кличе будь-хто: суми рахуються з `Run` чистими функціями, і той, хто",
        "покличе це для всіх датасетів, зробить рівно те, чого від нього хотіли."
      ],
      "discriminator": [
        195,
        34,
        225,
        110,
        108,
        106,
        124,
        230
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Платить за акаунти балансів, якщо їх ще немає. Підпис тут не дає жодних",
            "прав: суми рахуються з `Run`, і покликати це може будь-хто."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "run",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "dataset",
          "docs": [
            "Датасет із того самого рядка прогону. Потрібен рівно заради власника:",
            "ціна й внесок уже лежать у `Run` і навмисно не перечитуються звідси —",
            "власник вільний змінити ціну після замовлення, а умови прогону — ні."
          ]
        },
        {
          "name": "ownerBalance",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "dataset.owner",
                "account": "dataset"
              }
            ]
          }
        },
        {
          "name": "platformBalance",
          "docs": [
            "Комісія платформи лягає на такий самий баланс, як у власника даних:",
            "окремий шлях для неї був би місцем, де платформа рухає гроші не так, як",
            "усі."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  108,
                  97,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config.authority",
                "account": "platformConfig"
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
          "name": "index",
          "type": "u32"
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
    },
    {
      "name": "writeBatch",
      "docs": [
        "Кладе шматок шифротексту в буфер. Конверт їде в ланцюг транзакціями по",
        "~950 байтів — інших у Solana не буває."
      ],
      "discriminator": [
        241,
        101,
        221,
        8,
        160,
        229,
        116,
        203
      ],
      "accounts": [
        {
          "name": "dispatcher",
          "signer": true
        },
        {
          "name": "run",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "run.buyer",
                "account": "run"
              },
              {
                "kind": "account",
                "path": "run.nonce",
                "account": "run"
              }
            ]
          }
        },
        {
          "name": "accumulator",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "run"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
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
      "name": "ownerBalance",
      "discriminator": [
        126,
        78,
        65,
        151,
        163,
        196,
        116,
        207
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
    },
    {
      "name": "run",
      "discriminator": [
        199,
        54,
        155,
        86,
        235,
        115,
        246,
        189
      ]
    },
    {
      "name": "runAccumulator",
      "discriminator": [
        117,
        151,
        93,
        153,
        172,
        56,
        93,
        82
      ]
    },
    {
      "name": "runResult",
      "discriminator": [
        201,
        22,
        203,
        115,
        112,
        189,
        94,
        243
      ]
    }
  ],
  "events": [
    {
      "name": "batchFolded",
      "discriminator": [
        25,
        15,
        197,
        37,
        100,
        2,
        119,
        137
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
      "name": "datasetContributionDeclared",
      "discriminator": [
        207,
        89,
        133,
        7,
        250,
        169,
        91,
        59
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
      "name": "datasetSettled",
      "discriminator": [
        173,
        151,
        250,
        76,
        70,
        145,
        84,
        202
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
    },
    {
      "name": "runCompleted",
      "discriminator": [
        233,
        115,
        120,
        101,
        166,
        52,
        138,
        133
      ]
    },
    {
      "name": "runComputationAborted",
      "discriminator": [
        222,
        130,
        122,
        214,
        32,
        82,
        37,
        53
      ]
    },
    {
      "name": "runOpened",
      "discriminator": [
        160,
        77,
        88,
        236,
        193,
        43,
        178,
        255
      ]
    },
    {
      "name": "runRequested",
      "discriminator": [
        79,
        164,
        142,
        242,
        233,
        74,
        92,
        174
      ]
    },
    {
      "name": "runRevealRefused",
      "discriminator": [
        163,
        119,
        76,
        239,
        62,
        182,
        108,
        231
      ]
    },
    {
      "name": "runRevealed",
      "discriminator": [
        190,
        16,
        32,
        166,
        94,
        147,
        248,
        140
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
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
    },
    {
      "code": 6033,
      "name": "platformPaused",
      "msg": "Платформу поставлено на паузу — нові прогони не приймаються"
    },
    {
      "code": 6034,
      "name": "unknownRecipe",
      "msg": "Такого рецепта немає в каталозі"
    },
    {
      "code": 6035,
      "name": "runAccountsMalformed",
      "msg": "Склад прогону передано неповними парами «датасет + згода»"
    },
    {
      "code": 6036,
      "name": "consentMissing",
      "msg": "Власник ще не задав згоди для цього датасету"
    },
    {
      "code": 6037,
      "name": "consentDatasetMismatch",
      "msg": "Передана згода належить іншому датасету"
    },
    {
      "code": 6038,
      "name": "consentVersionStale",
      "msg": "Передана згода не є чинною версією"
    },
    {
      "code": 6039,
      "name": "runEscrowOverflow",
      "msg": "Вартість прогону не вміщається в u64"
    },
    {
      "code": 6040,
      "name": "runEscrowAboveMax",
      "msg": "Вартість прогону перевищує названу покупцем межу"
    },
    {
      "code": 6041,
      "name": "runNotDispatcher",
      "msg": "Цю дію може виконати лише диспетчер прогону"
    },
    {
      "code": 6042,
      "name": "recipeParamsInvalid",
      "msg": "Параметри рецепта не проходять перевірку"
    },
    {
      "code": 6043,
      "name": "accumulatorBusy",
      "msg": "Попереднє обчислення прогону ще не повернулось"
    },
    {
      "code": 6044,
      "name": "accumulatorNotReady",
      "msg": "Накопичувач прогону ще не створено"
    },
    {
      "code": 6045,
      "name": "accumulatorAlreadyReady",
      "msg": "Накопичувач прогону вже створено"
    },
    {
      "code": 6046,
      "name": "accumulatorOffsetMismatch",
      "msg": "Callback належить іншому обчисленню"
    },
    {
      "code": 6047,
      "name": "batchBufferMalformed",
      "msg": "Буферний акаунт не має заголовка"
    },
    {
      "code": 6048,
      "name": "batchBufferForeignRun",
      "msg": "Буферний акаунт належить іншому прогону"
    },
    {
      "code": 6049,
      "name": "batchBufferTooSmall",
      "msg": "Буферний акаунт ще не дорощено до розміру батча"
    },
    {
      "code": 6050,
      "name": "batchBufferNotGrowing",
      "msg": "Буферний акаунт уже такого розміру або більший"
    },
    {
      "code": 6051,
      "name": "batchWriteOutOfBounds",
      "msg": "Запис виходить за межі буферного акаунта"
    },
    {
      "code": 6052,
      "name": "batchLiveOutOfRange",
      "msg": "У батчі має бути від 1 до 32 живих записів"
    },
    {
      "code": 6053,
      "name": "runPoolExhausted",
      "msg": "Усі датасети прогону вже закриті"
    },
    {
      "code": 6054,
      "name": "runPoolNotExhausted",
      "msg": "У прогоні лишились незакриті датасети"
    },
    {
      "code": 6055,
      "name": "runFoldOverflow",
      "msg": "Лічильник згорнутих батчів переповнився"
    },
    {
      "code": 6056,
      "name": "lamportsOverflow",
      "msg": "Переповнення балансу при поверненні rent"
    },
    {
      "code": 6057,
      "name": "runRevealAlreadyDone",
      "msg": "Звіт прогону вже розкрито"
    },
    {
      "code": 6058,
      "name": "runDatasetIndexOutOfRange",
      "msg": "У прогоні немає датасету під таким індексом"
    },
    {
      "code": 6059,
      "name": "runDatasetMismatch",
      "msg": "Переданий датасет не той, що стоїть під цим індексом у прогоні"
    },
    {
      "code": 6060,
      "name": "runRecordsBelowContributions",
      "msg": "Записів у звіті менше, ніж оголошено внесками датасетів"
    },
    {
      "code": 6061,
      "name": "ownerBalanceOverflow",
      "msg": "Переповнення балансу нарахувань власника"
    },
    {
      "code": 6062,
      "name": "runResultForeignRun",
      "msg": "Результат прогону належить іншому прогону"
    }
  ],
  "types": [
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
      "name": "batchFolded",
      "docs": [
        "Батч пішов у MPC. Несе рівно те, чим третя сторона звіряє журнал (`FR-025`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "live",
            "type": "u8"
          },
          {
            "name": "foldedBatches",
            "type": "u32"
          },
          {
            "name": "foldedHash",
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
      "name": "datasetContributionDeclared",
      "docs": [
        "Внесок датасету, оголошений усередині MPC (`FR-018a`).",
        "",
        "`below_floor` окремо від нульового внеску навмисно: «не дав жодного запису",
        "під фільтр» і «дав, але замало, щоб про це говорити» — різні речі для",
        "власника, який дивиться на свій екран нарахувань, і однакові для гаманця."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "belowFloor",
            "type": "bool"
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
      "name": "datasetSettled",
      "docs": [
        "Нарахування одному власнику (`FR-018b`).",
        "",
        "Несе всі три числа, з яких порахована частка, а не тільки підсумок: `FR-018`",
        "прямо вимагає, щоб власник бачив, з чого вона вийшла. Без `records_included`",
        "прогону «мій внесок — 1 000 записів» не пояснює нічого."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "runRecordsIncluded",
            "type": "u32"
          },
          {
            "name": "pricePer1k",
            "type": "u64"
          },
          {
            "name": "gross",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "net",
            "type": "u64"
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
      "name": "frequenciesCloseDatasetOutput",
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
                "name": "frequenciesCloseDatasetOutputStruct0"
              }
            }
          }
        ]
      }
    },
    {
      "name": "frequenciesCloseDatasetOutputStruct0",
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
          },
          {
            "name": "field1",
            "type": "u32"
          },
          {
            "name": "field2",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "frequenciesFoldOutput",
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
      "name": "frequenciesRevealOutput",
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
                "name": "frequenciesRevealOutputStruct0"
              }
            }
          }
        ]
      }
    },
    {
      "name": "frequenciesRevealOutputStruct0",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "field0",
            "type": {
              "defined": {
                "name": "sharedEncryptedStruct",
                "generics": [
                  {
                    "kind": "const",
                    "value": "24"
                  }
                ]
              }
            }
          },
          {
            "name": "field1",
            "type": "u32"
          },
          {
            "name": "field2",
            "type": "u32"
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
      "name": "ownerBalance",
      "docs": [
        "Нарахування власника (`FR-020`).",
        "",
        "Seeds: `[\"balance\", owner]`.",
        "",
        "Один акаунт на власника, а не на пару «власник + прогін»: токени рухаються",
        "рівно двічі — внесок покупця в сейф і виведення власника з сейфа, — і саме",
        "тому `SC-007` (розподіл між 50 власниками < 30 с) досяжний без петлі з 50",
        "переказів. Розшифровку «звідки взялась ця сума» дають події прогонів, а не",
        "окремі акаунти під кожну з них.",
        "",
        "Тут же лежить і комісія платформи: її балансом володіє `PlatformConfig.",
        "authority`, і жодного окремого шляху для неї не існує. Виняток був би",
        "місцем, де платформа рухає гроші не так, як усі."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "accrued",
            "docs": [
              "Скільки нараховано за весь час."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "docs": [
              "Скільки з нарахованого вже виведено (`T049`)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
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
      "name": "requestRunArgs",
      "docs": [
        "Замовлення прогону (`FR-013`, `FR-015a`, `FR-016`) — `T024`.",
        "",
        "# Чому це одна транзакція",
        "",
        "Склад прогону їде в `remaining_accounts` парами «датасет + його чинна",
        "згода», і пул на 50 датасетів — це 100 акаунтів, тобто транзакція з",
        "таблицею пошуку адрес. Порційне складання прогону кількома транзакціями",
        "коштувало б дешевше клієнту й дорожче змісту: `FR-007` каже, що відкликання",
        "діє на прогони, **замовлені після нього**, а `SC-005` міряє це в секундах.",
        "Замовлення, розтягнуте на чотири транзакції, робить «замовлений після»",
        "питанням без однієї відповіді — власник відкликає згоду між порціями, і",
        "половина пулу перевірена за старим станом.",
        "",
        "# Що саме перевіряється",
        "",
        "Згода перевіряється тут, а не при публікації в MPC, з тієї ж причини: момент",
        "замовлення має бути точкою. Публікація (`T025`) читає вже перевірений `Run`.",
        "",
        "Ціну й обсяг бере програма з акаунтів датасетів, а не з аргументів: число,",
        "яке передав би покупець, він же й занизив би. Покупець передає лише стелю",
        "`max_escrow` — і це не формальність, а захист від того, що власник підняв",
        "ціну між квотою і підписом: транзакція має впасти, а не мовчки списати",
        "більше, ніж покупець бачив.",
        "",
        "# Чого тут немає",
        "",
        "Перевірки, що шифротекст лежить у сховищі: програма про сховище не знає й",
        "знати не може. Її робить квота (`ciphertext-missing`), а прогін по датасету",
        "без байтів впаде на публікації й поверне депозит повністю (`FR-016`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "docs": [
              "Обраний покупцем; він же в seeds, тож два прогони не сплутати."
            ],
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "useType",
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "maxEscrow",
            "docs": [
              "Стеля, вище якої покупець не згоден. Зазвичай — число з квоти."
            ],
            "type": "u64"
          },
          {
            "name": "buyerX25519",
            "docs": [
              "Ключ шифрування покупця, на який MPC зашифрує звіт (`T026`).",
              "",
              "Приїжджає із замовленням, а не з публікації, з тієї ж причини, з якої",
              "параметри рецепта лежать у `Run`: диспетчер, який називає читача звіту,",
              "назве себе. Перевірити ключ програма не може ніяк — тому він мусить",
              "прийти від того єдиного, хто не має причин себе обманути."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "dispatcher",
            "docs": [
              "Кому покупець доручає довести прогін до кінця (`T025`).",
              "",
              "Публікація в MPC — це сотні транзакцій на прогін, і підписувати їх у",
              "вкладці браузера неможливо. Але й брати це повноваження собі платформа",
              "не має права: воно приходить звідси, від покупця, разом із замовленням.",
              "Диспетчер не рухає грошей і не міняє умов — він або доводить прогін до",
              "кінця, або ні."
            ],
            "type": "pubkey"
          },
          {
            "name": "recipeParams",
            "docs": [
              "Параметри рецепта: для «частот» — вікові межі й фільтри статі та",
              "ураженості. Перевіряються тут, бо після оплати вже пізно."
            ],
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
      "name": "run",
      "docs": [
        "Замовлений прогін (`FR-013`, `FR-016`).",
        "",
        "Seeds: `[\"run\", buyer, nonce]`.",
        "",
        "Склад прогону лежить тут списком, а не відновлюється скануванням",
        "програмних акаунтів: `FR-025` вимагає, щоб третя сторона звіряла журнал з",
        "мережею, і читання одного акаунта — це те, що вона зробить без нашого коду."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "dispatcher",
            "docs": [
              "Хто має право подавати шифротекст і ставити обчислення в чергу",
              "(`T025`). Називає його **покупець** при замовленні: 313 підписів на",
              "прогін у вкладці браузера — не продукт, а повноваження, взяте",
              "платформою собі, — не те, що покупець комусь давав. Диспетчер не",
              "рухає грошей, не міняє згоди й не змінює складу прогону: усе, що він",
              "може, — довести цей прогін до кінця або не довести."
            ],
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Обраний покупцем; він же в seeds, тож два прогони не сплутати."
            ],
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "recipeParams",
            "docs": [
              "Параметри рецепта, заявлені при замовленні: для «частот» це вікові межі",
              "й фільтри статі та ураженості.",
              "",
              "Лежать тут, а не в аргументах публікації, бо запит покупця — частина",
              "умов прогону. Власник звіряє їх зі своєю згодою (`FR-006`), незалежний",
              "звіряч журналу — з тим, що пішло в MPC (`FR-025`), і ні перше, ні друге",
              "неможливе, якщо диспетчер може підставити інший фільтр після",
              "замовлення."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "useType",
            "docs": [
              "Тип використання і категорія покупця, заявлені при замовленні: саме",
              "вони перевірялись проти згоди кожного датасету."
            ],
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "buyerX25519",
            "docs": [
              "Ключ шифрування покупця, на який MPC зашифрує звіт (`T026`).",
              "",
              "Приходить із замовленням, від самого покупця, і саме тому виняток про",
              "диспетчера лишається безпечним: якби ключ називала публікація, диспетчер",
              "підставив би свій і прочитав звіт, за який заплатив хтось інший.",
              "Перевірити його програма не може ніяк — тому він і мусить приїхати від",
              "того єдиного, хто не має причин себе обманути."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "datasets",
            "type": {
              "vec": {
                "defined": {
                  "name": "runDataset"
                }
              }
            }
          },
          {
            "name": "feeBps",
            "docs": [
              "Комісія на момент замовлення (`FR-019`). Копія, а не посилання на",
              "конфігурацію: інакше зміна комісії переписувала б умови вже",
              "замовленого прогону."
            ],
            "type": "u16"
          },
          {
            "name": "escrowAmount",
            "docs": [
              "Верхня оцінка, заблокована в депозиті (`FR-015a`)."
            ],
            "type": "u64"
          },
          {
            "name": "settledCount",
            "docs": [
              "Скільки датасетів уже отримали нарахування."
            ],
            "type": "u32"
          },
          {
            "name": "settledAmount",
            "docs": [
              "Скільки з депозиту вже роздано власникам."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "runStatus"
              }
            }
          },
          {
            "name": "resultHash",
            "docs": [
              "Відбиток результату; з'являється, коли повернувся callback MPC."
            ],
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Скільки записів увійшло в когорту — оголошено відкрито при розкритті",
              "(`T026`). За цим числом рахується оплата, і приховати його від програми",
              "означало б не мати чим платити."
            ],
            "type": "u32"
          },
          {
            "name": "suppressed",
            "docs": [
              "Когорта виявилась меншою за `MIN_COHORT`, і рецепт віддав нулі",
              "(`FR-012`). Прогін відбувся, платити нема за що, депозит повертається",
              "повністю."
            ],
            "type": "bool"
          },
          {
            "name": "datasetCursor",
            "docs": [
              "Який датасет пулу згортається зараз. Рухає його тільки закриття",
              "датасету в MPC — саме тому ончейн-порядок не може розійтись із тим, у",
              "якому рахував рецепт."
            ],
            "type": "u32"
          },
          {
            "name": "foldedBatches",
            "docs": [
              "Скільки батчів згорнуто за весь прогін."
            ],
            "type": "u32"
          },
          {
            "name": "foldedHash",
            "docs": [
              "Ланцюжок відбитків усього, що пішло в MPC (`T025`).",
              "",
              "Програма не бачить сховища й не може звірити байти з",
              "`Dataset.content_hash`: потокового sha256 через транзакції не існує, а",
              "цілий конверт на 21 МБ у одну не влазить. Тому ланцюг не перевіряє —",
              "він **свідчить**: кожна згортка вплітає сюди датасет, кількість живих",
              "записів і самі байти батча. Третя сторона бере шифротекст зі сховища",
              "(він публічний), ріже його тим самим батчем і рахує той самий ланцюжок.",
              "Розбіжність означає, що згорнули не той датасет, — і це видно без",
              "доступу до нашого коду (`FR-025`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "runAccumulator",
      "docs": [
        "Накопичувач частот між згортками (`T025`).",
        "",
        "Seeds: `[\"acc\", run]`.",
        "",
        "# Чому окремий акаунт, а не поле в `Run`",
        "",
        "`Run` читає незалежний звіряч журналу (`FR-025`), і 784 байти непрозорого",
        "шифротексту в ньому не доводять йому нічого — зате коштують rent кожному",
        "прогону, включно з тими, що впали одразу після замовлення. Окремий акаунт",
        "живе рівно від публікації обчислення до розкриття, а на закритті rent",
        "повертається тому, хто його вніс.",
        "",
        "# Чому не аргументом від клієнта",
        "",
        "Підмінити накопичувач неможливо — він під ключем MXE, — але **повторити**",
        "старий можна: згорнути той самий батч двічі або підсунути накопичувач",
        "іншого прогону. Черга обчислень цього не забороняє, а результат виглядав би",
        "цілком валідним. Ланцюг мусить пам'ятати, який накопичувач чинний, інакше",
        "«скільки записів увійшло» перестає бути фактом."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Нонс шифру, що лежить у `ciphertexts`. Свіжий на кожну згортку: Rescue",
              "працює в режимі CTR, і повторений нонс за того самого ключа MXE дав би",
              "повторену гаму."
            ],
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
                24
              ]
            }
          },
          {
            "name": "ready",
            "docs": [
              "Чи вже повернувся `frequencies_init`. До того згортати нема в що."
            ],
            "type": "bool"
          },
          {
            "name": "pending",
            "docs": [
              "Акаунт обчислення, яке зараз у польоті.",
              "",
              "Адреса, а не зсув: callback приходить окремою транзакцією і зсуву в",
              "аргументах не має — зате має сам акаунт обчислення, тож звірити є з чим.",
              "",
              "Без цього поля дві згортки могли б піти в чергу одночасно, прочитати той",
              "самий накопичувач і повернутись по черзі — друга мовчки затерла б першу,",
              "і батч зник би з когорти, не зникнувши з рахунку покупця."
            ],
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
      "name": "runCompleted",
      "docs": [
        "Прогін закрито: всім нараховано, різницю повернуто (`SC-006`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "settledAmount",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "runComputationAborted",
      "docs": [
        "Обчислення повернулось невдачею — прогін переходить у `failed`.",
        "",
        "Не помилка транзакції: відкат лишив би накопичувач назавжди зайнятим, і",
        "прогін застряг би в `running` без жодного способу повернути депозит.",
        "`FR-016` каже повернути його повністю, а для цього потрібен саме кінцевий",
        "статус."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "computation",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "runDataset",
      "docs": [
        "Один датасет у складі прогону (`T026`).",
        "",
        "# Чому не просто адреса",
        "",
        "Нарахування рахується з трьох чисел, і жодне з них не можна брати «зараз»:",
        "",
        "- **ціна** мусить бути тією, що діяла при замовленні. Власник вільний",
        "підняти `price_per_1k` наступного дня, і депозит, порахований учора, не",
        "зобов'язаний його витримати. Копія тут — те саме рішення, що й копія",
        "`fee_bps` у `Run`.",
        "- **внесок** оголошується всередині MPC (`FR-018a`) і приходить callback'ом",
        "закриття датасету. Подією його не втримати: подія — свідчення, а платити",
        "треба з того, що лежить в акаунті.",
        "- **прапорець нарахування** окремо від `settled_count`: лічильник не",
        "заважає нарахувати одному й тому самому датасету двічі, а порційність",
        "виплат саме й означає, що порядок викликів обирає не програма."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dataset",
            "type": "pubkey"
          },
          {
            "name": "pricePer1k",
            "docs": [
              "Ціна за 1000 записів на момент замовлення (`FR-015`)."
            ],
            "type": "u64"
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Скільки записів дав цей датасет — оголошено всередині MPC.",
              "Нуль, поки датасет не закрито, і нуль назавжди, якщо внесок не дотягнув",
              "до порога."
            ],
            "type": "u32"
          },
          {
            "name": "belowFloor",
            "docs": [
              "Внесок був меншим за `MIN_CONTRIBUTION` і тому оголошений нулем.",
              "",
              "Окремо від нульового внеску, бо для власника, який дивиться на екран",
              "нарахувань (`FR-018b`), «не дав жодного запису під фільтр» і «дав, але",
              "замало, щоб про це говорити» — різні речі. Для гаманця однакові."
            ],
            "type": "bool"
          },
          {
            "name": "settled",
            "docs": [
              "Нарахування вже зроблено."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "runOpened",
      "docs": [
        "Прогін готовий приймати шифротекст."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "accumulator",
            "type": "pubkey"
          },
          {
            "name": "buffer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "runRequested",
      "docs": [
        "Прогін прийнято: склад, умови й заблокована сума — усе публічне.",
        "",
        "Подія несе рівно те, чим третя сторона звіряє журнал із мережею (`FR-025`),",
        "і нічого понад: складу пулу й суми депозиту вистачає, щоб перерахувати",
        "розподіл, коли він настане."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "dispatcher",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "recipeId",
            "type": "u16"
          },
          {
            "name": "recipeParams",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "useType",
            "type": "u32"
          },
          {
            "name": "buyerCategory",
            "type": "u32"
          },
          {
            "name": "datasets",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "escrowAmount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "runResult",
      "docs": [
        "Результат прогону, зашифрований на ключ покупця (`T026`, `FR-014`).",
        "",
        "Seeds: `[\"result\", run]`.",
        "",
        "# Чому акаунт, а не подія",
        "",
        "Подія коштувала б нуль rent і жила б рівно доти, доки RPC тримає логи.",
        "Покупець, який не забрав звіт вчасно, втратив би його назавжди: MPC стану",
        "не зберігає, накопичувач на той момент уже закритий, і перерахувати нема з",
        "чого — довелось би замовляти й оплачувати прогін удруге. Акаунт коштує",
        "~0,006 SOL і читається з ланцюга будь-коли й без нашого API — рівно те, що",
        "потрібно `FR-025` і звіряцу з `T031`.",
        "",
        "# Що тут відкрито, а що ні",
        "",
        "Відкрито `records_included` — за ним рахується оплата, і приховати його від",
        "програми означало б не мати чим платити. Сам звіт зашифрований на ключ",
        "покупця: ні платформа, ні власник датасету, ні диспетчер його не читають.",
        "Приватність **сум платежів** — окрема задача (`FR-021`, `T054`-`T055`); на",
        "M1 суми публічні, і це сказано вголос у віхах."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "docs": [
              "Ключ, яким MXE зашифрував звіт на покупця. Разом із нонсом його",
              "вистачає, щоб покупець розшифрував звіт своїм ключем і більше нічим."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
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
                24
              ]
            }
          },
          {
            "name": "recordsIncluded",
            "docs": [
              "Розмір когорти — те саме число, що в `Run.records_included`."
            ],
            "type": "u32"
          },
          {
            "name": "suppressed",
            "docs": [
              "Когорта менша за `MIN_COHORT`: звіт складається з нулів (`FR-012`)."
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
      "name": "runRevealRefused",
      "docs": [
        "Розкриття повернулось зі сторожем `unclosed = 1`.",
        "",
        "Означає, що останній датасет пулу не закрито в MPC: його записи вже в",
        "когорті, але внеску на них ніхто не оголосив, і частка мовчки розтеклася б",
        "між рештою власників. Ончейн ми цього не допускаємо (`dispatch_reveal`",
        "вимагає вичерпаного пулу), тож сюди можна потрапити тільки якщо ончейн-облік",
        "розійшовся з тим, що рахував рецепт. Платити з таких чисел не можна — прогін",
        "іде в `failed`, депозит повертається повністю (`FR-016`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "computation",
            "type": "pubkey"
          },
          {
            "name": "unclosed",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "runRevealed",
      "docs": [
        "Звіт готовий: покупець може його забрати, програма — рахувати оплату."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "run",
            "type": "pubkey"
          },
          {
            "name": "recordsIncluded",
            "type": "u32"
          },
          {
            "name": "suppressed",
            "type": "bool"
          },
          {
            "name": "resultHash",
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
      "name": "runStatus",
      "docs": [
        "Статуси прогону (`FR-013`) — рівно ті п'ять, що названі у SPEC.",
        "",
        "Порційність виплат навмисно **не** стала шостим статусом: її тримає",
        "лічильник `settled_count`. Інакше «завершено» означало б «обчислення",
        "скінчилось», а не «всім заплачено», і слово розходилось би зі змістом."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "accepted"
          },
          {
            "name": "running"
          },
          {
            "name": "completed"
          },
          {
            "name": "rejected"
          },
          {
            "name": "failed"
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
      "name": "sharedEncryptedStruct",
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
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
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
      "name": "vaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
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
