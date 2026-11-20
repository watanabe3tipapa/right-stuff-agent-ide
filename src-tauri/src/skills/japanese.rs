use std::path::Path;

use super::HandlerOutcome;
use crate::error::{AppError, AppResult};
use crate::skills::editor;

const MAX_FINDINGS: usize = 100;
const MAX_EXCERPT_CHARS: usize = 120;

const CLOSING_PUNCTUATION: &[char] = &[
    '、', '。', '，', '．', '）', '］', '｝', '」', '』', '】', '〉', '》', '〕',
];
const OPENING_PUNCTUATION: &[char] = &['（', '［', '｛', '「', '『', '【', '〈', '《', '〔'];

/// Variants that should be normalized in prose. The check skips a match when
/// it is immediately followed by `ー`, so `サーバー` is not reported.
const GLOSSARY: &[(&str, &str)] = &[
    ("サーバ", "サーバー"),
    ("ユーザ", "ユーザー"),
    ("インターフェイス", "インターフェース"),
    ("レポジトリ", "リポジトリ"),
    ("ディフォルト", "デフォルト"),
    ("ライブラリー", "ライブラリ"),
    ("コンパイラ", "コンパイラー"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Warning,
    Error,
}

impl Severity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub line: usize,
    pub column: usize,
    pub rule: &'static str,
    pub severity: Severity,
    pub message: String,
    pub excerpt: String,
}

fn is_fullwidth_alnum(ch: char) -> bool {
    matches!(ch as u32, 0xFF10..=0xFF19 | 0xFF21..=0xFF3A | 0xFF41..=0xFF5A)
}

fn is_halfwidth_katakana(ch: char) -> bool {
    matches!(ch as u32, 0xFF66..=0xFF9D)
}

fn mask_inline_code(line: &str) -> String {
    let mut masked = String::with_capacity(line.len());
    let mut in_code = false;
    for ch in line.chars() {
        if ch == '`' {
            in_code = !in_code;
            masked.push(' ');
        } else if in_code {
            masked.push(' ');
        } else {
            masked.push(ch);
        }
    }
    masked
}

fn excerpt(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_EXCERPT_CHARS {
        return trimmed.to_string();
    }
    let mut value: String = trimmed.chars().take(MAX_EXCERPT_CHARS).collect();
    value.push('…');
    value
}

fn push_finding(
    findings: &mut Vec<Finding>,
    line: usize,
    column: usize,
    rule: &'static str,
    severity: Severity,
    message: impl Into<String>,
    text: &str,
) {
    if findings.len() >= MAX_FINDINGS {
        return;
    }
    findings.push(Finding {
        line,
        column,
        rule,
        severity,
        message: message.into(),
        excerpt: excerpt(text),
    });
}

/// Lint Japanese prose. Fenced code blocks, frontmatter, inline code, and
/// URL-only lines are ignored so documentation examples do not produce noise.
pub fn lint_text(content: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut in_fence = false;
    let mut fence_marker = "";
    let mut in_frontmatter = content.trim_start().starts_with("---");

    for (index, raw_line) in content.lines().enumerate() {
        let line_no = index + 1;
        let trimmed = raw_line.trim_start();

        if in_frontmatter {
            if line_no > 1 && trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = &trimmed[..3];
            if in_fence && marker == fence_marker {
                in_fence = false;
                fence_marker = "";
            } else if !in_fence {
                in_fence = true;
                fence_marker = marker;
            }
            continue;
        }
        if in_fence {
            continue;
        }

        if trimmed.contains("http://") || trimmed.contains("https://") {
            continue;
        }

        let masked = mask_inline_code(raw_line);
        let chars: Vec<char> = masked.chars().collect();

        for (column, ch) in chars.iter().enumerate() {
            if is_fullwidth_alnum(*ch) {
                push_finding(
                    &mut findings,
                    line_no,
                    column + 1,
                    "fullwidth-alnum",
                    Severity::Warning,
                    "全角の英数字があります。半角に統一してください。",
                    raw_line,
                );
            }
            if is_halfwidth_katakana(*ch) {
                push_finding(
                    &mut findings,
                    line_no,
                    column + 1,
                    "halfwidth-kana",
                    Severity::Warning,
                    "半角カタカナがあります。全角に統一してください。",
                    raw_line,
                );
            }
        }

        if let Some(first) = chars.iter().find(|ch| !ch.is_whitespace())
            && CLOSING_PUNCTUATION.contains(first)
        {
            let column = chars
                .iter()
                .position(|ch| ch == first)
                .map(|value| value + 1)
                .unwrap_or(1);
            push_finding(
                &mut findings,
                line_no,
                column,
                "line-start-closing",
                Severity::Error,
                "行頭に閉じ括弧・句読点があります。前の行につなげてください。",
                raw_line,
            );
        }

        if let Some(last) = chars.iter().rev().find(|ch| !ch.is_whitespace())
            && OPENING_PUNCTUATION.contains(last)
        {
            let column = chars
                .iter()
                .rposition(|ch| ch == last)
                .map(|value| value + 1)
                .unwrap_or(1);
            push_finding(
                &mut findings,
                line_no,
                column,
                "line-end-opening",
                Severity::Error,
                "行末に開き括弧があります。次の行につなげてください。",
                raw_line,
            );
        }

        for pair in ["。。", "、、", "，，", "！！", "？？"] {
            if let Some(byte_index) = masked.find(pair) {
                let column = masked[..byte_index].chars().count() + 1;
                push_finding(
                    &mut findings,
                    line_no,
                    column,
                    "repeated-punctuation",
                    Severity::Warning,
                    format!("句読点が連続しています: {pair}"),
                    raw_line,
                );
            }
        }

        for (variant, preferred) in GLOSSARY {
            let mut start = 0;
            while let Some(offset) = masked[start..].find(variant) {
                let byte_index = start + offset;
                let after = masked[byte_index + variant.len()..].chars().next();
                if after != Some('ー') {
                    let column = masked[..byte_index].chars().count() + 1;
                    push_finding(
                        &mut findings,
                        line_no,
                        column,
                        "glossary",
                        Severity::Warning,
                        format!("用語を統一してください: {variant} → {preferred}"),
                        raw_line,
                    );
                }
                start = byte_index + variant.len();
                if start >= masked.len() {
                    break;
                }
            }
        }
    }

    findings.sort_by_key(|finding| (finding.line, finding.column));
    findings.truncate(MAX_FINDINGS);
    findings
}

pub fn check(root: &Path, rel: &str, max_bytes: u64) -> AppResult<HandlerOutcome> {
    let extension = rel
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "mdx" | "txt") {
        return Err(AppError::Other(
            "日本語チェックの対象は .md / .mdx / .txt です".into(),
        ));
    }

    let file = editor::read_file(root, rel, max_bytes)?;
    let findings = lint_text(&file.content);
    let errors = findings
        .iter()
        .filter(|finding| finding.severity == Severity::Error)
        .count();
    let warnings = findings.len() - errors;

    let mut stdout = String::new();
    if findings.is_empty() {
        stdout.push_str("日本語表記の指摘はありませんでした。\n");
    } else {
        for finding in &findings {
            stdout.push_str(&format!(
                "{rel}:{}:{} [{}:{}] {}\n  {}\n",
                finding.line,
                finding.column,
                finding.severity.as_str(),
                finding.rule,
                finding.message,
                finding.excerpt
            ));
        }
        stdout.push_str(&format!(
            "\n{} 件の指摘 (error {} / warning {})\n",
            findings.len(),
            errors,
            warnings
        ));
    }

    Ok(HandlerOutcome {
        changed_files: Vec::new(),
        stdout,
        detail: format!(
            "{rel} の日本語チェック: {} 件 (error {errors} / warning {warnings})",
            findings.len()
        ),
        failed: errors > 0,
        exit_code: Some(if errors > 0 { 1 } else { 0 }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_japanese_typography_issues() {
        let text = "全角のＡＢＣです。\n半角のｶﾀｶﾅです。\nこれは、\n、行頭の句読点です。\nこれは（\n行末の開き括弧です。\n二重。。の句読点です。\n";
        let findings = lint_text(text);
        assert!(findings.iter().any(|item| item.rule == "fullwidth-alnum"));
        assert!(findings.iter().any(|item| item.rule == "halfwidth-kana"));
        assert!(
            findings
                .iter()
                .any(|item| item.rule == "line-start-closing")
        );
        assert!(findings.iter().any(|item| item.rule == "line-end-opening"));
        assert!(
            findings
                .iter()
                .any(|item| item.rule == "repeated-punctuation")
        );
    }

    #[test]
    fn skips_code_blocks_and_inline_code() {
        let text = "```ts\nconst ＡＢＣ = 1;\n```\n\n`ｶﾀｶﾅ` はコードです。\n";
        let findings = lint_text(text);
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn detects_glossary_variants_without_flagging_longer_words() {
        let text = "サーバを再起動します。\nサーバーは稼働中です。\nユーザを作成します。\nユーザーを確認します。\n";
        let findings = lint_text(text);
        let glossary: Vec<_> = findings
            .iter()
            .filter(|item| item.rule == "glossary")
            .collect();
        assert_eq!(glossary.len(), 2);
        assert!(glossary.iter().any(|item| item.message.contains("サーバ")));
        assert!(glossary.iter().any(|item| item.message.contains("ユーザ")));
    }

    #[test]
    fn ignores_frontmatter() {
        let text = "---\ntitle: ＡＢＣ\n---\n\n本文です。\n";
        let findings = lint_text(text);
        assert!(findings.is_empty(), "{findings:?}");
    }

    #[test]
    fn shipped_manifest_is_valid() {
        let raw = include_str!("../../../.agents/skills/japanese-text.json");
        let manifest = crate::skills::parse_manifest(raw, "japanese-text")
            .expect("japanese-text manifest should be valid");
        assert_eq!(manifest.actions.len(), 1);
        assert_eq!(manifest.actions[0].handler, "editor.checkJapanese");
        assert_eq!(manifest.risk, Some(crate::skills::Risk::Read));
    }
}
