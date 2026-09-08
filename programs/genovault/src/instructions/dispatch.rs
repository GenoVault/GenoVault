use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

// Імена хендлерів навмисно короткі й не збігаються з іменами інструкцій:
// `pub use instructions::*` і `#[arcium_program]` реекспортують обидва набори в
// корінь крейта, і однойменні мовчки стають неоднозначними.
use crate::errors::GenoVaultError;
// `ArciumSignerAccount`, `ID` і `ID_CONST` породжує `#[arcium_program]` у корені
// крейта — макроси `derive_*_pda!` розкриваються в них без префікса.
use crate::{ArciumSignerAccount, ID, ID_CONST};
use crate::state::{
    check_batch_buffer_header, write_batch_buffer_header, FrequenciesParams, Run, RunAccumulator,
    RunStatus, ACCUMULATOR_CIPHERTEXTS, BATCH_BUFFER_BYTES, BATCH_BUFFER_HEADER_BYTES,
    BATCH_BUFFER_INITIAL_BYTES, BATCH_BUFFER_SEED, BATCH_PAYLOAD_BYTES,
    MAX_PERMITTED_DATA_INCREASE,
};

/// Публікація обчислення в Arcium (`T025`, `FR-010`).
///
/// # Чому це не одна інструкція
///
/// Контур MPC має сталий розмір, зафіксований при компіляції: `frequencies_fold`
/// приймає рівно 32 записи. Стандартний датасет — 10 000 записів, тобто 313
/// згорток, і між ними мусить щось лишатись живим. Тому прогін розкладається
/// на чотири речі, кожна зі своєю причиною існувати:
///
/// - **буфер** (`["batch", run]`) — 70 656 байтів, рівно один батч у тій
///   розкладці, в якій його читає черга обчислень. Інлайн-аргументами батч не
///   передати: індекс `ArgumentRef` це `u8`, тобто не більше 256 шифротекстів,
///   а в батчі їх 2 144. Черга бере вхід рівно з двох джерел, і друге — зріз
///   Solana-акаунта, який вузли читають самі.
/// - **накопичувач** (`["acc", run]`) — стан між згортками під ключем MXE.
/// - **курсор** у `Run` — який датасет пулу згортається зараз.
/// - **ланцюжок відбитків** у `Run` — свідчення про те, що саме пішло в MPC.
///
/// # Чому диспетчер, а не покупець
///
/// 313 згорток — це 313 підписів, і ще ~81 запис у буфер на кожну: конверт
/// їде в ланцюг транзакціями по ~950 байтів. Вкладка браузера, яка просить
/// двадцять п'ять тисяч підписів, — не продукт. Тому покупець при замовленні
/// **називає диспетчера** (`Run.dispatcher`), і повноваження приходить від
/// нього, а не береться платформою собі.
///
/// Що диспетчер може: подавати байти, ставити обчислення в чергу, доводити
/// прогін до кінця — або не доводити. Чого не може: рухати гроші, міняти склад
/// прогону, міняти параметри рецепта, обійти згоду (її перевірено при
/// замовленні) і приховати, що саме він подав (ланцюжок відбитків).
///
/// # Чого ланцюг усе-таки не доводить
///
/// Що байти в буфері — це зареєстрований датасет. Потокового sha256 через
/// транзакції не існує, а цілий конверт у транзакцію не влазить, тож звірити з
/// `Dataset.content_hash` ончейн нічим. Замість перевірки ланцюг веде
/// **свідчення**: `Run.folded_hash` вплітає датасет, `live` і самі байти
/// кожної згортки. Шифротекст публічний, тож третя сторона ріже його тим самим
/// батчем, рахує той самий ланцюжок і бачить розбіжність без доступу до нашого
/// коду (`FR-025`). Це робить `tools/audit-verify` у `T030`-`T031`.

// ── Зсуви визначень обчислень ───────────────────────────────────────────────

pub const COMP_DEF_OFFSET_FREQUENCIES_INIT: u32 = comp_def_offset("frequencies_init");
pub const COMP_DEF_OFFSET_FREQUENCIES_FOLD: u32 = comp_def_offset("frequencies_fold");
pub const COMP_DEF_OFFSET_FREQUENCIES_CLOSE_DATASET: u32 =
    comp_def_offset("frequencies_close_dataset");

// ── Події ───────────────────────────────────────────────────────────────────

/// Прогін готовий приймати шифротекст.
#[event]
pub struct RunOpened {
    pub run: Pubkey,
    pub accumulator: Pubkey,
    pub buffer: Pubkey,
}

/// Батч пішов у MPC. Несе рівно те, чим третя сторона звіряє журнал (`FR-025`).
#[event]
pub struct BatchFolded {
    pub run: Pubkey,
    pub dataset: Pubkey,
    pub live: u8,
    pub folded_batches: u32,
    pub folded_hash: [u8; 32],
}

/// Внесок датасету, оголошений усередині MPC (`FR-018a`).
///
/// `below_floor` окремо від нульового внеску навмисно: «не дав жодного запису
/// під фільтр» і «дав, але замало, щоб про це говорити» — різні речі для
/// власника, який дивиться на свій екран нарахувань, і однакові для гаманця.
#[event]
pub struct DatasetContributionDeclared {
    pub run: Pubkey,
    pub dataset: Pubkey,
    pub records_included: u32,
    pub below_floor: bool,
}

/// Обчислення повернулось невдачею — прогін переходить у `failed`.
///
/// Не помилка транзакції: відкат лишив би накопичувач назавжди зайнятим, і
/// прогін застряг би в `running` без жодного способу повернути депозит.
/// `FR-016` каже повернути його повністю, а для цього потрібен саме кінцевий
/// статус.
#[event]
pub struct RunComputationAborted {
    pub run: Pubkey,
    pub computation: Pubkey,
}

// ── Відкриття прогону ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct OpenRun<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub dispatcher: Signer<'info>,
    #[account(
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        init,
        payer = dispatcher,
        space = 8 + RunAccumulator::INIT_SPACE,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    /// Буфер під один батч. Створюється на 10 КіБ і доростає окремими
    /// інструкціями: акаунт, створений через CPI, не буває більшим за межу
    /// приросту за одну інструкцію, а батч у неї не вміщається всемеро.
    ///
    /// CHECK: адресу дає seeds, вміст — власна розкладка (мітка, прогін, зріз).
    /// Структурою його не описати: черга обчислень читає з нього сирі слова.
    #[account(
        init,
        payer = dispatcher,
        space = BATCH_BUFFER_INITIAL_BYTES,
        seeds = [BATCH_BUFFER_SEED, run.key().as_ref()],
        bump,
        owner = crate::ID,
    )]
    pub buffer: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn open(ctx: Context<OpenRun>) -> Result<()> {
    // Відкривати можна тільки прогін, який ще не публікувався: після `start`
    // накопичувач уже існує, і другий затер би стан першого.
    require!(
        ctx.accounts.run.status == RunStatus::Accepted,
        GenoVaultError::RunNotAccepted
    );

    let run_key = ctx.accounts.run.key();
    ctx.accounts.accumulator.set_inner(RunAccumulator {
        run: run_key,
        nonce: 0,
        ciphertexts: [[0u8; 32]; ACCUMULATOR_CIPHERTEXTS],
        ready: false,
        pending: None,
        bump: ctx.bumps.accumulator,
    });

    let buffer = ctx.accounts.buffer.to_account_info();
    let mut data = buffer.try_borrow_mut_data()?;
    write_batch_buffer_header(&mut data[..], &run_key, ctx.bumps.buffer);
    drop(data);

    emit!(RunOpened {
        run: run_key,
        accumulator: ctx.accounts.accumulator.key(),
        buffer: ctx.accounts.buffer.key(),
    });
    Ok(())
}

// ── Дорощування буфера ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct GrowBatchBuffer<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub dispatcher: Signer<'info>,
    #[account(
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    /// CHECK: seeds і мітка заголовка; вміст — сирий зріз для черги обчислень.
    #[account(mut, seeds = [BATCH_BUFFER_SEED, run.key().as_ref()], bump)]
    pub buffer: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Дорощує буфер на один крок.
///
/// Крок, а не цільовий розмір аргументом: межу приросту за одну інструкцію
/// задає рантайм, і клієнт, який назвав би завеликий розмір, дізнався б про це
/// з помилки рантайму замість нашої. Шість викликів на прогін — це в скрипті,
/// а не в голові в того, хто пише клієнт.
pub fn grow_buffer(ctx: Context<GrowBatchBuffer>) -> Result<()> {
    let buffer = ctx.accounts.buffer.to_account_info();
    check_batch_buffer_header(&buffer.try_borrow_data()?[..], &ctx.accounts.run.key())?;

    let current = buffer.data_len();
    require!(
        current < BATCH_BUFFER_BYTES,
        GenoVaultError::BatchBufferNotGrowing
    );
    let next = (current + MAX_PERMITTED_DATA_INCREASE).min(BATCH_BUFFER_BYTES);

    // Спершу rent, потім розмір: акаунт, який виріс і перестав бути
    // rent-exempt, збирається рантаймом наприкінці транзакції — разом із
    // батчем, що в ньому лежить.
    let required = Rent::get()?.minimum_balance(next);
    let shortfall = required.saturating_sub(buffer.lamports());
    if shortfall > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.dispatcher.to_account_info(),
                    to: buffer.clone(),
                },
            ),
            shortfall,
        )?;
    }

    buffer.resize(next)?;
    Ok(())
}

// ── Запис батча ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct WriteBatch<'info> {
    #[account(address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub dispatcher: Signer<'info>,
    #[account(
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    /// CHECK: seeds і мітка заголовка; вміст — сирий зріз для черги обчислень.
    #[account(mut, seeds = [BATCH_BUFFER_SEED, run.key().as_ref()], bump)]
    pub buffer: UncheckedAccount<'info>,
}

/// Кладе шматок шифротексту в буфер.
///
/// Конверт їде в ланцюг транзакціями по ~950 байтів корисного вантажу — інших
/// транзакцій у Solana не буває, — тож один батч це ~75 викликів. Порядок між
/// ними довільний: кожен несе свій зсув, і зіпсувати сусідній шматок не може.
///
/// Накопичувач тут не для читання, а для одного питання: чи немає обчислення в
/// польоті. Вузли читають буфер тоді, коли виконують згортку, тобто **після**
/// нашої транзакції — запис під час польоту підмінив би саме ті байти, за які
/// вже поручився ланцюжок відбитків.
pub fn write(ctx: Context<WriteBatch>, offset: u32, bytes: Vec<u8>) -> Result<()> {
    require!(
        ctx.accounts.accumulator.pending.is_none(),
        GenoVaultError::AccumulatorBusy
    );

    let buffer = ctx.accounts.buffer.to_account_info();
    let mut data = buffer.try_borrow_mut_data()?;
    check_batch_buffer_header(&data[..], &ctx.accounts.run.key())?;

    let start = offset as usize;
    let end = start
        .checked_add(bytes.len())
        .ok_or(GenoVaultError::BatchWriteOutOfBounds)?;
    require!(
        end <= BATCH_PAYLOAD_BYTES,
        GenoVaultError::BatchWriteOutOfBounds
    );
    // Буфер може бути ще не дорощеним: тоді запис у хвіст мовчки нікуди б не
    // потрапив, а батч поїхав би в MPC наполовину нульовим.
    require!(
        data.len() >= BATCH_BUFFER_BYTES,
        GenoVaultError::BatchBufferTooSmall
    );

    let at = BATCH_BUFFER_HEADER_BYTES + start;
    data[at..at + bytes.len()].copy_from_slice(&bytes);
    Ok(())
}

// ── Закриття буфера ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CloseBatchBuffer<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub dispatcher: Signer<'info>,
    #[account(
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    /// CHECK: seeds і мітка заголовка.
    #[account(mut, seeds = [BATCH_BUFFER_SEED, run.key().as_ref()], bump)]
    pub buffer: UncheckedAccount<'info>,
}

/// Повертає rent за буфер — ~0,49 SOL, які лежали мертвим вантажем увесь прогін.
///
/// Дозволено лише коли пул вичерпано або прогін уже в кінцевому статусі:
/// закритий буфер посеред прогону — це згортка, яка поїде в MPC із нулями.
pub fn close_buffer(ctx: Context<CloseBatchBuffer>) -> Result<()> {
    let run = &ctx.accounts.run;
    require!(
        run.pool_exhausted() || run.status.is_terminal(),
        GenoVaultError::RunPoolNotExhausted
    );

    let buffer = ctx.accounts.buffer.to_account_info();
    check_batch_buffer_header(&buffer.try_borrow_data()?[..], &run.key())?;

    let dispatcher = ctx.accounts.dispatcher.to_account_info();
    let refund = buffer.lamports();
    **buffer.try_borrow_mut_lamports()? = 0;
    **dispatcher.try_borrow_mut_lamports()? = dispatcher
        .lamports()
        .checked_add(refund)
        .ok_or(GenoVaultError::LamportsOverflow)?;
    buffer.assign(&anchor_lang::solana_program::system_program::ID);
    buffer.resize(0)?;
    Ok(())
}

// ── Публікація: створення накопичувача ──────────────────────────────────────

#[queue_computation_accounts("frequencies_init", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DispatchInit<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_INIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn queue_init(ctx: Context<DispatchInit>, computation_offset: u64) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    ctx.accounts.accumulator.require_empty()?;

    let computation = ctx.accounts.computation_account.key();
    ctx.accounts.accumulator.arm(computation)?;
    // Статус міняється тут, на публікації, а не на callback'у: `running` за
    // `FR-013` означає «обчислення опубліковане в Arcium», і саме це щойно
    // сталося. Якщо воно повернеться невдачею, callback переведе в `failed`.
    ctx.accounts.run.start()?;

    // Аргументів немає: порожній накопичувач залежить лише від форми рецепта,
    // а її знає сам контур. Нулі, зашифровані ключем MXE, може зробити тільки
    // MXE — програма цього ключа не має, і в цьому суть (`FR-004a`).
    queue_computation(
        ctx.accounts,
        computation_offset,
        ArgBuilder::new().build(),
        vec![FrequenciesInitCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &callback_state_accounts(ctx.accounts.run.key(), ctx.accounts.accumulator.key()),
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

// ── Публікація: згортка батча ───────────────────────────────────────────────

#[queue_computation_accounts("frequencies_fold", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DispatchFold<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    /// CHECK: seeds і мітка заголовка; вміст читають вузли Arcium зрізом.
    #[account(seeds = [BATCH_BUFFER_SEED, run.key().as_ref()], bump)]
    pub buffer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_FOLD))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn queue_fold(
    ctx: Context<DispatchFold>,
    computation_offset: u64,
    live: u8,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    ctx.accounts.accumulator.require_ready()?;

    let run_key = ctx.accounts.run.key();
    let buffer = ctx.accounts.buffer.to_account_info();
    let dataset = ctx.accounts.run.current_dataset()?;
    // Параметри — з `Run`, а не з аргументів: запит покупця це умова прогону, і
    // диспетчер не має права підмінити фільтр після замовлення (`FR-006`).
    let params = FrequenciesParams::decode(&ctx.accounts.run.recipe_params)?;

    {
        let data = buffer.try_borrow_data()?;
        check_batch_buffer_header(&data[..], &run_key)?;
        require!(
            data.len() >= BATCH_BUFFER_BYTES,
            GenoVaultError::BatchBufferTooSmall
        );
        let payload = &data[BATCH_BUFFER_HEADER_BYTES..BATCH_BUFFER_HEADER_BYTES + BATCH_PAYLOAD_BYTES];
        ctx.accounts.run.record_fold(&dataset, live, payload)?;
    }

    let computation = ctx.accounts.computation_account.key();
    ctx.accounts.accumulator.arm(computation)?;

    // Порядок аргументів дублює сигнатуру `frequencies_fold`: батч, накопичувач,
    // `live` і чотири фільтри. Зріз акаунта покриває 2 208 параметрів поспіль —
    // черга ділить його довжину на 32 і не звіряє типи, тож розкладка байтів це
    // те, за чим стежимо ми, а не вона.
    let mut args = ArgBuilder::new()
        .account(
            ctx.accounts.buffer.key(),
            BATCH_BUFFER_HEADER_BYTES as u32,
            BATCH_PAYLOAD_BYTES as u32,
        )
        .plaintext_u128(ctx.accounts.accumulator.nonce);
    for ciphertext in ctx.accounts.accumulator.ciphertexts.iter() {
        args = args.encrypted_u128(*ciphertext);
    }
    let args = args
        .plaintext_u8(live)
        .plaintext_u8(params.min_age)
        .plaintext_u8(params.max_age)
        .plaintext_u8(params.sex_filter)
        .plaintext_u8(params.affected_filter)
        .build();

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![FrequenciesFoldCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &callback_state_accounts(run_key, ctx.accounts.accumulator.key()),
        )?],
        1,
        0,
        0,
    )?;

    emit!(BatchFolded {
        run: run_key,
        dataset,
        live,
        folded_batches: ctx.accounts.run.folded_batches,
        folded_hash: ctx.accounts.run.folded_hash,
    });
    Ok(())
}

// ── Публікація: закриття датасету ───────────────────────────────────────────

#[queue_computation_accounts("frequencies_close_dataset", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DispatchCloseDataset<'info> {
    #[account(mut, address = run.dispatcher @ GenoVaultError::RunNotDispatcher)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account))]
    /// CHECK: перевіряє програма Arcium.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_CLOSE_DATASET))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

pub fn queue_close_dataset(
    ctx: Context<DispatchCloseDataset>,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    ctx.accounts.accumulator.require_ready()?;
    // Курсор рухає callback, а не ця інструкція: інакше друга публікація пішла
    // б уже для наступного датасету, і внесок оголосився б не тому.
    require!(
        !ctx.accounts.run.pool_exhausted(),
        GenoVaultError::RunPoolExhausted
    );
    require!(
        ctx.accounts.run.status == RunStatus::Running,
        GenoVaultError::RunNotRunning
    );

    let computation = ctx.accounts.computation_account.key();
    ctx.accounts.accumulator.arm(computation)?;

    let mut args = ArgBuilder::new().plaintext_u128(ctx.accounts.accumulator.nonce);
    for ciphertext in ctx.accounts.accumulator.ciphertexts.iter() {
        args = args.encrypted_u128(*ciphertext);
    }

    queue_computation(
        ctx.accounts,
        computation_offset,
        args.build(),
        vec![FrequenciesCloseDatasetCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &callback_state_accounts(
                ctx.accounts.run.key(),
                ctx.accounts.accumulator.key(),
            ),
        )?],
        1,
        0,
        0,
    )?;
    Ok(())
}

// ── Callback'и ──────────────────────────────────────────────────────────────

// Шість обов'язкових акаунтів Arcium однакові в усіх трьох callback'ах; наші
// два стоять після них — рівно в тому порядку, в якому їх додає `callback_ix`.
// Написані тричі, а не макросом: `#[callback_accounts]` — атрибут над
// структурою, і згенерована структура для нього невидима.

#[callback_accounts("frequencies_init")]
#[derive(Accounts)]
pub struct FrequenciesInitCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_INIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: адресу перевіряє програма Arcium; verify_output читає з неї дані слота.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: перевіряється обмеженням address.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
}

#[callback_accounts("frequencies_fold")]
#[derive(Accounts)]
pub struct FrequenciesFoldCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_FOLD))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: адресу перевіряє програма Arcium; verify_output читає з неї дані слота.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: перевіряється обмеженням address.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
}

#[callback_accounts("frequencies_close_dataset")]
#[derive(Accounts)]
pub struct FrequenciesCloseDatasetCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FREQUENCIES_CLOSE_DATASET))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: адресу перевіряє програма Arcium; verify_output читає з неї дані слота.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::arcium_anchor::solana_instructions_sysvar::ID)]
    /// CHECK: перевіряється обмеженням address.
    pub instructions_sysvar: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [Run::SEED, run.buyer.as_ref(), &run.nonce.to_le_bytes()],
        bump = run.bump,
    )]
    pub run: Box<Account<'info, Run>>,
    #[account(
        mut,
        seeds = [RunAccumulator::SEED, run.key().as_ref()],
        bump = accumulator.bump,
        constraint = accumulator.run == run.key() @ GenoVaultError::BatchBufferForeignRun,
    )]
    pub accumulator: Box<Account<'info, RunAccumulator>>,
}

/// Стан прогону, який callback має право міняти.
///
/// Обидва акаунти йдуть у callback записуваними — інакше згортка повернулась би
/// у порожнечу, і накопичувач лишився б назавжди зайнятим. Порядок той самий, у
/// якому вони оголошені в кожній callback-структурі: `callback_ix` додає їх
/// після своїх шести обов'язкових.
fn callback_state_accounts(run: Pubkey, accumulator: Pubkey) -> [CallbackAccount; 2] {
    [
        CallbackAccount {
            pubkey: run,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: accumulator,
            is_writable: true,
        },
    ]
}

/// Невдале обчислення не має права застрягти.
///
/// Помилка транзакції тут була б найгіршим виходом: накопичувач лишився б
/// зайнятим, прогін завис би в `running`, і депозит не повернувся б ніколи.
/// Тому невдача — це подія й кінцевий статус, а не `Err`. Повернути депозит
/// звідси теж не можна (у callback'а немає ні сейфа, ні мінта), і саме тому
/// `failed` — окремий статус, з якого повернення робить `T028`.
pub fn abort_computation(
    run_key: Pubkey,
    run: &mut Run,
    accumulator: &mut RunAccumulator,
    computation: Pubkey,
) -> Result<()> {
    accumulator.release(computation)?;
    run.fail()?;
    emit!(RunComputationAborted {
        run: run_key,
        computation,
    });
    Ok(())
}

/// Накопичувач повернувся з MPC — і в `init`, і в `fold` це рівно одне й те
/// саме: новий шифротекст під ключем MXE замість попереднього.
///
/// Ланцюжок відбитків тут не чіпається навмисно: він свідчить про те, що
/// **пішло** в MPC, а не про те, що звідти повернулось. Інакше невдала згортка
/// зникала б зі свідчення, і третя сторона не побачила б спроби.
pub fn accept_accumulator(
    run_key: Pubkey,
    run: &mut Run,
    accumulator: &mut RunAccumulator,
    computation: Pubkey,
    result: Option<(u128, [[u8; 32]; ACCUMULATOR_CIPHERTEXTS])>,
) -> Result<()> {
    match result {
        Some((nonce, ciphertexts)) => accumulator.store(computation, nonce, ciphertexts),
        None => abort_computation(run_key, run, accumulator, computation),
    }
}

/// Датасет закрито: внесок оголошено, курсор пішов на наступний.
pub fn accept_dataset_close(
    run_key: Pubkey,
    run: &mut Run,
    accumulator: &mut RunAccumulator,
    computation: Pubkey,
    result: Option<(u128, [[u8; 32]; ACCUMULATOR_CIPHERTEXTS], u32, u32)>,
) -> Result<()> {
    let Some((nonce, ciphertexts, contribution, below_floor)) = result else {
        return abort_computation(run_key, run, accumulator, computation);
    };

    accumulator.store(computation, nonce, ciphertexts)?;
    let dataset = run.close_current_dataset()?;

    emit!(DatasetContributionDeclared {
        run: run_key,
        dataset,
        records_included: contribution,
        below_floor: below_floor != 0,
    });
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::RECIPE_PARAMS_LEN;

    const CIPHERTEXTS: [[u8; 32]; ACCUMULATOR_CIPHERTEXTS] = [[5u8; 32]; ACCUMULATOR_CIPHERTEXTS];

    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    fn code(result: Result<()>) -> u32 {
        match result.expect_err("очікувалась відмова") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        }
    }

    fn run_and_accumulator() -> (Pubkey, Run, RunAccumulator) {
        let run_key = Pubkey::new_unique();
        let run = Run {
            buyer: Pubkey::new_unique(),
            dispatcher: Pubkey::new_unique(),
            nonce: 1,
            recipe_id: 1,
            recipe_params: [0u8; RECIPE_PARAMS_LEN],
            use_type: 1,
            buyer_category: 1,
            datasets: vec![Pubkey::new_unique(), Pubkey::new_unique()],
            fee_bps: 700,
            escrow_amount: 1_000,
            settled_count: 0,
            settled_amount: 0,
            status: RunStatus::Running,
            result_hash: None,
            dataset_cursor: 0,
            folded_batches: 0,
            folded_hash: [0u8; 32],
            created_at: 0,
            bump: 255,
        };
        let accumulator = RunAccumulator {
            run: run_key,
            nonce: 0,
            ciphertexts: [[0u8; 32]; ACCUMULATOR_CIPHERTEXTS],
            ready: false,
            pending: None,
            bump: 255,
        };
        (run_key, run, accumulator)
    }

    #[test]
    fn a_returned_accumulator_replaces_the_previous_one() {
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        let computation = Pubkey::new_unique();

        accumulator.arm(computation).unwrap();
        accept_accumulator(
            run_key,
            &mut run,
            &mut accumulator,
            computation,
            Some((77, CIPHERTEXTS)),
        )
        .unwrap();

        assert!(accumulator.ready);
        assert_eq!(accumulator.nonce, 77);
        assert_eq!(accumulator.ciphertexts, CIPHERTEXTS);
        assert!(accumulator.pending.is_none());
        assert_eq!(run.status, RunStatus::Running);
    }

    #[test]
    fn an_aborted_computation_fails_the_run_instead_of_wedging_it() {
        // Помилка транзакції лишила б накопичувач зайнятим назавжди: прогін
        // завис би в `running`, і депозит не повернувся б ніколи (`FR-016`).
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        let computation = Pubkey::new_unique();

        accumulator.arm(computation).unwrap();
        accept_accumulator(run_key, &mut run, &mut accumulator, computation, None).unwrap();

        assert_eq!(run.status, RunStatus::Failed);
        assert!(accumulator.pending.is_none());
        assert!(!accumulator.ready, "невдача не створює накопичувача");
    }

    #[test]
    fn a_failed_fold_does_not_erase_what_was_already_folded() {
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();

        accumulator.arm(first).unwrap();
        accept_accumulator(run_key, &mut run, &mut accumulator, first, Some((1, CIPHERTEXTS)))
            .unwrap();

        accumulator.arm(second).unwrap();
        accept_accumulator(run_key, &mut run, &mut accumulator, second, None).unwrap();

        assert_eq!(accumulator.nonce, 1, "згорнуте лишається згорнутим");
        assert!(accumulator.ready);
        assert_eq!(run.status, RunStatus::Failed);
    }

    #[test]
    fn closing_a_dataset_moves_the_cursor_and_declares_the_contribution() {
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        let first = run.datasets[0];
        let computation = Pubkey::new_unique();

        accumulator.arm(computation).unwrap();
        accept_dataset_close(
            run_key,
            &mut run,
            &mut accumulator,
            computation,
            Some((9, CIPHERTEXTS, 120, 0)),
        )
        .unwrap();

        assert_eq!(run.dataset_cursor, 1);
        assert_eq!(run.current_dataset().unwrap(), run.datasets[1]);
        assert_ne!(first, run.datasets[1]);
        assert_eq!(accumulator.nonce, 9);
    }

    #[test]
    fn a_failed_close_leaves_the_cursor_where_it_was() {
        // Зсунутий курсор оголосив би внесок наступного датасету від імені
        // попереднього — і жоден із двох власників цього б не побачив.
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        let computation = Pubkey::new_unique();

        accumulator.arm(computation).unwrap();
        accept_dataset_close(run_key, &mut run, &mut accumulator, computation, None).unwrap();

        assert_eq!(run.dataset_cursor, 0);
        assert_eq!(run.status, RunStatus::Failed);
    }

    #[test]
    fn a_callback_of_another_computation_is_refused() {
        let (run_key, mut run, mut accumulator) = run_and_accumulator();
        accumulator.arm(Pubkey::new_unique()).unwrap();

        assert_eq!(
            code(accept_accumulator(
                run_key,
                &mut run,
                &mut accumulator,
                Pubkey::new_unique(),
                Some((1, CIPHERTEXTS)),
            )),
            expected(GenoVaultError::AccumulatorOffsetMismatch),
            "результат скасованого обчислення не сідає поверх свіжого"
        );
    }
}
