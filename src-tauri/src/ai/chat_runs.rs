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

#[derive(Default)]
pub struct ChatRunRegistry {
    runs: Mutex<HashMap<String, ChatRunHandle>>,
}

impl ChatRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

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
        if runs
            .get(run_id)
            .is_some_and(|current| Arc::ptr_eq(&current.cancelled, &handle.cancelled))
        {
            runs.remove(run_id);
        }
        result
    }

    pub async fn cancel(&self, run_id: &str) -> bool {
        let handle = self.runs.lock().await.get(run_id).cloned();
        let Some(handle) = handle else {
            return false;
        };
        if !handle.cancelled.swap(true, Ordering::SeqCst) {
            // notify_one stores a permit when cancellation wins the tiny race
            // between registry insertion and the select branch being polled.
            handle.notify.notify_one();
        }
        true
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
        tokio::task::yield_now().await;
        assert!(registry.cancel("run-a").await);
        assert!(registry.cancel("run-a").await);
        let error = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("cancelled provider future stayed active")
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
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
}
