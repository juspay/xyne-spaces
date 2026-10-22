//! The synchronous driver: for storage that answers at once (the
//! in-process [`super::MemoryStorage`]), every read the runtime hands out
//! is run inline and landed before the call returns, so registration and
//! routing keep the plain call-and-return shape of the engine itself.
//! This is the driver the test suites, the demo and the benchmark use.

use std::collections::VecDeque;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use super::runtime::{Runtime, Step};
use super::storage::Storage;
use crate::ivm::{Delta, Engine};
use crate::model::frame::SharedRow;
use crate::model::{Lsn, SubId, WriteQuery};

/// A runtime over an engine and an immediately-answering storage.
///
/// - `clock`: the driver's own write counter, the location every routed
///   write is committed at; the storage is advanced to it after each
///   write, so its reads are positioned exactly there.
pub struct Local<E: Engine, S: Storage> {
    runtime: Runtime<E>,
    storage: Rc<S>,
    clock: u64,
}

impl<E: Engine, S: Storage> Local<E, S> {
    /// A driver owning `engine` and reading from `storage`.
    pub fn new(engine: E, storage: Rc<S>) -> Self {
        Local {
            runtime: Runtime::new(engine),
            storage,
            clock: 0,
        }
    }

    /// Register a subscription and return its id and its complete
    /// initial snapshot, every read it needed already landed.
    pub fn register_query(&mut self, query: E::Query) -> (SubId, Vec<Delta>) {
        let (sub, step) = self.runtime.register(query);
        (sub, self.settle(step))
    }

    /// Remove a subscription; the rows only it held come back to be freed
    /// by the caller (the server frees them off the engine's thread).
    pub fn unregister_query(&mut self, sub: SubId) -> Vec<SharedRow> {
        self.runtime.unregister(sub);
        self.runtime.take_dead()
    }

    /// Route one write at the next tick of the driver's clock and return
    /// every delta it led to, reads included.
    pub fn incremental_update(&mut self, write: &WriteQuery) -> Vec<Delta> {
        self.clock += 1;
        let step = self.runtime.write(write, Lsn(self.clock));
        self.moved();
        self.settle(step)
    }

    /// Run the reads the engine asked for through a direct maintenance
    /// call ([`Local::engine_mut`]) and return the deltas they led to.
    pub fn pump(&mut self) -> Vec<Delta> {
        let step = self.runtime.pump();
        self.settle(step)
    }

    /// The engine, for inspection.
    pub fn engine(&self) -> &E {
        self.runtime.engine()
    }

    /// The engine, for direct maintenance calls; follow with
    /// [`Local::pump`].
    pub fn engine_mut(&mut self) -> &mut E {
        self.runtime.engine_mut()
    }

    /// The runtime, for its counters.
    pub fn runtime(&self) -> &Runtime<E> {
        &self.runtime
    }

    /// The storage handle.
    pub fn storage(&self) -> &Rc<S> {
        &self.storage
    }

    /// The stream moved: tell the storage, and learn its floor.
    fn moved(&mut self) {
        self.storage.advance(self.runtime.position());
        self.runtime.set_floor(self.storage.floor());
    }

    /// Run every read a step handed out, land it, and keep going until no
    /// read is left, collecting the deltas in order.
    fn settle(&mut self, step: Step) -> Vec<Delta> {
        let mut updates = step.updates;
        let mut queue: VecDeque<_> = step.selects.into();
        while let Some(fetch) = queue.pop_front() {
            let snapshot = immediate(self.storage.select(&fetch.query))
                .expect("Local drives storage that answers at once; use Service for asynchronous storage")
                .expect("Local drives storage that cannot fail");
            let landed = self.runtime.fetched(fetch.id, snapshot);
            updates.extend(landed.updates);
            queue.extend(landed.selects);
        }
        updates
    }
}

/// The output of a future that is ready as soon as it is created; `None`
/// if it would have to wait.
fn immediate<F: Future>(future: F) -> Option<F::Output> {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    match future.as_mut().poll(&mut context) {
        Poll::Ready(output) => Some(output),
        Poll::Pending => None,
    }
}
