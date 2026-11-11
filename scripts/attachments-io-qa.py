import json, os, pathlib, subprocess, tempfile
base=pathlib.Path(tempfile.mkdtemp(prefix='grove-attach-')); root=base/'vault'; root.mkdir()
source=base/'picture.png'; source.write_bytes(b'\x89PNG\r\n'+bytes(range(256))*400)
helper=pathlib.Path('resources/vault_io.py').resolve()
def call(**request):
    p=subprocess.run(['python3',str(helper),str(root)],input=json.dumps(request),text=True,capture_output=True)
    return json.loads(p.stdout)
(root/'note.md').write_text('# Test')
first=call(action='importAttachment',path='note.md',source=str(source))
assert first['ok'],first
second=call(action='importAttachment',path='note.md',source=str(source))
assert second['ok'] and first['value']!=second['value']
assert (root/first['value']).read_bytes()==source.read_bytes()
existing=call(action='importAttachment',path='note.md',source=str(root/first['value']))
assert existing['ok'] and existing['value']==first['value']
link=base/'link.png';link.symlink_to(source)
assert not call(action='importAttachment',path='note.md',source=str(link))['ok']
assert not call(action='importAttachment',path='../outside.md',source=str(source))['ok']
assert source.read_bytes().startswith(b'\x89PNG')
print('PASS: stream copy, collision no-overwrite, existing vault link, symlink and traversal rejection, intact sources:',base)
