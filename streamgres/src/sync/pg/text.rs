//! The text forms Postgres uses for the values the engine carries in a
//! form of its own: the epoch-millisecond reading of a time, a JSON array
//! read from `to_json(column)`, and the `{a,b}` array literal the change
//! feed delivers, each turned into the [`Value`] the column's declared
//! type calls for; and the **standard form** of a JSON value, the one text
//! every JSON cell and every JSON literal is brought into, so that two
//! equal values are two equal texts.
//!
//! # The standard form of JSON
//!
//! It is the text `jsonb` writes, with numbers written one way: a space
//! after every `:` and `,`, an object's keys once each, by length and then
//! by bytes, strings escaped as JSON, and a number as its plain decimal
//! digits without an exponent and without zeros padding its fraction
//! (`1.50` and `1.5` are both `1.5`, `1.0` and `1e0` are both `1`, `-0` is
//! `0`). Three things arrive and each is brought into it where it enters:
//!
//! - a `jsonb` cell, from a read (`column::jsonb::text`) or the change
//!   feed, is already that text except for a padded fraction, which
//!   [`standard_json`] looks for at the speed of a copy and trims without
//!   parsing the document;
//! - a `json` cell is whatever text was stored: a read has Postgres turn
//!   it into `jsonb` (the same `::jsonb` cast), and the change feed, which
//!   delivers the stored text, parses and rewrites it ([`json_as_jsonb`]);
//! - a literal from a client's query is written by [`jsonb_text`].

use std::borrow::Cow;

use crate::model::{Value, ValueType};

/// A JSON value in the standard form (see the module docs): what a
/// literal compared with a JSON column is written as, so equality of the
/// two texts is equality of the two values.
pub fn jsonb_text(value: &serde_json::Value) -> String {
    let mut out = String::new();
    write_jsonb(value, &mut out);
    out
}

/// Append `value` in the standard form.
fn write_jsonb(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                write_jsonb(item, out);
            }
            out.push(']');
        }
        serde_json::Value::Object(entries) => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort_by(|a, b| {
                a.len()
                    .cmp(&b.len())
                    .then_with(|| a.as_bytes().cmp(b.as_bytes()))
            });
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                out.push_str(&serde_json::Value::String(key.clone()).to_string());
                out.push_str(": ");
                write_jsonb(&entries[key], out);
            }
            out.push('}');
        }
        serde_json::Value::Number(number) => write_number(number, out),
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// Append a number in the standard form: an integer as its digits, any
/// other as the shortest decimal that reads back as the same double,
/// which is what a JavaScript client wrote and so what `jsonb` stored;
/// never an exponent, never a padded fraction, and zero without a sign.
fn write_number(number: &serde_json::Number, out: &mut String) {
    use std::fmt::Write;
    if let Some(int) = number.as_i64() {
        let _ = write!(out, "{int}");
    } else if let Some(int) = number.as_u64() {
        let _ = write!(out, "{int}");
    } else {
        match number.as_f64() {
            Some(0.0) => out.push('0'),
            Some(float) => {
                let _ = write!(out, "{float}");
            }
            None => out.push_str(&number.to_string()),
        }
    }
}

/// A `jsonb` cell's text in the standard form: the text itself unless a
/// number in it carries zeros padding its fraction (`jsonb` keeps the
/// scale a number was stored with), which are trimmed. Nearly every cell
/// has none, and is found so by a vectorised search for a `.` between
/// digits whose fraction ends in `0`: the cost of a copy, nothing parsed,
/// nothing allocated. Only a cell with such a candidate is walked with its
/// strings skipped, since the candidate may be text (`"v1.50"`) rather
/// than a number.
pub fn standard_json(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let candidate = memchr::memchr_iter(b'.', bytes).any(|dot| padding(bytes, dot).is_some());
    if candidate {
        trimmed(text)
    } else {
        Cow::Borrowed(text)
    }
}

/// The padded fraction at the `.` at `dot`, if there is one: where the
/// number's kept text ends (before the `.` when the whole fraction is
/// zeros) and where the fraction ends. None when the `.` is not between
/// digits, the fraction does not end in `0`, or an exponent follows
/// (`jsonb` never writes one, so such text is not its output).
fn padding(bytes: &[u8], dot: usize) -> Option<(usize, usize)> {
    if dot == 0 || !bytes[dot - 1].is_ascii_digit() {
        return None;
    }
    let fraction = dot + 1;
    let digits = bytes[fraction..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    let end = fraction + digits;
    if digits == 0 || bytes[end - 1] != b'0' || matches!(bytes.get(end), Some(b'e' | b'E')) {
        return None;
    }
    let kept = bytes[fraction..end]
        .iter()
        .rposition(|byte| *byte != b'0')
        .map_or(0, |last| last + 1);
    Some((if kept == 0 { dot } else { fraction + kept }, end))
}

/// `text` with every padded fraction outside a string trimmed; borrowed
/// when the candidates all turned out to be inside strings.
fn trimmed(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut copied = 0;
    let mut index = 0;
    while let Some(found) = memchr::memchr2(b'"', b'.', &bytes[index..]) {
        let at = index + found;
        if bytes[at] == b'"' {
            index = after_string(bytes, at + 1);
            continue;
        }
        index = at + 1;
        if let Some((keep_to, end)) = padding(bytes, at) {
            let out = out.get_or_insert_with(|| String::with_capacity(text.len()));
            out.push_str(&text[copied..keep_to]);
            copied = end;
            index = end;
        }
    }
    match out {
        None => Cow::Borrowed(text),
        Some(mut out) => {
            out.push_str(&text[copied..]);
            Cow::Owned(out)
        }
    }
}

/// The index just past the string whose opening quote ends at `index`: the
/// next `"` that no `\` escapes; the end of the text when it never closes.
fn after_string(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() {
        match memchr::memchr2(b'"', b'\\', &bytes[index..]) {
            Some(found) if bytes[index + found] == b'"' => return index + found + 1,
            Some(found) => index += found + 2,
            None => break,
        }
    }
    bytes.len()
}

/// A `json` cell's stored text in the standard form: parsed and written
/// the way `jsonb` would hold it (the last of a repeated key wins, as it
/// does there). Text that does not parse is kept as it is. A number with
/// more digits than a double holds is written as the double, where the
/// `::jsonb` cast of a read keeps every digit; no JavaScript client can
/// write or read such a number.
pub fn json_as_jsonb(text: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => jsonb_text(&value),
        Err(_) => text.to_owned(),
    }
}

/// Milliseconds since the Unix epoch of a Postgres `timestamp`,
/// `timestamptz` or `date` in its text form (`2026-09-15 10:00:00.123`,
/// with an optional `+05:30` style offset, or `2026-09-15`); a timestamp
/// without a zone is read as UTC, the protocol's convention. `None` when the text
/// is not a time (`infinity` included).
pub fn epoch_millis(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.len() == 10 {
        let date = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?;
        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    let (naive, offset_seconds) = split_offset(text);
    let parsed = chrono::NaiveDateTime::parse_from_str(naive, "%Y-%m-%d %H:%M:%S%.f")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(naive, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(naive, "%Y-%m-%dT%H:%M:%S%.f"))
        .ok()?;
    Some(parsed.and_utc().timestamp_millis() - offset_seconds * 1000)
}

/// Split a trailing `+HH`, `+HH:MM` or `+HHMM` zone offset off a timestamp
/// text, returning the rest and the offset in seconds east of UTC.
fn split_offset(text: &str) -> (&str, i64) {
    let Some(position) = text.rfind(['+', '-']) else {
        return (text, 0);
    };
    if position < 11 {
        return (text, 0);
    }
    let (rest, zone) = text.split_at(position);
    let sign = if zone.starts_with('-') { -1 } else { 1 };
    let digits: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
    let (hours, minutes) = match digits.len() {
        2 => (digits.parse::<i64>().unwrap_or(0), 0),
        4 => (
            digits[..2].parse::<i64>().unwrap_or(0),
            digits[2..].parse::<i64>().unwrap_or(0),
        ),
        _ => return (text, 0),
    };
    (rest, sign * (hours * 3600 + minutes * 60))
}

/// A JSON array text (what `to_json(column)::text` returns for an array
/// column) as a [`Value::List`] of `inner`-typed items; text that is not
/// a JSON array is kept whole as a string.
pub fn json_list(text: &str, inner: &ValueType) -> Value {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Array(items)) => {
            Value::List(items.iter().map(|item| json_scalar(item, inner)).collect())
        }
        _ => Value::String(text.to_owned()),
    }
}

/// One JSON scalar as the [`Value`] the item type calls for.
fn json_scalar(item: &serde_json::Value, inner: &ValueType) -> Value {
    match item {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(flag) => Value::Bool(*flag),
        serde_json::Value::Number(number) => match (number.as_i64(), inner) {
            (Some(int), ValueType::Float) => Value::Float(int as f64),
            (Some(int), _) => Value::Int(int),
            (None, _) => Value::Float(number.as_f64().unwrap_or(f64::NAN)),
        },
        serde_json::Value::String(text) => scalar_text(text, inner),
        other => Value::String(other.to_string()),
    }
}

/// A Postgres array literal (`{a,"b c",NULL}`) as a [`Value::List`] of
/// `inner`-typed items.
pub fn array_literal(text: &str, inner: &ValueType) -> Value {
    let body = text
        .trim()
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'));
    let Some(body) = body else {
        return Value::String(text.to_owned());
    };
    if body.is_empty() {
        return Value::List(Vec::new());
    }
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut was_quoted = false;
    let mut escaped = false;
    let mut depth = 0usize;
    for character in body.chars() {
        if escaped {
            current.push(character);
            escaped = false;
        } else if quoted {
            match character {
                '\\' => escaped = true,
                '"' => quoted = false,
                other => current.push(other),
            }
        } else {
            match character {
                '"' => {
                    quoted = true;
                    was_quoted = true;
                }
                '{' => {
                    depth += 1;
                    current.push(character);
                }
                '}' => {
                    depth = depth.saturating_sub(1);
                    current.push(character);
                }
                ',' if depth == 0 => {
                    items.push(array_item(&current, was_quoted, inner));
                    current.clear();
                    was_quoted = false;
                }
                other => current.push(other),
            }
        }
    }
    items.push(array_item(&current, was_quoted, inner));
    Value::List(items)
}

/// One element of an array literal: an unquoted `NULL` is null, anything
/// else the scalar the item type calls for.
fn array_item(text: &str, was_quoted: bool, inner: &ValueType) -> Value {
    if !was_quoted && text.eq_ignore_ascii_case("NULL") {
        return Value::Null;
    }
    scalar_text(text, inner)
}

/// A scalar in text form as the [`Value`] its type calls for; text that
/// does not parse as the type stays a string.
fn scalar_text(text: &str, inner: &ValueType) -> Value {
    match inner {
        ValueType::Int | ValueType::Timestamp => text
            .parse()
            .map(Value::Int)
            .unwrap_or_else(|_| Value::String(text.to_owned())),
        ValueType::Float => text
            .parse()
            .map(Value::Float)
            .unwrap_or_else(|_| Value::String(text.to_owned())),
        ValueType::Bool => match text {
            "t" | "true" => Value::Bool(true),
            "f" | "false" => Value::Bool(false),
            other => Value::String(other.to_owned()),
        },
        _ => Value::String(text.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Timestamps without a zone read as UTC, with a zone are shifted, and
    /// dates land on UTC midnight.
    #[test]
    fn times_read_as_epoch_milliseconds() {
        assert_eq!(epoch_millis("1970-01-01 00:00:01.5"), Some(1_500));
        assert_eq!(epoch_millis("1970-01-01 01:00:00+01"), Some(0));
        assert_eq!(epoch_millis("1970-01-01 05:30:00.25+05:30"), Some(250));
        assert_eq!(epoch_millis("1970-01-02"), Some(86_400_000));
        assert_eq!(epoch_millis("infinity"), None);
    }

    /// Array literals split on unquoted commas, unquote, and read NULL.
    #[test]
    fn array_literals_become_lists() {
        assert_eq!(
            array_literal("{a,\"b, c\",NULL,\"NULL\"}", &ValueType::String),
            Value::List(vec![
                Value::from("a"),
                Value::from("b, c"),
                Value::Null,
                Value::from("NULL")
            ])
        );
        assert_eq!(
            array_literal("{1,2}", &ValueType::Int),
            Value::List(vec![Value::Int(1), Value::Int(2)])
        );
        assert_eq!(array_literal("{}", &ValueType::String), Value::List(vec![]));
    }

    /// JSON arrays from `to_json` become the same lists.
    #[test]
    fn json_arrays_become_lists() {
        assert_eq!(
            json_list("[\"x\",null]", &ValueType::String),
            Value::List(vec![Value::from("x"), Value::Null])
        );
        assert_eq!(
            json_list("[1.5,2]", &ValueType::Float),
            Value::List(vec![Value::Float(1.5), Value::Float(2.0)])
        );
    }

    /// A JSON value is written as `jsonb` writes it: scalars as JSON, a
    /// space after every `:` and `,`, keys by length and then by bytes.
    #[test]
    fn json_is_written_as_jsonb_writes_it() {
        use serde_json::json;
        assert_eq!(jsonb_text(&json!("high")), "\"high\"");
        assert_eq!(jsonb_text(&json!("a\"b\n")), "\"a\\\"b\\n\"");
        assert_eq!(jsonb_text(&json!(5)), "5");
        assert_eq!(jsonb_text(&json!(1.5)), "1.5");
        assert_eq!(jsonb_text(&json!(1.0)), "1");
        assert_eq!(jsonb_text(&json!(true)), "true");
        assert_eq!(jsonb_text(&json!([1, "x", null])), "[1, \"x\", null]");
        assert_eq!(
            jsonb_text(&json!({"bb": 1, "a": {"z": [], "y": {}}, "ab": false})),
            "{\"a\": {\"y\": {}, \"z\": []}, \"ab\": false, \"bb\": 1}"
        );
    }

    /// A literal's number is written one way however the client spelled
    /// it: no padded fraction, no exponent, no signed zero; and it is the
    /// text `jsonb` gives back for what a JavaScript client stored.
    #[test]
    fn a_literal_number_has_one_spelling() {
        let written = |text: &str| jsonb_text(&serde_json::from_str(text).unwrap());
        assert_eq!(written("1.50"), "1.5");
        assert_eq!(written("1.0"), "1");
        assert_eq!(written("1e3"), "1000");
        assert_eq!(written("1E+21"), "1000000000000000000000");
        assert_eq!(written("1.5e-7"), "0.00000015");
        assert_eq!(written("-0"), "0");
        assert_eq!(written("-0.0"), "0");
        assert_eq!(written("0.30000000000000004"), "0.30000000000000004");
        assert_eq!(written("-12.25"), "-12.25");
        assert_eq!(written("18446744073709551615"), "18446744073709551615");
        assert_eq!(written("{\"a\": [1.10, 2.00]}"), "{\"a\": [1.1, 2]}");
    }

    /// A `jsonb` cell is its own standard form, borrowed, unless a number
    /// in it has a padded fraction; digits and dots inside strings, and an
    /// integer's own zeros, are left alone.
    #[test]
    fn a_jsonb_cell_loses_only_padded_fractions() {
        for untouched in [
            "\"high\"",
            "5",
            "100",
            "1.5",
            "-0.25",
            "true",
            "null",
            "[1, \"x\", null]",
            "{\"v\": \"1.50\", \"w\": \"a \\\"1.0\\\" b\", \"x\": 10}",
            "\"ends with a backslash \\\\\"",
        ] {
            assert!(
                matches!(standard_json(untouched), Cow::Borrowed(_)),
                "{untouched}"
            );
        }
        assert_eq!(standard_json("1.50"), "1.5");
        assert_eq!(standard_json("1.0"), "1");
        assert_eq!(standard_json("0.0"), "0");
        assert_eq!(standard_json("-3.1400"), "-3.14");
        assert_eq!(standard_json("100.00"), "100");
        assert_eq!(
            standard_json("{\"a\": 1.50, \"b\": [2.0, \"3.0\", 4.25], \"c\": 10.010}"),
            "{\"a\": 1.5, \"b\": [2, \"3.0\", 4.25], \"c\": 10.01}"
        );
        assert_eq!(
            standard_json("\"ends with a backslash \\\\\" 1.0").as_ref(),
            "\"ends with a backslash \\\\\" 1"
        );
    }

    /// The plain way to say the same thing, byte by byte with the strings
    /// tracked, which the searched version must agree with.
    fn trimmed_byte_by_byte(text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = String::new();
        let mut index = 0;
        let mut quoted = false;
        while index < bytes.len() {
            let byte = bytes[index];
            if quoted && byte == b'\\' {
                out.push_str(&text[index..(index + 2).min(bytes.len())]);
                index += 2;
                continue;
            }
            if byte == b'"' {
                quoted = !quoted;
            }
            if byte == b'.'
                && !quoted
                && let Some((keep_to, end)) = padding(bytes, index)
            {
                out.push_str(&text[index..keep_to.max(index)]);
                index = end;
                continue;
            }
            let width = text[index..].chars().next().map_or(1, char::len_utf8);
            out.push_str(&text[index..index + width]);
            index += width;
        }
        out
    }

    /// Thousands of texts put together from the pieces that matter (padded
    /// and plain numbers, strings holding digits, dots, quotes and
    /// backslashes, other scripts) come out of the searched version as
    /// they do out of the byte-by-byte one.
    #[test]
    fn the_search_agrees_with_the_byte_by_byte_walk() {
        let pieces = [
            "1.50",
            "2.0",
            "0.0",
            "-3.1400",
            "100",
            "10.01",
            "7.",
            ".5",
            "1.5e3",
            "1.50e3",
            "\"1.50\"",
            "\"a \\\"2.0\\\" b\"",
            "\"back\\\\\"",
            "\"x.y\"",
            "\"\u{e9}t\u{e9} 3.0\"",
            "{",
            "}",
            "[",
            "]",
            ": ",
            ", ",
            "true",
            "null",
            "\"k\"",
            " ",
            "\"",
        ];
        let mut state = 0x2545F4914F6CDD1Du64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..20_000 {
            let text: String = (0..1 + next() % 9)
                .map(|_| pieces[(next() % pieces.len() as u64) as usize])
                .collect();
            assert_eq!(
                standard_json(&text),
                trimmed_byte_by_byte(&text),
                "for {text:?}"
            );
        }
    }

    /// A cell and a literal that are the same value are the same text,
    /// which is what the engine's equality compares.
    #[test]
    fn a_cell_and_a_literal_of_one_value_are_one_text() {
        let literal = |text: &str| jsonb_text(&serde_json::from_str(text).unwrap());
        assert_eq!(standard_json("1.50"), literal("1.5"));
        assert_eq!(standard_json("2.0"), literal("2"));
        assert_eq!(standard_json("1000"), literal("1e3"));
        assert_eq!(
            standard_json("{\"a\": 1.0, \"bb\": [0.50]}"),
            literal("{\"bb\":[0.5],\"a\":1}")
        );
    }

    /// A `json` cell, stored with whatever spacing, key order, repeated
    /// keys and number spellings, becomes the text its `jsonb` would be.
    #[test]
    fn a_json_cell_is_rewritten_as_its_jsonb() {
        assert_eq!(
            json_as_jsonb("{ \"bb\":1.50,\n \"a\" : [1e2,\"x\"], \"a\": {\"k\":true} }"),
            "{\"a\": {\"k\": true}, \"bb\": 1.5}"
        );
        assert_eq!(json_as_jsonb("  \"x\"  "), "\"x\"");
        assert_eq!(json_as_jsonb("not json"), "not json");
    }
}
