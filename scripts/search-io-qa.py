import json, pathlib, subprocess, tempfile, hashlib
base=pathlib.Path(tempfile.mkdtemp(prefix='grove-search-'));root=base/'vault';root.mkdir()
(root/'unicode.txt').write_text('😀 ÉTÉ\néTé',encoding='utf8');(root/'binary.bin').write_bytes(b'\x00\xff');(root/'alias.txt').symlink_to(root/'unicode.txt')
request=dict(action='searchText',path='search',paths=['unicode.txt','alias.txt','binary.bin','../escape'],query='été')
p=subprocess.run(['python3','resources/vault_io.py',str(root)],input=json.dumps(request),text=True,capture_output=True,check=True)
rows=[json.loads(line) for line in p.stdout.splitlines()];hits=[hit for row in rows for hit in row.get('hits',[])]
assert [(hit['from'],hit['to'],hit['line']) for hit in hits]==[(3,6,1),(7,10,2)],hits
assert hits[0]['sourceHash']==hashlib.sha256((root/'unicode.txt').read_bytes()).hexdigest()
assert len([row for row in rows if 'error' in row])==3,rows
print('PASS: batched confined search, Unicode UTF-16 offsets, hashes, symlink/binary/traversal rejection:',base)
