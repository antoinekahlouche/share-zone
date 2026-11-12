import { mkdir, readdir, lstat, realpath, open, rm, mkdtemp } from 'node:fs/promises';
import { resolve, relative, join, dirname, sep } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';

const base = import.meta.dir;
await mkdir(resolve(process.env.SHARE_DIR || join(base, 'shared')), { recursive: true });
const root = await realpath(resolve(process.env.SHARE_DIR || join(base, 'shared')));
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function safe(value = '') {
  const path = resolve(root, value);
  if (path !== root && !path.startsWith(root + sep)) throw new HttpError(400, 'Invalid path');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new HttpError(400, 'Symbolic links are not supported'); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  return path;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const server = Bun.serve({
  hostname: '0.0.0.0', port: Number(process.env.PORT || 8080),
  maxRequestBodySize: 1024 * 1024 * 1024,
  async fetch(req) {
    try {
      const url = new URL(req.url);
      const route = url.pathname;
      if (req.method === 'GET' && (route === '/' || ['/static/app.js', '/static/style.css', '/static/favicon.svg'].includes(route))) {
        return new Response(Bun.file(join(base, route === '/' ? 'templates/index.html' : route.slice(1))));
      }
      if (route === '/api/files' && req.method === 'GET') {
        const path = await safe(url.searchParams.get('path') || '');
        const files = await Promise.all((await readdir(path)).map(async name => {
          const stat = await lstat(join(path, name));
          return stat.isSymbolicLink() ? null : { name, directory: stat.isDirectory(), size: stat.isFile() ? stat.size : 0 };
        }));
        return json(files.filter(Boolean).sort((a: any, b: any) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)));
      }
      if (route === '/api/upload' && req.method === 'POST') {
        const form = await req.formData();
        const parent = await safe(String(form.get('path') || ''));
        if (!(await lstat(parent)).isDirectory()) throw new HttpError(400, 'Invalid destination');
        for (const file of form.getAll('files')) {
          if (!(file instanceof File)) continue;
          const destination = await safe(join(relative(root, parent), file.name));
          await mkdir(dirname(destination), { recursive: true });
          const handle = await open(destination, 'wx');
          try { for await (const chunk of file.stream()) await handle.writeFile(chunk); }
          finally { await handle.close(); }
        }
        return json({ ok: true });
      }
      if (route === '/api/folder' && req.method === 'POST') {
        const data = await req.json();
        const name = String(data.name || '').trim();
        if (!name || /[/\\]/.test(name) || ['.', '..'].includes(name)) throw new HttpError(400, 'Invalid folder name');
        await mkdir(await safe(join(data.path || '', name)));
        return json({ ok: true });
      }
      if (route === '/api/files' && req.method === 'DELETE') {
        const path = await safe(url.searchParams.get('path') || '');
        if (path === root) throw new HttpError(400, 'Cannot delete shared root');
        await rm(path, { recursive: true });
        return json({ ok: true });
      }
      if (route === '/api/view' && req.method === 'GET') {
        const path = await safe(url.searchParams.get('path') || '');
        if (!(await lstat(path)).isFile()) throw new HttpError(400, 'Select files to download folders');
        const file = Bun.file(path);
        // Isolate uploaded HTML/SVG from the app's origin and API.
        return new Response(file, { headers: {
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.split(sep).pop()!)}`,
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:",
          'X-Content-Type-Options': 'nosniff'
        } });
      }
      if (route === '/api/download-selected' && req.method === 'POST') {
        const { names } = await req.json();
        if (!Array.isArray(names) || !names.length || names.some(n => typeof n !== 'string' || !n || n.includes('/') || n.includes('\\') || n === '.' || n === '..')) throw new HttpError(400, 'Invalid selection');
        const paths = await Promise.all(names.map(n => safe(n)));
        if (paths.length === 1 && (await lstat(paths[0])).isFile()) {
          return new Response(Bun.file(paths[0]), { headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(names[0])}`, 'X-Content-Type-Options': 'nosniff' } });
        }
        const temp = await mkdtemp(join(tmpdir(), 'share-zone-'));
        try {
          const archive = join(temp, 'download.zip');
          const proc = Bun.spawn(['zip', '-q', '-r', '-y', archive, '--', ...names], { cwd: root, stdout: 'ignore', stderr: 'pipe' });
          if (await proc.exited !== 0) throw new HttpError(500, 'Could not create ZIP');
          return new Response(await Bun.file(archive).arrayBuffer(), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="share-zone.zip"' } });
        } finally { await rm(temp, { recursive: true, force: true }); }
      }
      if (route === '/api/download' && req.method === 'GET') {
        const path = await safe(url.searchParams.get('path') || '');
        let file = Bun.file(path), name = path.split(sep).pop()!;
        if ((await lstat(path)).isDirectory()) {
          const temp = await mkdtemp(join(tmpdir(), 'share-zone-'));
          try {
            const archive = join(temp, 'download.zip');
            const proc = Bun.spawn(['zip', '-q', '-r', '-y', archive, '.'], { cwd: path, stdout: 'ignore', stderr: 'pipe' });
            if (await proc.exited !== 0) throw new HttpError(500, 'Could not create ZIP');
            const bytes = await Bun.file(archive).arrayBuffer();
            return new Response(bytes, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.zip')}` } });
          } finally { await rm(temp, { recursive: true, force: true }); }
        }
        return new Response(file, { headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff' } });
      }
      return json({ error: 'Not found' }, 404);
    } catch (e: any) {
      const status = e.status || (e.code === 'ENOENT' ? 404 : e.code === 'EEXIST' ? 409 : 500);
      return json({ error: status === 409 ? 'A file or folder with this name already exists' : status === 500 ? 'Operation failed' : e.message }, status);
    }
  }
});
console.log(`Share zone: http://localhost:${server.port}`);
for (const interfaces of Object.values(networkInterfaces())) for (const address of interfaces || []) if (address.family === 'IPv4' && !address.internal) console.log(`Network: http://${address.address}:${server.port}`);
