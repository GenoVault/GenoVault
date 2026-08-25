use anchor_lang::prelude::*;

declare_id!("EBDdxS1AsBojwbLBQqAsh61194ZNUqZRSbB8gyUZJ2p1");

/// Каркас програми. Стан і інструкції додаються задачами T009…T012;
/// тут лише точка входу, щоб збірка й деплой перевірялись окремо від логіки.
#[program]
pub mod genovault {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
