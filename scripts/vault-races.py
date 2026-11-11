#!/usr/bin/python3
import ctypes
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile

repo=Path(__file__).resolve().parent.parent
helper=repo/'resources/vault_io.py'
def call(root,request,driver=None):
    args=['/usr/bin/python3',str(helper),str(root)] if not driver else ['/usr/bin/python3','-c',driver,str(helper),str(root)]
    result=subprocess.run(args,input=json.dumps(request),text=True,capture_output=True,check=True)
    return json.loads(result.stdout)
with tempfile.TemporaryDirectory(prefix='folio-race-') as directory:
    root=Path(directory)
    note=root/'note.md'
    note.write_text('base')
    base=hashlib.sha256(b'base').hexdigest()
    driver=r'''
import ctypes,os,runpy,sys
real=ctypes.CDLL
class Library:
    def __init__(self,*args,**kw):
        self.inner=real(*args,**kw);self.fired=False
    def __getattr__(self,name):
        if name!='renameat2':return getattr(self.inner,name)
        def rename(source_fd,source,target_fd,target,flags):
            if flags==2 and not self.fired:
                self.fired=True
                fd=os.open('note.md',os.O_WRONLY|os.O_TRUNC,dir_fd=target_fd)
                os.write(fd,b'external-at-commit');os.close(fd)
            return self.inner.renameat2(source_fd,source,target_fd,target,flags)
        return rename
ctypes.CDLL=Library
sys.argv=[sys.argv[1],sys.argv[2]]
runpy.run_path(sys.argv[0],run_name='__main__')
'''
    result=call(root,dict(action='write',path='note.md',content='mine',hash=base),driver)
    assert result['ok'] and result['value']['status']=='conflict',result
    assert note.read_text()=='external-at-commit'
    history=call(root,dict(action='versions',path='note.md'))['value']
    assert any(item['content']=='mine' for item in history)
    note.write_text('base')
    old=open(note,'r+b',buffering=0)
    result=call(root,dict(action='write',path='note.md',content='mine',hash=base))
    assert result['value']['status']=='saved'
    old.seek(0);old.write(b'late external write');old.truncate();old.close()
    history=call(root,dict(action='versions',path='note.md'))['value']
    assert any(item['content']=='late external write' for item in history),history
    print('PASS: save-race conflict rollback and late writes to displaced inode stay recoverable')
