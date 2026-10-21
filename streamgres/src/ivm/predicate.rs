//! Predicate evaluation: does a row satisfy a `Where` tree?
//!
//! NULL semantics follow SQL, collapsed to two-valued logic: any comparison
//! that touches `Null` — the row's value, the condition's value, or a
//! missing column — evaluates to `false`, for every operator including
//! `NEQ` and `NOT_IN`. The null tests are the exception: `IS NULL` holds
//! for a `Null` or missing column and `IS NOT NULL` for a present,
//! non-`Null` one; with any operand but `Null` neither ever holds.
//!
//! Every function threads an `evaluated` counter so callers can observe how
//! much work routing a write actually costs (see `crate::ivm::IvmStats`).

use crate::model::{ComparisonOperator, Condition, RowData, Value, Where};

/// Evaluate a full `Where` tree against a row image; an `EXISTS` leaf is
/// never true here (see [`evaluate_with`] for a caller that can answer
/// it).
///
/// `AND` and `OR` short-circuit, so `evaluated` counts conditions actually
/// looked at, not the size of the tree. `AND(vec![])` is `true`,
/// `OR(vec![])` is `false`.
pub fn evaluate(filter: &Where, row: &RowData, evaluated: &mut u64) -> bool {
    evaluate_with(filter, row, evaluated, &|_| false)
}

/// [`evaluate`] with the `EXISTS` leaves answered by `exists` (the join
/// layer answers them from its per-edge counts when it decides whether a
/// row is shown); every other leaf evaluates as usual.
pub fn evaluate_with(
    filter: &Where,
    row: &RowData,
    evaluated: &mut u64,
    exists: &dyn Fn(&Condition) -> bool,
) -> bool {
    match filter {
        Where::Condition(c) if c.comparison_operator == ComparisonOperator::EXISTS => {
            *evaluated += 1;
            exists(c)
        }
        Where::Condition(c) => eval_condition(c, row, evaluated),
        Where::AND(children) => children
            .iter()
            .all(|child| evaluate_with(child, row, evaluated, exists)),
        Where::OR(children) => children
            .iter()
            .any(|child| evaluate_with(child, row, evaluated, exists)),
    }
}

/// Evaluate a single leaf condition against a row image.
///
/// `IN` / `NOT_IN` expect the condition value to be a [`Value::List`];
/// anything else matches nothing (the parser's job is to reject it earlier).
/// A `Null` inside the list makes `NOT_IN` unsatisfiable, per the
/// module-level NULL rule (SQL agrees: `x NOT IN (a, NULL)` is never true);
/// `IN` needs no such guard — a `Null` element simply never matches.
pub fn eval_condition(cond: &Condition, row: &RowData, evaluated: &mut u64) -> bool {
    *evaluated += 1;

    use ComparisonOperator::*;
    match cond.comparison_operator {
        IS => return cond.value.is_null() && row.get(&cond.column).is_none_or(Value::is_null),
        IS_NOT => {
            return cond.value.is_null()
                && row
                    .get(&cond.column)
                    .is_some_and(|actual| !actual.is_null());
        }
        EXISTS => return false,
        _ => {}
    }
    let Some(actual) = row.get(&cond.column) else {
        return false;
    };
    if actual.is_null() || cond.value.is_null() {
        return false;
    }

    match cond.comparison_operator {
        EQ => actual.loose_eq(&cond.value),
        NEQ => !actual.loose_eq(&cond.value),
        GT => matches!(
            actual.compare(&cond.value),
            Some(std::cmp::Ordering::Greater)
        ),
        GTE => matches!(
            actual.compare(&cond.value),
            Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
        ),
        LT => matches!(actual.compare(&cond.value), Some(std::cmp::Ordering::Less)),
        LTE => matches!(
            actual.compare(&cond.value),
            Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
        ),
        IN => match &cond.value {
            Value::List(items) => items.iter().any(|item| actual.loose_eq(item)),
            Value::Set(set) => set.contains(actual),
            _ => false,
        },
        NOT_IN => match &cond.value {
            Value::List(items) => {
                !items.iter().any(Value::is_null) && !items.iter().any(|item| actual.loose_eq(item))
            }
            Value::Set(set) => !set.contains(actual),
            _ => false,
        },
        IS | IS_NOT | EXISTS => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ColumnName;
    use crate::model::ComparisonOperator::*;
    use std::collections::HashMap;

    /// Build a row image from `(column, value)` pairs.
    fn row(pairs: Vec<(&str, Value)>) -> RowData {
        RowData::from(
            pairs
                .into_iter()
                .map(|(k, v)| (ColumnName::from(k), v))
                .collect::<HashMap<_, _>>(),
        )
    }

    /// Evaluate `filter` against `row`, discarding the evaluated counter.
    fn check(filter: &Where, row: &RowData) -> bool {
        evaluate(filter, row, &mut 0)
    }

    /// `IS NULL` holds for a `Null` or absent column, `IS NOT NULL` for a
    /// present non-`Null` one; with any other operand neither holds, and
    /// `= NULL` / `!= NULL` stay false.
    #[test]
    fn null_tests() {
        let null_row = row(vec![("id", Value::Int(1)), ("owner", Value::Null)]);
        let absent_row = row(vec![("id", Value::Int(1))]);
        let owned_row = row(vec![("id", Value::Int(1)), ("owner", Value::from("u1"))]);
        let is_null = Where::is_null("owner");
        let is_not_null = Where::is_not_null("owner");
        assert!(check(&is_null, &null_row));
        assert!(check(&is_null, &absent_row));
        assert!(!check(&is_null, &owned_row));
        assert!(!check(&is_not_null, &null_row));
        assert!(!check(&is_not_null, &absent_row));
        assert!(check(&is_not_null, &owned_row));
        let is_text = Where::condition("owner", IS, "u1");
        assert!(!check(&is_text, &owned_row));
        assert!(!check(&is_text, &null_row));
        assert!(!check(
            &Where::condition("owner", EQ, Value::Null),
            &null_row
        ));
        assert!(!check(
            &Where::condition("owner", NEQ, Value::Null),
            &owned_row
        ));
    }

    /// All six comparison operators match and reject as expected on int and
    /// string columns.
    #[test]
    fn comparison_operators() {
        let r = row(vec![("points", Value::Int(5)), ("status", "OPEN".into())]);
        assert!(check(&Where::condition("points", EQ, 5), &r));
        assert!(check(&Where::condition("points", NEQ, 4), &r));
        assert!(check(&Where::condition("points", GT, 4), &r));
        assert!(check(&Where::condition("points", GTE, 5), &r));
        assert!(check(&Where::condition("points", LT, 6), &r));
        assert!(check(&Where::condition("points", LTE, 5), &r));
        assert!(!check(&Where::condition("points", GT, 5), &r));
        assert!(check(&Where::condition("status", EQ, "OPEN"), &r));
    }

    /// An `Int` column value compares against `Float` condition values via
    /// loose numeric coercion.
    #[test]
    fn int_float_coercion_in_comparisons() {
        let r = row(vec![("points", Value::Int(5))]);
        assert!(check(&Where::condition("points", EQ, 5.0), &r));
        assert!(check(&Where::condition("points", GT, 4.5), &r));
    }

    /// `IN` matches list membership and `NOT_IN` its complement for
    /// NULL-free lists.
    #[test]
    fn in_and_not_in() {
        let r = row(vec![("priority", Value::String("HIGH".into()))]);
        let hot = Value::List(vec!["HIGH".into(), "URGENT".into()]);
        let cold = Value::List(vec!["LOW".into(), "MEDIUM".into()]);
        assert!(check(&Where::condition("priority", IN, hot.clone()), &r));
        assert!(!check(&Where::condition("priority", IN, cold.clone()), &r));
        assert!(!check(&Where::condition("priority", NOT_IN, hot), &r));
        assert!(check(&Where::condition("priority", NOT_IN, cold), &r));
    }

    /// NULL semantics: a `Null` row value is `false` for every operator
    /// (`NEQ` and `NOT_IN` included), and a missing column behaves the same;
    /// a `Null` *inside* an IN/NOT_IN list is never matched by `IN` and
    /// makes `NOT_IN` unsatisfiable; a `Null` condition value is also always
    /// `false`.
    #[test]
    fn null_and_missing_columns_never_match() {
        let r = row(vec![("status", Value::Null)]);
        assert!(!check(&Where::condition("status", EQ, "OPEN"), &r));
        assert!(!check(&Where::condition("status", NEQ, "OPEN"), &r));
        assert!(!check(
            &Where::condition("status", NOT_IN, Value::List(vec!["OPEN".into()])),
            &r
        ));
        assert!(!check(&Where::condition("ghost", NEQ, "anything"), &r));
        let r3 = row(vec![("status", Value::String("OPEN".into()))]);
        let with_null = Value::List(vec!["OPEN".into(), Value::Null]);
        let with_null_other = Value::List(vec!["CLOSED".into(), Value::Null]);
        assert!(check(
            &Where::condition("status", IN, with_null.clone()),
            &r3
        ));
        assert!(!check(
            &Where::condition("status", IN, with_null_other.clone()),
            &r3
        ));
        assert!(!check(&Where::condition("status", NOT_IN, with_null), &r3));
        assert!(!check(
            &Where::condition("status", NOT_IN, with_null_other),
            &r3
        ));
        let r2 = row(vec![("status", Value::String("OPEN".into()))]);
        assert!(!check(&Where::condition("status", EQ, Value::Null), &r2));
        assert!(!check(&Where::condition("status", NEQ, Value::Null), &r2));
    }

    /// AND/OR trees combine leaf results, and the vacuous cases hold:
    /// `AND(vec![])` is `true`, `OR(vec![])` is `false`.
    #[test]
    fn and_or_trees_and_vacuous_cases() {
        let r = row(vec![("a", Value::Int(1)), ("b", Value::Int(2))]);
        let both = Where::AND(vec![
            Where::condition("a", EQ, 1),
            Where::condition("b", EQ, 2),
        ]);
        let either = Where::OR(vec![
            Where::condition("a", EQ, 99),
            Where::condition("b", EQ, 2),
        ]);
        let neither = Where::OR(vec![
            Where::condition("a", EQ, 99),
            Where::condition("b", EQ, 99),
        ]);
        assert!(check(&both, &r));
        assert!(check(&either, &r));
        assert!(!check(&neither, &r));
        assert!(check(&Where::AND(vec![]), &r));
        assert!(!check(&Where::OR(vec![]), &r));
    }

    /// The first AND child fails, so the second is never evaluated and the
    /// `evaluated` counter stays at 1.
    #[test]
    fn short_circuit_counts_only_evaluated_conditions() {
        let r = row(vec![("a", Value::Int(1)), ("b", Value::Int(2))]);
        let tree = Where::AND(vec![
            Where::condition("a", EQ, 99),
            Where::condition("b", EQ, 2),
        ]);
        let mut evaluated = 0;
        assert!(!evaluate(&tree, &r, &mut evaluated));
        assert_eq!(evaluated, 1);
    }
}
