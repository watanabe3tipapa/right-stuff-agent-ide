import { useEffect, useState } from "react";

import type {
  LlmConfig,
  LlmProvider,
  LlmSettings,
  LlmTestResult,
} from "../shared/types";
import { api, errorMessage } from "../lib/api";
import { DEFAULT_LLM_CONFIG, PROVIDER_ORDER, PROVIDER_PRESETS } from "../lib/llm";
import { useAgentStore } from "../stores/agentStore";
import { AgentPolicySettings } from "./AgentPolicySettings";
import { Icon } from "./Icon";
import { OpenShipSettings } from "./OpenShipSettings";
import { SkillPolicySettings } from "./SkillPolicySettings";

function configFromSettings(settings: LlmSettings): LlmConfig {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };
}

function sameConfig(a: LlmConfig, b: LlmConfig): boolean {
  return (
    a.provider === b.provider &&
    a.baseUrl === b.baseUrl &&
    a.model === b.model &&
    a.temperature === b.temperature &&
    a.maxTokens === b.maxTokens
  );
}

export function SettingsDialog() {
  const open = useAgentStore((state) => state.settingsOpen);
  const closeSettings = useAgentStore((state) => state.closeSettings);
  const refreshLlm = useAgentStore((state) => state.refreshLlm);

  const [section, setSection] = useState<
    "llm" | "agent" | "skills" | "openship"
  >("llm");
  const [config, setConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);
  const [configured, setConfigured] = useState(false);
  const [savedConfig, setSavedConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const demo = !api.isTauri;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    setKeyDraft("");
    setShowKey(false);

    api
      .llmConfig()
      .then((settings) => {
        if (cancelled) return;
        setConfig(configFromSettings(settings));
        setConfigured(settings.configured);
        setSavedConfig(configFromSettings(settings));
        setKeyConfigured(settings.keyConfigured);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeSettings]);

  if (!open) return null;

  function update<K extends keyof LlmConfig>(key: K, value: LlmConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setNotice(null);
    setError(null);
    setTestResult(null);
  }

  function changeProvider(provider: LlmProvider) {
    const preset = PROVIDER_PRESETS[provider];
    setConfig((current) => ({
      ...current,
      provider,
      baseUrl: provider === "custom" ? current.baseUrl : preset.baseUrl,
      model: provider === "custom" ? current.model : preset.model,
    }));
    setNotice(null);
    setError(null);
    setTestResult(null);
  }

  async function persistDraftKey() {
    if (!keyDraft.trim()) return;
    await api.llmKeySet(keyDraft);
    setKeyDraft("");
    setKeyConfigured(true);
  }

  async function save(): Promise<LlmSettings | null> {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const settings = await api.llmConfigSet(config);
      setConfig(configFromSettings(settings));
      setConfigured(settings.configured);
      setSavedConfig(configFromSettings(settings));
      setKeyConfigured(settings.keyConfigured);
      await persistDraftKey();
      setNotice("設定を保存しました。");
      await refreshLlm();
      return settings;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveKey() {
    if (!keyDraft.trim()) {
      setError("API キーを入力してください。");
      return;
    }

    setKeyBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The key is stored per provider, so persist the provider change first.
      if (config.provider !== savedConfig.provider) {
        const settings = await api.llmConfigSet(config);
        setConfig(configFromSettings(settings));
        setConfigured(true);
        setSavedConfig(configFromSettings(settings));
        setKeyConfigured(settings.keyConfigured);
      }
      await persistDraftKey();
      setNotice("API キーを OS キーチェーンに保存しました。");
      await refreshLlm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setKeyBusy(false);
    }
  }

  async function deleteKey() {
    setKeyBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.llmKeyDelete();
      setKeyConfigured(false);
      setNotice("API キーを OS キーチェーンから削除しました。");
      await refreshLlm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setKeyBusy(false);
    }
  }

  async function saveAndTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const settings = await api.llmConfigSet(config);
      setConfig(configFromSettings(settings));
      setConfigured(true);
      setSavedConfig(configFromSettings(settings));
      setKeyConfigured(settings.keyConfigured);
      await persistDraftKey();
      await refreshLlm();
      setTestResult(await api.llmTest());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTesting(false);
    }
  }

  const preset = PROVIDER_PRESETS[config.provider];
  const providerDirty = config.provider !== savedConfig.provider;
  const dirty = !sameConfig(config, savedConfig);
  const keyReady = keyConfigured && !providerDirty;
  const saveDisabled = demo || loading || saving || testing || keyBusy;
  const testDisabled = demo || loading || testing || saving || keyBusy;

  return (
    <div className="modal-backdrop" onMouseDown={closeSettings}>
      <div
        className="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3 id="llm-settings-title">設定</h3>
            <p className="settings-sub">
              LLM 接続、エージェントの承認ポリシー、Openship
              連携を管理します。設定はこの端末内に保存されます。
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={closeSettings}
            aria-label="閉じる"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="設定セクション">
          <button
            type="button"
            role="tab"
            aria-selected={section === "llm"}
            className={section === "llm" ? "active" : ""}
            onClick={() => setSection("llm")}
          >
            LLM
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "agent"}
            className={section === "agent" ? "active" : ""}
            onClick={() => setSection("agent")}
          >
            エージェント
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "skills"}
            className={section === "skills" ? "active" : ""}
            onClick={() => setSection("skills")}
          >
            スキル
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "openship"}
            className={section === "openship" ? "active" : ""}
            onClick={() => setSection("openship")}
          >
            Openship
          </button>
        </div>

        {demo && section === "llm" && (
          <div className="dialog-note warn" role="note">
            ブラウザデモでは LLM 設定を保存できません。<code>npm run tauri dev</code> で Tauri 版を起動してください。
          </div>
        )}

        {section === "agent" && <AgentPolicySettings />}
        {section === "skills" && <SkillPolicySettings />}
        {section === "openship" && <OpenShipSettings />}

        {section === "llm" && (
          <>
        <div className="settings-body">
          <label className="field-label" htmlFor="llm-provider">
            プロバイダー
          </label>
          <select
            id="llm-provider"
            className="text-input"
            value={config.provider}
            onChange={(event) => changeProvider(event.target.value as LlmProvider)}
            disabled={loading}
          >
            {PROVIDER_ORDER.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_PRESETS[provider].label}
              </option>
            ))}
          </select>
          <p className="field-help">{preset.description}</p>

          <label className="field-label" htmlFor="llm-base-url">
            Base URL
          </label>
          <input
            id="llm-base-url"
            className="text-input"
            value={config.baseUrl}
            onChange={(event) => update("baseUrl", event.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
          <p className="field-help">
            末尾の <code>/v1</code> まで含めて指定してください。http:// は localhost / 127.0.0.1 / ::1 でのみ使用できます。
          </p>

          <label className="field-label" htmlFor="llm-model">
            モデル
          </label>
          <input
            id="llm-model"
            className="text-input"
            value={config.model}
            onChange={(event) => update("model", event.target.value)}
            placeholder="gpt-4o-mini"
            list="llm-model-options"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
          <datalist id="llm-model-options">
            {(testResult?.models ?? []).slice(0, 50).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="llm-temperature">
                Temperature
              </label>
              <input
                id="llm-temperature"
                className="text-input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(event) => {
                  const value = Number.parseFloat(event.target.value);
                  update("temperature", Number.isFinite(value) ? value : 0);
                }}
                disabled={loading}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="llm-max-tokens">
                最大トークン数
              </label>
              <input
                id="llm-max-tokens"
                className="text-input"
                type="number"
                min={1}
                max={128000}
                step={1}
                value={config.maxTokens}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  update("maxTokens", Number.isFinite(value) ? value : 1);
                }}
                disabled={loading}
              />
            </div>
          </div>

          <div className="settings-divider" />

          <label className="field-label" htmlFor="llm-api-key">
            API キー
          </label>
          <div className="key-row">
            <input
              id="llm-api-key"
              className="text-input"
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(event) => {
                setKeyDraft(event.target.value);
                setError(null);
                setNotice(null);
              }}
              placeholder={
                keyReady
                  ? "設定済み（変更する場合は新しいキーを入力）"
                  : "API キーを入力"
              }
              autoComplete="off"
              spellCheck={false}
              disabled={demo || keyBusy || loading}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? "API キーを隠す" : "API キーを表示"}
              title={showKey ? "API キーを隠す" : "API キーを表示"}
              disabled={demo || loading}
            >
              <Icon name={showKey ? "eye-off" : "eye"} size={14} />
            </button>
            <button
              type="button"
              className="btn small key-save"
              onClick={() => void saveKey()}
              disabled={demo || keyBusy || loading || saving || testing || !keyDraft.trim()}
            >
              {keyBusy ? "保存中…" : "キーを保存"}
            </button>
          </div>

          <div className="key-status">
            <span className={`key-dot${keyReady ? " on" : ""}`} />
            <span>
              {providerDirty
                ? "プロバイダーを保存すると、このプロバイダーのキーの設定状態を確認できます。"
                : keyConfigured
                  ? "OS キーチェーンに保存済み"
                  : "未設定（ローカルプロバイダーでは不要な場合があります）"}
            </span>
            {keyReady && (
              <button
                type="button"
                className="link-button danger"
                onClick={() => void deleteKey()}
                disabled={demo || keyBusy || loading || saving || testing}
              >
                削除
              </button>
            )}
          </div>

          <p className="field-help">
            {preset.keyRequired
              ? "このプロバイダーでは API キーが必要です。"
              : "このプロバイダーでは API キーは通常不要です。必要な場合のみ入力してください。"}
          </p>
          <p className="field-help">
            API キーは OS キーチェーンにのみ保存され、保存後に画面・SQLite・ログへ再表示されることはありません。
          </p>

          {testResult && (
            <div
              className={`test-result ${testResult.ok ? "ok" : "ng"}`}
              role="status"
            >
              <div className="test-result-head">
                <Icon name={testResult.ok ? "check" : "alert"} size={13} />
                <span>{testResult.message}</span>
              </div>
              {testResult.models.length > 0 && (
                <div className="model-chips">
                  {testResult.models.slice(0, 24).map((model) => (
                    <button
                      type="button"
                      key={model}
                      className={`model-chip${model === config.model ? " active" : ""}`}
                      onClick={() => {
                        setConfig((current) => ({ ...current, model }));
                        setError(null);
                        setNotice(null);
                      }}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="dialog-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="dialog-notice" role="status">
              {notice}
            </div>
          )}
          {configured && !dirty && !notice && !error && (
            <p className="field-help muted">
              このプロバイダーの設定は保存済みです。
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={closeSettings}>
            閉じる
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void saveAndTest()}
            disabled={testDisabled}
          >
            {testing ? "接続テスト中…" : "保存して接続テスト"}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void save()}
            disabled={saveDisabled}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
