use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use crate::commands::terminal::TerminalHandle;
use crate::db;

/// Cooperative cancellation flag shared between the UI command and an
/// in-flight streaming request.
#[derive(Default)]
pub struct CancelFlag {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelFlag {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        // `notify_one` stores a permit when no waiter is registered yet, so a
        // cancel that arrives just before `wait()` cannot be lost.
        self.notify.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub async fn wait(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            self.notify.notified().await;
        }
    }
}

pub struct AppState {
    pub root: Mutex<Option<PathBuf>>,
    pub db: Mutex<Connection>,
    pub http: reqwest::Client,
    pub llm_cancel: Mutex<Option<Arc<CancelFlag>>>,
    pub terminals: Mutex<HashMap<String, TerminalHandle>>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;

        let conn = Connection::open(data_dir.join("right-stuff.db"))?;
        db::init(&conn)?;

        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("Right-Stuff-Agent-IDE/", env!("CARGO_PKG_VERSION")))
            .build()?;

        Ok(Self {
            root: Mutex::new(None),
            db: Mutex::new(conn),
            http,
            llm_cancel: Mutex::new(None),
            terminals: Mutex::new(HashMap::new()),
        })
    }

    pub fn root(&self) -> Result<PathBuf, crate::error::AppError> {
        self.root
            .lock()
            .map_err(|_| crate::error::AppError::Other("状態ロックの取得に失敗しました".into()))?
            .clone()
            .ok_or(crate::error::AppError::NoWorkspace)
    }
}
