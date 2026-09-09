"""Check every product file against the recorded copy and original hashes."""
import argparse,hashlib,json
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,help='Optional original dist/extension directory; read only')
args=parser.parse_args()
root=Path(__file__).resolve().parent
VERSION='0.12.2'
manifest=json.loads((root/'source-provenance.json').read_text(encoding='utf-8'))
failures=[]
if manifest.get('baseVersion')!=VERSION:failures.append('Provenance version mismatch')
for label,path in [('Package',root/'package.json'),('Product',root/'product/manifest.json')]:
    if not path.is_file() or json.loads(path.read_text(encoding='utf-8')).get('version')!=VERSION:
        failures.append(label+' version mismatch')
for row in manifest['files']:
    path=root/'product'/row['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['copySha256']:
        failures.append('Copy mismatch: '+row['path'])
    if args.source:
        original=args.source/row['path']
        if not original.is_file() or hashlib.sha256(original.read_bytes()).hexdigest()!=row['sourceSha256']:
            failures.append('Original changed: '+row['path'])
recorded={row['path'] for row in manifest['files']}
actual={path.relative_to(root/'product').as_posix() for path in (root/'product').rglob('*') if path.is_file()}
if actual!=recorded:failures.append('Unrecorded or missing product files')
host_rows=manifest.get('localHarnessFiles',[])
if not host_rows:failures.append('Missing local harness provenance')
for row in host_rows:
    path=root/row['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:
        failures.append('Local harness mismatch: '+row['path'])
host_actual={path.relative_to(root).as_posix() for path in (root/'web').glob('*') if path.is_file()}
host_recorded={row['path'] for row in host_rows if row['path'].startswith('web/')}
if host_actual!=host_recorded:failures.append('Unrecorded or missing local web harness files')
qa_names={'mobile-textarea.js','plain-text.js','selection-paste.js','content.js','send-control.js','reply-reader.js'}
source_hashes={row['path']:row['sourceSha256'] for row in manifest['files']}
for name in sorted(qa_names):
    path=root/'qa/production-adapters'/name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=source_hashes.get('adapters/'+name):
        failures.append('QA original adapter mismatch: '+name)
qa_actual={path.name for path in (root/'qa/production-adapters').glob('*') if path.is_file()}
if qa_actual!=qa_names:failures.append('Unrecorded or missing QA original adapters')
result={'version':VERSION,'status':'fail' if failures else 'pass','productFiles':len(recorded),'adaptedFiles':sum(bool(row['changes']) for row in manifest['files']),'qaOriginalAdapters':len(qa_names),'localHarnessFiles':len(host_rows),'originalChecked':bool(args.source),'failures':failures}
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(bool(failures))
