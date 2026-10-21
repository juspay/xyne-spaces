//! Running an engine against a real source: the storage reads the engine
//! asks for are asynchronous, the write stream keeps flowing while they
//! run, and this module reconciles the two.
//!
//! | Piece | Role |
//! |-------|------|
//! | [`Lsn`] | Where a write or a read's snapshot sits in the source's history: one WAL location. |
//! | [`Storage`] | The asynchronous read seam every source implements: [`MemoryStorage`] in-process, [`pg::PgStorage`] over Postgres, [`Sources`] routing by table between the two. |
//! | [`Runtime`] | The single owner of an engine: hands out the engine's reads, keeps the delivered writes a read may still be behind, and lands each read after bringing it up to the engine's position (its module docs). Pure state, no I/O. |
//! | [`Local`] | The synchronous driver: reads answered at once, landed inline (tests, demo, benchmark). |
//! | [`Service`] | The asynchronous driver: a command loop on a `LocalSet`; every read as its own task, and an [`Event`] stream telling its consumer what landed, what became hydrated and where the stream is. |
//! | [`pg`] | Postgres: reads from the exported snapshot of a rotating temporary replication slot, flipped to a newer one only once the stream has passed it, and the change feed streamed from a permanent slot that positions every write. |
//!
//! The sources differ only in how they arrive at a read's location; the
//! runtime, the engine's rules, and both drivers are shared.

pub mod catalog;
mod local;
pub mod pg;
mod runtime;
mod service;
mod sources;
mod storage;

pub use crate::model::SubId;
pub use crate::model::{Lsn, Snapshot};
pub use catalog::CatalogHandle;
pub use local::Local;
pub use runtime::{Runtime, Step, SyncStats};
pub use service::{Command, Event, Service, Transaction};
pub use sources::{MEMORY_TABLES_VAR, Sources};
pub use storage::{MemoryStorage, Storage, StorageError};
