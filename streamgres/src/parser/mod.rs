//! SQL text → query model.
//!
//! Clients speak SQL-shaped text; the engine speaks [`crate::model`]. This
//! module is the boundary. Parsing is schema-aware — queries reference
//! tables by name and writes split primary-key values from row data, so
//! every entry point takes a [`Catalog`] (the single home of the schema) to
//! resolve tables, validate column names, coerce literal types, and know
//! which columns form the primary key.
//!
//! ```text
//! query     := read | write
//! read      := SELECT '*' FROM ident [WHERE filter]
//!              [ORDER BY column [ASC | DESC] (, column [ASC | DESC])*] [LIMIT integer]
//! write     := INSERT INTO ident '(' ident (',' ident)* ')' VALUES row
//!            | UPDATE ident SET assign (',' assign)* WHERE filter
//!            | DELETE FROM ident WHERE filter
//! row       := '(' value (',' value)* ')'
//! assign    := ident '=' value
//! filter    := conjunct (OR conjunct)*
//! conjunct  := primary (AND primary)*
//! primary   := '(' filter ')' | condition | TRUE | FALSE
//! condition := column ('=' | '!=' | '<>' | '>' | '>=' | '<' | '<=') value
//!            | column [NOT] IN '(' [value (',' value)*] ')'
//!            | column IS [NOT] NULL
//! column    := ident
//! value     := NULL | TRUE | FALSE | number | string
//!            | '[' [value (',' value)*] ']'
//! ```
//!
//! Keywords are case-insensitive; identifiers are bare words; strings are
//! single-quoted with `''` for an embedded quote; `TRUE` / `FALSE` as a
//! filter parse to the vacuous `AND(vec![])` / `OR(vec![])`.
//!
//! # v1 restrictions (each rejected with a clear error, never narrowed silently)
//!
//! - Single table only — `LEFT JOIN` is recognised and refused.
//! - Writes address **exactly one row by primary key**: the `WHERE` of an
//!   `UPDATE` / `DELETE` must be a conjunction of `pkey_column = value`
//!   conditions covering the whole primary key. Predicate writes ("set all
//!   OPEN tickets to DONE") arrive with the storage connector.
//! - `UPDATE` must `SET` every non-pkey column (the engine's full-row-image
//!   constraint, see [`crate::model::UpdateQuery`]); setting a pkey column
//!   is refused (that is a delete + insert, not an update).
//! - `INSERT` is single-row and must provide every pkey column; other
//!   columns may be omitted and then behave like `NULL` under predicates.
//! - Write values are checked against the catalog: each literal is coerced
//!   to its column's declared [`ValueType`] (numeric literals are typed by
//!   spelling, so `1.0` into an `Int` column becomes `Int(1)`); mismatches
//!   and `NULL` primary-key values are rejected. Row identity is
//!   variant-exact, so an uncoerced `Float(1.0)` key would silently miss
//!   the row stored under `Int(1)`.
//! - A `SELECT` without `ORDER BY` defaults to the first declared pkey
//!   column ascending, and without `LIMIT` to `u32::MAX` — the model makes
//!   both mandatory (see "Design notes" in the README).
//! - `(` / `[` nesting is capped at [`MAX_NESTING_DEPTH`] levels so
//!   pathological input returns an error instead of overflowing the stack.

use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::model::{
    ColumnName, ComparisonOperator, Condition, DataFrameKey, DataFrameRow, DbTable, DeleteQuery,
    InsertQuery, Order, OrderBy, SingleTableReadQuery, UpdateQuery, Value, ValueType, Where,
    WriteQuery,
};

/// Hard cap on `(` / `[` nesting depth. The parser descends recursively, so
/// without a bound a client-supplied string with thousands of nested parens
/// would overflow the stack and abort the whole process.
pub const MAX_NESTING_DEPTH: usize = 128;

/// The authoritative table schemas live in the model; re-exported here
/// because the parser is their primary consumer.
pub use crate::model::Catalog;

/// A successfully parsed statement — either side of the read/write split.
#[derive(Debug, Clone, PartialEq)]
pub enum ParsedQuery {
    Read(SingleTableReadQuery),
    Write(WriteQuery),
}

/// Parse one statement of either kind.
pub fn parse(sql: &str, catalog: &Catalog) -> Result<ParsedQuery, ParseError> {
    let mut parser = Parser {
        tokens: lex(sql)?,
        pos: 0,
        depth: 0,
    };
    let parsed = parser.query(catalog)?;
    if !matches!(parser.peek(), Tok::Eof) {
        return parser.err(format!("unexpected trailing input: {}", parser.describe()));
    }
    Ok(parsed)
}

/// Parse a statement that must be a `SELECT`.
pub fn parse_read(sql: &str, catalog: &Catalog) -> Result<SingleTableReadQuery, ParseError> {
    match parse(sql, catalog)? {
        ParsedQuery::Read(read) => Ok(read),
        ParsedQuery::Write(_) => Err(ParseError {
            message: "expected a SELECT, found a write statement".into(),
            position: 0,
        }),
    }
}

/// Parse a statement that must be an `INSERT` / `UPDATE` / `DELETE`.
pub fn parse_write(sql: &str, catalog: &Catalog) -> Result<WriteQuery, ParseError> {
    match parse(sql, catalog)? {
        ParsedQuery::Write(write) => Ok(write),
        ParsedQuery::Read(_) => Err(ParseError {
            message: "expected a write statement, found a SELECT".into(),
            position: 0,
        }),
    }
}

/// A lex or parse failure, positioned for caret rendering by [`point_at`].
///
/// - `message`: what went wrong, phrased for the human who typed the query.
/// - `position`: byte offset into the input where the offending token starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub position: usize,
}

impl fmt::Display for ParseError {
    /// Renders as `message (at byte N)`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at byte {})", self.message, self.position)
    }
}

impl std::error::Error for ParseError {}

/// The error, the input, and a caret under the token that caused it —
/// the rendering to show a human who typed the query.
pub fn point_at(source: &str, error: &ParseError) -> String {
    let position = error.position.min(source.len());
    let column = source[..position].chars().count();
    format!(
        "error: {}\n  {}\n  {}^",
        error.message,
        source,
        " ".repeat(column + 2)
    )
}

/// One lexed token.
///
/// - `Word`: identifiers and keywords alike; keywords match case-insensitively.
/// - `Str`: the unquoted content of a single-quoted string literal.
/// - `Num`: raw numeric text; the parser decides int vs float.
/// - `Sym`: operators and punctuation, normalised (`<>` lexes as `!=`).
/// - `Eof`: end of input; always the final token.
#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Word(String),
    Str(String),
    Num(String),
    Sym(&'static str),
    Eof,
}

/// A token plus the byte offset where it starts, for error positions.
struct Spanned {
    tok: Tok,
    at: usize,
}

/// Tokenise `source`; the result always ends with [`Tok::Eof`].
///
/// A `.` only continues a number when a digit follows, so `1.5` lexes as
/// one number without capturing a stray dot. Inside a string literal a
/// doubled quote is an escaped one; a lone quote ends the string.
fn lex(source: &str) -> Result<Vec<Spanned>, ParseError> {
    let mut tokens = Vec::new();
    let mut chars = source.char_indices().peekable();

    while let Some(&(at, c)) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c.is_alphabetic() || c == '_' {
            let mut word = String::new();
            while let Some(&(_, c)) = chars.peek() {
                if c.is_alphanumeric() || c == '_' {
                    word.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Spanned {
                tok: Tok::Word(word),
                at,
            });
        } else if c.is_ascii_digit() {
            let mut number = String::new();
            take_digits(&mut chars, &mut number);
            if peek_at_is(&chars, 0, '.') && next_is_digit(&chars, 1) {
                number.push('.');
                chars.next();
                take_digits(&mut chars, &mut number);
            }
            tokens.push(Spanned {
                tok: Tok::Num(number),
                at,
            });
        } else if c == '\'' {
            chars.next();
            let mut text = String::new();
            loop {
                match chars.next() {
                    Some((_, '\'')) => {
                        if peek_at_is(&chars, 0, '\'') {
                            text.push('\'');
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    Some((_, c)) => text.push(c),
                    None => {
                        return Err(ParseError {
                            message: "unterminated string literal".into(),
                            position: at,
                        });
                    }
                }
            }
            tokens.push(Spanned {
                tok: Tok::Str(text),
                at,
            });
        } else {
            chars.next();
            let sym: &'static str = match c {
                '(' => "(",
                ')' => ")",
                '[' => "[",
                ']' => "]",
                ',' => ",",
                '*' => "*",
                '-' => "-",
                '=' => "=",
                '>' => {
                    if peek_at_is(&chars, 0, '=') {
                        chars.next();
                        ">="
                    } else {
                        ">"
                    }
                }
                '<' => {
                    if peek_at_is(&chars, 0, '=') {
                        chars.next();
                        "<="
                    } else if peek_at_is(&chars, 0, '>') {
                        chars.next();
                        "!="
                    } else {
                        "<"
                    }
                }
                '!' => {
                    if peek_at_is(&chars, 0, '=') {
                        chars.next();
                        "!="
                    } else {
                        return Err(ParseError {
                            message: "expected `=` after `!`".into(),
                            position: at,
                        });
                    }
                }
                other => {
                    return Err(ParseError {
                        message: format!("unexpected character `{other}`"),
                        position: at,
                    });
                }
            };
            tokens.push(Spanned {
                tok: Tok::Sym(sym),
                at,
            });
        }
    }

    tokens.push(Spanned {
        tok: Tok::Eof,
        at: source.len(),
    });
    Ok(tokens)
}

/// The lexer's cursor: a peekable char-indices iterator over the input.
type Chars<'a> = std::iter::Peekable<std::str::CharIndices<'a>>;

/// Append the maximal run of ASCII digits at the cursor to `out`.
fn take_digits(chars: &mut Chars<'_>, out: &mut String) {
    while let Some(&(_, c)) = chars.peek() {
        if c.is_ascii_digit() {
            out.push(c);
            chars.next();
        } else {
            break;
        }
    }
}

/// Whether the character `ahead` positions past the cursor is `want`.
fn peek_at_is(chars: &Chars<'_>, ahead: usize, want: char) -> bool {
    chars.clone().nth(ahead).is_some_and(|(_, c)| c == want)
}

/// Whether the character `ahead` positions past the cursor is an ASCII digit.
fn next_is_digit(chars: &Chars<'_>, ahead: usize) -> bool {
    chars
        .clone()
        .nth(ahead)
        .is_some_and(|(_, c)| c.is_ascii_digit())
}

/// Recursive-descent parser over the lexed token stream.
///
/// - `tokens`: the lexed input, always ending with [`Tok::Eof`].
/// - `pos`: index of the current token.
/// - `depth`: current `(` / `[` nesting depth, bounded by [`MAX_NESTING_DEPTH`].
struct Parser {
    tokens: Vec<Spanned>,
    pos: usize,
    depth: usize,
}

impl Parser {
    /// The current token.
    fn peek(&self) -> &Tok {
        &self.tokens[self.pos].tok
    }

    /// Enter one nesting level; errors past [`MAX_NESTING_DEPTH`]. Callers
    /// decrement `self.depth` on the success path; error paths abandon the
    /// parse entirely, so an unwound counter is irrelevant there.
    fn descend(&mut self) -> Result<(), ParseError> {
        self.depth += 1;
        if self.depth > MAX_NESTING_DEPTH {
            self.err(format!(
                "nesting deeper than {MAX_NESTING_DEPTH} levels is not supported"
            ))
        } else {
            Ok(())
        }
    }

    /// Byte offset of the current token, for error positions.
    fn at(&self) -> usize {
        self.tokens[self.pos].at
    }

    /// Advance one token, never past the trailing [`Tok::Eof`].
    fn bump(&mut self) {
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
    }

    /// Build an `Err` positioned at the current token.
    fn err<T>(&self, message: impl Into<String>) -> Result<T, ParseError> {
        Err(ParseError {
            message: message.into(),
            position: self.at(),
        })
    }

    /// Human-readable rendering of the current token for error messages.
    fn describe(&self) -> String {
        match self.peek() {
            Tok::Word(word) => format!("`{word}`"),
            Tok::Str(text) => format!("string `{text}`"),
            Tok::Num(number) => format!("number `{number}`"),
            Tok::Sym(symbol) => format!("`{symbol}`"),
            Tok::Eof => "end of input".into(),
        }
    }

    /// Whether the current token is the keyword `word` (case-insensitive).
    fn is_word(&self, word: &str) -> bool {
        matches!(self.peek(), Tok::Word(found) if found.eq_ignore_ascii_case(word))
    }

    /// Consume the keyword `word` if it is current; reports whether it did.
    fn eat_word(&mut self, word: &str) -> bool {
        let found = self.is_word(word);
        if found {
            self.bump();
        }
        found
    }

    /// Require and consume the keyword `word`.
    fn expect_word(&mut self, word: &str) -> Result<(), ParseError> {
        if self.eat_word(word) {
            Ok(())
        } else {
            self.err(format!("expected `{word}`, found {}", self.describe()))
        }
    }

    /// Whether the current token is the symbol `symbol`.
    fn is_sym(&self, symbol: &str) -> bool {
        matches!(self.peek(), Tok::Sym(found) if *found == symbol)
    }

    /// Consume the symbol `symbol` if it is current; reports whether it did.
    fn eat_sym(&mut self, symbol: &str) -> bool {
        let found = self.is_sym(symbol);
        if found {
            self.bump();
        }
        found
    }

    /// Require and consume the symbol `symbol`.
    fn expect_sym(&mut self, symbol: &str) -> Result<(), ParseError> {
        if self.eat_sym(symbol) {
            Ok(())
        } else {
            self.err(format!("expected `{symbol}`, found {}", self.describe()))
        }
    }

    /// A bare-word identifier.
    fn ident(&mut self) -> Result<String, ParseError> {
        match self.peek().clone() {
            Tok::Word(word) => {
                self.bump();
                Ok(word)
            }
            _ => self.err(format!("expected a name, found {}", self.describe())),
        }
    }

    /// A table name, resolved against the catalog.
    fn table<'c>(&mut self, catalog: &'c Catalog) -> Result<&'c DbTable, ParseError> {
        let at = self.at();
        let name = self.ident()?;
        catalog.table(&name).ok_or(ParseError {
            message: format!("unknown table `{name}`"),
            position: at,
        })
    }

    /// A column name, validated to exist on `table`.
    fn column_name(&mut self, table: &DbTable) -> Result<ColumnName, ParseError> {
        let at = self.at();
        let name = self.ident()?;
        if table.column(&name).is_some() {
            Ok(ColumnName::from(name))
        } else {
            Err(ParseError {
                message: format!("unknown column `{}` on table `{}`", name, table.name),
                position: at,
            })
        }
    }

    /// Dispatch on the leading keyword to a read or a write.
    fn query(&mut self, catalog: &Catalog) -> Result<ParsedQuery, ParseError> {
        if self.is_word("SELECT") {
            Ok(ParsedQuery::Read(self.read(catalog)?))
        } else if self.is_word("INSERT") || self.is_word("UPDATE") || self.is_word("DELETE") {
            Ok(ParsedQuery::Write(self.write(catalog)?))
        } else {
            self.err(format!(
                "expected SELECT, INSERT, UPDATE or DELETE, found {}",
                self.describe()
            ))
        }
    }

    /// `SELECT * FROM …` with optional WHERE / ORDER BY / LIMIT.
    ///
    /// A missing WHERE subscribes to the whole table (the vacuously true
    /// `AND(vec![])`). A missing ORDER BY defaults via [`default_order`],
    /// and a missing LIMIT becomes `u32::MAX` — the model makes `limit`
    /// mandatory, so absent means "no bound".
    fn read(&mut self, catalog: &Catalog) -> Result<SingleTableReadQuery, ParseError> {
        self.expect_word("SELECT")?;
        self.expect_sym("*")?;
        self.expect_word("FROM")?;
        let table = self.table(catalog)?;

        if self.is_word("LEFT") || self.is_word("JOIN") {
            return self.err("joins are not supported yet — single-table queries only");
        }

        let filter = if self.eat_word("WHERE") {
            self.filter(table)?
        } else {
            Where::AND(Vec::new())
        };

        let order_by = if self.eat_word("ORDER") {
            self.expect_word("BY")?;
            let mut clauses = Vec::new();
            loop {
                let column = self.column_name(table)?;
                let direction = if self.eat_word("DESC") {
                    Order::DESC
                } else {
                    self.eat_word("ASC");
                    Order::ASC
                };
                clauses.push(OrderBy::new(column, direction));
                if !self.eat_sym(",") {
                    break;
                }
            }
            clauses
        } else {
            vec![default_order(table, self.at())?]
        };

        let limit = if self.eat_word("LIMIT") {
            match self.peek().clone() {
                Tok::Num(number) => {
                    let at = self.at();
                    self.bump();
                    number.parse::<u32>().map_err(|_| ParseError {
                        message: format!("`{number}` is not a valid limit"),
                        position: at,
                    })?
                }
                _ => return self.err(format!("expected a limit, found {}", self.describe())),
            }
        } else {
            u32::MAX
        };

        Ok(SingleTableReadQuery::new(
            table.name.clone(),
            filter,
            order_by,
            limit,
        ))
    }

    /// `INSERT` / `UPDATE` / `DELETE`, enforcing the v1 write restrictions.
    ///
    /// INSERT coerces each value while it still lines up with a named
    /// column; a value/column count mismatch is reported only after the
    /// whole row is read. UPDATE must SET every non-pkey column because
    /// the engine evaluates predicates against `record` as the complete
    /// new row image — a partial SET would corrupt the views.
    fn write(&mut self, catalog: &Catalog) -> Result<WriteQuery, ParseError> {
        if self.eat_word("INSERT") {
            self.expect_word("INTO")?;
            let table = self.table(catalog)?;

            self.expect_sym("(")?;
            let columns_at = self.at();
            let mut columns = vec![self.column_name(table)?];
            while self.eat_sym(",") {
                columns.push(self.column_name(table)?);
            }
            self.expect_sym(")")?;
            ensure_no_duplicates(&columns, columns_at)?;

            self.expect_word("VALUES")?;
            let row_at = self.at();
            self.expect_sym("(")?;
            let mut values = Vec::new();
            loop {
                let value_at = self.at();
                let value = self.value()?;
                values.push(match columns.get(values.len()) {
                    Some(column) => coerce_to_column_type(value, table, column, value_at)?,
                    None => value,
                });
                if !self.eat_sym(",") {
                    break;
                }
            }
            self.expect_sym(")")?;
            if self.is_sym(",") {
                return self.err("multi-row INSERT is not supported yet — one row per statement");
            }
            if values.len() != columns.len() {
                return Err(ParseError {
                    message: format!(
                        "row has {} values but {} columns were named",
                        values.len(),
                        columns.len()
                    ),
                    position: row_at,
                });
            }

            let mut data: HashMap<ColumnName, Value> = columns.into_iter().zip(values).collect();
            let pkey_value = pkey_of(table, &data);
            ensure_full_pkey(table, &pkey_value, "INSERT must provide", row_at)?;
            ensure_pkey_not_null(&pkey_value, row_at)?;
            for column in table.columns.keys() {
                data.entry(column.clone()).or_insert(Value::Null);
            }

            Ok(WriteQuery::INSERT(InsertQuery {
                table: table.name.clone(),
                pkey_value: DataFrameKey::new(pkey_value),
                record: DataFrameRow::from(data),
            }))
        } else if self.eat_word("UPDATE") {
            let table = self.table(catalog)?;
            self.expect_word("SET")?;

            let set_at = self.at();
            let mut assignments: Vec<(ColumnName, Value)> = Vec::new();
            loop {
                let column = self.column_name(table)?;
                self.expect_sym("=")?;
                let value_at = self.at();
                let value = self.value()?;
                let value = coerce_to_column_type(value, table, &column, value_at)?;
                assignments.push((column, value));
                if !self.eat_sym(",") {
                    break;
                }
            }
            ensure_no_duplicates(
                &assignments
                    .iter()
                    .map(|(column, _)| column.clone())
                    .collect::<Vec<_>>(),
                set_at,
            )?;
            for (column, _) in &assignments {
                if table.is_pkey(column.as_str()) {
                    return Err(ParseError {
                        message: format!(
                            "updating primary-key column `{column}` is not supported — \
                             that is a DELETE plus an INSERT"
                        ),
                        position: set_at,
                    });
                }
            }
            let missing: Vec<&str> = table
                .columns
                .values()
                .filter(|column| !table.is_pkey(column.name.as_str()))
                .filter(|column| !assignments.iter().any(|(name, _)| column.name == *name))
                .map(|column| column.name.as_str())
                .collect();
            if !missing.is_empty() {
                let mut missing = missing;
                missing.sort_unstable();
                return Err(ParseError {
                    message: format!(
                        "UPDATE must SET every non-pkey column until partial row images are \
                         supported (missing: {})",
                        missing.join(", ")
                    ),
                    position: set_at,
                });
            }

            let pkey_value = self.write_pkey_filter(table)?;
            let mut data: HashMap<ColumnName, Value> = assignments.into_iter().collect();
            for (column, value) in &pkey_value {
                data.insert(column.clone(), value.clone());
            }
            Ok(WriteQuery::UPDATE(UpdateQuery {
                table: table.name.clone(),
                pkey_value: DataFrameKey::new(pkey_value),
                record: DataFrameRow::from(data),
            }))
        } else {
            self.expect_word("DELETE")?;
            self.expect_word("FROM")?;
            let table = self.table(catalog)?;
            let pkey_value = self.write_pkey_filter(table)?;
            Ok(WriteQuery::DELETE(DeleteQuery {
                table: table.name.clone(),
                pkey_value: DataFrameKey::new(pkey_value),
            }))
        }
    }

    /// The mandatory `WHERE` of an UPDATE / DELETE, restricted to a
    /// conjunction of `pkey_column = value` covering the full primary key.
    fn write_pkey_filter(
        &mut self,
        table: &DbTable,
    ) -> Result<HashMap<ColumnName, Value>, ParseError> {
        self.expect_word("WHERE")?;
        let at = self.at();
        let filter = self.filter(table)?;

        let mut pairs = Vec::new();
        collect_pkey_equalities(&filter, &mut pairs).map_err(|()| ParseError {
            message: "writes must address one row by primary key: WHERE must be a \
                      conjunction of `pkey_column = value` conditions"
                .into(),
            position: at,
        })?;

        let mut pkey_value = HashMap::new();
        for (column, value) in pairs {
            if !table.is_pkey(column.as_str()) {
                return Err(ParseError {
                    message: format!(
                        "`{column}` is not a primary-key column of `{}` — writes may only \
                         filter on the primary key yet",
                        table.name
                    ),
                    position: at,
                });
            }
            let value = coerce_to_column_type(value, table, &column, at)?;
            if pkey_value.insert(column.clone(), value).is_some() {
                return Err(ParseError {
                    message: format!("primary-key column `{column}` appears twice in WHERE"),
                    position: at,
                });
            }
        }
        ensure_full_pkey(table, &pkey_value, "WHERE must pin", at)?;
        ensure_pkey_not_null(&pkey_value, at)?;
        Ok(pkey_value)
    }

    /// `OR` is the loosest binder, so it sits at the top of the chain.
    fn filter(&mut self, table: &DbTable) -> Result<Where, ParseError> {
        let mut parts = vec![self.conjunct(table)?];
        while self.eat_word("OR") {
            parts.push(self.conjunct(table)?);
        }
        Ok(collapse(parts, Where::OR))
    }

    /// `AND` chain of primaries; binds tighter than `OR`.
    fn conjunct(&mut self, table: &DbTable) -> Result<Where, ParseError> {
        let mut parts = vec![self.primary(table)?];
        while self.eat_word("AND") {
            parts.push(self.primary(table)?);
        }
        Ok(collapse(parts, Where::AND))
    }

    /// A parenthesised filter, a `TRUE` / `FALSE` literal, or one condition.
    ///
    /// `TRUE` / `FALSE` parse to the identities: an empty `AND` is true, an
    /// empty `OR` is false.
    fn primary(&mut self, table: &DbTable) -> Result<Where, ParseError> {
        if self.eat_sym("(") {
            self.descend()?;
            let filter = self.filter(table)?;
            self.expect_sym(")")?;
            self.depth -= 1;
            return Ok(filter);
        }
        if self.eat_word("TRUE") {
            return Ok(Where::AND(Vec::new()));
        }
        if self.eat_word("FALSE") {
            return Ok(Where::OR(Vec::new()));
        }

        let column = self.column_name(table)?;
        if self.eat_word("IS") {
            let comparison_operator = if self.eat_word("NOT") {
                ComparisonOperator::IS_NOT
            } else {
                ComparisonOperator::IS
            };
            if !self.eat_word("NULL") {
                return self.err(format!(
                    "expected NULL after IS [NOT], found {}",
                    self.describe()
                ));
            }
            return Ok(Where::Condition(Condition {
                column,
                comparison_operator,
                value: Value::Null,
            }));
        }
        let comparison_operator = if self.eat_sym("=") {
            ComparisonOperator::EQ
        } else if self.eat_sym("!=") {
            ComparisonOperator::NEQ
        } else if self.eat_sym(">=") {
            ComparisonOperator::GTE
        } else if self.eat_sym(">") {
            ComparisonOperator::GT
        } else if self.eat_sym("<=") {
            ComparisonOperator::LTE
        } else if self.eat_sym("<") {
            ComparisonOperator::LT
        } else if self.eat_word("IN") {
            return Ok(Where::Condition(Condition {
                column,
                comparison_operator: ComparisonOperator::IN,
                value: self.value_list()?,
            }));
        } else if self.eat_word("NOT") {
            self.expect_word("IN")?;
            return Ok(Where::Condition(Condition {
                column,
                comparison_operator: ComparisonOperator::NOT_IN,
                value: self.value_list()?,
            }));
        } else {
            return self.err(format!(
                "expected a comparison operator, [NOT] IN or IS [NOT] NULL after a column, found {}",
                self.describe()
            ));
        };
        Ok(Where::Condition(Condition {
            column,
            comparison_operator,
            value: self.value()?,
        }))
    }

    /// The parenthesised value list of `IN` / `NOT IN`.
    fn value_list(&mut self) -> Result<Value, ParseError> {
        self.expect_sym("(")?;
        let mut items = Vec::new();
        if !self.is_sym(")") {
            items.push(self.value()?);
            while self.eat_sym(",") {
                items.push(self.value()?);
            }
        }
        self.expect_sym(")")?;
        Ok(Value::List(items))
    }

    /// One literal: `NULL`, `TRUE` / `FALSE`, a (possibly `-`-negated)
    /// number, a single-quoted string, or a `[`-bracketed list.
    fn value(&mut self) -> Result<Value, ParseError> {
        let at = self.at();

        if self.eat_sym("[") {
            self.descend()?;
            let mut items = Vec::new();
            if !self.is_sym("]") {
                items.push(self.value()?);
                while self.eat_sym(",") {
                    items.push(self.value()?);
                }
            }
            self.expect_sym("]")?;
            self.depth -= 1;
            return Ok(Value::List(items));
        }

        let negative = self.eat_sym("-");
        match self.peek().clone() {
            Tok::Num(number) => {
                self.bump();
                let text = if negative {
                    format!("-{number}")
                } else {
                    number
                };
                let parsed = if text.contains('.') {
                    text.parse::<f64>().map(Value::Float).ok()
                } else {
                    text.parse::<i64>().map(Value::Int).ok()
                };
                parsed.ok_or(ParseError {
                    message: format!("`{text}` is out of range"),
                    position: at,
                })
            }
            _ if negative => self.err(format!(
                "expected a number after `-`, found {}",
                self.describe()
            )),
            Tok::Str(text) => {
                self.bump();
                Ok(Value::String(text))
            }
            Tok::Word(word) if word.eq_ignore_ascii_case("NULL") => {
                self.bump();
                Ok(Value::Null)
            }
            Tok::Word(word) if word.eq_ignore_ascii_case("TRUE") => {
                self.bump();
                Ok(Value::Bool(true))
            }
            Tok::Word(word) if word.eq_ignore_ascii_case("FALSE") => {
                self.bump();
                Ok(Value::Bool(false))
            }
            _ => self.err(format!("expected a value, found {}", self.describe())),
        }
    }
}

/// Unwrap a lone part; otherwise group `parts` under `group`.
fn collapse(mut parts: Vec<Where>, group: fn(Vec<Where>) -> Where) -> Where {
    if parts.len() == 1 {
        parts.pop().expect("just checked the length")
    } else {
        group(parts)
    }
}

/// The implicit ORDER BY: the first declared pkey column, ascending. A
/// (degenerate) pkey-less table falls back to the alphabetically first
/// column name for determinism; a column-less table is an error.
fn default_order(table: &DbTable, at: usize) -> Result<OrderBy, ParseError> {
    let column = table
        .pkey_columns()
        .next()
        .or_else(|| table.columns.values().min_by_key(|column| &column.name))
        .ok_or(ParseError {
            message: format!(
                "table `{}` has no columns to default ORDER BY to — specify ORDER BY",
                table.name
            ),
            position: at,
        })?;
    Ok(OrderBy::new(column.name.clone(), Order::ASC))
}

/// The primary-key values of one full row image, by pkey column name.
fn pkey_of(table: &DbTable, data: &HashMap<ColumnName, Value>) -> HashMap<ColumnName, Value> {
    data.iter()
        .filter(|(column, _)| table.is_pkey(column.as_str()))
        .map(|(column, value)| (column.clone(), value.clone()))
        .collect()
}

/// Error unless `pkey_value` covers every primary-key column of `table`;
/// `verb` prefixes the message ("INSERT must provide" / "WHERE must pin").
fn ensure_full_pkey(
    table: &DbTable,
    pkey_value: &HashMap<ColumnName, Value>,
    verb: &str,
    at: usize,
) -> Result<(), ParseError> {
    let mut missing: Vec<&str> = table
        .pkey
        .iter()
        .filter(|pk| !pkey_value.contains_key(pk.as_str()))
        .map(ColumnName::as_str)
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        missing.sort_unstable();
        Err(ParseError {
            message: format!(
                "{verb} every primary-key column of `{}` (missing: {})",
                table.name,
                missing.join(", ")
            ),
            position: at,
        })
    }
}

/// Reject `NULL` primary-key values — a NULL-keyed row could never be
/// matched or addressed again.
fn ensure_pkey_not_null(
    pkey_value: &HashMap<ColumnName, Value>,
    at: usize,
) -> Result<(), ParseError> {
    let mut null_columns: Vec<&str> = pkey_value
        .iter()
        .filter(|(_, value)| value.is_null())
        .map(|(column, _)| column.as_str())
        .collect();
    if null_columns.is_empty() {
        Ok(())
    } else {
        null_columns.sort_unstable();
        Err(ParseError {
            message: format!(
                "primary-key column(s) {} cannot be NULL — a NULL-keyed row could never \
                 be matched or addressed again",
                null_columns.join(", ")
            ),
            position: at,
        })
    }
}

/// Fit a parsed write literal to `column`'s declared type. Numeric literals
/// are typed by spelling (`1` lexes as Int, `1.0` as Float), so Int/Float
/// cross-spellings coerce; every other mismatch is an error — storing it
/// would create a row whose identity and predicate behavior disagree with
/// the column (`Float(1.0)` is not the frame key `Int(1)`).
fn coerce_to_column_type(
    value: Value,
    table: &DbTable,
    column: &ColumnName,
    at: usize,
) -> Result<Value, ParseError> {
    let declared = table
        .column(column.as_str())
        .map(|candidate| &candidate.r#type)
        .expect("column names are validated against the table before coercion");
    coerce_to_type(value, declared, column.as_str(), at)
}

/// Recursive worker for [`coerce_to_column_type`], matching a value (and
/// list elements) against a declared [`ValueType`]. `NULL` fits any column
/// here — primary-key columns reject it separately via
/// [`ensure_pkey_not_null`].
fn coerce_to_type(
    value: Value,
    declared: &ValueType,
    column: &str,
    at: usize,
) -> Result<Value, ParseError> {
    Ok(match (value, declared) {
        (Value::Null, _) => Value::Null,
        (value @ Value::Int(_), ValueType::Int) => value,
        (value @ Value::Float(_), ValueType::Float) => value,
        (value @ Value::String(_), ValueType::String) => value,
        (value @ Value::Bool(_), ValueType::Bool) => value,
        (value @ Value::Int(_), ValueType::Timestamp) => value,
        (value @ Value::String(_), ValueType::Json) => value,
        (Value::Int(int), ValueType::Float) => Value::Float(int as f64),
        (Value::Float(float), ValueType::Int)
            if float.fract() == 0.0 && ((i64::MIN as f64)..(i64::MAX as f64)).contains(&float) =>
        {
            Value::Int(float as i64)
        }
        (Value::List(items), ValueType::List(inner)) => Value::List(
            items
                .into_iter()
                .map(|item| coerce_to_type(item, inner, column, at))
                .collect::<Result<_, _>>()?,
        ),
        (Value::String(_), ValueType::Date | ValueType::Datetime) => {
            return Err(ParseError {
                message: format!(
                    "column `{column}` is declared {declared:?} — date/datetime literals \
                     are not supported yet"
                ),
                position: at,
            });
        }
        (value, _) => {
            return Err(ParseError {
                message: format!(
                    "column `{column}` is declared {declared:?} but the value is {value:?}"
                ),
                position: at,
            });
        }
    })
}

/// Error if any column name appears more than once.
fn ensure_no_duplicates(columns: &[ColumnName], at: usize) -> Result<(), ParseError> {
    let mut seen = HashSet::new();
    for column in columns {
        if !seen.insert(column) {
            return Err(ParseError {
                message: format!("column `{column}` appears twice"),
                position: at,
            });
        }
    }
    Ok(())
}

/// Flatten a filter into `column = value` pairs; `Err(())` if it contains
/// anything other than a conjunction of equality conditions.
fn collect_pkey_equalities(filter: &Where, out: &mut Vec<(ColumnName, Value)>) -> Result<(), ()> {
    match filter {
        Where::Condition(condition) => {
            if condition.comparison_operator == ComparisonOperator::EQ {
                out.push((condition.column.clone(), condition.value.clone()));
                Ok(())
            } else {
                Err(())
            }
        }
        Where::AND(children) => {
            for child in children {
                collect_pkey_equalities(child, out)?;
            }
            Ok(())
        }
        Where::OR(_) => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, ValueType};

    /// A one-table catalog (`tickets`, pkey `id`) shared by most tests.
    fn catalog() -> Catalog {
        Catalog::new(vec![DbTable::new(
            "tickets",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("status", ValueType::String),
                DbColumn::new("priority", ValueType::String),
                DbColumn::new("points", ValueType::Int),
            ],
        )])
    }

    /// Parse `sql` as a read against the shared catalog, panicking on error.
    fn read(sql: &str) -> SingleTableReadQuery {
        parse_read(sql, &catalog()).expect("should parse")
    }

    /// Parse `sql` as a write against the shared catalog, panicking on error.
    fn write(sql: &str) -> WriteQuery {
        parse_write(sql, &catalog()).expect("should parse")
    }

    /// The error from parsing `sql` as a read, panicking on success.
    fn read_err(sql: &str) -> ParseError {
        parse_read(sql, &catalog()).expect_err("should fail")
    }

    /// The error from parsing `sql` as a write, panicking on success.
    fn write_err(sql: &str) -> ParseError {
        parse_write(sql, &catalog()).expect_err("should fail")
    }

    /// A SELECT with WHERE, ORDER BY and LIMIT fills every [`SingleTableReadQuery`] field.
    #[test]
    fn select_with_all_clauses() {
        let q = read(
            "SELECT * FROM tickets WHERE status = 'OPEN' AND points >= 8 \
             ORDER BY points DESC LIMIT 10",
        );
        assert_eq!(q.table, "tickets");
        assert_eq!(
            q.filter,
            Where::AND(vec![
                Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                Where::condition("points", ComparisonOperator::GTE, 8),
            ])
        );
        assert_eq!(q.order_by, vec![OrderBy::new("points", Order::DESC)]);
        assert_eq!(q.limit, 10);
    }

    /// Several `ORDER BY` columns parse in order, each with its own
    /// direction, `ASC` the default.
    #[test]
    fn parses_compound_order() {
        let q = read("SELECT * FROM tickets ORDER BY points DESC, status, id ASC LIMIT 3");
        assert_eq!(
            q.order_by,
            vec![
                OrderBy::new("points", Order::DESC),
                OrderBy::new("status", Order::ASC),
                OrderBy::new("id", Order::ASC),
            ]
        );
    }

    /// A bare SELECT defaults to a vacuous filter, pkey-ascending order,
    /// and an unbounded limit.
    #[test]
    fn select_defaults_no_filter_pkey_order_unbounded_limit() {
        let q = read("SELECT * FROM tickets");
        assert_eq!(q.filter, Where::AND(vec![]));
        assert_eq!(q.order_by, vec![OrderBy::new("id", Order::ASC)]);
        assert_eq!(q.limit, u32::MAX);
    }

    /// Pkey declaration order (`ts`, `actor`) picks the default ORDER BY —
    /// not column order, not alphabetical order.
    #[test]
    fn default_order_uses_first_declared_pkey_column() {
        let catalog = Catalog::new(vec![DbTable::new(
            "events",
            ["ts", "actor"],
            vec![
                DbColumn::new("actor", ValueType::String),
                DbColumn::new("ts", ValueType::Int),
            ],
        )]);
        let q = parse_read("SELECT * FROM events", &catalog).expect("should parse");
        assert_eq!(q.order_by[0].column, "ts");
    }

    /// `AND` groups before `OR`, and parentheses override that precedence.
    #[test]
    fn and_binds_tighter_than_or_and_parens_override() {
        let q = read("SELECT * FROM tickets WHERE status = 'a' AND points > 1 OR status = 'b'");
        assert!(matches!(&q.filter, Where::OR(parts) if parts.len() == 2));

        let q = read("SELECT * FROM tickets WHERE status = 'a' AND (points > 1 OR status = 'b')");
        let Where::AND(parts) = &q.filter else {
            panic!("expected a top-level AND");
        };
        assert!(matches!(parts.as_slice(), [_, Where::OR(_)]));
    }

    /// `IN` / `NOT IN` parse to list conditions, and `<>` is the same
    /// operator as `!=`.
    #[test]
    fn in_not_in_and_operator_spellings() {
        let q = read("SELECT * FROM tickets WHERE priority IN ('HIGH', 'URGENT')");
        assert_eq!(
            q.filter,
            Where::condition(
                "priority",
                ComparisonOperator::IN,
                Value::List(vec!["HIGH".into(), "URGENT".into()])
            )
        );

        let q = read("SELECT * FROM tickets WHERE priority NOT IN ('LOW')");
        assert!(matches!(
            &q.filter,
            Where::Condition(c) if c.comparison_operator == ComparisonOperator::NOT_IN
        ));

        assert_eq!(
            read("SELECT * FROM tickets WHERE points <> 1").filter,
            read("SELECT * FROM tickets WHERE points != 1").filter,
        );
    }

    /// `IS [NOT] NULL` parses to the null tests with a `NULL` operand, in
    /// any case; any other operand after `IS` is refused.
    #[test]
    fn parses_null_tests() {
        assert_eq!(
            read("SELECT * FROM tickets WHERE status IS NULL").filter,
            Where::is_null("status")
        );
        assert_eq!(
            read("SELECT * FROM tickets WHERE status is not null").filter,
            Where::is_not_null("status")
        );
        let error = parse_read("SELECT * FROM tickets WHERE points IS 3", &catalog())
            .expect_err("IS takes NULL only");
        assert!(error.message.contains("expected NULL after IS"), "{error}");
    }

    /// An `INSERT` naming only some columns carries the rest as `NULL`:
    /// every image has every column.
    #[test]
    fn insert_fills_omitted_columns_with_null() {
        let write = parse_write(
            "INSERT INTO tickets (id, status) VALUES (1, 'OPEN')",
            &catalog(),
        )
        .unwrap();
        let image = write.new_row_image().unwrap();
        assert_eq!(image.data["status"], Value::from("OPEN"));
        assert_eq!(image.data["points"], Value::Null);
        assert_eq!(
            image.data.len(),
            catalog().table("tickets").unwrap().columns.len()
        );
    }

    /// `TRUE` / `FALSE` filters parse to the vacuous AND / OR, and keywords
    /// match in any case.
    #[test]
    fn true_false_filters_and_keyword_case() {
        assert_eq!(
            read("SELECT * FROM tickets WHERE TRUE").filter,
            Where::AND(vec![])
        );
        assert_eq!(
            read("SELECT * FROM tickets WHERE FALSE").filter,
            Where::OR(vec![])
        );
        assert_eq!(
            read("select * from tickets where status = 'x' limit 5"),
            read("SELECT * FROM tickets WHERE status = 'x' LIMIT 5"),
        );
    }

    /// Literals carry their spelled types: negative ints, floats, `NULL`,
    /// and `''`-escaped strings.
    #[test]
    fn values_parse_with_types() {
        let q = read("SELECT * FROM tickets WHERE points = -3");
        assert!(matches!(&q.filter, Where::Condition(c) if c.value == Value::Int(-3)));
        let q = read("SELECT * FROM tickets WHERE points > 1.5");
        assert!(matches!(&q.filter, Where::Condition(c) if c.value == Value::Float(1.5)));
        let q = read("SELECT * FROM tickets WHERE status = NULL");
        assert!(matches!(&q.filter, Where::Condition(c) if c.value == Value::Null));
        let q = read("SELECT * FROM tickets WHERE status = 'it''s'");
        assert!(
            matches!(&q.filter, Where::Condition(c) if c.value == Value::String("it's".into()))
        );
    }

    /// INSERT extracts the pkey identity into `pkey_value` and carries the
    /// complete row image — pkey columns included — in `record`.
    #[test]
    fn insert_extracts_pkey_and_keeps_the_full_image() {
        let WriteQuery::INSERT(insert) =
            write("INSERT INTO tickets (id, status, points) VALUES (7, 'OPEN', 3)")
        else {
            panic!("expected an INSERT");
        };
        assert_eq!(insert.pkey_value.pkey_value["id"], Value::Int(7));
        assert_eq!(insert.record.data["id"], Value::Int(7));
        assert_eq!(insert.record.data["status"], Value::String("OPEN".into()));
        assert_eq!(insert.record.data["points"], Value::Int(3));
    }

    /// UPDATE carries the complete new row image (WHERE's pkey overlaid
    /// onto the SET columns), addressed by the pkey.
    #[test]
    fn update_builds_full_row_image_addressed_by_pkey() {
        let WriteQuery::UPDATE(update) =
            write("UPDATE tickets SET status = 'DONE', priority = 'LOW', points = 3 WHERE id = 7")
        else {
            panic!("expected an UPDATE");
        };
        assert_eq!(update.pkey_value.pkey_value["id"], Value::Int(7));
        assert_eq!(update.record.data.len(), 4);
        assert_eq!(update.record.data["id"], Value::Int(7));
    }

    /// DELETE resolves its WHERE to the primary-key value.
    #[test]
    fn delete_is_pkey_addressed() {
        let WriteQuery::DELETE(delete) = write("DELETE FROM tickets WHERE id = 7") else {
            panic!("expected a DELETE");
        };
        assert_eq!(delete.pkey_value.pkey_value["id"], Value::Int(7));
    }

    /// Each v1 restriction is refused with its documented error message.
    #[test]
    fn v1_restrictions_are_rejected_loudly() {
        let cases = [
            (
                "SELECT * FROM tickets LEFT JOIN tickets",
                "joins are not supported",
            ),
            ("SELECT * FROM nope", "unknown table"),
            ("SELECT * FROM tickets WHERE ghost = 1", "unknown column"),
            (
                "INSERT INTO tickets (status) VALUES ('x')",
                "every primary-key column",
            ),
            (
                "INSERT INTO tickets (id, status) VALUES (1, 'x'), (2, 'y')",
                "multi-row INSERT",
            ),
            (
                "INSERT INTO tickets (id, id) VALUES (1, 2)",
                "appears twice",
            ),
            (
                "UPDATE tickets SET status = 'x' WHERE id = 1",
                "must SET every non-pkey column",
            ),
            (
                "UPDATE tickets SET id = 2, status = 'x', priority = 'y', points = 1 WHERE id = 1",
                "updating primary-key column",
            ),
            (
                "UPDATE tickets SET status = 'x', priority = 'y', points = 1 WHERE status = 'x'",
                "not a primary-key column",
            ),
            (
                "UPDATE tickets SET status = 'x', priority = 'y', points = 1 WHERE id > 1",
                "conjunction of `pkey_column = value`",
            ),
            ("DELETE FROM tickets WHERE id = 1 OR id = 2", "conjunction"),
            ("DELETE FROM tickets", "expected `WHERE`"),
        ];
        for (sql, expected) in cases {
            let error = parse(sql, &catalog()).expect_err(sql);
            assert!(
                error.message.contains(expected),
                "for {sql:?} expected {expected:?} in {:?}",
                error.message
            );
        }
    }

    /// Cross-spelled numerics coerce: `1.0` spelled as a float narrows into
    /// an Int pkey column, and an Int literal into a Float column widens.
    #[test]
    fn write_values_coerce_to_declared_column_types() {
        let WriteQuery::INSERT(insert) =
            write("INSERT INTO tickets (id, status) VALUES (1.0, 'OPEN')")
        else {
            panic!("expected an INSERT");
        };
        assert_eq!(insert.pkey_value.pkey_value["id"], Value::Int(1));

        let WriteQuery::UPDATE(update) = write(
            "UPDATE tickets SET status = 'DONE', priority = 'LOW', points = 3.0 WHERE id = 7.0",
        ) else {
            panic!("expected an UPDATE");
        };
        assert_eq!(update.pkey_value.pkey_value["id"], Value::Int(7));
        assert_eq!(update.record.data["points"], Value::Int(3));

        let float_catalog = Catalog::new(vec![DbTable::new(
            "metrics",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("score", ValueType::Float),
            ],
        )]);
        let WriteQuery::INSERT(insert) = parse_write(
            "INSERT INTO metrics (id, score) VALUES (1, 2)",
            &float_catalog,
        )
        .expect("should parse") else {
            panic!("expected an INSERT");
        };
        assert_eq!(insert.record.data["score"], Value::Float(2.0));
    }

    /// 64-bit integers parse and coerce: Postgres bigint-scale ids fit,
    /// both as bare literals and float-spelled ones that round-trip
    /// exactly.
    #[test]
    fn bigint_ids_parse_and_coerce() {
        let WriteQuery::INSERT(insert) =
            write("INSERT INTO tickets (id, status) VALUES (3000000000, 'x')")
        else {
            panic!("expected an INSERT");
        };
        assert_eq!(
            insert.pkey_value.pkey_value["id"],
            Value::Int(3_000_000_000)
        );

        let WriteQuery::DELETE(delete) = write("DELETE FROM tickets WHERE id = 3000000000.0")
        else {
            panic!("expected a DELETE");
        };
        assert_eq!(
            delete.pkey_value.pkey_value["id"],
            Value::Int(3_000_000_000)
        );
    }

    /// Type mismatches and NULL pkeys are rejected — a string-spelled pkey
    /// would silently miss the Int-keyed row.
    #[test]
    fn mistyped_or_null_write_values_are_rejected() {
        let cases = [
            ("DELETE FROM tickets WHERE id = '7'", "declared Int"),
            (
                "DELETE FROM tickets WHERE id = 9223372036854775808.0",
                "declared Int",
            ),
            (
                "INSERT INTO tickets (id, points) VALUES (1, 'many')",
                "declared Int",
            ),
            (
                "INSERT INTO tickets (id, status) VALUES (1.5, 'x')",
                "declared Int",
            ),
            (
                "INSERT INTO tickets (id, status) VALUES (NULL, 'x')",
                "cannot be NULL",
            ),
            (
                "UPDATE tickets SET status = 'x', priority = 'y', points = 1 WHERE id = NULL",
                "cannot be NULL",
            ),
        ];
        for (sql, expected) in cases {
            let error = write_err(sql);
            assert!(
                error.message.contains(expected),
                "for {sql:?} expected {expected:?} in {:?}",
                error.message
            );
        }
    }

    /// Nesting past [`MAX_NESTING_DEPTH`] errors for both `(` and `[`,
    /// while reasonable nesting still parses.
    #[test]
    fn deep_nesting_errors_instead_of_overflowing_the_stack() {
        let parens = format!(
            "SELECT * FROM tickets WHERE {}status = 'x'{}",
            "(".repeat(10_000),
            ")".repeat(10_000)
        );
        let error = read_err(&parens);
        assert!(error.message.contains("nesting deeper than"));

        let brackets = format!(
            "SELECT * FROM tickets WHERE status IN ({}1{})",
            "[".repeat(10_000),
            "]".repeat(10_000)
        );
        let error = read_err(&brackets);
        assert!(error.message.contains("nesting deeper than"));

        let shallow = format!(
            "SELECT * FROM tickets WHERE {}status = 'x'{}",
            "(".repeat(20),
            ")".repeat(20)
        );
        assert!(parse_read(&shallow, &catalog()).is_ok());
    }

    /// Lexer errors report the byte position of the offending character.
    #[test]
    fn lex_errors_carry_positions() {
        let error = read_err("SELECT * FROM tickets WHERE status = 'oops");
        assert!(error.message.contains("unterminated string"));
        assert_eq!(error.position, 37);

        let error = read_err("SELECT * FROM tickets WHERE points ! 1");
        assert!(error.message.contains("expected `=` after `!`"));
    }

    /// [`parse_read`] refuses writes and [`parse_write`] refuses reads.
    #[test]
    fn wrong_kind_is_an_error() {
        assert!(
            read_err("DELETE FROM tickets WHERE id = 1")
                .message
                .contains("expected a SELECT")
        );
        assert!(
            write_err("SELECT * FROM tickets")
                .message
                .contains("expected a write statement")
        );
    }

    /// Tokens after a complete statement error at their byte position.
    #[test]
    fn trailing_input_is_rejected() {
        let error = read_err("SELECT * FROM tickets LIMIT 1 garbage");
        assert!(error.message.contains("unexpected trailing input"));
        assert_eq!(error.position, 30);
    }
}
