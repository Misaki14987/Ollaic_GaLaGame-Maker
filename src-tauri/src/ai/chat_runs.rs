//! Per-run cancellation registry shared by the Tauri chat command and any
//! Provider execution that exposes an explicit request handle. Frontend
//! orchestration owns a `run_id`; every awaited continuation for that turn
//! funnels through `run_cancellable` so a later Stop can interrupt it.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
struct ChatRunHandle {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

/// Frontend → backend chat-turn ownership. One entry per active `run_id`.
/// Caller cancels through [`ChatRunRegistry::cancel`]; the corresponding
/// provider future is dropped or detached by the [`select!`] inside
/// [`ChatRunRegistry::run_cancellable`].
#[derive(Default)]
pub struct ChatRunRegistry {
    runs: Mutex<HashMap<String, ChatRunHandle>>,
}

impl ChatRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Drive `future` under the ownership of `run_id`. Concurrent calls for the
    /// same id are rejected so a stale Run B cannot hijack an active Run A.
    pub async fn run_cancellable<T>(
        &self,
        run_id: &str,
        future: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let handle = ChatRunHandle {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        };
        {
            let mut runs = self.runs.lock().await;
            if runs.contains_key(run_id) {
                return Err(format!("chat run already active: {run_id}"));
            }
            runs.insert(run_id.to_string(), handle.clone());
        }

        let result = tokio::select! {
            biased;
            _ = handle.notify.notified() => Err("chat run cancelled".to_string()),
            result = future => result,
        };
        let mut runs = self.runs.lock().await;
        // Only remove if the entry still corresponds to *this* future. A
        // newer call for the same run_id would have inserted a different
        // handle and must not be evicted by an old future finishing late.
        if runs
            .get(run_id)
            .is_some_and(|current| Arc::ptr_eq(&current.cancelled, &handle.cancelled))
        {
            runs.remove(run_id);
        }
        result
    }

    /// Cancel a previously registered run. Returns `true` if a live run was
    /// signalled, `false` if the id was already completed or never started.
    /// Safe to call repeatedly.
    pub async fn cancel(&self, run_id: &str) -> bool {
        let handle = self.runs.lock().await.get(run_id).cloned();
        let Some(handle) = handle else {
            return false;
        };
        if !handle.cancelled.swap(true, Ordering::SeqCst) {
            // `notify_waiters` stores no permit and the future registered a
            // waiter before checking the durable atomic flag, so the cancel
            // race between insert and select polling is observable to the
            // waiter. notify_one keeps that path hot without waking anyone
            // who hasn't registered yet.
            handle.notify.notify_one();
        }
        true
    }

    /// Snapshot whether a run is currently registered. Used by tests to
    /// confirm a slot was freed after completion.
    #[cfg(test)]
    pub async fn is_active(&self, run_id: &str) -> bool {
        self.runs.lock().await.contains_key(run_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn ai_chat_cancel_aborts_registered_provider_future() {
        let registry = Arc::new(ChatRunRegistry::new());
        let runner = registry.clone();
        let task = tokio::spawn(async move {
            runner
                .run_cancellable("run-a", async {
                    std::future::pending::<()>().await;
                    Ok::<_, String>(())
                })
                .await
        });
        // Give the spawned task a chance to register before we cancel.
        tokio::task::yield_now().await;
        assert!(registry.cancel("run-a").await);
        assert!(registry.cancel("run-a").await);
        let error = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("cancelled provider future stayed active")
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(!registry.is_active("run-a").await);
    }

    #[tokio::test]
    async fn ai_chat_cancel_is_idempotent_for_unknown_or_finished_runs() {
        let registry = ChatRunRegistry::new();
        assert!(!registry.cancel("missing").await);
        assert_eq!(
            registry
                .run_cancellable("done", async { Ok::<_, String>(42) })
                .await
                .unwrap(),
            42
        );
        assert!(!registry.cancel("done").await);
    }

    #[tokio::test]
    async fn a_new_run_id_is_independent_from_a_cancelled_run() {
        let registry = ChatRunRegistry::new();
        assert_eq!(
            registry
                .run_cancellable("run-b", async { Ok::<_, String>("new") })
                .await
                .unwrap(),
            "new"
        );
    }

    #[tokio::test]
    async fn concurrent_runs_with_the_same_id_are_rejected() {
        let registry = Arc::new(ChatRunRegistry::new());
        let runner = registry.clone();
        let task = tokio::spawn(async move {
            runner
                .run_cancellable("dup", async {
                    std::future::pending::<()>().await;
                    Ok::<_, String>(())
                })
                .await
        });
        tokio::task::yield_now().await;
        let err = registry
            .run_cancellable("dup", async { Ok::<_, String>(()) })
            .await
            .unwrap_err();
        assert!(err.contains("already active"));
        assert!(registry.cancel("dup").await);
        let _ = tokio::time::timeout(Duration::from_secs(1), task).await;
    }
}