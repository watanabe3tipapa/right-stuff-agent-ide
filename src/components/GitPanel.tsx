import { useEffect, useState } from "react";

import type { GitFile } from "../shared/types";
import { useGitStore } from "../stores/gitStore";
import { Icon } from "./Icon";

function FileRow({
  file,
  staged,
}: {
  file: GitFile;
  staged: boolean;
}) {
  const openDiff = useGitStore((state) => state.openDiff);
  const stage = useGitStore((state) => state.stage);
  const unstage = useGitStore((state) => state.unstage);
  const acting = useGitStore((state) => state.acting);
  const busy = acting === `${staged ? "unstage" : "stage"}:${file.path}`;

  return (
    <div className={`git-file${busy ? " busy" : ""}`}>
      <button
        type="button"
        className="git-file-main"
        onClick={() => void openDiff(file.path, staged)}
        title="差分を表示"
      >
        <span className={`git-badge status-${file.status.toLowerCase()}`}>
          {file.status}
        </span>
        <span className="git-path">{file.path}</span>
      </button>
      <button
        type="button"
        className="git-file-action"
        title={staged ? "ステージから外す" : "ステージする"}
        aria-label={staged ? "ステージから外す" : "ステージする"}
        disabled={busy}
        onClick={() => void (staged ? unstage(file.path) : stage(file.path))}
      >
        {staged ? "−" : "+"}
      </button>
    </div>
  );
}

function FileGroup({
  title,
  files,
  staged,
  action,
  actionLabel,
  disabled,
}: {
  title: string;
  files: GitFile[];
  staged: boolean;
  action?: () => void;
  actionLabel?: string;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <section className="git-group">
      <div className="git-group-head">
        <span>
          {title} <span className="git-count">{files.length}</span>
        </span>
        {action && actionLabel && (
          <button
            type="button"
            className="git-link"
            onClick={action}
            disabled={disabled}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {files.map((file) => (
        <FileRow key={`${staged ? "s" : "u"}:${file.path}`} file={file} staged={staged} />
      ))}
    </section>
  );
}

export function GitPanel() {
  const status = useGitStore((state) => state.status);
  const loading = useGitStore((state) => state.loading);
  const error = useGitStore((state) => state.error);
  const notice = useGitStore((state) => state.notice);
  const diff = useGitStore((state) => state.diff);
  const diffLoading = useGitStore((state) => state.diffLoading);
  const log = useGitStore((state) => state.log);
  const logLoading = useGitStore((state) => state.logLoading);
  const committing = useGitStore((state) => state.committing);
  const acting = useGitStore((state) => state.acting);
  const refresh = useGitStore((state) => state.refresh);
  const initRepo = useGitStore((state) => state.initRepo);
  const closeDiff = useGitStore((state) => state.closeDiff);
  const stageAll = useGitStore((state) => state.stageAll);
  const unstageAll = useGitStore((state) => state.unstageAll);
  const commit = useGitStore((state) => state.commit);
  const loadLog = useGitStore((state) => state.loadLog);
  const clearNotice = useGitStore((state) => state.clearNotice);
  const clearError = useGitStore((state) => state.clearError);

  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
    void loadLog();
  }, [refresh, loadLog]);

  const stagedCount = status?.staged.length ?? 0;
  const changeCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const busy = committing || acting !== null;

  const submit = async () => {
    if (!message.trim() || stagedCount === 0) return;
    const ok = await commit(message);
    if (ok) setMessage("");
  };

  return (
    <div className="git-panel">
      <div className="git-toolbar">
        <div className="git-branch">
          <Icon name="branch" size={13} />
          <span>{status?.branch ?? "—"}</span>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="git-ahead-behind">
              {status.ahead > 0 && `↑${status.ahead}`}
              {status.behind > 0 && ` ↓${status.behind}`}
            </span>
          )}
        </div>
        <div className="git-toolbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => void refresh()}
            aria-label="Git の状態を更新"
            title="更新"
            disabled={loading || busy}
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void loadLog()}
            aria-label="コミット履歴を更新"
            title="履歴"
            disabled={logLoading}
          >
            <Icon name="history" size={13} />
          </button>
        </div>
      </div>

      {loading && !status && <div className="git-empty">Git の状態を確認しています…</div>}

      {status && !status.repo && (
        <div className="git-empty">
          <p>{status.message ?? "このワークスペースは Git リポジトリではありません。"}</p>
          <button
            type="button"
            className="btn small primary"
            onClick={() => void initRepo()}
            disabled={busy}
          >
            <Icon name="branch" size={13} />
            git init
          </button>
        </div>
      )}

      {status?.repo && (
        <>
          <div className="git-summary">
            <span>{status.clean ? "変更はありません" : `${changeCount} 件の変更`}</span>
            {stagedCount > 0 && <span>{stagedCount} 件ステージ済み</span>}
          </div>

          {status.clean && (
            <div className="git-empty">
              <p>作業ツリーはクリーンです。</p>
            </div>
          )}

          <div className="git-scroll">
            <FileGroup
              title="ステージ済み"
              files={status.staged}
              staged
              action={() => void unstageAll()}
              actionLabel="すべて外す"
              disabled={busy}
            />
            <FileGroup
              title="変更"
              files={status.unstaged}
              staged={false}
              action={() => void stageAll()}
              actionLabel="すべてステージ"
              disabled={busy}
            />
            {status.untracked.length > 0 && (
              <FileGroup
                title="未追跡"
                files={status.untracked}
                staged={false}
              />
            )}

            {diff && (
              <section className="git-diff">
                <div className="git-group-head">
                  <span>
                    {diff.staged ? "ステージ済みの差分" : "差分"}{" "}
                    <code>{diff.path}</code>
                  </span>
                  <button
                    type="button"
                    className="git-link"
                    onClick={closeDiff}
                  >
                    閉じる
                  </button>
                </div>
                {diffLoading ? (
                  <div className="git-empty">差分を読み込んでいます…</div>
                ) : (
                  <pre>{diff.diff}</pre>
                )}
              </section>
            )}

            <section className="git-commit">
              <textarea
                value={message}
                rows={3}
                placeholder="コミットメッセージ"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <button
                type="button"
                className="btn small primary"
                onClick={() => void submit()}
                disabled={
                  !message.trim() ||
                  stagedCount === 0 ||
                  committing ||
                  status === null
                }
              >
                <Icon name="check" size={13} />
                {committing ? "コミット中…" : "コミット"}
              </button>
              <p className="git-hint">⌘Enter でもコミットできます。</p>
            </section>

            {log.length > 0 && (
              <section className="git-log">
                <div className="git-group-head">
                  <span>最近のコミット</span>
                  {logLoading && <span className="git-count">更新中…</span>}
                </div>
                {log.map((entry) => (
                  <div className="git-log-row" key={entry.hash}>
                    <code>{entry.hash}</code>
                    <span className="git-log-subject">{entry.subject}</span>
                    <span className="git-log-meta">
                      {entry.author} · {entry.date}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </div>
        </>
      )}

      {notice && (
        <div className="git-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-btn" onClick={clearNotice} aria-label="閉じる">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="git-error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" onClick={clearError} aria-label="閉じる">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
