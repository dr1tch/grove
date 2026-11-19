"""Deterministic local-only regression for concurrent file/folder mutations."""
import json
import os
import subprocess
import time
import uuid
from urllib.parse import urlparse
from urllib.request import Request, urlopen

api = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_ANON_KEY"]
database = os.environ["SUPABASE_DB_URL"]
assert urlparse(api).hostname in ("localhost", "127.0.0.1")
assert urlparse(database).hostname in ("localhost", "127.0.0.1")


def request(path, body, token=key, content_type="application/json"):
    data = json.dumps(body).encode() if content_type == "application/json" else body
    req = Request(api + path, data=data, headers={
        "apikey": key, "Authorization": "Bearer " + token, "Content-Type": content_type,
    })
    with urlopen(req) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


account = request("/auth/v1/signup", {
    "email": f"path-race-{uuid.uuid4()}@grove.test", "password": str(uuid.uuid4()),
    "gotrue_meta_security": {"captcha_token": "XXXX.DUMMY.TOKEN.XXXX"},
})
user = account["user"]["id"]
token = account["access_token"]
content = b"race fixture"
import hashlib
sha = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
request(f"/storage/v1/object/vaults/{user}/{sha}", content, token, "application/octet-stream")
save = lambda path: f"select public.vault_save('{path}', null, '{sha}', {len(content)});"
claims = f"begin; set local role authenticated; set local request.jwt.claim.sub = '{user}';\n"
psql = ["psql", database, "-XAt", "-v", "ON_ERROR_STOP=1"]
subprocess.run(psql, input=claims + save("Source.md") + "commit;", text=True, capture_output=True, check=True)


def race(first, second):
    a = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    b = None
    try:
        a.stdin.write(claims + first + "select 'READY';\n")
        a.stdin.flush()
        while True:
            line = a.stdout.readline()
            if line.strip() == "READY": break
            assert line, "First transaction failed: " + a.stderr.read()
        env = {**os.environ, "PGAPPNAME": "grove-path-race-" + user}
        b = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        b.stdin.write("\\set VERBOSITY verbose\n" + claims + second + "commit;\n")
        b.stdin.close()
        for _ in range(100):
            result = subprocess.run(psql, input=f"select wait_event_type from pg_stat_activity where application_name = 'grove-path-race-{user}';", text=True, capture_output=True, check=True)
            if "Lock" in result.stdout: break
            assert b.poll() is None, "Second transaction did not wait for the first"
            time.sleep(0.02)
        else: raise AssertionError("Second transaction never reached the lock")
        a.stdin.write("commit;\n\\q\n")
        a.stdin.flush()
        a.wait(timeout=10)
        b.wait(timeout=10)
        error = b.stderr.read()
        assert b.returncode != 0 and "GR409" in error, "Both conflicting structural mutations succeeded: " + error
    finally:
        if a.poll() is None: a.kill()
        if b and b.poll() is None: b.kill()


race(save("A"), save("A/Child.md"))
race(save("B/Child.md"), save("B"))
race(f"select public.vault_rename('Source.md', 'Target', '{sha}');", save("Target/Child.md"))
print("PASS: concurrent parent/child create and rename/create preserve file/folder exclusivity")
