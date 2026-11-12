const $ = id => document.getElementById(id);
const selection = new Set();
let items = [];
let busy = false;
async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = 'Operation failed';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response;
}
function report(error) { $('status').textContent = error.message; }
function updateActions() {
  $('actions').hidden = selection.size === 0;
  $('selected').textContent = `${selection.size} selected`;
  $('download').disabled = busy;
  $('delete').disabled = busy;
}
async function refresh() {
  try {
    items = await (await api('/api/files')).json();
    for (const name of selection) if (!items.some(file => file.name === name)) selection.delete(name);
    $('count').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    $('files').replaceChildren();
    for (const file of items) {
      const row = document.createElement('div'); row.className = 'row';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Select ${file.name}`);
      checkbox.checked = selection.has(file.name);
      checkbox.onchange = () => { checkbox.checked ? selection.add(file.name) : selection.delete(file.name); updateActions(); };
      const link = document.createElement('a'); link.className = 'name';
      link.textContent = file.name + (file.directory ? '/' : '');
      link.href = '/api/view?path=' + encodeURIComponent(file.name);
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      const size = document.createElement('span'); size.className = 'size';
      size.textContent = file.directory ? 'Folder' : formatSize(file.size);
      row.append(checkbox, link, size); $('files').append(row);
    }
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No files yet'; $('files').append(empty); }
    updateActions();
  } catch (error) { report(error); }
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 'KB' : bytes < 1024 ** 3 ? 'MB' : 'GB';
  const divisor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
  return `${(bytes / divisor).toFixed(1)} ${unit}`;
}
async function upload(files) {
  if (!files.length) return;
  $('status').textContent = 'Uploading…';
  try {
    for (const file of files) {
      const data = new FormData(); data.append('files', file, file.name);
      await api('/api/upload', { method: 'POST', body: data });
    }
    $('status').textContent = 'Upload complete';
  } catch (error) { report(error); }
  await refresh();
}
$('drop').onclick = () => $('picker').click();
$('picker').onchange = event => { const files = Array.from(event.target.files); event.target.value = ''; upload(files); };
$('drop').ondragover = event => { event.preventDefault(); $('drop').classList.add('dragging'); };
$('drop').ondragleave = () => $('drop').classList.remove('dragging');
$('drop').ondrop = event => { event.preventDefault(); $('drop').classList.remove('dragging'); upload(Array.from(event.dataTransfer.files)); };
$('download').onclick = async () => {
  busy = true; updateActions();
  try {
    const names = [...selection];
    for (const name of names) {
      const response = await api('/api/download?path=' + encodeURIComponent(name));
      const objectURL = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = objectURL;
      link.download = items.find(file => file.name === name)?.directory ? name + '.zip' : name;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
    }
  } catch (error) { report(error); }
  finally { busy = false; updateActions(); }
};
$('delete').onclick = async () => {
  busy = true; updateActions();
  try {
    for (const name of [...selection]) { await api('/api/files?path=' + encodeURIComponent(name), { method: 'DELETE' }); selection.delete(name); }
    $('status').textContent = 'Deleted';
  } catch (error) { report(error); }
  finally { busy = false; await refresh(); }
};
refresh();
