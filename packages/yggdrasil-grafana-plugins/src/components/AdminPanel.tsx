import React, { useState, useEffect, useCallback } from 'react';
import { PanelProps } from '@grafana/data';
import type { PluginOptions, HealthResponse, RunnersResponse } from '../types';

interface Props extends PanelProps<PluginOptions> {}

const style: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px',
    fontFamily: "var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
    fontSize: '13px',
    color: 'var(--text-primary, #e0e0e0)',
    height: '100%',
    overflow: 'auto',
    boxSizing: 'border-box',
  },
  card: {
    background: 'var(--card-background, #26262b)',
    borderRadius: '8px',
    padding: '14px',
    marginBottom: '12px',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  col: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  badge: (bg: string, fg: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 500,
    background: bg,
    color: fg,
  }),
  input: {
    background: 'var(--input-background, #1e1e22)',
    color: 'var(--text-primary, #e0e0e0)',
    border: '1px solid #444',
    borderRadius: '4px',
    padding: '6px 10px',
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  btn: (bg = '#7c6ff0'): React.CSSProperties => ({
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 14px',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '4px 6px',
    borderBottom: '1px solid #333',
    color: '#888',
    fontWeight: 500,
  },
  td: {
    textAlign: 'left' as const,
    padding: '4px 6px',
    borderBottom: '1px solid #333',
  },
  statusBox: {
    fontSize: '12px',
    padding: '6px 10px',
    borderRadius: '4px',
    marginTop: '6px',
  },
};

const STATUS_OK = { bg: '#1b5e20', fg: '#a5d6a7' };
const STATUS_ERR = { bg: '#b71c1c', fg: '#ef9a9a' };
const STATUS_INFO = { bg: '#1a237e', fg: '#9fa8da' };

type StatusMsg = { type: 'ok' | 'err' | 'info'; text: string } | null;

/** Badge showing the self-update status of a runner, with an expandable log viewer. */
const UpdateStatusBadge: React.FC<{ status: string; log: string }> = ({ status, log }) => {
  const [expanded, setExpanded] = useState(false);

  if (status === 'idle' || !status) return <span style={{ color: '#666' }}>—</span>;

  const colorMap: Record<string, { bg: string; fg: string }> = {
    pending: { bg: '#f57f17', fg: '#fff9c4' },
    applying: { bg: '#1565c0', fg: '#bbdefb' },
    applied: { bg: '#1b5e20', fg: '#a5d6a7' },
    failed: { bg: '#b71c1c', fg: '#ef9a9a' },
  };
  const c = colorMap[status] || { bg: '#333', fg: '#999' };

  return (
    <div>
      <span
        onClick={() => log && setExpanded(!expanded)}
        style={{
          ...style.badge(c.bg, c.fg),
          cursor: log ? 'pointer' : 'default',
          borderBottom: log ? '1px dashed ' + c.fg : 'none',
        }}
        title={log ? 'Click to expand log' : undefined}
      >
        {status}
      </span>
      {expanded && log && (
        <pre
          style={{
            margin: '4px 0 0',
            padding: '6px 8px',
            fontSize: 10,
            lineHeight: 1.4,
            background: '#111',
            color: '#aaa',
            borderRadius: 4,
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {log}
        </pre>
      )}
    </div>
  );
};

export const AdminPanel: React.FC<Props> = ({ options, height }) => {
  const baseUrl = options.yggdrasilUrl || 'http://localhost:3000';
  const apiKey = options.adminApiKey || '';

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runners, setRunners] = useState<RunnersResponse | null>(null);
  const [npmLatest, setNpmLatest] = useState<string | null>(null);
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'status' | 'control'>('status');
  const [status, setStatus] = useState<StatusMsg>(null);

  // Form fields for control tab
  const [expectedVer, setExpectedVer] = useState('');
  const [runnerVersion, setRunnerVersion] = useState('');
  const [runnerCommand, setRunnerCommand] = useState('npm update -g @theaiinc/yggdrasil-ratatoskr');
  const [runnerIds, setRunnerIds] = useState('ALL');
  const [newApiKey, setNewApiKey] = useState('');
  const [keyRunnerIds, setKeyRunnerIds] = useState('');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Admin-Api-Key'] = apiKey;

  const fetchJson = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) {
        setError('Unauthorized — check your admin API key');
        throw new Error('Unauthorized');
      }
      return res.json() as Promise<T>;
    },
    [baseUrl, apiKey],
  );

  const loadAll = useCallback(async () => {
    try {
      const [h, adm, metricsText] = await Promise.all([
        fetchJson<HealthResponse>('/health'),
        fetchJson<RunnersResponse>('/api/admin/runners'),
        fetch(`${baseUrl.replace(/\/+$/, '')}/metrics`).then((r) => r.text()),
      ]);
      setHealth(h);
      setRunners(adm);
      setExpectedVer(adm.expectedVersion || '');

      const npmM = metricsText.match(/yggdrasil_npm_latest_version\{[^}]*latest="([^"]+)"[^}]*\}\s+1/);
      const verM = metricsText.match(/yggdrasil_version_info\{[^}]*version="([^"]+)"[^}]*\}\s+1/);
      setNpmLatest(npmM ? npmM[1] : null);
      setMetricsLoaded(true);
      setError(null);
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unauthorized') {
        setError(e.message);
      }
    }
  }, [fetchJson, baseUrl]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const showStatus = (type: 'ok' | 'err' | 'info', text: string) => {
    setStatus({ type, text });
    setTimeout(() => setStatus(null), 6000);
  };

  const isLatestNpm = npmLatest && health ? npmLatest === health.version : false;

  const selfUpdate = async () => {
    try {
      const d = (await fetchJson('/api/admin/self-update')) as Record<string, string>;
      if (d.status === 'already_up_to_date') {
        showStatus('ok', `Already on ${d.currentVersion}`);
      } else {
        showStatus('info', `Updating to ${d.latestVersion}…`);
        setTimeout(() => loadAll(), 10000);
      }
    } catch {
      showStatus('err', 'Self-update failed');
    }
  };

  const setExpected = async () => {
    if (!expectedVer.trim()) return showStatus('err', 'Enter a version');
    try {
      await fetchJson('/api/admin/expected-version', { version: expectedVer.trim() });
      showStatus('ok', `Expected version set to ${expectedVer.trim()}`);
      loadAll();
    } catch {
      showStatus('err', 'Failed to set expected version');
    }
  };

  const requestUpdate = async () => {
    if (!runnerVersion.trim()) return showStatus('err', 'Enter a version');
    const ids = runnerIds.trim() === '' || runnerIds.trim().toUpperCase() === 'ALL'
      ? ['ALL']
      : runnerIds.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const d = (await fetchJson('/api/admin/runners/request-update', {
        runnerIds: ids,
        version: runnerVersion.trim(),
        command: runnerCommand.trim() || undefined,
      })) as { notifiedRunners: string[]; skippedRunners: string[] };
      showStatus('ok', `${d.notifiedRunners.length} notified, ${d.skippedRunners.length} skipped`);
      loadAll();
    } catch {
      showStatus('err', 'Update request failed');
    }
  };

  const rotateKey = async () => {
    if (!newApiKey.trim()) return showStatus('err', 'Enter a new API key');
    const ids = keyRunnerIds.trim().toUpperCase() === 'ALL' || keyRunnerIds.trim() === ''
      ? []
      : keyRunnerIds.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const d = (await fetchJson('/api/admin/api-keys/rotate', {
        newApiKey: newApiKey.trim(),
        runnerIds: ids,
      })) as { notifiedRunners: string[] };
      showStatus('ok', `Key rotated. ${d.notifiedRunners.length} runners notified.`);
      loadAll();
    } catch {
      showStatus('err', 'Key rotation failed');
    }
  };

  if (error) {
    return (
      <div style={{ ...style.container, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#ef9a9a', background: '#b71c1c22', padding: '12px', borderRadius: 6 }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...style.container, height: height || '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        <button
          onClick={() => setTab('status')}
          style={{
            padding: '6px 14px',
            borderRadius: '4px 4px 0 0',
            cursor: 'pointer',
            border: 'none',
            fontSize: 13,
            background: tab === 'status' ? style.card.background : 'transparent',
            color: tab === 'status' ? style.container.color : '#888',
          }}
        >
          Status
        </button>
        <button
          onClick={() => setTab('control')}
          style={{
            padding: '6px 14px',
            borderRadius: '4px 4px 0 0',
            cursor: 'pointer',
            border: 'none',
            fontSize: 13,
            background: tab === 'control' ? style.card.background : 'transparent',
            color: tab === 'control' ? style.container.color : '#888',
          }}
        >
          Control
        </button>
      </div>

      {tab === 'status' && (
        <>
          {/* Yggdrasil Status */}
          <div style={style.card}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Yggdrasil</div>
            <div style={style.row}>
              <span style={style.badge('#4a148c', '#ce93d8')}>
                v{health?.version || '—'}
              </span>
              <span style={style.badge(
                isLatestNpm ? '#1b5e20' : (npmLatest ? '#b71c1c' : '#333'),
                isLatestNpm ? '#a5d6a7' : (npmLatest ? '#ef9a9a' : '#999'),
              )}>
                npm: {npmLatest || '—'}{npmLatest && isLatestNpm ? ' ✓' : npmLatest ? ' (new!)' : ''}
              </span>
              <span style={style.badge('#1b5e20', '#a5d6a7')}>
                {health ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '—'}
              </span>
              <span style={style.badge('#333', '#999')}>
                runners: {runners?.count ?? '—'}
              </span>
            </div>
          </div>

          {/* Runners */}
          <div style={style.card}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Runners</div>
            {!runners ? (
              <p style={{ color: '#888' }}>Loading…</p>
            ) : runners.runners.length === 0 ? (
              <p style={{ color: '#888' }}>No runners registered.</p>
            ) : (
              <table style={style.table}>
                <thead>
                  <tr>
                    <th style={style.th}></th>
                    <th style={style.th}>ID</th>
                    <th style={style.th}>Name</th>
                    <th style={style.th}>Version</th>
                    <th style={style.th}>Status</th>
                    <th style={style.th}>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {runners.runners.map((r) => (
                    <tr key={r.runnerId}>
                      <td style={style.td}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              r.outdated ? '#ffb300'
                              : r.status === 'online' ? '#4caf50'
                              : '#666',
                          }}
                        />
                      </td>
                      <td style={{ ...style.td, fontFamily: 'monospace', fontSize: 11 }}>{r.runnerId}</td>
                      <td style={style.td}>{r.name}</td>
                      <td style={style.td}>
                        {r.outdated ? `${r.version} ← ${runners.expectedVersion}` : r.version}
                      </td>
                      <td style={style.td}>{r.status}</td>
                      <td style={style.td}>
                        <UpdateStatusBadge status={r.updateStatus} log={r.updateLog} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Actions */}
          <div style={style.card}>
            <div style={{ ...style.row, justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Actions</div>
              <button
                style={style.btn(npmLatest && health && npmLatest !== health.version ? '#4caf50' : '#555')}
                disabled={!npmLatest || !health || npmLatest === health.version}
                onClick={selfUpdate}
              >
                {npmLatest && health && npmLatest !== health.version
                  ? `Update to ${npmLatest}`
                  : 'Up to date'}
              </button>
            </div>
            {status && (
              <div
                style={{
                  ...style.statusBox,
                  background: status.type === 'ok' ? STATUS_OK.bg : status.type === 'err' ? STATUS_ERR.bg : STATUS_INFO.bg,
                  color: status.type === 'ok' ? STATUS_OK.fg : status.type === 'err' ? STATUS_ERR.fg : STATUS_INFO.fg,
                }}
              >
                {status.text}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'control' && (
        /* Expected Version */
        <div style={{ ...style.card, ...style.col }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Set Expected Runner Version</div>
          <div style={style.row}>
            <input
              style={{ ...style.input, maxWidth: 200 }}
              value={expectedVer}
              onChange={(e) => setExpectedVer(e.target.value)}
              placeholder="e.g. 0.4.0"
            />
            <button style={style.btn()} onClick={setExpected}>Set</button>
          </div>
        </div>
      )}

      {/* Update Ratatoskrs - Always visible in control tab */}
      {tab === 'control' && (
        <div style={{ ...style.card, ...style.col }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Update Ratatoskrs</div>
          <input
            style={style.input}
            value={runnerVersion}
            onChange={(e) => setRunnerVersion(e.target.value)}
            placeholder="Version (e.g. 0.4.0)"
          />
          <input
            style={style.input}
            value={runnerCommand}
            onChange={(e) => setRunnerCommand(e.target.value)}
            placeholder="npm update -g @theaiinc/yggdrasil-ratatoskr"
          />
          <div style={{ fontSize: 12, color: '#888' }}>Runner IDs (comma-separated, or ALL)</div>
          <div style={style.row}>
            <input
              style={{ ...style.input, maxWidth: 300 }}
              value={runnerIds}
              onChange={(e) => setRunnerIds(e.target.value)}
              placeholder="ALL"
            />
            <button style={style.btn()} onClick={requestUpdate}>Request Update</button>
          </div>
        </div>
      )}

      {/* Rotate API Key - Always visible in control tab */}
      {tab === 'control' && (
        <div style={{ ...style.card, ...style.col }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Rotate API Key</div>
          <input
            style={{ ...style.input, maxWidth: 300 }}
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="New API key"
          />
          <div style={{ fontSize: 12, color: '#888' }}>Runner IDs (empty = no auto-propagation)</div>
          <div style={style.row}>
            <input
              style={{ ...style.input, maxWidth: 300 }}
              value={keyRunnerIds}
              onChange={(e) => setKeyRunnerIds(e.target.value)}
              placeholder="ALL or comma-separated"
            />
            <button style={style.btn()} onClick={rotateKey}>Rotate</button>
          </div>
        </div>
      )}
    </div>
  );
};
