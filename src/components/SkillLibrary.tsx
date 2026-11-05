import { useCallback, useEffect, useMemo, useState } from "react";

import type { SkillCategory, SkillCatalog } from "../shared/types";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, errorMessage, isTauri } from "../lib/api";
import {
  SKILL_LIBRARY,
  categoryLabel,
  manifestJson,
  riskLabel,
  skillPath,
  type SkillLibraryEntry,
} from "../lib/skillLibrary";
import { Icon } from "./Icon";

const CATEGORY_ORDER: SkillCategory[] = ["editor", "git", "terminal", "debug"];

function deriveWorkspaceEntries(catalog: SkillCatalog | null): SkillLibraryEntry[] {
  if (!catalog) return [];
  const known = new Set(SKILL_LIBRARY.map((entry) => entry.id));
  return catalog.skills
    .filter((skill) => !known.has(skill.id))
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      tagline: "ワークスペースのカスタムスキル",
      description: skill.description,
      category: skill.category,
      status: "ready" as const,
      tags: [categoryLabel(skill.category), "カスタム"],
      useCases: [],
      examples: [],
      manifest: skill,
    }));
}

function ActionTable({ entry }: { entry: SkillLibraryEntry }) {
  if (!entry.manifest) {
    return <p className="field-help">マニフェストはまだ提供されていません。</p>;
  }
  return (
    <div className="skill-lib-actions">
      {entry.manifest.actions.map((action) => (
        <div className="skill-lib-action" key={action.id}>
          <div className="skill-lib-action-head">
            <code>{action.id}</code>
            <span className={`skill-risk ${action.risk}`}>{riskLabel(action.risk)}</span>
          </div>
          <p>{action.description}</p>
          {Object.keys(action.params).length > 0 && (
            <div className="skill-lib-params">
              {Object.entries(action.params).map(([name, definition]) => (
                <div className="skill-lib-param" key={name}>
                  <code>{name}</code>
                  <span>{definition.type}</span>
                  {definition.required && <em>必須</em>}
                  <p>{definition.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SkillLibrary() {
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | SkillCategory>("all");
  const [selectedId, setSelectedId] = useState<string>(SKILL_LIBRARY[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCatalog(await api.skillsList());
      setError(null);
    } catch (next) {
      setError(errorMessage(next));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const workspaceEntries = useMemo(() => deriveWorkspaceEntries(catalog), [catalog]);
  const entries = useMemo(
    () => [...SKILL_LIBRARY, ...workspaceEntries],
    [workspaceEntries],
  );
  const installed = useMemo(
    () => new Set(catalog?.skills.map((skill) => skill.id) ?? []),
    [catalog],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!normalized) return true;
      return `${entry.name} ${entry.id} ${entry.tagline} ${entry.description} ${entry.tags.join(" ")}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [entries, query, category]);

  const selected =
    filtered.find((entry) => entry.id === selectedId) ??
    entries.find((entry) => entry.id === selectedId) ??
    filtered[0] ??
    entries[0];

  const readyCount = entries.filter((entry) => entry.status === "ready").length;
  const plannedCount = entries.length - readyCount;

  const install = async (entry: SkillLibraryEntry) => {
    if (!entry.manifest) return;
    setBusy(entry.id);
    setPendingInstall(null);
    try {
      await api.writeFile(skillPath(entry), manifestJson(entry));
      await refresh();
      setNotice(
        `${entry.name} を ${skillPath(entry)} に追加しました。メインウィンドウのスキルタブはフォーカス時に再読み込みされます。`,
      );
    } catch (next) {
      setError(errorMessage(next));
    } finally {
      setBusy(null);
    }
  };

  const requestInstall = (entry: SkillLibraryEntry) => {
    if (!entry.manifest) return;
    if (installed.has(entry.id)) {
      setPendingInstall(entry.id);
      return;
    }
    void install(entry);
  };

  const copyManifest = async (entry: SkillLibraryEntry) => {
    try {
      await navigator.clipboard.writeText(manifestJson(entry));
      setNotice("マニフェストをクリップボードへコピーしました。");
    } catch (next) {
      setError(errorMessage(next));
    }
  };

  const close = () => {
    if (isTauri) {
      void getCurrentWindow().close();
    } else {
      window.close();
    }
  };

  return (
    <div className="skill-lib">
      <header className="skill-lib-head">
        <div>
          <span className="skill-lib-eyebrow">Skill Library</span>
          <h1>スキルを、読める形で。</h1>
          <p>
            エージェントが実行できる操作を、目的・リスク・パラメータ・マニフェストで整理しています。
            ワークスペースの <code>.agents/skills/*.json</code> と組み合わせて表示します。
          </p>
        </div>
        <div className="skill-lib-head-actions">
          <span className="skill-lib-stat">
            <strong>{readyCount}</strong> 利用可能
          </span>
          <span className="skill-lib-stat">
            <strong>{plannedCount}</strong> 予定
          </span>
          <span className="skill-lib-stat">
            <strong>{installed.size}</strong> 導入済み
          </span>
          <button type="button" className="icon-btn" onClick={close} aria-label="閉じる">
            <Icon name="x" size={16} />
          </button>
        </div>
      </header>

      <div className="skill-lib-toolbar">
        <div className="palette-input skill-lib-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            placeholder="スキル名・タグ・説明で検索…"
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="skill-lib-filters" role="tablist" aria-label="カテゴリ">
          <button
            type="button"
            className={category === "all" ? "active" : ""}
            onClick={() => setCategory("all")}
          >
            すべて
          </button>
          {CATEGORY_ORDER.map((value) => (
            <button
              type="button"
              key={value}
              className={category === value ? "active" : ""}
              onClick={() => setCategory(value)}
            >
              {categoryLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="dialog-error skill-lib-message" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="dialog-note skill-lib-message" role="status">
          {notice}
        </div>
      )}
      {!isTauri && (
        <div className="dialog-note warn skill-lib-message" role="note">
          ブラウザデモではワークスペースへの追加はページを再読み込みすると失われます。
        </div>
      )}

      <div className="skill-lib-body">
        <div className="skill-lib-list">
          {filtered.length === 0 && (
            <div className="plan-empty">
              <Icon name="search" size={18} />
              <p>一致するスキルがありません。</p>
            </div>
          )}
          {filtered.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`skill-lib-card${entry.id === selected?.id ? " active" : ""}`}
              onClick={() => {
                setSelectedId(entry.id);
                setShowManifest(false);
                setPendingInstall(null);
              }}
            >
              <div className="skill-lib-card-top">
                <span className="skill-lib-cat">{categoryLabel(entry.category)}</span>
                <span className={`skill-lib-status ${entry.status}`}>
                  {entry.status === "ready" ? "利用可能" : "予定"}
                </span>
              </div>
              <strong>{entry.name}</strong>
              <code>{entry.id}</code>
              <p>{entry.tagline}</p>
              <div className="skill-lib-tags">
                {entry.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              {installed.has(entry.id) && (
                <span className="skill-lib-installed">
                  <Icon name="check" size={11} /> 導入済み
                </span>
              )}
            </button>
          ))}
        </div>

        {selected && (
          <article className="skill-lib-detail">
            <div className="skill-lib-detail-head">
              <div>
                <span className="skill-lib-cat">{categoryLabel(selected.category)}</span>
                <h2>{selected.name}</h2>
                <code>{selected.id}</code>
              </div>
              <span className={`skill-lib-status ${selected.status}`}>
                {selected.status === "ready" ? "利用可能" : "予定"}
              </span>
            </div>

            <p className="skill-lib-lead">{selected.description}</p>

            {selected.note && (
              <div className="dialog-note warn" role="note">
                {selected.note}
              </div>
            )}

            {selected.useCases.length > 0 && (
              <section className="skill-lib-section">
                <h3>向いている用途</h3>
                <ul className="skill-lib-usecases">
                  {selected.useCases.map((useCase) => (
                    <li key={useCase}>{useCase}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="skill-lib-section">
              <h3>アクションとリスク</h3>
              <ActionTable entry={selected} />
            </section>

            {selected.examples.length > 0 && (
              <section className="skill-lib-section">
                <h3>プロンプト例</h3>
                {selected.examples.map((example) => (
                  <div className="skill-lib-example" key={example.title}>
                    <strong>{example.title}</strong>
                    <p>{example.prompt}</p>
                  </div>
                ))}
              </section>
            )}

            {selected.manifest && (
              <section className="skill-lib-section">
                <div className="skill-lib-section-head">
                  <h3>マニフェスト</h3>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setShowManifest((value) => !value)}
                  >
                    {showManifest ? "閉じる" : "JSON を表示"}
                  </button>
                </div>
                {showManifest && (
                  <pre className="skill-lib-manifest">{manifestJson(selected)}</pre>
                )}
              </section>
            )}

            <div className="skill-lib-install">
              {selected.status === "ready" && selected.manifest ? (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy === selected.id}
                    onClick={() => requestInstall(selected)}
                  >
                    <Icon name="file-plus" size={13} />
                    {busy === selected.id
                      ? "追加中…"
                      : installed.has(selected.id)
                        ? "マニフェストを更新"
                        : "ワークスペースに追加"}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void copyManifest(selected)}
                  >
                    マニフェストをコピー
                  </button>
                  <code className="skill-lib-path">{skillPath(selected)}</code>
                </>
              ) : (
                <span className="field-help">
                  このスキルは設計カードです。ハンドラの実装後に追加できます。
                </span>
              )}
            </div>

            {pendingInstall === selected.id && (
              <div className="skill-lib-confirm" role="alertdialog">
                <p>
                  <code>{skillPath(selected)}</code> は既に存在します。内容を上書きしますか？
                </p>
                <div>
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => void install(selected)}
                  >
                    上書きする
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setPendingInstall(null)}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
