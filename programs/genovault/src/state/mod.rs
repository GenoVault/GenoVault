// Модулі стану навмисно приватні: назовні від них потрібні тільки типи, а
// публічні `state::consent` і `state::dataset` стикалися б у корені крейта з
// однойменними модулями `instructions` — і один із пари мовчки перемагав би.
mod config;
mod consent;
mod dataset;
mod run;

pub use config::*;
pub use consent::*;
pub use dataset::*;
pub use run::*;
