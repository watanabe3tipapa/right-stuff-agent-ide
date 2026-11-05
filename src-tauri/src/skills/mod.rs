pub mod editor;
pub mod params;
pub mod policy;
pub mod verify;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Directory, relative to the workspace root, that holds skill manifests.
pub const SKILLS_DIR: &str = ".agents/skills";
pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
pub const MAX_MANIFEST_FILES: usize = 64;

/// Handlers registered by the Rust runtime. A manifest cannot name anything
/// outside this set, so a malicious JSON file cannot add behavior.
pub const IMPLEMENTED_HANDLERS: &[&str] =
    &["editor.readFile", "editor.replaceText", "editor.createFile"];

const ALLOWED_PROGRAMS: &[&str] = &["npm", "pnpm", "yarn", "cargo"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    Read,
    Write,
    Destructive,
}

impl Risk {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Destructive => "destructive",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillCategory {
    Editor,
    Git,
    Terminal,
    Debug,
}

impl SkillCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::Editor => "editor",
            Self::Git => "git",
            Self::Terminal => "terminal",
            Self::Debug => "debug",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Ask,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerificationMode {
    #[default]
    None,
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerificationCheck {
    Typecheck,
    Lint,
    Test,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParamType {
    #[serde(rename = "string")]
    String,
    #[serde(rename = "number")]
    Number,
    #[serde(rename = "boolean")]
    Boolean,
    #[serde(rename = "string[]")]
    StringArray,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParamDef {
    #[serde(rename = "type")]
    pub param_type: ParamType,
    pub description: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
    #[serde(default, rename = "enum")]
    pub enum_values: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillAction {
    pub id: String,
    pub handler: String,
    pub description: String,
    pub risk: Risk,
    #[serde(default)]
    pub params: BTreeMap<String, ParamDef>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_output_chars: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionPaths {
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub write: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandRule {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permissions {
    #[serde(default)]
    pub paths: PermissionPaths,
    #[serde(default)]
    pub commands: Vec<CommandRule>,
    #[serde(default)]
    pub env: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Approval {
    #[serde(default, rename = "default")]
    pub default_decision: Option<Decision>,
    #[serde(default)]
    pub overrides: BTreeMap<String, Decision>,
}

fn default_verification_timeout() -> u64 {
    300_000
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verification {
    #[serde(default)]
    pub mode: VerificationMode,
    #[serde(default)]
    pub checks: Vec<VerificationCheck>,
    #[serde(default = "default_verification_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_true")]
    pub stop_on_failure: bool,
}

impl Default for Verification {
    fn default() -> Self {
        Self {
            mode: VerificationMode::None,
            checks: Vec::new(),
            timeout_ms: default_verification_timeout(),
            stop_on_failure: true,
        }
    }
}

fn default_max_files() -> u32 {
    20
}

fn default_max_bytes() -> u64 {
    1_048_576
}

fn default_limits_timeout() -> u64 {
    300_000
}

fn default_max_output_chars() -> usize {
    50_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    #[serde(default = "default_max_files")]
    pub max_files: u32,
    #[serde(default = "default_max_bytes")]
    pub max_bytes: u64,
    #[serde(default = "default_limits_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_max_output_chars")]
    pub max_output_chars: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_files: default_max_files(),
            max_bytes: default_max_bytes(),
            timeout_ms: default_limits_timeout(),
            max_output_chars: default_max_output_chars(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub category: SkillCategory,
    #[serde(default)]
    pub risk: Option<Risk>,
    pub actions: Vec<SkillAction>,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub approval: Approval,
    #[serde(default)]
    pub verification: Verification,
    #[serde(default)]
    pub limits: Limits,
}

impl SkillManifest {
    /// Highest risk across all actions. Skill-level risk defaults to this.
    fn max_action_risk(&self) -> Option<Risk> {
        self.actions.iter().map(|action| action.risk).max()
    }

    pub fn action(&self, action_id: &str) -> Option<&SkillAction> {
        self.actions.iter().find(|action| action.id == action_id)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWarning {
    pub file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    pub skills: Vec<SkillManifest>,
    pub warnings: Vec<SkillWarning>,
}

/// Load every manifest in `<root>/.agents/skills`. A broken manifest becomes a
/// warning instead of failing the whole catalog.
pub fn load_catalog(root: &Path) -> AppResult<SkillCatalog> {
    let dir = root.join(SKILLS_DIR);
    if !dir.exists() {
        return Ok(SkillCatalog {
            skills: Vec::new(),
            warnings: Vec::new(),
        });
    }
    if !dir.is_dir() {
        return Err(AppError::Other(format!(
            "{SKILLS_DIR} がディレクトリではありません"
        )));
    }

    let mut paths = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        // `file_type` does not follow symlinks, so a link cannot pull a
        // manifest from outside the skills directory.
        let is_file = entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false);
        if is_file && path.extension().and_then(|value| value.to_str()) == Some("json") {
            paths.push(path);
        }
    }
    paths.sort();

    let mut catalog = SkillCatalog {
        skills: Vec::new(),
        warnings: Vec::new(),
    };
    let mut loaded_ids = BTreeSet::new();
    let mut seen_files = 0usize;

    for path in paths {
        if seen_files >= MAX_MANIFEST_FILES {
            catalog.warnings.push(SkillWarning {
                file: display_path(&path),
                message: format!("マニフェストが多すぎます（上限 {MAX_MANIFEST_FILES} 件）"),
            });
            continue;
        }
        seen_files += 1;

        let file = display_path(&path);
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            catalog.warnings.push(SkillWarning {
                file,
                message: "ファイル名を UTF-8 として読めません".into(),
            });
            continue;
        };

        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                catalog.warnings.push(SkillWarning {
                    file,
                    message: format!("メタデータを読めません: {error}"),
                });
                continue;
            }
        };
        if metadata.len() > MAX_MANIFEST_BYTES {
            catalog.warnings.push(SkillWarning {
                file,
                message: format!(
                    "マニフェストが大きすぎます ({} bytes、上限 {} bytes)",
                    metadata.len(),
                    MAX_MANIFEST_BYTES
                ),
            });
            continue;
        }

        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(error) => {
                catalog.warnings.push(SkillWarning {
                    file,
                    message: format!("読み込めません: {error}"),
                });
                continue;
            }
        };

        if is_legacy_manifest(&raw) {
            catalog.warnings.push(SkillWarning {
                file,
                message:
                    "v0 形式のマニフェストです。schemaVersion を追加して v1 に移行してください"
                        .into(),
            });
            continue;
        }

        match parse_manifest(&raw, stem) {
            Ok(manifest) => {
                if !loaded_ids.insert(manifest.id.clone()) {
                    catalog.warnings.push(SkillWarning {
                        file,
                        message: format!("スキル ID が重複しています: {}", manifest.id),
                    });
                    continue;
                }
                catalog.skills.push(manifest);
            }
            Err(message) => catalog.warnings.push(SkillWarning { file, message }),
        }
    }

    catalog.skills.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(catalog)
}

fn display_path(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("<unknown>");
    format!("{SKILLS_DIR}/{name}")
}

/// A v0 manifest has no `schemaVersion`. Detect it before serde so the user
/// gets a migration hint instead of a generic "missing field" error.
fn is_legacy_manifest(raw: &str) -> bool {
    matches!(
        serde_json::from_str::<serde_json::Value>(raw),
        Ok(serde_json::Value::Object(map)) if !map.contains_key("schemaVersion")
    )
}

/// Parse and validate a single manifest. `expected_id` is the file stem; the
/// manifest id must match so a file cannot silently shadow another skill.
pub fn parse_manifest(raw: &str, expected_id: &str) -> Result<SkillManifest, String> {
    let mut manifest: SkillManifest =
        serde_json::from_str(raw).map_err(|error| format!("JSON を読めません: {error}"))?;
    validate_manifest(&mut manifest, expected_id)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &mut SkillManifest, expected_id: &str) -> Result<(), String> {
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "schemaVersion は {SCHEMA_VERSION} である必要があります"
        ));
    }
    if !is_skill_id(&manifest.id) {
        return Err(format!("スキル ID の形式が不正です: {}", manifest.id));
    }
    if manifest.id != expected_id {
        return Err(format!(
            "スキル ID とファイル名が一致しません: {} != {expected_id}.json",
            manifest.id
        ));
    }
    check_text(&manifest.name, "name", 1, 80)?;
    check_text(&manifest.description, "description", 1, 500)?;
    if !is_semver(&manifest.version) {
        return Err(format!(
            "version が SemVer ではありません: {}",
            manifest.version
        ));
    }
    if manifest.actions.is_empty() || manifest.actions.len() > 32 {
        return Err("actions は 1〜32 個である必要があります".into());
    }

    let mut action_ids = BTreeSet::new();
    for action in &manifest.actions {
        validate_action(action, manifest.category)?;
        if !action_ids.insert(action.id.as_str()) {
            return Err(format!("アクション ID が重複しています: {}", action.id));
        }
    }

    let max_risk = manifest
        .max_action_risk()
        .ok_or_else(|| "actions が空です".to_string())?;
    match manifest.risk {
        Some(risk) if risk != max_risk => {
            return Err(format!(
                "スキルの risk ({}) がアクションの最大リスク ({}) と一致しません",
                risk.as_str(),
                max_risk.as_str()
            ));
        }
        Some(_) => {}
        None => manifest.risk = Some(max_risk),
    }

    validate_permissions(manifest)?;
    validate_approval(manifest)?;
    validate_verification(&manifest.verification)?;
    validate_limits(&manifest.limits)?;

    Ok(())
}

fn validate_action(action: &SkillAction, category: SkillCategory) -> Result<(), String> {
    if !is_action_id(&action.id) {
        return Err(format!("アクション ID の形式が不正です: {}", action.id));
    }
    if !action.id.starts_with(&format!("{}.", category.as_str())) {
        return Err(format!(
            "アクション ID は {} で始まる必要があります: {}",
            category.as_str(),
            action.id
        ));
    }
    if !IMPLEMENTED_HANDLERS.contains(&action.handler.as_str()) {
        return Err(format!("未実装のハンドラです: {}", action.handler));
    }
    check_text(&action.description, "description", 1, 300)?;

    if let Some(timeout) = action.timeout_ms
        && !(1_000..=600_000).contains(&timeout)
    {
        return Err(format!("timeoutMs が範囲外です: {timeout}"));
    }
    if let Some(limit) = action.max_output_chars
        && !(1_000..=200_000).contains(&limit)
    {
        return Err(format!("maxOutputChars が範囲外です: {limit}"));
    }
    if action.params.len() > 16 {
        return Err("params は 16 個以下である必要があります".into());
    }

    for (name, param) in &action.params {
        if !is_param_name(name) {
            return Err(format!("パラメータ名の形式が不正です: {name}"));
        }
        check_text(&param.description, "description", 1, 200)?;
        if let Some(length) = param.max_length
            && !(1..=100_000).contains(&length)
        {
            return Err(format!("maxLength が範囲外です: {length}"));
        }
        if let Some(items) = param.max_items
            && !(1..=1_000).contains(&items)
        {
            return Err(format!("maxItems が範囲外です: {items}"));
        }
        if param.max_length.is_some() && param.param_type != ParamType::String {
            return Err(format!(
                "maxLength は string パラメータだけに指定できます: {name}"
            ));
        }
        if param.max_items.is_some() && param.param_type != ParamType::StringArray {
            return Err(format!(
                "maxItems は string[] パラメータだけに指定できます: {name}"
            ));
        }
        if let Some(pattern) = &param.pattern {
            if param.param_type != ParamType::String {
                return Err(format!(
                    "pattern は string パラメータだけに指定できます: {name}"
                ));
            }
            if pattern.chars().count() > 200 {
                return Err(format!("pattern が長すぎます: {name}"));
            }
            regex::Regex::new(pattern)
                .map_err(|error| format!("pattern が不正です ({name}): {error}"))?;
        }
        if let Some(values) = &param.enum_values {
            if values.is_empty() || values.len() > 32 {
                return Err(format!("enum は 1〜32 個である必要があります: {name}"));
            }
            if !values
                .iter()
                .all(|value| value.is_string() || value.is_number() || value.is_boolean())
            {
                return Err(format!("enum に使えない値があります: {name}"));
            }
        }
    }

    Ok(())
}

fn validate_permissions(manifest: &SkillManifest) -> Result<(), String> {
    let paths = &manifest.permissions.paths;
    if paths.read.len() > 32 || paths.write.len() > 32 {
        return Err("permissions.paths は 32 件以下である必要があります".into());
    }
    for glob in paths.read.iter().chain(paths.write.iter()) {
        validate_glob(glob)?;
    }

    if manifest.category == SkillCategory::Editor {
        let has_read = manifest
            .actions
            .iter()
            .any(|action| action.risk == Risk::Read);
        let has_write = manifest
            .actions
            .iter()
            .any(|action| action.risk != Risk::Read);
        if has_read && paths.read.is_empty() {
            return Err("読み取りアクションには permissions.paths.read が必要です".into());
        }
        if has_write && paths.write.is_empty() {
            return Err("書き込みアクションには permissions.paths.write が必要です".into());
        }
    }

    if manifest.permissions.commands.len() > 32 {
        return Err("permissions.commands は 32 件以下である必要があります".into());
    }
    for command in &manifest.permissions.commands {
        validate_program(&command.program)?;
        if command.args.len() > 32 {
            return Err("コマンドの引数は 32 件以下である必要があります".into());
        }
        for arg in &command.args {
            if arg.chars().count() > 500 {
                return Err("コマンドの引数が長すぎます".into());
            }
            if arg.contains('\0') || arg.contains('\n') || arg.contains('\r') {
                return Err("コマンドの引数に制御文字は使えません".into());
            }
        }
    }

    validate_env(&manifest.permissions.env)
}

fn validate_glob(glob: &str) -> Result<(), String> {
    let length = glob.chars().count();
    if length == 0 || length > 200 {
        return Err("パスの glob は 1〜200 文字である必要があります".into());
    }
    if glob.starts_with('/') || glob.contains('\\') || glob.contains('\0') {
        return Err(format!("パスの glob が不正です: {glob}"));
    }
    if glob
        .split('/')
        .any(|component| component == ".." || component == "~")
    {
        return Err(format!("パスの glob に .. や ~ は使えません: {glob}"));
    }
    Ok(())
}

fn validate_program(program: &str) -> Result<(), String> {
    let length = program.chars().count();
    if length == 0 || length > 64 {
        return Err("program は 1〜64 文字である必要があります".into());
    }
    if !program
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(format!("program に使えない文字があります: {program}"));
    }
    if program.contains("..") {
        return Err(format!("program に .. は使えません: {program}"));
    }
    if !ALLOWED_PROGRAMS.contains(&program) {
        return Err(format!("未許可のプログラムです: {program}"));
    }
    Ok(())
}

fn validate_env(env: &[String]) -> Result<(), String> {
    if env.len() > 32 {
        return Err("permissions.env は 32 件以下である必要があります".into());
    }
    let mut seen = BTreeSet::new();
    const DENIED: &[&str] = &[
        "NODE_OPTIONS",
        "PYTHONPATH",
        "RUSTFLAGS",
        "BASH_ENV",
        "ENV",
        "IFS",
    ];
    for name in env {
        if name.is_empty() || name.chars().count() > 64 {
            return Err(format!("環境変数名が不正です: {name}"));
        }
        if !name
            .chars()
            .all(|value| value.is_ascii_uppercase() || value.is_ascii_digit() || value == '_')
        {
            return Err(format!("環境変数名が不正です: {name}"));
        }
        if name.starts_with(|value: char| value.is_ascii_digit()) {
            return Err(format!("環境変数名が不正です: {name}"));
        }
        if name.starts_with("DYLD_") || name.starts_with("LD_") || DENIED.contains(&name.as_str()) {
            return Err(format!("許可されていない環境変数です: {name}"));
        }
        if !seen.insert(name.as_str()) {
            return Err(format!("環境変数が重複しています: {name}"));
        }
    }
    Ok(())
}

fn validate_approval(manifest: &SkillManifest) -> Result<(), String> {
    if manifest.approval.overrides.len() > 32 {
        return Err("approval.overrides は 32 件以下である必要があります".into());
    }
    if manifest.approval.default_decision == Some(Decision::Allow)
        && manifest
            .actions
            .iter()
            .any(|action| action.risk != Risk::Read)
    {
        return Err("approval.default を allow にできるのは読み取り専用スキルだけです".into());
    }
    for (action_id, decision) in &manifest.approval.overrides {
        let Some(action) = manifest.action(action_id) else {
            return Err(format!(
                "approval.overrides が未知のアクションを指しています: {action_id}"
            ));
        };
        if *decision == Decision::Allow && action.risk != Risk::Read {
            return Err(format!(
                "書き込みアクションを allow にはできません: {action_id}"
            ));
        }
    }
    Ok(())
}

fn validate_verification(verification: &Verification) -> Result<(), String> {
    if verification.checks.len() > 3 {
        return Err("verification.checks は 3 件以下である必要があります".into());
    }
    let unique = verification.checks.iter().collect::<BTreeSet<_>>();
    if unique.len() != verification.checks.len() {
        return Err("verification.checks が重複しています".into());
    }
    if !(1_000..=900_000).contains(&verification.timeout_ms) {
        return Err(format!(
            "verification.timeoutMs が範囲外です: {}",
            verification.timeout_ms
        ));
    }
    match verification.mode {
        VerificationMode::Auto if verification.checks.is_empty() => {
            return Err("verification.mode が auto のとき checks は必須です".into());
        }
        VerificationMode::None if !verification.checks.is_empty() => {
            return Err("verification.mode が none のとき checks は指定できません".into());
        }
        _ => {}
    }
    Ok(())
}

fn validate_limits(limits: &Limits) -> Result<(), String> {
    if !(1..=1_000).contains(&limits.max_files) {
        return Err(format!(
            "limits.maxFiles が範囲外です: {}",
            limits.max_files
        ));
    }
    if !(1..=10_485_760).contains(&limits.max_bytes) {
        return Err(format!(
            "limits.maxBytes が範囲外です: {}",
            limits.max_bytes
        ));
    }
    if !(1_000..=600_000).contains(&limits.timeout_ms) {
        return Err(format!(
            "limits.timeoutMs が範囲外です: {}",
            limits.timeout_ms
        ));
    }
    if !(1_000..=200_000).contains(&limits.max_output_chars) {
        return Err(format!(
            "limits.maxOutputChars が範囲外です: {}",
            limits.max_output_chars
        ));
    }
    Ok(())
}

fn check_text(value: &str, field: &str, min: usize, max: usize) -> Result<(), String> {
    let length = value.chars().count();
    if length < min || length > max {
        return Err(format!("{field} は {min}〜{max} 文字である必要があります"));
    }
    Ok(())
}

pub(crate) fn is_skill_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 64 {
        return false;
    }
    let mut segments = value.split('-');
    let first = segments.next().unwrap_or_default();
    if first.is_empty()
        || !first
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    {
        return false;
    }
    segments.all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    })
}

pub(crate) fn is_action_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 96 {
        return false;
    }
    let mut parts = value.split('.');
    let Some(first) = parts.next() else {
        return false;
    };
    if !is_ident(first) {
        return false;
    }
    let mut count = 0;
    for part in parts {
        if !is_ident(part) {
            return false;
        }
        count += 1;
    }
    count > 0
}

fn is_ident(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    first.is_ascii_lowercase() && characters.all(|character| character.is_ascii_alphanumeric())
}

fn is_param_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && is_ident(value)
}

fn is_semver(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|part| {
        !part.is_empty()
            && part.chars().all(|character| character.is_ascii_digit())
            && !(part.len() > 1 && part.starts_with('0'))
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/skills")
            .join(name);
        fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
    }

    fn temp_workspace(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "right-stuff-skills-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(root.join(SKILLS_DIR)).expect("create temp workspace");
        root
    }

    #[test]
    fn parses_the_code_edit_manifest() {
        let manifest =
            parse_manifest(&fixture("valid/code-edit.json"), "code-edit").expect("valid manifest");
        assert_eq!(manifest.id, "code-edit");
        assert_eq!(manifest.category, SkillCategory::Editor);
        assert_eq!(manifest.risk, Some(Risk::Write));
        assert_eq!(manifest.actions.len(), 3);
        assert_eq!(manifest.limits.max_bytes, 1_048_576);
        assert_eq!(
            manifest.verification.checks,
            vec![
                VerificationCheck::Typecheck,
                VerificationCheck::Lint,
                VerificationCheck::Test
            ]
        );
    }

    #[test]
    fn derives_the_skill_risk_when_omitted() {
        let manifest =
            parse_manifest(&fixture("valid/minimal.json"), "minimal").expect("valid manifest");
        assert_eq!(manifest.risk, Some(Risk::Read));
    }

    #[test]
    fn rejects_id_mismatch() {
        assert_error("invalid/id-mismatch.json", "id-mismatch", "ファイル名");
    }

    #[test]
    fn rejects_duplicate_actions() {
        assert_error("invalid/duplicate-action.json", "duplicate-action", "重複");
    }

    #[test]
    fn rejects_unknown_handlers() {
        assert_error("invalid/unknown-handler.json", "unknown-handler", "未実装");
    }

    #[test]
    fn rejects_allow_for_write_actions() {
        assert_error("invalid/write-allow.json", "write-allow", "allow");
    }

    #[test]
    fn rejects_out_of_range_limits() {
        assert_error("invalid/limits.json", "limits", "maxBytes");
    }

    #[test]
    fn rejects_path_escape_globs() {
        assert_error("invalid/path-escape.json", "path-escape", "..");
    }

    #[test]
    fn rejects_shell_programs() {
        assert_error("invalid/shell-command.json", "shell-command", "未許可");
    }

    #[test]
    fn rejects_unknown_fields() {
        assert_error(
            "invalid/unknown-field.json",
            "unknown-field",
            "unknown field",
        );
    }

    fn assert_error(fixture_name: &str, expected_id: &str, needle: &str) {
        let error = parse_manifest(&fixture(fixture_name), expected_id)
            .expect_err("manifest should be rejected");
        assert!(
            error.contains(needle),
            "expected {needle:?} in error, got {error:?}"
        );
    }

    #[test]
    fn loads_valid_manifests_and_reports_broken_ones() {
        let root = temp_workspace("mixed");
        fs::write(
            root.join(SKILLS_DIR).join("code-edit.json"),
            fixture("valid/code-edit.json"),
        )
        .expect("write valid manifest");
        fs::write(
            root.join(SKILLS_DIR).join("unknown-handler.json"),
            fixture("invalid/unknown-handler.json"),
        )
        .expect("write broken manifest");
        fs::write(root.join(SKILLS_DIR).join("notes.txt"), "ignore me")
            .expect("write unrelated file");

        let catalog = load_catalog(&root).expect("load catalog");
        assert_eq!(catalog.skills.len(), 1);
        assert_eq!(catalog.skills[0].id, "code-edit");
        assert_eq!(catalog.warnings.len(), 1);
        assert!(catalog.warnings[0].file.ends_with("unknown-handler.json"));
        assert!(catalog.warnings[0].message.contains("未実装"));

        fs::remove_dir_all(root).expect("clean temp workspace");
    }

    #[test]
    fn returns_an_empty_catalog_when_the_directory_is_missing() {
        let root = temp_workspace("missing");
        fs::remove_dir_all(root.join(SKILLS_DIR)).expect("remove skills dir");
        let catalog = load_catalog(&root).expect("load catalog");
        assert!(catalog.skills.is_empty());
        assert!(catalog.warnings.is_empty());
        fs::remove_dir_all(root).expect("clean temp workspace");
    }

    #[test]
    fn detects_legacy_v0_manifests() {
        assert!(is_legacy_manifest(
            r#"{"name":"code-edit","actions":["editor.openFile"]}"#
        ));
        assert!(!is_legacy_manifest(&fixture("valid/minimal.json")));
        assert!(!is_legacy_manifest("not json"));
    }

    #[test]
    fn enforces_glob_and_program_rules() {
        assert!(validate_glob("**/*").is_ok());
        assert!(validate_glob("../secrets").is_err());
        assert!(validate_glob("/etc/passwd").is_err());
        assert!(validate_program("npm").is_ok());
        assert!(validate_program("sh").is_err());
        assert!(validate_program("../npm").is_err());
    }
}
