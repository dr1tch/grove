#!/usr/bin/python3
"""Linux vault access: kernel path confinement and recoverable atomic replacement."""
import ctypes
import errno
import fcntl
import hashlib
import json
import mimetypes
import os
import sys
import stat
import time
import uuid
import re

libc = ctypes.CDLL(None, use_errno=True)
class OpenHow(ctypes.Structure):
    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]

root = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
request = json.load(sys.stdin)
action = request['action']

def uid():
    return str(uuid.uuid4())

def validate(path, internal=False):
    if (not isinstance(path, str) or not path or path.startswith('/') or '\\' in path
            or '\0' in path or any(part in ('', '.', '..') or (not internal and part.startswith('.'))
                                   for part in path.split('/'))):
        raise ValueError('Invalid vault path')

def safe(path, flags=os.O_RDONLY, mode=0):
    validate(path, internal=True)
    how = OpenHow(flags | os.O_CLOEXEC, mode, 0x08 | 0x04 | 0x02)
    fd = libc.syscall(437, root, path.encode(), ctypes.byref(how), ctypes.sizeof(how))
    if fd < 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), path)
    return fd

def directory(path):
    if not path:
        return os.dup(root)
    validate(path, internal=True)
    parts = path.split('/')
    current = os.dup(root)
    try:
        for index, part in enumerate(parts):
            if part in ('', '.', '..'):
                raise ValueError('Invalid directory')
            try:
                os.mkdir(part, 0o700, dir_fd=current)
            except FileExistsError:
                pass
            next_fd = safe('/'.join(parts[:index+1]), os.O_RDONLY | os.O_DIRECTORY)
            os.close(current)
            current = next_fd
        return os.dup(current)
    finally:
        os.close(current)

def bytes_at(path):
    fd = safe(path)
    try:
        info = os.fstat(fd)
        if info.st_size > 20 * 1024 * 1024:
            raise ValueError('File is too large to edit (20 MB maximum)')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise ValueError('File is too large to edit')
        return data, info
    finally:
        os.close(fd)

def doc(path):
    data, info = bytes_at(path)
    content = data.decode('utf-8', errors='strict')
    if '\0' in content:
        raise ValueError('Binary file cannot be edited as text')
    return dict(path=path, content=content, hash=hashlib.sha256(data).hexdigest(), modified=info.st_mtime * 1000)

def write_at(folder, name, data, mode=0o600):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=folder)
    try:
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)

def rename(source_fd, source, target_fd, target, flags):
    result = libc.renameat2(source_fd, source.encode(), target_fd, target.encode(), flags)
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), target)
    os.fsync(source_fd)
    os.fsync(target_fd)

def meta(folder, id, path, author, **details):
    value = dict(id=id, path=path, at=int(time.time()*1000), author=author, **details)
    write_at(folder, id+'.json', json.dumps(value).encode())
    return value

def snapshot(path, content, author):
    history = directory('.folio/history')
    try:
        id = uid()
        write_at(history, id+'.data', content.encode())
        meta(history, id, path, author)
    finally:
        os.close(history)

def replace_json(folder, name, value):
    temp = '.rename-'+uid()+'.tmp'
    try:
        write_at(folder, temp, json.dumps(value).encode())
        rename(folder, temp, folder, name, 0)
    finally:
        try:
            os.unlink(temp, dir_fd=folder)
        except FileNotFoundError:
            pass

def record_link_replacement(private, path, parent, temporary, content, expected_hash):
    try:
        data, _ = bytes_at('.folio/link-rename.json')
    except FileNotFoundError:
        return
    journal = json.loads(data)
    known = [journal['identity']] + journal.get('replacementIdentities', [])
    if path != journal['target'] or identity(path) not in known:
        return
    for item in journal['files']:
        desired_hash = hashlib.sha256(item['content'].encode()).hexdigest()
        if item['newPath'] == path and item['content'] == content and expected_hash in (item['hash'], desired_hash):
            info = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
            journal.setdefault('replacementIdentities', []).append([info.st_dev, info.st_ino])
            replace_json(private, 'link-rename.json', journal)
            return

def identity(path):
    try:
        fd = safe(path, os.O_PATH)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        return [info.st_dev, info.st_ino]
    finally:
        os.close(fd)

def recover_rename(private):
    try:
        data, _ = bytes_at('.folio/rename.json')
    except FileNotFoundError:
        return
    journal = json.loads(data)
    # The inode disambiguates a completed move from a failed NOREPLACE attempt.
    if identity(journal['source']) == journal['identity']:
        pass
    elif identity(journal['target']) == journal['identity']:
        history = directory('.folio/history')
        try:
            for item in journal['entries']:
                if str(uuid.UUID(item['id'])) != item['id']:
                    raise ValueError('Invalid rename history ID')
                replace_json(history, item['id']+'.json', item)
        finally:
            os.close(history)
    else:
        raise ValueError('Rename recovery needs attention: .folio/rename.json retained')
    os.unlink('rename.json', dir_fd=private)
    os.fsync(private)

def prepare_rename(private, source, target, is_folder):
    history = directory('.folio/history')
    items = []
    try:
        for filename in os.listdir(history):
            if not filename.endswith('.json'):
                continue
            id = filename[:-5]
            if str(uuid.UUID(id)) != id:
                continue
            data, _ = bytes_at('.folio/history/'+filename)
            item = json.loads(data)
            old = item['path']
            if old == source or (is_folder and old.startswith(source+'/')):
                item['id'] = id
                item['path'] = target+old[len(source):]
                items.append(item)
    finally:
        os.close(history)
    replace_json(private, 'rename.json', dict(source=source, target=target,
                 identity=identity(source), entries=items))

def entries(folder_name):
    try:
        fd = safe(folder_name, os.O_RDONLY | os.O_DIRECTORY)
    except FileNotFoundError:
        return []
    result = []
    try:
        for filename in os.listdir(fd):
            if not filename.endswith('.json'):
                continue
            try:
                id = filename[:-5]
                if str(uuid.UUID(id)) != id:
                    continue
                data, _ = bytes_at(folder_name+'/'+filename)
                item = json.loads(data)
                payload = folder_name+'/'+id+'.data'
                payload_fd = safe(payload, os.O_PATH)
                try:
                    info = os.fstat(payload_fd)
                finally:
                    os.close(payload_fd)
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    continue
                if folder_name == '.trash':
                    item['id'] = id
                    item['directory'] = stat.S_ISDIR(info.st_mode)
                    item['size'] = info.st_size
                if stat.S_ISREG(info.st_mode):
                    try:
                        content, _ = bytes_at(payload)
                        text = content.decode('utf-8', errors='strict')
                        if '\0' not in text:
                            item['content'] = text
                    except (ValueError, UnicodeError):
                        pass
                if folder_name != '.trash' and 'content' not in item:
                    continue
                if folder_name == '.trash':
                    item['deleted'] = item['at']
                result.append(item)
            except (FileNotFoundError, ValueError, UnicodeError):
                continue
    finally:
        os.close(fd)
    return sorted(result, key=lambda item:item['at'], reverse=True)

lock = None
private = None
try:
    path = request.get('path', '')
    if action not in ('list', 'trashList', 'undelete'):
        validate(path)
    if action == 'rename':
        validate(request['newPath'])
    # Serialize metadata with renames, but keep read-only folders readable.
    lock = None
    private = None
    mutation = action in ('putLinkJournal', 'clearLinkJournal', 'importAttachment', 'checkpoint', 'create', 'mkdir', 'rename', 'write', 'trash', 'trashEntry', 'undelete')
    try:
        private = directory('.folio') if mutation else safe('.folio', os.O_RDONLY | os.O_DIRECTORY)
        try:
            lock = os.open('io.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=private)
        except PermissionError:
            lock = os.open('io.lock', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=private)
        fcntl.flock(lock, fcntl.LOCK_EX)
        recover_rename(private)
    except FileNotFoundError:
        if mutation:
            raise
    if action == 'getLinkJournal':
        try:
            data, _ = bytes_at('.folio/link-rename.json')
            result = json.loads(data)
            result['location'] = 'source' if identity(result['source']) == result['identity'] else 'target' if identity(result['target']) in [result['identity']] + result.get('replacementIdentities', []) else 'unknown'
        except FileNotFoundError:
            result = None
    elif action == 'putLinkJournal':
        journal = request['journal']
        validate(journal['source'])
        validate(journal['target'])
        if len(json.dumps(journal).encode()) > 20*1024*1024:
            raise ValueError('Link recovery plan exceeds 20 MB; split this rename into smaller moves')
        for item in journal['files']:
            validate(item['path'])
            validate(item['newPath'])
        try:
            data, _ = bytes_at('.folio/link-rename.json')
            existing = json.loads(data)
            if request.get('initial') or existing['id'] != journal['id']:
                raise ValueError('Resolve the pending link rename first')
            journal['identity'] = existing['identity']
            journal['replacementIdentities'] = existing.get('replacementIdentities', [])
        except FileNotFoundError:
            if not request.get('initial'):
                raise ValueError('Link recovery journal is missing')
            journal['identity'] = identity(journal['source'])
            journal['replacementIdentities'] = []
            if journal['identity'] is None:
                raise ValueError('Rename source is missing')
        replace_json(private, 'link-rename.json', journal)
        result = journal
    elif action == 'clearLinkJournal':
        data, _ = bytes_at('.folio/link-rename.json')
        if json.loads(data)['id'] != request['id']:
            raise ValueError('Link recovery plan changed')
        os.unlink('link-rename.json', dir_fd=private)
        os.fsync(private)
        result = None
    elif action == 'searchText':
        paths = request.get('paths')
        query = request.get('query')
        if not isinstance(paths, list) or len(paths) > 100000 or not isinstance(query, str) or not 1 <= len(query) <= 256:
            raise ValueError('Invalid search')
        if lock is not None:
            os.close(lock)
            lock = None
        expression = re.compile(re.escape(query), re.IGNORECASE)
        total = 0
        for candidate in paths:
            if total >= 1000:
                break
            try:
                validate(candidate)
                fd = safe(candidate)
                try:
                    if os.pread(fd, 5, 0) == b'%PDF-':
                        print(json.dumps(dict(pdf=candidate)), flush=True)
                        continue
                finally:
                    os.close(fd)
                data, _ = bytes_at(candidate)
                text = data.decode('utf-8', errors='strict')
                if '\0' in text:
                    raise ValueError('Binary file has no searchable text')
                hits = []
                line, scanned, units = 1, 0, 0
                digest = hashlib.sha256(data).hexdigest()
                for match in expression.finditer(text):
                    prefix = text[scanned:match.start()]
                    line += prefix.count('\n')
                    units += len(prefix.encode('utf-16-le')) // 2
                    hits.append(dict(path=candidate, sourceHash=digest, line=line, **{'from': units}, to=units+len(match.group().encode('utf-16-le'))//2, snippet=text[max(0,match.start()-50):match.end()+100]))
                    scanned = match.start()
                    total += 1
                    if total >= 1000:
                        break
                print(json.dumps(dict(hits=hits)), flush=True)
            except Exception as error:
                print(json.dumps(dict(error=dict(path=candidate, error=str(error)))), flush=True)
        result = None
    elif action == 'list':
        result=[]
        def walk(folder):
            fd=safe(folder,os.O_RDONLY|os.O_DIRECTORY) if folder else os.dup(root)
            try:
                with os.scandir(fd) as children:
                    for entry in children:
                        if entry.name.startswith('.') or entry.name=='node_modules' or entry.is_symlink():
                            continue
                        child=folder+'/'+entry.name if folder else entry.name
                        try:
                            if entry.is_dir(follow_symlinks=False):
                                info=entry.stat(follow_symlinks=False)
                                result.append(dict(path=child,name=entry.name,kind='folder',size=0,modified=info.st_mtime*1000))
                                walk(child)
                            elif entry.is_file(follow_symlinks=False):
                                info=entry.stat(follow_symlinks=False)
                                result.append(dict(path=child,name=entry.name,size=info.st_size,modified=info.st_mtime*1000))
                        except OSError:
                            continue
            finally:
                os.close(fd)
        walk('')
    elif action == 'importAttachment':
        if not path.lower().endswith(('.md', '.markdown')):
            raise ValueError('Attachments require a Markdown note')
        note = safe(path)
        os.close(note)
        source = request.get('source')
        if not isinstance(source, str) or not os.path.isabs(source) or '\0' in source:
            raise ValueError('Invalid attachment source')
        filesystem = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
        how = OpenHow(os.O_RDONLY | os.O_CLOEXEC | os.O_NONBLOCK, 0, 0x08 | 0x04 | 0x02)
        source_fd = libc.syscall(437, filesystem, source.lstrip('/').encode(), ctypes.byref(how), ctypes.sizeof(how))
        os.close(filesystem)
        if source_fd < 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code), source)
        folder = None
        temporary = '.import-'+uid()
        try:
            before = os.fstat(source_fd)
            if not stat.S_ISREG(before.st_mode):
                raise ValueError('Only regular files can be attached')
            vault_path = os.path.realpath('/proc/self/fd/'+str(root))
            local = os.path.relpath(source, vault_path)
            if local != '..' and not local.startswith('../'):
                validate(local)
                existing = safe(local)
                try:
                    info = os.fstat(existing)
                    if (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino):
                        raise ValueError('Source changed during import')
                finally:
                    os.close(existing)
                result = local
            else:
                filename = os.path.basename(source)
                if filename.startswith('.'):
                    filename = 'attachment'+filename
                validate(filename)
                destination = '/'.join(filter(None, [os.path.dirname(path), 'attachments']))
                folder = directory(destination)
                target = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
                with os.fdopen(target, 'wb') as output, os.fdopen(os.dup(source_fd), 'rb') as input_file:
                    while True:
                        chunk = input_file.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                after = os.fstat(source_fd)
                if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise ValueError('Source changed during import; try again')
                stem, extension = os.path.splitext(filename)
                for index in range(10000):
                    candidate = filename if index == 0 else stem+' ('+str(index)+')'+extension
                    try:
                        rename(folder, temporary, folder, candidate, 1)
                        result = destination+'/'+candidate
                        break
                    except FileExistsError:
                        continue
                else:
                    raise ValueError('Too many attachments with this name')
        finally:
            os.close(source_fd)
            if folder is not None:
                try:
                    os.unlink(temporary, dir_fd=folder)
                except FileNotFoundError:
                    pass
                os.close(folder)
    elif action == 'mkdir':
        parent = directory(os.path.dirname(path))
        try:
            os.mkdir(os.path.basename(path), 0o700, dir_fd=parent)
            os.fsync(parent)
            result = None
        finally:
            os.close(parent)
    elif action == 'rename':
        target = request['newPath']
        source_fd = safe(path, os.O_PATH)
        try:
            info = os.fstat(source_fd)
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError('Unsupported vault entry')
            if stat.S_ISDIR(info.st_mode) and (target == path or target.startswith(path+'/')):
                raise ValueError('Cannot move a folder into itself')
        finally:
            os.close(source_fd)
        parent = safe(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY) if os.path.dirname(path) else os.dup(root)
        try:
            target_parent = safe(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY) if os.path.dirname(target) else os.dup(root)
            try:
                prepare_rename(private, path, target, stat.S_ISDIR(info.st_mode))
                rename(parent, os.path.basename(path), target_parent, os.path.basename(target), 1)
                recover_rename(private)
                result = None
            finally:
                os.close(target_parent)
        finally:
            os.close(parent)
    elif action == 'read':
        result = doc(path)
    elif action == 'checkpoint':
        snapshot(path, request['content'], request.get('author','Unsaved draft'))
        result = None
    elif action == 'versions':
        result = [item for item in entries('.folio/history') if item['path'] == path]
    elif action == 'trashList':
        result = entries('.trash')
    elif action == 'create':
        parent = directory(os.path.dirname(path))
        try:
            write_at(parent, os.path.basename(path), request['content'].encode())
            result = doc(path)
            snapshot(path, result['content'], 'Created')
        finally:
            os.close(parent)
    elif action == 'write':
        disk = doc(path)
        if disk['hash'] != request['hash']:
            result = dict(status='conflict', disk=disk)
        elif disk['content'] == request['content']:
            result = dict(status='saved', document=disk)
        else:
            parent = safe(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY) if os.path.dirname(path) else os.dup(root)
            history = directory('.folio/history')
            id = uid()
            name = os.path.basename(path)
            temp = '.folio-'+uid()+'.tmp'
            try:
                file_fd=safe(path)
                try:
                    mode = os.fstat(file_fd).st_mode & 0o777
                finally:
                    os.close(file_fd)
                write_at(parent, temp, request['content'].encode(), mode)
                record_link_replacement(private, path, parent, temp, request['content'], request['hash'])
                # Exchange preserves the displaced inode, including late writes by an external editor.
                rename(parent, temp, parent, name, 2)
                rename(parent, temp, history, id+'.data', 1)
                meta(history, id, path, 'Before save')
                displaced_bytes, _ = bytes_at('.folio/history/'+id+'.data')
                if hashlib.sha256(displaced_bytes).hexdigest() != request['hash']:
                    # Roll back by exchange. Retain both inodes, including any intervening edits.
                    rename(history, id+'.data', parent, name, 2)
                    result = dict(status='conflict', disk=doc(path))
                else:
                    saved = doc(path)
                    snapshot(path, saved['content'], request.get('author','You'))
                    result = dict(status='saved', document=saved)
            finally:
                os.close(parent)
                os.close(history)
    elif action in ('trash', 'trashEntry'):
        entry_fd = safe(path, os.O_PATH)
        try:
            info = os.fstat(entry_fd)
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError('Unsupported vault entry')
        finally:
            os.close(entry_fd)
        disk = doc(path) if action == 'trash' else None
        if disk is not None and disk['hash'] != request['hash']:
            raise ValueError('File changed on disk. Reload before deleting.')
        parent = safe(os.path.dirname(path), os.O_RDONLY | os.O_DIRECTORY) if os.path.dirname(path) else os.dup(root)
        trash = directory('.trash')
        id = uid()
        try:
            meta(trash, id, path, 'You', directory=stat.S_ISDIR(info.st_mode), size=info.st_size)
            rename(parent, os.path.basename(path), trash, id+'.data', 1)
            moved = doc('.trash/'+id+'.data') if action == 'trash' else None
            if moved is not None and moved['hash'] != request['hash']:
                try:
                    rename(trash,id+'.data',parent,os.path.basename(path),1)
                    os.unlink(id+'.json',dir_fd=trash)
                except FileExistsError:
                    pass
                raise ValueError('File changed during deletion. Its latest bytes are preserved in the vault or Trash.')
            result = None
        finally:
            os.close(parent)
            os.close(trash)
    elif action == 'undelete':
        id = request['id']
        if str(uuid.UUID(id)) != id:
            raise ValueError('Invalid trash ID')
        item = next(item for item in entries('.trash') if item['id'] == id)
        validate(item['path'])
        parent = directory(os.path.dirname(item['path']))
        trash = safe('.trash',os.O_RDONLY | os.O_DIRECTORY)
        try:
            rename(trash,id+'.data',parent,os.path.basename(item['path']),1)
            os.unlink(id+'.json',dir_fd=trash)
            result = dict(path=item['path'], directory=item.get('directory', False), size=item['size'])
            if not item.get('directory'):
                try:
                    result = doc(item['path'])
                except (ValueError, UnicodeError):
                    # Restoring data must not require it to be editable text.
                    pass
        finally:
            os.close(parent)
            os.close(trash)
    elif action == 'info':
        fd=safe(path)
        try:
            info=os.fstat(fd)
            mime = 'application/pdf' if os.pread(fd, 5, 0) == b'%PDF-' else mimetypes.guess_type(path)[0] or 'application/octet-stream'
            result=dict(size=info.st_size,modified=info.st_mtime*1000,mime=mime)
        finally:
            os.close(fd)
    elif action == 'stream':
        fd = safe(path)
        # Once opened, the descriptor pins this file; media must not hold the vault lock.
        if lock is not None:
            os.close(lock)
            lock = None
        try:
            start = int(request.get('start',0))
            end = request.get('end')
            os.lseek(fd,start,os.SEEK_SET)
            remaining = int(end)-start+1 if end is not None else None
            while remaining is None or remaining > 0:
                data = os.read(fd, min(65536,remaining) if remaining is not None else 65536)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                if remaining is not None:
                    remaining -= len(data)
        finally:
            os.close(fd)
        sys.exit(0)
    else:
        raise ValueError('Unknown vault operation')
    print(json.dumps(dict(ok=True,value=result)))
except Exception as error:
    print(json.dumps(dict(ok=False,error=str(error))))
finally:
    if lock is not None:
        os.close(lock)
    if private is not None:
        os.close(private)
    os.close(root)
