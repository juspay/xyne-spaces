//! The catalog as the running server holds it: one handle, read by every
//! thread, whose content is replaced whole when a migration adds a table
//! or a column. A reader loads a snapshot for the duration of one
//! operation (one translation, one read, one flush of pokes) and never
//! sees a half-written catalog; the writer builds the next catalog from
//! the current one and swaps it in. The [`Catalog`] itself stays what it
//! is in the model, an immutable set of tables: the next one is one table
//! more or one column wider.

use std::sync::Arc;

use arc_swap::ArcSwap;

use crate::model::{Catalog, DbColumn, DbTable};

/// The catalog every thread reads through, replaced whole by the feed
/// when the schema grows.
pub struct CatalogHandle {
    current: ArcSwap<Catalog>,
}

impl CatalogHandle {
    /// A handle holding `catalog`.
    pub fn new(catalog: Catalog) -> Self {
        CatalogHandle {
            current: ArcSwap::from_pointee(catalog),
        }
    }

    /// A handle holding a catalog already shared.
    pub fn from_arc(catalog: Arc<Catalog>) -> Self {
        CatalogHandle {
            current: ArcSwap::new(catalog),
        }
    }

    /// The catalog as of now, to keep for one operation.
    pub fn load(&self) -> Arc<Catalog> {
        self.current.load_full()
    }

    /// Whether `catalog` is the one held right now (the same allocation).
    pub fn holds(&self, catalog: &Arc<Catalog>) -> bool {
        Arc::ptr_eq(&self.current.load(), catalog)
    }

    /// Make `catalog` the one every reader loads from now on.
    pub fn swap(&self, catalog: Arc<Catalog>) {
        self.current.store(catalog);
    }
}

/// `catalog` with `table` in it, replacing a table of the same name.
pub fn with_table(catalog: &Catalog, table: DbTable) -> Catalog {
    let name = table.name.clone();
    Catalog::new(
        catalog
            .tables()
            .filter(|held| held.name != name)
            .cloned()
            .chain(std::iter::once(table)),
    )
}

/// `table` with `column` added: the same name and key, one column more.
pub fn with_column(table: &DbTable, column: DbColumn) -> DbTable {
    let mut columns: Vec<DbColumn> = table
        .columns
        .values()
        .map(|held| DbColumn::new(held.name.clone(), held.r#type.clone()))
        .collect();
    columns.push(DbColumn::new(column.name, column.r#type));
    DbTable::new(table.name.clone(), table.pkey.iter().cloned(), columns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ValueType;

    /// A swap is seen by the next load and not by a snapshot already
    /// taken; a table added or widened leaves the others as they were.
    #[test]
    fn the_handle_swaps_whole_catalogs() {
        let tickets = DbTable::new(
            "tickets",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("status", ValueType::String),
            ],
        );
        let handle = CatalogHandle::new(Catalog::new(vec![tickets.clone()]));
        let before = handle.load();
        assert!(handle.holds(&before));
        let wider = with_column(&tickets, DbColumn::new("owner", ValueType::String));
        assert_eq!(wider.pkey, tickets.pkey);
        assert!(wider.column("owner").is_some() && wider.column("status").is_some());
        assert_eq!(
            wider
                .row_schema()
                .names()
                .iter()
                .map(|c| c.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "owner", "status"],
            "the key first, then the rest by name"
        );
        let users = DbTable::new("users", ["id"], vec![DbColumn::new("id", ValueType::Int)]);
        let next = with_table(&with_table(&before, wider), users);
        handle.swap(Arc::new(next));
        assert!(!handle.holds(&before));
        let after = handle.load();
        assert!(after.table("users").is_some());
        assert!(after.table("tickets").unwrap().column("owner").is_some());
        assert!(before.table("tickets").unwrap().column("owner").is_none());
        assert_eq!(after.tables().count(), 2);
    }
}
