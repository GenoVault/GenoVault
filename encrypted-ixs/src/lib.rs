use arcis::*;

/// Рецепти, які виконуються над зашифрованими даними.
///
/// Зараз тут єдиний каркасний рецепт: він доводить, що ланцюг «програма →
/// черга обчислень → MPC-вузли → callback» замикається, і не претендує на
/// продуктовий сенс. Справжній каталог (`FR-011`) — частоти, кореляції,
/// GWAS-асоціація й логістична регресія — приходить задачами T018 і T044-T045,
/// і кожен рецепт має повертати ще й вектор `records_included` (`FR-018a`).
#[encrypted]
mod circuits {
    use arcis::*;

    pub struct GenotypePair {
        first: u8,
        second: u8,
    }

    #[instruction]
    pub fn probe_sum(input_ctxt: Enc<Shared, GenotypePair>) -> Enc<Shared, u16> {
        let input = input_ctxt.to_arcis();
        let sum = input.first as u16 + input.second as u16;
        input_ctxt.owner.from_arcis(sum)
    }
}
