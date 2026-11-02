use serde::ser::{Serialize, Serializer};

/// Application-wide error type. Every variant is safe to surface in the UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("ワークスペースが開かれていません")]
    NoWorkspace,
    #[error("ワークスペース外のパスは操作できません: {0}")]
    OutsideWorkspace(String),
    #[error("見つかりません: {0}")]
    NotFound(String),
    #[error("既に存在します: {0}")]
    AlreadyExists(String),
    #[error("ファイルが大きすぎます (上限 5MB): {0}")]
    TooLarge(String),
    #[error("バイナリファイルは開けません: {0}")]
    BinaryFile(String),
    #[error("入出力エラー: {0}")]
    Io(#[from] std::io::Error),
    #[error("データベースエラー: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("JSON の処理に失敗しました: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
