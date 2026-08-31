use anchor_lang::prelude::*;

use crate::errors::GenoVaultError;

/// Словник типів використання.
///
/// Бітмаска, а не рядки: порівняння рядків у контексті, де перевірку робить і
/// програма, і згодом обчислювальний шар, дороге й помилкове, а фіксований
/// словник закривається однією операцією. Ті самі значення дублюються в
/// `packages/shared` (`T034`) — розходження двох списків зробило б відмову
/// незрозумілою покупцю, тому будь-яка правка тут парна.
pub mod use_type {
    pub const ONCOLOGY: u32 = 1 << 0;
    pub const CARDIOLOGY: u32 = 1 << 1;
    pub const RARE_DISEASE: u32 = 1 << 2;
    pub const POPULATION_GENETICS: u32 = 1 << 3;
    pub const PHARMA_COMMERCIAL: u32 = 1 << 4;

    pub const ALL: u32 =
        ONCOLOGY | CARDIOLOGY | RARE_DISEASE | POPULATION_GENETICS | PHARMA_COMMERCIAL;
}

/// Словник категорій покупців.
pub mod buyer_category {
    pub const ACADEMIC: u32 = 1 << 0;
    pub const NON_PROFIT: u32 = 1 << 1;
    pub const COMMERCIAL: u32 = 1 << 2;
    pub const GOVERNMENT: u32 = 1 << 3;

    pub const ALL: u32 = ACADEMIC | NON_PROFIT | COMMERCIAL | GOVERNMENT;
}

/// Версія згоди (`FR-005`).
///
/// Seeds: `["consent", dataset, version]`. Кожна версія — окремий акаунт із
/// посиланням на попередню: перезапис зробив би вимогу «історія без
/// можливості перезапису» недоказовою. Поточну версію датасету зберігає сам
/// `Dataset.consent_version`, тож адреса чинної згоди деривується без пошуку.
#[account]
#[derive(InitSpace)]
pub struct Consent {
    pub dataset: Pubkey,
    /// Починається з 1; 0 у `Dataset.consent_version` означає «згоди немає».
    pub version: u32,
    /// Що дозволено.
    pub allowed_uses: u32,
    /// Що заборонено попри дозвіл. Не надлишкове поле: воно дає висловити
    /// «дозволено все, крім фарма-комерційного», не перелічуючи решту, і
    /// новий тип використання у словнику не стає дозволеним заднім числом.
    pub forbidden_uses: u32,
    pub buyer_categories: u32,
    /// `None` — без строку. Строк перевіряється часом ланцюга, не клієнта.
    pub expires_at: Option<i64>,
    /// Проставляється відкликанням і більше не змінюється (`FR-007`).
    pub revoked_at: Option<i64>,
    pub prev_version: Option<Pubkey>,
    pub bump: u8,
}

impl Consent {
    pub const SEED: &'static [u8] = b"consent";

    /// Що насправді дозволено після врахування заборон.
    pub fn effective_uses(&self) -> u32 {
        self.allowed_uses & !self.forbidden_uses
    }

    /// Перевірка згоди для одного прогону (`FR-006`).
    ///
    /// Порядок перевірок не випадковий: він визначає, яку саме причину побачить
    /// покупець (`FR-008`). Спершу те, що стосується згоди цілком (відкликання,
    /// строк), потім те, що стосується конкретного замовлення. Інакше на
    /// відкликаній згоді покупець читав би «тип не дозволений» і шукав би
    /// проблему не там.
    pub fn check(&self, now: i64, use_type: u32, buyer_category: u32) -> Result<()> {
        require!(
            self.revoked_at.is_none(),
            GenoVaultError::ConsentIsRevoked
        );
        if let Some(expires_at) = self.expires_at {
            require!(now < expires_at, GenoVaultError::ConsentExpired);
        }
        require!(
            use_type.count_ones() == 1 && use_type & use_type::ALL != 0,
            GenoVaultError::UnknownUseType
        );
        require!(
            buyer_category.count_ones() == 1 && buyer_category & buyer_category::ALL != 0,
            GenoVaultError::UnknownBuyerCategory
        );
        // Заборона перевіряється окремо від дозволу навмисно: «не дозволено» і
        // «прямо заборонено» — різні відповіді власника, і власник має право
        // знати, яка з них спрацювала.
        require!(
            self.forbidden_uses & use_type == 0,
            GenoVaultError::UseTypeForbidden
        );
        require!(
            self.allowed_uses & use_type != 0,
            GenoVaultError::UseTypeNotAllowed
        );
        require!(
            self.buyer_categories & buyer_category != 0,
            GenoVaultError::BuyerCategoryNotAllowed
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn consent(allowed: u32, forbidden: u32, categories: u32) -> Consent {
        Consent {
            dataset: Pubkey::default(),
            version: 1,
            allowed_uses: allowed,
            forbidden_uses: forbidden,
            buyer_categories: categories,
            expires_at: None,
            revoked_at: None,
            prev_version: None,
            bump: 255,
        }
    }

    /// Очікуваний код: `.into()` просто в `assert_eq!` не виводиться —
    /// обидві сторони макроса лишаються родовими, і компілятор не має за що
    /// зачепитись.
    fn expected(error: GenoVaultError) -> u32 {
        error.into()
    }

    fn code(result: Result<()>) -> u32 {
        match result.expect_err("очікувалась відмова") {
            Error::AnchorError(err) => err.error_code_number,
            other => panic!("очікувалась помилка програми, отримано {other:?}"),
        }
    }

    #[test]
    fn allows_what_the_owner_allowed() {
        let c = consent(
            use_type::ONCOLOGY | use_type::RARE_DISEASE,
            0,
            buyer_category::ACADEMIC,
        );
        assert!(c
            .check(0, use_type::ONCOLOGY, buyer_category::ACADEMIC)
            .is_ok());
    }

    #[test]
    fn forbidden_beats_allowed() {
        // Саме заради цього випадку існує друга маска: «все, крім
        // фарма-комерційного» пишеться однією згодою і не ламається, коли у
        // словник додадуть новий тип.
        let c = consent(
            use_type::ALL,
            use_type::PHARMA_COMMERCIAL,
            buyer_category::ALL,
        );
        assert!(c
            .check(0, use_type::ONCOLOGY, buyer_category::COMMERCIAL)
            .is_ok());
        assert_eq!(
            code(c.check(0, use_type::PHARMA_COMMERCIAL, buyer_category::COMMERCIAL)),
            expected(GenoVaultError::UseTypeForbidden)
        );
    }

    #[test]
    fn names_the_constraint_that_was_violated() {
        let c = consent(use_type::ONCOLOGY, 0, buyer_category::ACADEMIC);
        assert_eq!(
            code(c.check(0, use_type::CARDIOLOGY, buyer_category::ACADEMIC)),
            expected(GenoVaultError::UseTypeNotAllowed)
        );
        assert_eq!(
            code(c.check(0, use_type::ONCOLOGY, buyer_category::COMMERCIAL)),
            expected(GenoVaultError::BuyerCategoryNotAllowed)
        );
    }

    #[test]
    fn revocation_outranks_everything_else() {
        let mut c = consent(use_type::ALL, 0, buyer_category::ALL);
        c.revoked_at = Some(100);
        // Тип і категорія тут дозволені — відмова має назвати відкликання, а
        // не відправити власника шукати неіснуючу проблему в типі.
        assert_eq!(
            code(c.check(0, use_type::ONCOLOGY, buyer_category::ACADEMIC)),
            expected(GenoVaultError::ConsentIsRevoked)
        );
    }

    #[test]
    fn expiry_is_exclusive_at_the_boundary() {
        let mut c = consent(use_type::ALL, 0, buyer_category::ALL);
        c.expires_at = Some(1_000);
        assert!(c
            .check(999, use_type::ONCOLOGY, buyer_category::ACADEMIC)
            .is_ok());
        assert_eq!(
            code(c.check(1_000, use_type::ONCOLOGY, buyer_category::ACADEMIC)),
            expected(GenoVaultError::ConsentExpired)
        );
    }

    #[test]
    fn rejects_bits_outside_the_dictionary() {
        let c = consent(use_type::ALL, 0, buyer_category::ALL);
        let unknown = 1 << 31;
        assert_eq!(
            code(c.check(0, unknown, buyer_category::ACADEMIC)),
            expected(GenoVaultError::UnknownUseType)
        );
        // Дві одиниці в масці — це вже два типи, а прогін має рівно один.
        assert_eq!(
            code(c.check(
                0,
                use_type::ONCOLOGY | use_type::CARDIOLOGY,
                buyer_category::ACADEMIC
            )),
            expected(GenoVaultError::UnknownUseType)
        );
    }

    #[test]
    fn effective_uses_subtracts_the_forbidden_ones() {
        let c = consent(use_type::ALL, use_type::PHARMA_COMMERCIAL, 0);
        assert_eq!(c.effective_uses(), use_type::ALL & !use_type::PHARMA_COMMERCIAL);
    }
}
