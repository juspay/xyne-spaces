//! A row image as the engine holds it: the table's column names once,
//! shared by every row decoded from that table, and the values in that
//! order. A row used to be a hash map per row (its own buckets, its own
//! copy of every column name), which cost about ten times the data it
//! carried; here a row is one allocation of values, and a column lookup
//! is one small map probe on the shared schema. The API is the subset of
//! a map's the engine uses, so a row still reads as a map.

use std::collections::HashMap;
use std::fmt;
use std::ops::Index;
use std::sync::Arc;

use bytes::Bytes;
use once_cell::race::OnceBox;

use super::ids::IdMap;
use super::schema::ColumnName;
use super::value::Value;

/// The columns of a table's rows, in the order their values are stored,
/// and the position of each name (under a fast hash: a column name is a
/// catalog string, looked up once per condition per row); built once per
/// table and shared. `partial` marks the schema of an image the change
/// feed left columns out of (see [`RowData::partial`]).
#[derive(Debug)]
pub struct RowSchema {
    names: Box<[ColumnName]>,
    positions: IdMap<ColumnName, u16>,
    partial: bool,
}

impl RowSchema {
    /// A schema over `names` in that order (a name that repeats keeps
    /// its first position).
    pub fn new(names: impl IntoIterator<Item = ColumnName>) -> Arc<Self> {
        Self::build(names, false)
    }

    /// [`RowSchema::new`], marked partial or not.
    fn build(names: impl IntoIterator<Item = ColumnName>, partial: bool) -> Arc<Self> {
        let names: Box<[ColumnName]> = names.into_iter().collect();
        let mut positions = IdMap::with_capacity_and_hasher(names.len(), Default::default());
        for (index, name) in names.iter().enumerate() {
            positions.entry(name.clone()).or_insert(index as u16);
        }
        Arc::new(RowSchema {
            names,
            positions,
            partial,
        })
    }

    /// The position of `column`, if the schema has it.
    pub fn position(&self, column: &str) -> Option<usize> {
        self.positions.get(column).map(|index| *index as usize)
    }

    /// The column names in storage order.
    pub fn names(&self) -> &[ColumnName] {
        &self.names
    }

    /// How many columns.
    pub fn len(&self) -> usize {
        self.names.len()
    }

    /// Whether the schema has no columns.
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
}

/// One row's values under a shared schema.
#[derive(Clone)]
pub struct RowData {
    schema: Arc<RowSchema>,
    values: Box<[Value]>,
    wire: OnceBox<Bytes>,
}

impl PartialEq for RowSchema {
    /// The same columns in the same order.
    fn eq(&self, other: &Self) -> bool {
        self.names == other.names
    }
}

impl Eq for RowSchema {}

impl RowData {
    /// A row over `schema` with `values` in the schema's order; missing
    /// trailing values are `NULL`, extra ones are dropped.
    pub fn with_schema(schema: Arc<RowSchema>, values: Vec<Value>) -> Self {
        let mut values = values;
        values.resize(schema.len(), Value::Null);
        RowData {
            schema,
            values: values.into_boxed_slice(),
            wire: OnceBox::new(),
        }
    }

    /// A row the change feed left columns out of: an update's new image
    /// in which PostgreSQL sent a large value the update did not touch as
    /// "unchanged" instead of the value. It holds every other column, over
    /// a schema of its own as [`RowData::from`] lays it out, and is marked
    /// so whoever holds it knows it is not the whole row
    /// ([`RowData::is_partial`]).
    pub fn partial(map: HashMap<ColumnName, Value>) -> Self {
        Self::laid_out(map, true)
    }

    /// Whether the row lacks columns its table has, the feed having left
    /// them out ([`RowData::partial`]); a row built on such a row's
    /// schema is partial too.
    pub fn is_partial(&self) -> bool {
        self.schema.partial
    }

    /// `map` over a schema of its own, the columns in name order, marked
    /// partial or not.
    fn laid_out(map: HashMap<ColumnName, Value>, partial: bool) -> Self {
        let mut pairs: Vec<(ColumnName, Value)> = map.into_iter().collect();
        pairs.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
        let schema = RowSchema::build(pairs.iter().map(|(column, _)| column.clone()), partial);
        RowData {
            schema,
            values: pairs.into_iter().map(|(_, value)| value).collect(),
            wire: OnceBox::new(),
        }
    }

    /// The row's schema.
    pub fn schema(&self) -> &Arc<RowSchema> {
        &self.schema
    }

    /// The value of `column`, if the row has the column.
    pub fn get<Q: AsRef<str> + ?Sized>(&self, column: &Q) -> Option<&Value> {
        self.schema
            .position(column.as_ref())
            .map(|index| &self.values[index])
    }

    /// Whether the row has `column`.
    pub fn contains_key<Q: AsRef<str> + ?Sized>(&self, column: &Q) -> bool {
        self.schema.position(column.as_ref()).is_some()
    }

    /// The columns and values, in schema order.
    pub fn iter(&self) -> impl Iterator<Item = (&ColumnName, &Value)> {
        self.schema.names.iter().zip(self.values.iter())
    }

    /// The column names, in schema order.
    pub fn keys(&self) -> impl Iterator<Item = &ColumnName> {
        self.schema.names.iter()
    }

    /// The values, in schema order.
    pub fn values(&self) -> impl Iterator<Item = &Value> {
        self.values.iter()
    }

    /// How many columns.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Whether the row has no columns.
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// The row's bytes as the transport sends it (its `rowsPatch` put),
    /// empty until the first time the row is sent. The cell is written
    /// once, by whichever thread sends the row first, and read by every
    /// later send in place of serializing the row again
    /// (`client::groups`). That is sound because nothing the bytes are
    /// made of changes while the image lives: the values are never
    /// written after the image is built (a changed row is a new image,
    /// with a cell of its own; a decoded row holds scalars, text and
    /// lists, never a [`Value::Set`], which can grow in place and only
    /// ever belongs to a query's condition), the image belongs to one
    /// table, and its layout fixes the types that table declares (a
    /// migration that adds a column lays the table's rows out again as
    /// new images; one that changes a type stops the server). Two threads
    /// that both find the cell empty write the same bytes, so it does not
    /// matter which of them fills it: the cell is a [`OnceBox`], one
    /// atomic pointer that the first `set` fills and every later one is
    /// refused, and a reader never waits.
    pub fn wire(&self) -> &OnceBox<Bytes> {
        &self.wire
    }

    /// The row as an owned map, for the few places that build a new row
    /// from an old one.
    pub fn to_map(&self) -> HashMap<ColumnName, Value> {
        self.iter()
            .map(|(column, value)| (column.clone(), value.clone()))
            .collect()
    }
}

impl From<HashMap<ColumnName, Value>> for RowData {
    /// A row over a schema of its own, the columns in name order, so two
    /// rows built from equal maps compare equal and hash alike.
    fn from(map: HashMap<ColumnName, Value>) -> Self {
        Self::laid_out(map, false)
    }
}

impl PartialEq for RowData {
    /// Equal as maps: the same columns with the same values, whatever
    /// the schemas' orders.
    fn eq(&self, other: &Self) -> bool {
        if Arc::ptr_eq(&self.schema, &other.schema) {
            return self.values == other.values;
        }
        self.len() == other.len()
            && self
                .iter()
                .all(|(column, value)| other.get(column) == Some(value))
    }
}

impl<Q: AsRef<str> + ?Sized> Index<&Q> for RowData {
    type Output = Value;

    /// The value of a column the row has.
    fn index(&self, column: &Q) -> &Value {
        self.get(column)
            .unwrap_or_else(|| panic!("no column `{}` in the row", column.as_ref()))
    }
}

impl fmt::Debug for RowData {
    /// As a map.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.iter()).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row built from a map and one built over a shared schema read
    /// the same, compare equal, and hold every column once.
    #[test]
    fn a_row_reads_as_a_map_whatever_its_schema() {
        let schema = RowSchema::new(["id", "name", "points"].map(ColumnName::from));
        let shared = RowData::with_schema(
            schema.clone(),
            vec![Value::Int(1), Value::from("a"), Value::Int(3)],
        );
        let mapped = RowData::from(HashMap::from([
            (ColumnName::from("points"), Value::Int(3)),
            (ColumnName::from("id"), Value::Int(1)),
            (ColumnName::from("name"), Value::from("a")),
        ]));
        assert_eq!(shared, mapped);
        assert_eq!(shared.get("name"), Some(&Value::from("a")));
        assert_eq!(
            shared.get(&ColumnName::from("points")),
            Some(&Value::Int(3))
        );
        assert_eq!(shared["id"], Value::Int(1));
        assert!(shared.get("missing").is_none());
        assert_eq!(shared.len(), 3);
        assert_eq!(
            mapped.keys().map(ColumnName::as_str).collect::<Vec<_>>(),
            ["id", "name", "points"]
        );
        let short = RowData::with_schema(schema, vec![Value::Int(2)]);
        assert_eq!(
            short.get("points"),
            Some(&Value::Null),
            "missing trailing values are NULL"
        );
        assert_ne!(short, shared);
    }
}
