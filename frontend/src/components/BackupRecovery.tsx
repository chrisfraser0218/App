import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import Modal from "./Modal";
export interface BackupSettings {
  enabled: boolean;
  time: string;
  timeZone: string;
  daily: number;
  weekly: number;
  monthly: number;
  restoreEveryDays: number;
  externalDirectory: string;
  externalOverdueDays: number;
  version: number;
}
interface BackupRow {
  id: string;
  createdAt: string;
  reason: string;
  verification: string;
  verifiedAt: string | null;
  bytes: number;
  legacy: boolean;
  encrypted: boolean;
}
export interface BackupState {
  settings: BackupSettings;
  directory: string;
  freeBytes: number;
  lastSuccessfulBackup: string | null;
  nextScheduledBackup: string | null;
  missedBackup: boolean;
  busy: boolean;
  operation: {
    state: string;
    stage?: string;
    action?: string;
    result?: { exportId?: string };
  };
  backups: BackupRow[];
  history: {
    id: string;
    createdAt: string;
    reason: string;
    verification: string;
    message?: string;
  }[];
  external: {
    directory: string;
    available: boolean;
    lastSuccessfulCopy: string | null;
    overdue: boolean;
  };
  liveRestoreAvailable: boolean;
  launchdInstalled?: boolean;
  encrypted: boolean;
  dispatchError?: string;
  lastExport?: { exportId: string } | null;
}
const date = (value: string | null) =>
  !value
    ? "None yet"
    : Number.isNaN(Date.parse(value))
      ? value
      : new Date(value).toLocaleString();
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(2)} MB`
      : `${(bytes / 1024).toFixed(2)} KB`;
export default function BackupRecovery() {
  const [state, setState] = useState<BackupState>(),
    [draft, setDraft] = useState<BackupSettings>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [sending, setSending] = useState(false),
    [restore, setRestore] = useState<BackupRow>(),
    [confirmed, setConfirmed] = useState(false),
    [download, setDownload] = useState<string>();
  const mounted = useRef(true);
  async function load() {
    try {
      const s = await request<BackupState>("/backups");
      if (!mounted.current) return;
      setState(s);
      setDraft((old) => old ?? s.settings);
      if (s.operation.result?.exportId || s.lastExport?.exportId)
        setDownload(s.operation.result?.exportId ?? s.lastExport!.exportId);
      setError("");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    const interval = setInterval(() => {
      void load();
    }, 2500);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);
  const busy = sending || state?.busy;
  async function action(path: string, body: unknown = {}) {
    setSending(true);
    setMessage("");
    setError("");
    try {
      await request("/backups" + path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessage(
        "Operation accepted. Progress and verification results appear below.",
      );
      setRestore(undefined);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function save() {
    if (!draft) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const settings = await request<BackupSettings>("/backups/settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(settings);
      setMessage("Backup schedule and retention saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function patch<K extends keyof BackupSettings>(
    key: K,
    value: BackupSettings[K],
  ) {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
  }
  const chooseDirectory = (window as Window & { finsightDesktop?: { chooseBackupDirectory: () => Promise<string | null> } }).finsightDesktop?.chooseBackupDirectory;
  return (
    <div className="backup-workspace">
      <p className="notice">
        Full PostgreSQL backups protect all application records. Local copies on
        this Mac cannot protect against loss of the MacBook; periodically copy
        verified backups to a disconnected external SSD. Backups are not
        encrypted by this application.
      </p>
      {error && (
        <div role="alert" className="error-panel">
          <h2>Backup operation unavailable</h2>
          <p>{error}</p>
          <button className="secondary" onClick={() => void load()}>
            Refresh backup status
          </button>
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!state ? (
        <p role="status" className="notice">
          Loading local backup status…
        </p>
      ) : (
        <>
          <section className="forecast-summary" aria-label="Backup status">
            {[
              [
                "Automatic backups",
                state.settings.enabled ? "Enabled" : "Paused",
                state.missedBackup
                  ? "A missed backup is pending; retried when services are available."
                  : "Latest scheduled slot is covered.",
              ],
              [
                "Last successful backup",
                date(state.lastSuccessfulBackup),
                "Archive validation; check history for full restore-test status.",
              ],
              [
                "Next scheduled backup",
                date(state.nextScheduledBackup),
                `Business time zone: ${state.settings.timeZone}`,
              ],
              [
                "Available local disk space",
                size(state.freeBytes),
                "Low-space failures preserve existing valid backups.",
              ],
            ].map(([title, value, note]) => (
              <article className="summary-card" key={title}>
                <h2>{title}</h2>
                <div className="backup-metric">{value}</div>
                <p className="muted">{note}</p>
              </article>
            ))}
          </section>
          <section className="panel backup-section">
            <div className="panel-heading">
              <div>
                <h2>Backup & Recovery</h2>
                <p className="backup-path">{state.directory}</p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void action("")}
              >
                Backup Now
              </button>
            </div>
            <div className="forecast-padding">
              <p role="status">
                <strong>
                  {busy ? "Operation running" : state.operation.state}
                </strong>{" "}
                · {state.operation.stage ?? "Ready for a local backup"}
              </p>
              {state.dispatchError && (
                <p role="alert" className="error">
                  {state.dispatchError}
                </p>
              )}
              <p className="muted">
                The backend checks daily slots on startup and every minute. No
                frontend is required.{" "}
                {state.launchdInstalled
                  ? "The approved per-user launchd agent is loaded for closed-application scheduling."
                  : "Closed-application scheduling requires the separately approved launchd agent; it is not installed/loaded."}
              </p>
              <a className="text-button" href="#backup-history">
                View Backup History
              </a>
            </div>
          </section>
          {draft && (
            <section className="panel backup-section">
              <div className="panel-heading">
                <div>
                  <h2>Configure Backup Schedule</h2>
                  <p>
                    One shared lock prevents overlapping backend and standalone
                    jobs. Nothing runs while the Mac is powered off.
                  </p>
                </div>
              </div>
              <form
                className="backup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => patch("enabled", e.target.checked)}
                    />
                    Enable automatic daily backups
                  </label>
                  <div className="backup-fields">
                    <label>
                      Daily backup time
                      <input
                        required
                        type="time"
                        value={draft.time}
                        onChange={(e) => patch("time", e.target.value)}
                      />
                    </label>
                    <label>
                      Backup time zone
                      <input
                        required
                        value={draft.timeZone}
                        onChange={(e) => patch("timeZone", e.target.value)}
                      />
                    </label>
                    {(["daily", "weekly", "monthly"] as const).map((key) => (
                      <label key={key}>
                        Keep {key} versions
                        <input
                          type="number"
                          required
                          min="1"
                          max="365"
                          value={draft[key]}
                          onChange={(e) => patch(key, Number(e.target.value))}
                        />
                      </label>
                    ))}
                    <label>
                      Full restore-test interval (days)
                      <input
                        type="number"
                        required
                        min="1"
                        max="365"
                        value={draft.restoreEveryDays}
                        onChange={(e) =>
                          patch("restoreEveryDays", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <p className="muted">
                    Retention keeps the latest backup in each retained daily,
                    weekly, and monthly period. Safety backups and existing
                    migration backups are pinned. A newer verified backup must
                    exist before managed versions are removed.
                  </p>
                  <label>
                    External backup directory
                    <input
                      placeholder="/Volumes/My SSD/FinSight Backups"
                      value={draft.externalDirectory}
                      onChange={(e) =>
                        patch("externalDirectory", e.target.value)
                      }
                    />
                  </label>
                  {chooseDirectory && <button type="button" className="secondary" onClick={async () => { try { const path = await chooseDirectory(); if (path) patch("externalDirectory", path); } catch { setError("The local folder dialog could not open. You can enter a folder path directly."); } }}>Choose external backup folder…</button>}
                  <label>
                    External backup overdue after (days)
                    <input
                      type="number"
                      required
                      min="1"
                      max="365"
                      value={draft.externalOverdueDays}
                      onChange={(e) =>
                        patch("externalOverdueDays", Number(e.target.value))
                      }
                    />
                  </label>
                  <div className="backup-actions">
                    <button className="primary">Save backup settings</button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDraft(state.settings)}
                    >
                      Reload saved settings
                    </button>
                  </div>
                </fieldset>
              </form>
            </section>
          )}
          <section className="panel backup-section">
            <div className="panel-heading">
              <div>
                <h2>External SSD copies</h2>
                <p>
                  {state.external.directory ||
                    "No external destination configured"}
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy || !state.external.available}
                onClick={() => void action("/external-copy")}
              >
                Copy verified backups to external drive
              </button>
            </div>
            <div className="forecast-padding">
              <p>
                {state.external.available
                  ? "Destination available"
                  : "External destination unavailable or disconnected. Local budgeting and backups continue."}
              </p>
              <p>
                Last verified external copy:{" "}
                {date(state.external.lastSuccessfulCopy)}
              </p>
              {state.external.overdue && (
                <p className="notice">
                  External backups are overdue. Connect the configured SSD and
                  copy verified backups.
                </p>
              )}
              <p className="muted">
                The destination must be an existing directory on a mounted
                /Volumes drive. No drive is erased or formatted, and local
                backups are never deleted because an external copy exists.
              </p>
            </div>
          </section>
          <section id="backup-history" className="panel backup-section">
            <div className="panel-heading">
              <div>
                <h2>Backup history</h2>
                <p>
                  Archive verification checks decoding/checksums. Restore
                  verification compares full rows, counts and exact balances in
                  isolated copies.
                </p>
              </div>
            </div>
            {!state.backups.length ? (
              <p className="empty">
                No managed backups yet. Choose Backup Now to create the first
                verified archive.
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Created / identifier</th>
                      <th>Kind</th>
                      <th>Verification</th>
                      <th>Size</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.backups.map((b) => (
                      <tr key={b.id}>
                        <td>
                          {date(b.createdAt)}
                          <small className="recurring-meta">{b.id}</small>
                        </td>
                        <td>{b.legacy ? "Legacy · protected" : b.reason}</td>
                        <td>
                          {b.verification.replaceAll("_", " ")}
                          <small className="recurring-meta">Unencrypted</small>
                        </td>
                        <td>{size(b.bytes)}</td>
                        <td>
                          <div className="recurring-row-actions">
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => void action(`/${b.id}/verify`)}
                            >
                              Verify Backup
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => {
                                setRestore(b);
                                setConfirmed(false);
                              }}
                            >
                              Restore From Backup
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="forecast-padding">
              <h3>Recent operations and failures</h3>
              {!state.history.length ? (
                <p className="muted">No operations recorded.</p>
              ) : (
                <ul className="backup-operation-list">
                  {state.history.slice(0, 20).map((h, i) => (
                    <li key={h.id + i}>
                      <strong>
                        {h.reason} · {h.verification.replaceAll("_", " ")}
                      </strong>
                      <span>{date(h.createdAt)}</span>
                      {h.message && <p className="error">{h.message}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="panel backup-section">
            <div className="panel-heading">
              <div>
                <h2>Financial data exports</h2>
                <p>
                  Transactions, categories, recurring schedules, plans, accounts,
                  preferences, savings goals, allocations and correction history.
                </p>
              </div>
            </div>
            <div className="forecast-padding">
              <p className="notice">
                CSV and JSON exports are not substitutes for full PostgreSQL
                backups. Downloads contain sensitive financial information; keep
                them local and private.
              </p>
              <div className="backup-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action("/exports", { format: "json" })}
                >
                  Export JSON
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action("/exports", { format: "csv" })}
                >
                  Export CSV bundle
                </button>
                {download && (
                  <a
                    className="primary"
                    href={`/api/backups/exports/${download}`}
                    download
                  >
                    Download prepared export
                  </a>
                )}
              </div>
            </div>
          </section>
        </>
      )}
      {restore && (
        <Modal
          title="Restore verification and recovery"
          onClose={() => !busy && setRestore(undefined)}
        >
          <div className="form-stack">
            <p>
              Selected backup: <strong>{restore.id}</strong>
            </p>
            <p>Created: {date(restore.createdAt)}</p>
            <p className="notice">
              This action validates the archive, creates a verified safety
              backup of current data, then restores into newly named protected
              databases and compares records and balances. Your active database
              is not replaced.
            </p>
            <p>
              Replacing live data with an older backup can discard newer
              financial records. Live replacement is unavailable in this phase;
              use the documented recovery procedure after verification and a
              deliberate cutover.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm this isolated restore test and the current-data safety
              backup.
            </label>
            <button
              className="primary"
              disabled={busy || !confirmed}
              onClick={() =>
                void action(`/${restore.id}/restore-test`, { confirmed: true })
              }
            >
              Confirm isolated restore test
            </button>
            <button className="secondary" disabled>
              Replace active database — unavailable
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
