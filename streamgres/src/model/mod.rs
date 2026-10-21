//! The data model the whole engine operates on.
//!
//! Split by concern and re-exported flat for convenient access to the full
//! vocabulary:
//!
//! - [`value`] — [`Value`] / [`ValueType`], the dynamic value representation
//! - [`schema`] — [`Catalog`] / [`DbTable`] / [`DbColumn`]: the single
//!   authoritative schema home; queries reference tables by name and
//!   resolve them in the catalog
//! - [`query`] — [`SingleTableReadQuery`] / [`WriteQuery`], the `Where`
//!   predicate tree, and the [`SubId`] handle
//! - [`frame`] — row identities, images, the [`DataFrameOperation`] delta
//!   unit, and the engine's shared [`frame::TableFrame`] materialization
//! - [`position`] — where a write, a read, or a frame row sits in the
//!   source's history: one WAL location ([`Lsn`]; [`Snapshot`] for a
//!   read's result)
//! - [`ids`] — the maps and sets keyed by the engine's own small ids,
//!   on a hasher that costs one multiply
//!
//! Structure changes here ripple through the whole engine (these types are
//! index keys in `crate::ivm`), so keep field changes deliberate and discuss
//! them in an issue first — see "Design notes" in the README.

pub mod frame;
pub mod ids;
pub mod position;
pub mod query;
pub mod row;
pub mod schema;
pub mod value;

pub use frame::{DataFrameKey, DataFrameOperation, DataFrameRow};
pub use ids::{IdMap, IdSet};
pub use position::{Lsn, Snapshot};
pub use query::{
    ComparisonOperator, Condition, DeleteQuery, Disjunct, Driver, InsertQuery, Join,
    MultiTableReadQuery, Order, OrderBy, PageRead, SingleTableReadQuery, SubId, UpdateQuery, Where,
    WriteQuery,
};
pub use row::{RowData, RowSchema};
pub use schema::{Catalog, ColumnName, DbColumn, DbTable, PutPlan, TableName};
pub use value::{SharedSet, Value, ValueType};
