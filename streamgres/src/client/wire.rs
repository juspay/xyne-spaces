//! Rows and keys as the wire carries them: JSON objects keyed by column,
//! with a JSON column's text embedded as the JSON it holds, a time as its
//! milliseconds, and every column the row carries, whoever receives it.
//! The row-patch entries of a poke are written straight into bytes
//! ([`write_put`], [`write_del`]); a put once per row image, kept on the
//! image and shared by every group's frame that carries it; the
//! JSON-tree forms stay for the small messages and the tests.

use std::io::Write;
use std::sync::Arc;

use serde_json::{Map, Value as Json};

#[cfg(doc)]
use crate::model::PutPlan;
use crate::model::{DataFrameKey, DataFrameRow, DbTable, Value, ValueType};

/// Append the `rowsPatch` entry putting `row` into `table`:
/// `{"op":"put","tableName":…,"value":{…}}`, every column the row
/// carries. The bytes depend on the row alone, never on who receives it,
/// so one serialization serves every client.
///
/// A row on the table's own layout (every row decoded from the feed or
/// from storage) is written from the table's [`PutPlan`]: the column
/// keys already escaped and the declared types already found, in the
/// order the row stores its values. Any other row (one built from a map)
/// looks each column up by name, with the same result.
pub fn write_put(out: &mut Vec<u8>, table: &DbTable, row: &DataFrameRow) {
    if Arc::ptr_eq(row.data.schema(), table.row_schema()) {
        let plan = table.put_plan();
        out.extend_from_slice(plan.head());
        for ((key, declared), value) in plan.columns().iter().zip(row.data.values()) {
            out.extend_from_slice(key);
            write_value(out, value, Some(declared));
        }
        out.extend_from_slice(b"}}");
        return;
    }
    out.extend_from_slice(b"{\"op\":\"put\",\"tableName\":");
    write_text(out, table.name.as_str());
    out.extend_from_slice(b",\"value\":{");
    let mut first = true;
    for (column, value) in row.data.iter() {
        if !first {
            out.push(b',');
        }
        first = false;
        write_text(out, column.as_str());
        out.push(b':');
        let declared = table.column(column.as_str()).map(|column| &column.r#type);
        write_value(out, value, declared);
    }
    out.extend_from_slice(b"}}");
}

/// Append the `rowsPatch` entry deleting `key` from `table`:
/// `{"op":"del","tableName":…,"id":{…}}`.
pub fn write_del(out: &mut Vec<u8>, table: &str, key: &DataFrameKey) {
    out.extend_from_slice(b"{\"op\":\"del\",\"tableName\":");
    write_text(out, table);
    out.extend_from_slice(b",\"id\":{");
    let mut first = true;
    for (column, value) in key.pkey_value.iter() {
        if !first {
            out.push(b',');
        }
        first = false;
        write_text(out, column.as_str());
        out.push(b':');
        write_value(out, value, None);
    }
    out.extend_from_slice(b"}}");
}

/// Append one cell as JSON, in the light of its declared type: a JSON
/// column's text is embedded as it is when it parses, a time as its
/// milliseconds, a list item by item.
pub fn write_value(out: &mut Vec<u8>, value: &Value, declared: Option<&ValueType>) {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::String(text) => match declared {
            Some(ValueType::Json)
                if serde_json::from_str::<serde::de::IgnoredAny>(text).is_ok() =>
            {
                out.extend_from_slice(text.as_bytes());
            }
            _ => write_text(out, text),
        },
        Value::Int(int) => {
            let _ = write!(out, "{int}");
        }
        Value::Float(float) if whole(*float) => {
            let _ = write!(out, "{}", *float as i64);
        }
        Value::Float(float) => {
            if serde_json::to_writer(&mut *out, float).is_err() {
                out.extend_from_slice(b"null");
            }
        }
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Date(date) => match date.and_hms_opt(0, 0, 0) {
            Some(at) => {
                let _ = write!(out, "{}", at.and_utc().timestamp_millis());
            }
            None => out.extend_from_slice(b"null"),
        },
        Value::Datetime(datetime) => {
            let _ = write!(out, "{}", datetime.and_utc().timestamp_millis());
        }
        Value::List(items) => {
            let inner = match declared {
                Some(ValueType::List(inner)) => Some(inner.as_ref()),
                _ => None,
            };
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_value(out, item, inner);
            }
            out.push(b']');
        }
        Value::Map(_) | Value::Set(_) => {
            if serde_json::to_writer(&mut *out, &value_json(value, declared)).is_err() {
                out.extend_from_slice(b"null");
            }
        }
    }
}

/// Append `text` as a JSON string, escaped.
fn write_text(out: &mut Vec<u8>, text: &str) {
    if serde_json::to_writer(&mut *out, text).is_err() {
        out.extend_from_slice(b"\"\"");
    }
}

/// A row as a JSON object.
pub fn row_json(row: &DataFrameRow, table: &DbTable) -> Json {
    let mut object = Map::with_capacity(row.data.len());
    for (column, value) in row.data.iter() {
        let declared = table.column(column.as_str()).map(|column| &column.r#type);
        object.insert(column.as_str().to_owned(), value_json(value, declared));
    }
    Json::Object(object)
}

/// A key as a JSON object of its primary-key columns.
pub fn key_json(key: &DataFrameKey) -> Json {
    let mut object = Map::with_capacity(key.pkey_value.len());
    for (column, value) in key.pkey_value.iter() {
        object.insert(column.as_str().to_owned(), value_json(value, None));
    }
    Json::Object(object)
}

/// One cell as JSON, in the light of its declared type.
pub fn value_json(value: &Value, declared: Option<&ValueType>) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::String(text) => match declared {
            Some(ValueType::Json) => {
                serde_json::from_str(text).unwrap_or_else(|_| Json::String(text.clone()))
            }
            _ => Json::String(text.clone()),
        },
        Value::Int(int) => Json::from(*int),
        Value::Float(float) if whole(*float) => Json::from(*float as i64),
        Value::Float(float) => {
            serde_json::Number::from_f64(*float).map_or(Json::Null, Json::Number)
        }
        Value::Bool(flag) => Json::Bool(*flag),
        Value::Date(date) => date
            .and_hms_opt(0, 0, 0)
            .map_or(Json::Null, |at| Json::from(at.and_utc().timestamp_millis())),
        Value::Datetime(datetime) => Json::from(datetime.and_utc().timestamp_millis()),
        Value::List(items) => {
            let inner = match declared {
                Some(ValueType::List(inner)) => Some(inner.as_ref()),
                _ => None,
            };
            Json::Array(items.iter().map(|item| value_json(item, inner)).collect())
        }
        Value::Map(entries) => {
            let mut object = Map::with_capacity(entries.len());
            for (key, item) in entries {
                let key = match key {
                    Value::String(text) => text.clone(),
                    other => format!("{other:?}"),
                };
                object.insert(key, value_json(item, None));
            }
            Json::Object(object)
        }
        Value::Set(set) => Json::Array(
            set.members()
                .iter()
                .map(|item| value_json(item, None))
                .collect(),
        ),
    }
}

/// Whether a float is a whole number a JSON integer holds exactly, so
/// it is written as `1`, not `1.0`: zero-cache writes such values as
/// integers, and a client comparing rows byte for byte sees no
/// difference.
fn whole(float: f64) -> bool {
    float.fract() == 0.0 && float.abs() < 9_007_199_254_740_992.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, DbTable};
    use std::collections::HashMap;

    /// A row on its table's layout, written from the table's plan, comes
    /// out byte for byte as the same row looked up column by column:
    /// every value type, text and column names that need escaping, a
    /// JSON cell that is JSON and one that is not, nulls.
    #[test]
    fn the_plan_writes_what_the_lookup_writes() {
        use crate::model::RowData;
        use chrono::NaiveDate;
        let table = DbTable::new(
            "odd \"table\"",
            ["id", "seq"],
            vec![
                DbColumn::new("id", ValueType::String),
                DbColumn::new("seq", ValueType::Int),
                DbColumn::new("we\"ird\\name", ValueType::String),
                DbColumn::new("meta", ValueType::Json),
                DbColumn::new("broken", ValueType::Json),
                DbColumn::new("ratio", ValueType::Float),
                DbColumn::new("whole", ValueType::Float),
                DbColumn::new("nan", ValueType::Float),
                DbColumn::new("flag", ValueType::Bool),
                DbColumn::new("day", ValueType::Date),
                DbColumn::new("at", ValueType::Datetime),
                DbColumn::new("ts", ValueType::Timestamp),
                DbColumn::new("tags", ValueType::List(Box::new(ValueType::String))),
                DbColumn::new("docs", ValueType::List(Box::new(ValueType::Json))),
                DbColumn::new("gone", ValueType::String),
            ],
        );
        let day = NaiveDate::from_ymd_opt(2026, 10, 5).unwrap();
        let cells = |id: &str| -> Vec<(&'static str, Value)> {
            vec![
                ("id", Value::from(id)),
                ("seq", Value::Int(-42)),
                (
                    "we\"ird\\name",
                    Value::from("tab\t, quote \", é, 😀, \u{1}"),
                ),
                ("meta", Value::from(r#"{"k":[1,2],"s":"x\"y"}"#)),
                ("broken", Value::from("{not json")),
                ("ratio", Value::Float(1.5)),
                ("whole", Value::Float(3.0)),
                ("nan", Value::Float(f64::NAN)),
                ("flag", Value::Bool(true)),
                ("day", Value::Date(day)),
                (
                    "at",
                    Value::Datetime(day.and_hms_milli_opt(1, 2, 3, 4).unwrap()),
                ),
                ("ts", Value::Int(1_759_622_400_000)),
                ("tags", Value::List(vec![Value::from("a\"b"), Value::Null])),
                (
                    "docs",
                    Value::List(vec![Value::from(r#"{"n":1}"#), Value::from("x")]),
                ),
                ("gone", Value::Null),
            ]
        };
        for id in ["plain", "with \"quotes\" and \\ and \n"] {
            let by_name: HashMap<&str, Value> = cells(id).into_iter().collect();
            let layout = table.row_schema();
            let values = |schema: &crate::model::RowSchema| -> Vec<Value> {
                schema
                    .names()
                    .iter()
                    .map(|name| by_name[name.as_str()].clone())
                    .collect()
            };
            let planned = DataFrameRow::from(RowData::with_schema(layout.clone(), values(layout)));
            let copy = crate::model::RowSchema::new(layout.names().iter().cloned());
            assert!(!Arc::ptr_eq(&copy, layout));
            let looked_up = DataFrameRow::from(RowData::with_schema(copy.clone(), values(&copy)));
            let (mut fast, mut slow) = (Vec::new(), Vec::new());
            write_put(&mut fast, &table, &planned);
            write_put(&mut slow, &table, &looked_up);
            assert_eq!(
                String::from_utf8_lossy(&fast),
                String::from_utf8_lossy(&slow),
                "the plan writes the same bytes"
            );
            let written: Json = serde_json::from_slice(&fast).expect("valid JSON");
            assert_eq!(written["tableName"], "odd \"table\"");
            assert_eq!(written["value"], row_json(&planned, &table));
        }
    }

    /// A whole-valued float is written as an integer on both paths, a
    /// fractional one as it is, and a NaN as null.
    #[test]
    fn whole_floats_are_written_as_integers() {
        let mut out = Vec::new();
        write_value(&mut out, &Value::Float(1.0), None);
        assert_eq!(out, b"1");
        out.clear();
        write_value(&mut out, &Value::Float(-4.0), None);
        assert_eq!(out, b"-4");
        out.clear();
        write_value(&mut out, &Value::Float(1.5), None);
        assert_eq!(out, b"1.5");
        out.clear();
        write_value(&mut out, &Value::Float(f64::NAN), None);
        assert_eq!(out, b"null");
        assert_eq!(value_json(&Value::Float(1.0), None), serde_json::json!(1));
        assert_eq!(value_json(&Value::Float(1.5), None), serde_json::json!(1.5));
        assert!(!whole(1e17), "beyond 2^53 a float is left as it is");
    }

    /// JSON columns are embedded, times are numbers, and the client's
    /// schema filters the columns.
    #[test]
    fn rows_serialize_for_the_client() {
        let table = DbTable::new(
            "t",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::String),
                DbColumn::new("meta", ValueType::Json),
                DbColumn::new("at", ValueType::Timestamp),
                DbColumn::new("extra", ValueType::Int),
            ],
        );
        let row = DataFrameRow::from(HashMap::from([
            ("id".into(), Value::from("a")),
            ("meta".into(), Value::from(r#"{"k":[1,2]}"#)),
            ("at".into(), Value::Int(1_000)),
            ("extra".into(), Value::Int(7)),
        ]));
        let json = row_json(&row, &table);
        assert_eq!(json["meta"]["k"][1], 2);
        assert_eq!(json["at"], 1_000);
        assert_eq!(json["extra"], 7, "every column the row carries is written");

        let mut bytes = Vec::new();
        write_put(&mut bytes, &table, &row);
        let written: Json = serde_json::from_slice(&bytes).expect("valid JSON");
        assert_eq!(written["op"], "put");
        assert_eq!(written["tableName"], "t");
        assert_eq!(written["value"], json, "the bytes say what the tree says");
        let mut bytes = Vec::new();
        write_del(
            &mut bytes,
            "t",
            &DataFrameKey::new([("id", Value::from("a\"b"))]),
        );
        let written: Json = serde_json::from_slice(&bytes).expect("valid JSON");
        assert_eq!(written["id"]["id"], "a\"b", "keys are escaped");
    }
}
