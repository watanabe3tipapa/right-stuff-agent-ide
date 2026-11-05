use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::{
    Decision, Limits, Risk, SkillAction, SkillCatalog, SkillCategory, SkillManifest,
    VerificationCheck, is_action_id, is_skill_id,
};
use crate::db;
use crate::error::AppResult;

/// Settings key for the persisted skill policy.
pub const SETTING_SKILL_POLICY: &str = "skill_policy";
pub const SKILL_POLICY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct SkillPolicy {
    pub version: u32,
    pub skills: BTreeMap<String, Decision>,
    pub actions: BTreeMap<String, Decision>,
    pub verification: VerificationPolicy,
    pub limits: Limits,
}

impl Default for SkillPolicy {
    fn default() -> Self {
        Self {
            version: SKILL_POLICY_VERSION,
            skills: BTreeMap::new(),
            actions: BTreeMap::new(),
            verification: VerificationPolicy::default(),
            limits: Limits::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct VerificationPolicy {
    pub auto_run: bool,
    pub allow_checks: Vec<VerificationCheck>,
}

impl Default for VerificationPolicy {
    fn default() -> Self {
        Self {
            auto_run: false,
            // `test` runs project code, so it always asks before running.
            allow_checks: vec![VerificationCheck::Typecheck, VerificationCheck::Lint],
        }
    }
}

impl SkillPolicy {
    /// Clamp values that could weaken the safety rules. Unknown or removed
    /// skills stay in the map so a future manifest can pick them up, but an
    /// `allow` for an unknown action is downgraded to `ask`.
    pub fn normalize(mut self, catalog: Option<&SkillCatalog>) -> Self {
        self.version = SKILL_POLICY_VERSION;
        self.skills.retain(|id, _| is_skill_id(id));
        self.actions.retain(|id, _| is_action_id(id));

        for (id, decision) in &mut self.skills {
            let has_write = catalog
                .and_then(|catalog| catalog.skills.iter().find(|skill| &skill.id == id))
                .map(|skill| skill.actions.iter().any(|action| action.risk != Risk::Read))
                .unwrap_or(true);
            if *decision == Decision::Allow && has_write {
                *decision = Decision::Ask;
            }
        }

        for (id, decision) in &mut self.actions {
            let is_write = catalog
                .and_then(|catalog| {
                    catalog
                        .skills
                        .iter()
                        .flat_map(|skill| skill.actions.iter())
                        .find(|action| &action.id == id)
                })
                .map(|action| action.risk != Risk::Read)
                .unwrap_or(true);
            if *decision == Decision::Allow && is_write {
                *decision = Decision::Ask;
            }
        }

        let mut seen = BTreeSet::new();
        self.verification
            .allow_checks
            .retain(|check| *check != VerificationCheck::Test && seen.insert(*check));

        self.limits = clamp_limits(self.limits);
        self
    }
}

fn clamp_limits(mut limits: Limits) -> Limits {
    let defaults = Limits::default();
    if !(1..=1_000).contains(&limits.max_files) {
        limits.max_files = defaults.max_files;
    }
    if !(1..=10_485_760).contains(&limits.max_bytes) {
        limits.max_bytes = defaults.max_bytes;
    }
    if !(1_000..=600_000).contains(&limits.timeout_ms) {
        limits.timeout_ms = defaults.timeout_ms;
    }
    if !(1_000..=200_000).contains(&limits.max_output_chars) {
        limits.max_output_chars = defaults.max_output_chars;
    }
    limits
}

pub fn load_policy(conn: &Connection, catalog: Option<&SkillCatalog>) -> AppResult<SkillPolicy> {
    let Some(raw) = db::get_setting(conn, SETTING_SKILL_POLICY)? else {
        return Ok(SkillPolicy::default());
    };
    match serde_json::from_str::<SkillPolicy>(&raw) {
        Ok(policy) => Ok(policy.normalize(catalog)),
        Err(_) => Ok(SkillPolicy::default()),
    }
}

pub fn save_policy(
    conn: &Connection,
    policy: SkillPolicy,
    catalog: Option<&SkillCatalog>,
) -> AppResult<SkillPolicy> {
    let policy = policy.normalize(catalog);
    let raw = serde_json::to_string(&policy)?;
    db::set_setting(conn, SETTING_SKILL_POLICY, &raw)?;
    Ok(policy)
}

/// Resolve the effective decision. Policy overrides win over the manifest,
/// and a write action can never be promoted to `allow`.
pub fn decision_for(
    policy: &SkillPolicy,
    manifest: &SkillManifest,
    action: &SkillAction,
) -> Decision {
    let requested = policy
        .actions
        .get(&action.id)
        .or_else(|| policy.skills.get(&manifest.id))
        .or_else(|| manifest.approval.overrides.get(&action.id))
        .or(manifest.approval.default_decision.as_ref())
        .copied()
        .unwrap_or_else(|| default_decision(manifest, action));
    clamp_decision(requested, action)
}

fn default_decision(manifest: &SkillManifest, action: &SkillAction) -> Decision {
    if manifest.category == SkillCategory::Terminal {
        return Decision::Block;
    }
    match action.risk {
        Risk::Read => Decision::Allow,
        Risk::Write | Risk::Destructive => Decision::Ask,
    }
}

fn clamp_decision(decision: Decision, action: &SkillAction) -> Decision {
    if decision == Decision::Allow && action.risk != Risk::Read {
        Decision::Ask
    } else {
        decision
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;
    use crate::skills::parse_manifest;
    use crate::skills::policy::SKILL_POLICY_VERSION;

    fn catalog() -> SkillCatalog {
        let manifest = parse_manifest(
            include_str!("../../tests/fixtures/skills/valid/code-edit.json"),
            "code-edit",
        )
        .expect("valid fixture");
        SkillCatalog {
            skills: vec![manifest],
            warnings: Vec::new(),
        }
    }

    fn action<'a>(catalog: &'a SkillCatalog, id: &str) -> &'a SkillAction {
        catalog.skills[0]
            .actions
            .iter()
            .find(|action| action.id == id)
            .expect("fixture action")
    }

    #[test]
    fn defaults_are_conservative() {
        let policy = SkillPolicy::default();
        assert_eq!(policy.version, SKILL_POLICY_VERSION);
        assert!(!policy.verification.auto_run);
        assert_eq!(
            policy.verification.allow_checks,
            vec![VerificationCheck::Typecheck, VerificationCheck::Lint]
        );
    }

    #[test]
    fn normalization_downgrades_write_allow_to_ask() {
        let catalog = catalog();
        let mut policy = SkillPolicy::default();
        policy.skills.insert("code-edit".into(), Decision::Allow);
        policy
            .actions
            .insert("editor.readFile".into(), Decision::Allow);
        policy
            .actions
            .insert("editor.replaceText".into(), Decision::Allow);

        let policy = policy.normalize(Some(&catalog));
        assert_eq!(policy.skills["code-edit"], Decision::Ask);
        assert_eq!(policy.actions["editor.readFile"], Decision::Allow);
        assert_eq!(policy.actions["editor.replaceText"], Decision::Ask);
    }

    #[test]
    fn normalization_drops_test_and_duplicate_checks() {
        let mut policy = SkillPolicy::default();
        policy.verification.allow_checks = vec![
            VerificationCheck::Typecheck,
            VerificationCheck::Test,
            VerificationCheck::Typecheck,
            VerificationCheck::Lint,
        ];
        let policy = policy.normalize(None);
        assert_eq!(
            policy.verification.allow_checks,
            vec![VerificationCheck::Typecheck, VerificationCheck::Lint]
        );
    }

    #[test]
    fn normalization_resets_out_of_range_limits() {
        let mut policy = SkillPolicy::default();
        policy.limits.max_bytes = 0;
        policy.limits.timeout_ms = 1;
        let policy = policy.normalize(None);
        let defaults = Limits::default();
        assert_eq!(policy.limits.max_bytes, defaults.max_bytes);
        assert_eq!(policy.limits.timeout_ms, defaults.timeout_ms);
    }

    #[test]
    fn decision_priority_and_write_clamping() {
        let catalog = catalog();
        let manifest = &catalog.skills[0];

        let mut policy = SkillPolicy::default();
        assert_eq!(
            decision_for(&policy, manifest, action(&catalog, "editor.readFile")),
            Decision::Allow
        );
        assert_eq!(
            decision_for(&policy, manifest, action(&catalog, "editor.replaceText")),
            Decision::Ask
        );

        policy
            .actions
            .insert("editor.replaceText".into(), Decision::Block);
        assert_eq!(
            decision_for(&policy, manifest, action(&catalog, "editor.replaceText")),
            Decision::Block
        );

        policy
            .actions
            .insert("editor.readFile".into(), Decision::Block);
        assert_eq!(
            decision_for(&policy, manifest, action(&catalog, "editor.readFile")),
            Decision::Block
        );
    }

    #[test]
    fn round_trips_through_sqlite() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::init(&conn).expect("init db");
        let catalog = catalog();

        let mut policy = SkillPolicy::default();
        policy
            .actions
            .insert("editor.replaceText".into(), Decision::Block);
        let saved = save_policy(&conn, policy, Some(&catalog)).expect("save policy");
        assert_eq!(saved.actions["editor.replaceText"], Decision::Block);

        let loaded = load_policy(&conn, Some(&catalog)).expect("load policy");
        assert_eq!(loaded.actions["editor.replaceText"], Decision::Block);
        assert_eq!(loaded.version, SKILL_POLICY_VERSION);
    }

    #[test]
    fn corrupt_settings_fall_back_to_defaults() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        crate::db::init(&conn).expect("init db");
        crate::db::set_setting(&conn, SETTING_SKILL_POLICY, "not json").expect("write setting");
        let policy = load_policy(&conn, None).expect("load policy");
        assert_eq!(policy.version, SKILL_POLICY_VERSION);
        assert!(!policy.verification.auto_run);
    }

    #[test]
    fn unknown_allow_is_downgraded() {
        let mut policy = SkillPolicy::default();
        policy
            .actions
            .insert("editor.unknown".into(), Decision::Allow);
        let policy = policy.normalize(None);
        assert_eq!(policy.actions["editor.unknown"], Decision::Ask);
    }

    #[test]
    fn manifest_overrides_apply_before_the_global_default() {
        let catalog = catalog();
        let manifest = &catalog.skills[0];
        let policy = SkillPolicy::default();
        assert_eq!(
            decision_for(&policy, manifest, action(&catalog, "editor.readFile")),
            Decision::Allow
        );
    }
}
