#!/usr/bin/env python3
"""Build source-only development archives from an explicit allowlist."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
out = root / 'dist'
out.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text())['version']
folders = ['core', 'adapters', 'codex-to-antigravity', 'dsh-to-antigravity', 'dashboard', 'scripts', 'tests', 'docs']
files = [root / p for p in ['README.md', 'LICENSE', 'THIRD_PARTY.md', 'package.json', 'package-lock.json', '.gitignore', 'config/bridge.example.json']]
for folder in folders:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file())
for p in files:
    if p.is_symlink() or p.suffix in ['.log', '.sqlite'] or '__pycache__' in p.parts:
        raise SystemExit(f'Unexpected source entry: {p.relative_to(root)}')
checksums = []
for flavor in ['codex', 'dsh']:
    name = f'{flavor}-to-antigravity-dev-{version}'
    archive = out / (name + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(files):
            z.write(p, name + '/' + p.relative_to(root).as_posix())
        z.writestr(name + '/flavor.json', json.dumps({'flavor': flavor, 'version': version}) + '\n')
        z.writestr(name + '/workspaces/.gitkeep', '')
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert not any('/data/' in n or '/runtime/' in n or '/node_modules/' in n or n.endswith('/config/local.json') for n in z.namelist())
    checksums.append(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name)
    print(f'{archive.name}: {archive.stat().st_size} bytes')
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
