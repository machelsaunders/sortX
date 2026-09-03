const $ = (id) => document.getElementById(id)

async function load() {
  const s = await chrome.storage.local.get({ sortxUrl: 'http://localhost:3000', intervalMin: 60, likes: false, status: {} })
  $('url').value = s.sortxUrl
  $('interval').value = String(s.intervalMin)
  $('likes').checked = !!s.likes
  render(s.status)
}

function render(st = {}) {
  const el = $('status')
  if (st.state === 'running') { el.innerHTML = `<b>Syncing…</b> ${st.pages || 0} pages · ${st.imported || 0} new`; return }
  if (st.state === 'error') { el.innerHTML = `<span class="err">Error: ${st.error}</span>`; return }
  if (st.lastSync) {
    const when = new Date(st.lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    el.innerHTML = `Last sync <b>${when}</b><br>${st.imported || 0} new · ${st.skipped || 0} already saved · ${st.pages || 0} page${st.pages === 1 ? '' : 's'}`
    return
  }
  el.textContent = 'Not synced yet. Log in to x.com in this browser, then click Sync now.'
}

$('save').onclick = async () => {
  await chrome.storage.local.set({ sortxUrl: $('url').value.trim().replace(/\/$/, '') || 'http://localhost:3000', intervalMin: parseInt($('interval').value, 10), likes: $('likes').checked })
  await chrome.runtime.sendMessage({ type: 'reschedule' })
  $('status').textContent = 'Saved.'
}
$('sync').onclick = async () => { await $('save').onclick(); $('status').innerHTML = '<b>Syncing…</b>'; chrome.runtime.sendMessage({ type: 'sync', full: false }, () => load()) }
$('full').onclick = async () => { await $('save').onclick(); $('status').innerHTML = '<b>Full re-sync…</b>'; chrome.runtime.sendMessage({ type: 'sync', full: true }, () => load()) }

chrome.storage.onChanged.addListener((changes) => { if (changes.status) render(changes.status.newValue) })
load()
