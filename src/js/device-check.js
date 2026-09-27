export function recordKey(commit) {
  const normalized = String(commit ?? '').trim().toLowerCase();
  return normalized || '__unspecified__';
}

export function recordFingerprint(record) {
  return JSON.stringify({
    fields: record?.fields || {},
    checks: record?.checks || {},
  });
}

export function isPassReady(record, requiredCheckIds) {
  const fields = record?.fields || {};
  const checks = record?.checks || {};
  const hasAllChecks = requiredCheckIds.every((id) => checks[id] === true);
  const hasDeviceRecord = ['device', 'ios', 'safari', 'commit', 'viewport']
    .every((id) => String(fields[id] || '').trim());
  const hasGameForm = fields['game-form'] && fields['game-form'] !== '未選択';
  const hasPublicationRecord = [
    'planned-path',
    'public-source',
    'official-url',
  ].every((id) => String(fields[id] || '').trim())
    && fields['preview-status'] === '実機画面を確認済み'
    && fields['distribution-match'] === '一致';
  return hasAllChecks && hasDeviceRecord && hasGameForm && hasPublicationRecord;
}

export function buildReport(record, groups) {
  const fields = record?.fields || {};
  const lines = [
    'パリパリ 実機確認記録',
    `確認日: ${fields['check-date'] || '未入力'}`,
    `端末: ${fields.device || '未入力'}`,
    `iOS: ${fields.ios || '未入力'}`,
    `Safari: ${fields.safari || '未入力'}`,
    `実寸法: ${fields.viewport || '未入力'}`,
    `確認したゲーム形式: ${fields['game-form'] || '未選択'}`,
    `対象コミット: ${fields.commit || '未入力'}`,
    `総合判定: ${fields.overall || '未実施'}`,
    `公開予定パス: ${fields['planned-path'] || '未確認'}`,
    `公開元: ${fields['public-source'] || '未確認'}`,
    `正式URL: ${fields['official-url'] || '未確認'}`,
    `プレビュー画像: ${fields['preview-status'] || '未作成'}`,
    `コミットと配布物: ${fields['distribution-match'] || '未確認'}`,
    '',
  ];

  for (const group of groups) {
    const checked = group.items.filter((item) => record?.checks?.[item.id] === true).length;
    lines.push(`${group.id.toUpperCase()}: ${checked}/${group.items.length}`);
    for (const item of group.items) {
      lines.push(`${record?.checks?.[item.id] === true ? '[x]' : '[ ]'} ${item.label}`);
    }
    lines.push('');
  }

  lines.push('メモ・再現手順:');
  lines.push(fields.notes || 'なし');
  return lines.join('\n');
}

function init() {
  'use strict';

  const STORAGE_KEY = 'paripari.device-check.r6.records.v2';
  const fieldIds = [
    'check-date', 'device', 'ios', 'safari', 'commit', 'viewport', 'game-form', 'overall', 'notes',
    'planned-path', 'public-source', 'official-url', 'preview-status', 'distribution-match',
  ];
  const fields = Object.fromEntries(fieldIds.map((id) => [id, document.getElementById(id)]));
  const report = document.getElementById('report');
  const status = document.getElementById('status');
  const checkboxes = [...document.querySelectorAll('input[type="checkbox"][data-group]')];
  const requiredCheckIds = checkboxes.map((checkbox) => checkbox.id);
  const passOption = fields.overall.querySelector('option[value="合格"]');
  let records = {};
  let activeRecordKey = recordKey(fields.commit.value);
  let activeCommitValue = fields.commit.value;
  let storageAvailable = true;

  function localDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function readRecord() {
    return {
      version: 2,
      fields: Object.fromEntries(fieldIds.map((id) => [id, fields[id].value])),
      checks: Object.fromEntries(checkboxes.map((checkbox) => [checkbox.id, checkbox.checked])),
      report: report.value,
    };
  }

  function restoreRecord(record) {
    if (!record || typeof record !== 'object') return;
    for (const id of fieldIds) {
      if (typeof record.fields?.[id] === 'string') fields[id].value = record.fields[id];
    }
    for (const checkbox of checkboxes) {
      if (typeof record.checks?.[checkbox.id] === 'boolean') {
        checkbox.checked = record.checks[checkbox.id];
      }
    }
    report.value = typeof record.report === 'string' ? record.report : '';
    report.dataset.fingerprint = report.value ? recordFingerprint(record) : '';
  }

  function resetVerificationState(commitValue = '') {
    for (const checkbox of checkboxes) checkbox.checked = false;
    fields.overall.value = '未実施';
    fields['game-form'].value = '未選択';
    fields.commit.value = commitValue;
    for (const id of ['notes', 'planned-path', 'public-source', 'official-url']) fields[id].value = '';
    fields['preview-status'].value = '未作成';
    fields['distribution-match'].value = '未確認';
    report.value = '';
    report.dataset.fingerprint = '';
  }

  function readStoredRecords() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      return parsed?.version === 2 && parsed.records && typeof parsed.records === 'object'
        ? parsed.records : {};
    } catch (error) {
      storageAvailable = false;
      setStatus('端末内記録を読み込めません。必要なら記録文をコピーしてください。');
      return {};
    }
  }

  function persistRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, records }));
      return true;
    } catch (error) {
      storageAvailable = false;
      return false;
    }
  }

  function persistRecord(key, record) {
    records[key] = record;
    return persistRecords();
  }

  function ensureActiveRecord() {
    if (recordKey(fields.commit.value) !== activeRecordKey) switchRecord();
  }

  function saveRecord(showStatus = true) {
    ensureActiveRecord();
    const saved = persistRecord(activeRecordKey, readRecord());
    if (showStatus) {
      setStatus(saved
        ? `対象コミット「${activeCommitValue || '未指定'}」の記録をこの端末に保存しました。`
        : '端末内保存が使えません。記録文をコピーして残してください。');
    }
    return saved;
  }

  function updateSummary() {
    for (const group of ['x01', 'x02', 'x03']) {
      const items = checkboxes.filter((checkbox) => checkbox.dataset.group === group);
      const checked = items.filter((checkbox) => checkbox.checked).length;
      document.getElementById(`summary-${group}`).textContent = `${checked}/${items.length}`;
    }

    const record = readRecord();
    const total = checkboxes.length;
    const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
    const ready = isPassReady(record, requiredCheckIds);
    passOption.disabled = !ready;
    if (!ready && fields.overall.value === '合格') {
      fields.overall.value = '未実施';
      setStatus('未確認項目があるため、総合判定を「未実施」に戻しました。');
    }
    document.getElementById('overall-summary').textContent = `${fields.overall.value}（${checked}/${total}）`;
  }

  function markReportStale() {
    if (report.value && report.dataset.fingerprint !== recordFingerprint(readRecord())) {
      setStatus('記録内容が変わりました。「記録文を作る」で記録を更新してください。');
    }
  }

  function groupsForReport() {
    return ['x01', 'x02', 'x03'].map((group) => ({
      id: group,
      items: checkboxes
        .filter((checkbox) => checkbox.dataset.group === group)
        .map((checkbox) => ({
          id: checkbox.id,
          label: checkbox.closest('label')?.querySelector('span')?.textContent.trim() || checkbox.id,
        })),
    }));
  }

  function makeReport() {
    ensureActiveRecord();
    const current = readRecord();
    report.value = buildReport(current, groupsForReport());
    report.dataset.fingerprint = recordFingerprint(current);
    saveRecord(false);
    setStatus('記録文を作りました。内容を確認してからコピーしてください。');
    return report.value;
  }

  async function copyReport() {
    ensureActiveRecord();
    const current = readRecord();
    if (!report.value || report.dataset.fingerprint !== recordFingerprint(current)) makeReport();
    const text = report.value;
    report.focus();
    report.select();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!document.execCommand('copy')) {
        throw new Error('copy command failed');
      }
      setStatus('記録文をコピーしました。');
    } catch (error) {
      setStatus('自動コピーできません。選択中の記録文を長押ししてコピーしてください。');
    }
  }

  function switchRecord() {
    const previous = readRecord();
    previous.fields.commit = activeCommitValue;
    persistRecord(activeRecordKey, previous);

    activeCommitValue = fields.commit.value.trim();
    activeRecordKey = recordKey(activeCommitValue);
    const saved = records[activeRecordKey];
    if (saved) {
      restoreRecord(saved);
      setStatus(`対象コミット「${activeCommitValue || '未指定'}」の記録を読み込みました。`);
    } else {
      resetVerificationState(activeCommitValue);
      setStatus(`対象コミット「${activeCommitValue || '未指定'}」の新しい記録です。`);
    }
    updateSummary();
  }

  function resetRecord() {
    ensureActiveRecord();
    if (!window.confirm('この対象コミットの実機確認記録をリセットしますか？')) return;
    delete records[activeRecordKey];
    persistRecords();
    const preserved = {
      date: fields['check-date'].value || localDate(),
      device: fields.device.value || 'iPhone 17 Pro',
      ios: fields.ios.value,
      safari: fields.safari.value,
      viewport: fields.viewport.value,
    };
    resetVerificationState(activeCommitValue);
    fields['check-date'].value = preserved.date;
    fields.device.value = preserved.device;
    fields.ios.value = preserved.ios;
    fields.safari.value = preserved.safari;
    fields.viewport.value = preserved.viewport;
    updateSummary();
    setStatus('この対象コミットの記録をリセットしました。');
  }

  fields['check-date'].value ||= localDate();
  fields.device.value ||= 'iPhone 17 Pro';
  records = readStoredRecords();
  activeCommitValue = fields.commit.value.trim();
  activeRecordKey = recordKey(activeCommitValue);
  if (records[activeRecordKey]) restoreRecord(records[activeRecordKey]);

  document.getElementById('save').addEventListener('click', () => saveRecord(true));
  document.getElementById('make-report').addEventListener('click', makeReport);
  document.getElementById('copy-report').addEventListener('click', copyReport);
  document.getElementById('reset').addEventListener('click', resetRecord);
  fields.commit.addEventListener('change', switchRecord);
  for (const checkbox of checkboxes) {
    checkbox.addEventListener('change', () => { updateSummary(); markReportStale(); });
  }
  for (const [id, field] of Object.entries(fields)) {
    if (id === 'commit') continue;
    field.addEventListener('input', () => { updateSummary(); markReportStale(); });
    field.addEventListener('change', () => { updateSummary(); markReportStale(); });
  }
  window.addEventListener('pagehide', () => saveRecord(false));

  if (!storageAvailable) setStatus('端末内保存が使えません。記録文をコピーして残してください。');
  updateSummary();
}

if (typeof document !== 'undefined') init();
