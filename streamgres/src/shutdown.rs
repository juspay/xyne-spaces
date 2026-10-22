//! One process-wide shutdown request shared by the bootstrapper and every
//! worker. Workers can report a failure, but only the bootstrapper decides
//! when the process returns to `main`.

use std::sync::{Arc, Mutex};

use tokio::sync::watch;

/// A one-way shutdown request and, optionally, the first fatal cause.
#[derive(Clone)]
pub struct Shutdown {
    requested: watch::Sender<bool>,
    failure: Arc<Mutex<Option<String>>>,
}

impl Shutdown {
    /// A coordinator which has not yet been asked to stop.
    pub fn new() -> Self {
        let (requested, _) = watch::channel(false);
        Shutdown {
            requested,
            failure: Arc::new(Mutex::new(None)),
        }
    }

    /// Ask every listener to begin its normal shutdown. This is idempotent.
    pub fn request(&self) {
        self.requested.send_replace(true);
    }

    /// Report an unexpected worker failure, preserving the first cause, then
    /// ask the bootstrapper's listeners to drain.
    pub fn fail(&self, cause: impl Into<String>) {
        let mut failure = self
            .failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if failure.is_none() {
            *failure = Some(cause.into());
        }
        drop(failure);
        self.request();
    }

    /// Whether shutdown has started.
    pub fn requested(&self) -> bool {
        *self.requested.subscribe().borrow()
    }

    /// Wait until shutdown is requested. A request made before subscribing is
    /// observed immediately.
    pub async fn wait(&self) {
        let mut receiver = self.requested.subscribe();
        while !*receiver.borrow() {
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }

    /// A receiver for tasks that need to react directly to shutdown.
    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.requested.subscribe()
    }

    /// The first unexpected failure, if shutdown was caused by one.
    pub fn failure(&self) -> Option<String> {
        self.failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

impl Default for Shutdown {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::Shutdown;

    #[tokio::test]
    async fn a_failure_requests_shutdown_and_keeps_its_first_cause() {
        let shutdown = Shutdown::new();
        shutdown.fail("feed failed");
        shutdown.fail("engine failed");

        shutdown.wait().await;
        assert!(shutdown.requested());
        assert_eq!(shutdown.failure().as_deref(), Some("feed failed"));
    }
}
