use anchor_lang::prelude::*;

/// Межа ідентифікатора датасету — це межа seed у Solana, а не смак.
///
/// Ідентифікатор іде в деривацію PDA як є, щоб адресу можна було відновити з
/// URL каталогу без жодного запиту до мережі. Той самий рядок і та сама межа
/// живуть у `packages/shared` (`DATASET_ID_MAX_LENGTH`).
pub const DATASET_ID_MAX_LEN: usize = 32;

/// Стан датасету в каталозі.
///
/// Це **не** заміна згоді. Згода відповідає на питання «на що можна», статус —
/// на питання «чи є цей датасет узагалі». Власник, який продає дані далі не
/// хоче, має обидва важелі, і плутати їх не варто: відкликання згоди лишає
/// датасет у каталозі видимим, зняття прибирає його з обігу.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DatasetStatus {
    Active,
    Retired,
}

/// Позначка підтвердження організації (`FR-024`).
///
/// `FR-024a` вимагає називати її тим, чим вона є: це довіра до оператора
/// платформи, а не криптографічний доказ. Тому тут лежить не «доказ», а хто
/// саме й коли поставив позначку — щоб покупець судив про джерело сам.
/// Ставить її `T060`; до того поле лишається `None`, і картка датасету має
/// показувати різницю, а не мовчати про неї.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct VerificationBadge {
    pub verifier: Pubkey,
    pub verified_at: i64,
}

/// Ончейн-ідентичність датасету (`FR-003`).
///
/// Seeds: `["dataset", owner, dataset_id]`.
///
/// `content_hash` і `version` тут — **поточні**. Історію доводить не цей
/// акаунт, а `Run`: кожен прогін пише версію й відбиток, по яких ішов
/// (`FR-004`), тож завершений прогін не можна заднім числом переприв'язати до
/// іншого вмісту, скільки б разів датасет не оновлювали після нього.
#[account]
#[derive(InitSpace)]
pub struct Dataset {
    pub owner: Pubkey,
    #[max_len(DATASET_ID_MAX_LEN)]
    pub dataset_id: String,
    /// Зростає з кожною зміною вмісту; починається з 1.
    pub version: u32,
    /// sha-256 шифротексту. Оператор бачить лише його — ключа він не має
    /// (`FR-004a`).
    pub content_hash: [u8; 32],
    /// Скільки записів заявив власник. Скільки увійшло насправді — рахує MPC
    /// (`FR-018a`), і саме те число йде в оплату.
    pub record_count_claimed: u64,
    /// Ціна за 1000 записів (`FR-015`).
    pub price_per_1k: u64,
    /// Номер чинної версії згоди; 0 — згоди ще немає. Тримається тут, щоб
    /// адреса чинного `Consent` деривувалась без пошуку по ланцюгу версій.
    pub consent_version: u32,
    pub status: DatasetStatus,
    pub verified_badge: Option<VerificationBadge>,
    pub bump: u8,
}

impl Dataset {
    pub const SEED: &'static [u8] = b"dataset";

    pub fn is_active(&self) -> bool {
        self.status == DatasetStatus::Active
    }
}
