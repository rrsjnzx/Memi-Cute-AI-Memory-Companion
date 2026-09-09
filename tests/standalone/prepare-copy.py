"""Create an auditable standalone copy; never edits the source extension."""
import hashlib,json,sys
from pathlib import Path

root=Path(__file__).resolve().parent
VERSION='0.12.2'
assert json.loads((root/'package.json').read_text(encoding='utf-8'))['version']==VERSION
source=Path(sys.argv[1]).resolve()
assert (source/'manifest.json').is_file()
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
assert manifest['version']==VERSION, 'Build version must match this standalone package'
assert (source/'adapters/mobile-textarea.js').is_file(), 'Formal build must include the mobile editing dependency'
assert (source/'adapters/selection-paste.js').is_file(), 'Formal build must include the Qianwen selection/paste dependency'
assert (source/'core/rejected-reply.js').is_file(), 'Formal build must include the rejected-reply diagnostic recovery filter'
rows=[]
patches=[json.loads(path.read_text(encoding='utf-8')) for path in sorted((root/'patches').glob('*.json'))]
for path in sorted(source.rglob('*')):
    if not path.is_file():continue
    rel=path.relative_to(source)
    if any(part in {'tests','fixtures'} for part in rel.parts):continue
    raw=path.read_bytes();out=raw;changes=[]
    if str(rel).replace('\\','/') in {'adapters/content.js','adapters/reply-reader.js','adapters/send-control.js'}:
        text=raw.decode('utf-8');old='(() => {'
        assert text.count(old)==1
        text=text.replace(old,old+'\n  // Local-only test environment. No requests to this simulated site.\n  const location=globalThis.__WEB_TEST_LOCATION__||globalThis.location;',1)
        out=text.encode('utf-8');changes.append('Explicit local mock location supplied by harness')
    if str(rel).replace('\\','/')=='adapters/floating-shell.js':
        text=raw.decode('utf-8')
        old="url.protocol!=='chrome-extension:'||url.host!==chrome.runtime.id||url.pathname!=='/floating.html'"
        assert old in text
        text=text.replace(old,"url.origin!==globalThis.location.origin||url.pathname!=='/product/floating.html'",1)
        assert "attachShadow({mode:'closed'})" in text
        text=text.replace("attachShadow({mode:'closed'})", "attachShadow({mode:'open'})", 1)
        out=text.encode('utf-8');changes.append('Allow only same-origin /product/floating.html in local harness instead of chrome-extension origin')
        changes.append('Open shadow root in standalone copy so browser inspection can reach the floating iframe; production remains closed')
    if rel.name in {'manager.html','sidepanel.html','floating.html'}:
        text=raw.decode('utf-8');script='ui.js' if rel.name!='floating.html' else 'floating.js'
        old=f'<script type="module" src="{script}"></script>'
        assert old in text
        text=text.replace(old,f'<script type="module" src="../web/boot-{script}"></script>')
        out=text.encode('utf-8');changes.append('Load local browser-API bridge before unchanged UI module')
    for patch in patches:
        if patch['path']!=rel.as_posix():continue
        text=out.decode('utf-8')
        newline='\r\n' if '\r\n' in text else '\n'
        for replacement in patch['replacements']:
            before=replacement['before'].replace('\r\n','\n').replace('\n',newline)
            after=replacement['after'].replace('\r\n','\n').replace('\n',newline)
            assert text.count(before)==1, f"Patch source mismatch: {patch['path']}"
            text=text.replace(before,after,1)
        out=text.encode('utf-8');changes.append(patch['description'])
    target=root/'product'/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(out)
    rows.append({'path':rel.as_posix(),'sourceSha256':hashlib.sha256(raw).hexdigest(),'copySha256':hashlib.sha256(out).hexdigest(),'changes':changes})
host_paths=[*sorted((root/'web').glob('*')),*(root/name for name in ['index.html','prepare-copy.py','verify-package.py','package-release.py','package.json','serve.py'])]
host_rows=[{'path':path.relative_to(root).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in host_paths if path.is_file()]
(root/'source-provenance.json').write_text(json.dumps({'baseVersion':VERSION,'networkTarget':'localhost only; AI messages are scripted fixtures','feedbackTransport':'Local Port substitute between actual sidepanel and mock iframes; no native browser API acceptance','files':rows,'localHarnessFiles':host_rows},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'copiedFiles':len(rows),'adaptedFiles':sum(bool(row['changes']) for row in rows),'originalUnchanged':True}))
for name in ['mobile-textarea.js','plain-text.js','selection-paste.js','content.js','send-control.js','reply-reader.js']:
    target=root/'qa/production-adapters'/name
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes((source/'adapters'/name).read_bytes())
