use std::collections::BTreeSet;

use serde_json::Value;

use super::{ParamDef, ParamType, SkillAction};
use crate::error::{AppError, AppResult};

/// Validate a skill call against the parameter definitions in its manifest.
/// Unknown parameters are rejected so a typo cannot silently change behavior.
pub fn validate_params(action: &SkillAction, params: &Value) -> AppResult<()> {
    let Some(object) = params.as_object() else {
        return Err(AppError::Other(
            "params はオブジェクトである必要があります".into(),
        ));
    };

    for name in object.keys() {
        if !action.params.contains_key(name) {
            return Err(AppError::Other(format!(
                "{name} は {} のパラメータではありません",
                action.id
            )));
        }
    }

    for (name, definition) in &action.params {
        let value = object.get(name);
        let missing = value.is_none_or(Value::is_null);
        if missing {
            if definition.required {
                return Err(AppError::Other(format!(
                    "必須パラメータがありません: {name}"
                )));
            }
            continue;
        }
        validate_value(name, definition, value.expect("checked above"))?;
    }

    Ok(())
}

fn validate_value(name: &str, definition: &ParamDef, value: &Value) -> AppResult<()> {
    match definition.param_type {
        ParamType::String => {
            let Some(value) = value.as_str() else {
                return Err(type_error(name, "文字列"));
            };
            if let Some(limit) = definition.max_length
                && value.chars().count() > limit
            {
                return Err(AppError::Other(format!(
                    "{name} は {limit} 文字以内である必要があります"
                )));
            }
            if let Some(pattern) = &definition.pattern {
                let regex = regex::Regex::new(pattern)
                    .map_err(|_| AppError::Other(format!("{name} の検証パターンが不正です")))?;
                if !regex.is_match(value) {
                    return Err(AppError::Other(format!(
                        "{name} が指定された形式に一致しません"
                    )));
                }
            }
            if let Some(values) = &definition.enum_values
                && !values.iter().any(|allowed| allowed == value)
            {
                return Err(AppError::Other(format!(
                    "{name} は許可された値ではありません"
                )));
            }
        }
        ParamType::Number => {
            if !value.is_number() {
                return Err(type_error(name, "数値"));
            }
            if let Some(values) = &definition.enum_values
                && !values.iter().any(|allowed| allowed == value)
            {
                return Err(AppError::Other(format!(
                    "{name} は許可された値ではありません"
                )));
            }
        }
        ParamType::Boolean => {
            if !value.is_boolean() {
                return Err(type_error(name, "真偽値"));
            }
        }
        ParamType::StringArray => {
            let Some(items) = value.as_array() else {
                return Err(type_error(name, "文字列の配列"));
            };
            if let Some(limit) = definition.max_items
                && items.len() > limit
            {
                return Err(AppError::Other(format!(
                    "{name} は {limit} 件以内である必要があります"
                )));
            }
            let mut seen = BTreeSet::new();
            for item in items {
                let Some(item) = item.as_str() else {
                    return Err(type_error(name, "文字列の配列"));
                };
                if !seen.insert(item) {
                    return Err(AppError::Other(format!("{name} に重複した値があります")));
                }
            }
            if let Some(allowed) = &definition.enum_values {
                let allowed = allowed
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<BTreeSet<_>>();
                for item in items {
                    let item = item.as_str().expect("checked above");
                    if !allowed.contains(item) {
                        return Err(AppError::Other(format!(
                            "{name} は許可された値ではありません"
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

fn type_error(name: &str, expected: &str) -> AppError {
    AppError::Other(format!("{name} は{expected}である必要があります"))
}

/// Read a string parameter that has already been validated.
pub fn string_param<'a>(params: &'a Value, name: &str) -> AppResult<&'a str> {
    params
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Other(format!("{name} は文字列である必要があります")))
}

/// Read an optional string parameter. Missing and null both mean "not set".
pub fn optional_string_param<'a>(params: &'a Value, name: &str) -> AppResult<Option<&'a str>> {
    match params.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.as_str())),
        Some(_) => Err(AppError::Other(format!(
            "{name} は文字列である必要があります"
        ))),
    }
}

/// Read a string parameter with a default for an omitted value.
pub fn string_param_or<'a>(params: &'a Value, name: &str, default: &'a str) -> AppResult<&'a str> {
    Ok(optional_string_param(params, name)?.unwrap_or(default))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::skills::parse_manifest;

    fn action() -> SkillAction {
        let manifest = parse_manifest(
            include_str!("../../tests/fixtures/skills/valid/code-edit.json"),
            "code-edit",
        )
        .expect("valid fixture");
        manifest
            .action("editor.replaceText")
            .expect("replaceText action")
            .clone()
    }

    #[test]
    fn accepts_a_complete_object() {
        let action = action();
        let params = json!({
            "path": "src/App.tsx",
            "oldText": "a",
            "newText": "b"
        });
        validate_params(&action, &params).expect("valid params");
    }

    #[test]
    fn rejects_missing_required_params() {
        let action = action();
        let error = validate_params(&action, &json!({ "path": "src/App.tsx" }))
            .expect_err("missing params");
        assert!(error.to_string().contains("必須"));
    }

    #[test]
    fn rejects_unknown_params_and_wrong_types() {
        let action = action();
        assert!(
            validate_params(
                &action,
                &json!({ "path": "a", "oldText": "a", "newText": "b", "x": 1 })
            )
            .is_err()
        );
        assert!(
            validate_params(
                &action,
                &json!({ "path": "a", "oldText": 1, "newText": "b" })
            )
            .is_err()
        );
    }

    #[test]
    fn enforces_max_length() {
        let action = action();
        let long = "x".repeat(100_001);
        let error = validate_params(
            &action,
            &json!({ "path": "a", "oldText": long, "newText": "b" }),
        )
        .expect_err("too long");
        assert!(error.to_string().contains("100000"));
    }

    #[test]
    fn reads_optional_values() {
        let params = json!({ "path": "a", "content": null });
        assert_eq!(optional_string_param(&params, "content").unwrap(), None);
        assert_eq!(string_param_or(&params, "content", "").unwrap(), "");
        assert_eq!(string_param(&params, "path").unwrap(), "a");
    }
}
