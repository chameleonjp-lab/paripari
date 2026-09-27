(() => {
  'use strict';

  const STORAGE_KEY = 'paripari.device-check.r6.v1';
  const fieldIds = ['check-date', 'device', 'ios', 'safari', 'commit', 'overall', 'notes'];
  const fields = Object.fromEntries(fieldIds.map((id) => [id, document.getElementById(id)]));
  const report = document.getElementById('report');
  const status = document.getElementById('status');
  const checkboxes = [...document.querySelectorAll('input[type="checkbox"][data-group]')];

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

  function updateSummary() {
    for (const group of ['x01', 'x02', 'x03']) {
      const items = checkboxes.filter((checkbox) => checkbox.dataset.group === group);
      const checked = items.filter((checkbox) => checkbox.checked).length;
      document.getElementById(`summary-${group}`).textContent = `${checked}/${items.length}`;
    }

    const total = checkboxes.length;
    const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
    const overall = fields.overall.value;
    document.getElementById('overall-summary').textContent = `${overall}（${checked}/${total}）`;
  }

  function readRecord() {
    return {
      version: 1,
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
    if (typeof record.report === 'string') report.value = record.report;
  }

  function saveRecord(showStatus = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readRecord()));
      if (showStatus) setStatus('この端末に保存しました。');
      return true;
    } catch (error) {
      if (showStatus) setStatus('端末内保存が使えません。記録文をコピーして残してください。');
      return false;
    }
  }

  function loadRecord() {
    fields['check-date'].value ||= localDate();
    fields.device.value ||= 'iPhone 17 Pro';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        restoreRecord(JSON.parse(saved));
        setStatus('前回の端末内記録を読み込みました。');
      }
    } catch (error) {
      setStatus('端末内記録を読み込めません。必要なら記録文をコピーしてください。');
    }
  }

  function labelFor(checkbox) {
    return checkbox.closest('label')?.querySelector('span')?.textContent.trim() || checkbox.id;
  }

  function makeReport() {
    const record = readRecord();
    const lines = [
      'パリパリ 実機確認記録',
      `確認日: ${record.fields['check-date'] || '未入力'}`,
      `端末: ${record.fields.device || '未入力'}`,
      `iOS: ${record.fields.ios || '未入力'}`,
      `Safari: ${record.fields.safari || '未入力'}`,
      `対象コミット: ${record.fields.commit || '未入力'}`,
      `総合判定: ${record.fields.overall || '未実施'}`,
      '',
    ];

    for (const group of ['x01', 'x02', 'x03']) {
      const items = checkboxes.filter((checkbox) => checkbox.dataset.group === group);
      const checked = items.filter((checkbox) => checkbox.checked).length;
      lines.push(`${group.toUpperCase()}: ${checked}/${items.length}`);
      for (const checkbox of items) {
        lines.push(`${checkbox.checked ? '[x]' : '[ ]'} ${labelFor(checkbox)}`);
      }
      lines.push('');
    }

    lines.push('メモ・再現手順:');
    lines.push(record.fields.notes || 'なし');
    report.value = lines.join('\n');
    saveRecord(false);
    setStatus('記録文を作りました。内容を確認してからコピーしてください。');
    return report.value;
  }

  async function copyReport() {
    const text = report.value || makeReport();
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
      setStatus('記録文を選択しました。コピー操作を続けてください。');
    }
  }

  function resetRecord() {
    if (!window.confirm('この端末に保存した実機確認記録をリセットしますか？')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* 保存不可でも画面は初期化する */ }
    for (const id of fieldIds) fields[id].value = '';
    for (const checkbox of checkboxes) checkbox.checked = false;
    report.value = '';
    fields['check-date'].value = localDate();
    fields.device.value = 'iPhone 17 Pro';
    updateSummary();
    setStatus('記録をリセットしました。');
  }

  document.getElementById('save').addEventListener('click', () => saveRecord(true));
  document.getElementById('make-report').addEventListener('click', makeReport);
  document.getElementById('copy-report').addEventListener('click', copyReport);
  document.getElementById('reset').addEventListener('click', resetRecord);
  for (const checkbox of checkboxes) checkbox.addEventListener('change', updateSummary);
  fields.overall.addEventListener('change', updateSummary);
  window.addEventListener('pagehide', () => saveRecord(false));

  loadRecord();
  updateSummary();
})();
