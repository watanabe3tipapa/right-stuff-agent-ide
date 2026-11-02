use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db;

pub struct AppState {
    pub root: Mutex<Option<PathBuf>>,
    pub db: Mutex<Connection>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;

        let conn = Connection::open(data_dir.join("right-stuff.db"))?;
        db::init(&conn)?;

        Ok(Self {
            root: Mutex::new(None),
            db: Mutex::new(conn),
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
