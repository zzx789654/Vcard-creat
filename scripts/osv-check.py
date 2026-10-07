"""osv-check.py — 以 OSV.dev API 掃描 package-lock.json 的相依套件弱點（SCA②）。

取代「下載 osv-scanner 二進位再執行」：CI 不需執行任何從網路下載的程式，
只把 lockfile 內的套件名稱與版本送到 OSV.dev 查詢（只用 Python 標準函式庫）。

用法：python3 scripts/osv-check.py [package-lock.json]
結果：有任何弱點即列出並以 exit 1 結束；查詢失敗也 exit 1（fail-closed，
      避免「查不到」被誤判成「沒弱點」）。
"""
import http.client
import json
import sys

OSV_HOST = "api.osv.dev"          # 只走 HTTPS（HTTPSConnection 不接受其他協定）
OSV_BATCH_PATH = "/v1/querybatch"
BATCH_SIZE = 500  # OSV querybatch 單次上限為 1000，取一半留餘裕


def load_packages(lock_path):
    with open(lock_path, encoding="utf-8") as f:
        lock = json.load(f)
    seen = set()
    packages = []
    for key, meta in lock.get("packages", {}).items():
        if not key or "version" not in meta or meta.get("link"):
            continue  # 根專案、無版本或本地連結不查
        name = key.split("node_modules/")[-1]
        pair = (name, meta["version"])
        if pair not in seen:
            seen.add(pair)
            packages.append(pair)
    return packages


def query(packages):
    hits = []
    for start in range(0, len(packages), BATCH_SIZE):
        chunk = packages[start:start + BATCH_SIZE]
        body = json.dumps({"queries": [
            {"package": {"name": n, "ecosystem": "npm"}, "version": v}
            for n, v in chunk
        ]}).encode("utf-8")
        conn = http.client.HTTPSConnection(OSV_HOST, timeout=60)
        try:
            conn.request("POST", OSV_BATCH_PATH, body=body,
                         headers={"Content-Type": "application/json"})
            resp = conn.getresponse()
            if resp.status != 200:
                raise RuntimeError(f"OSV 回應 HTTP {resp.status}")
            results = json.load(resp)["results"]
        finally:
            conn.close()
        if len(results) != len(chunk):
            raise RuntimeError("OSV 回傳筆數與查詢不符")
        for (name, version), res in zip(chunk, results):
            ids = [v["id"] for v in res.get("vulns", [])]
            if ids:
                hits.append((name, version, ids))
    return hits


def main():
    lock_path = sys.argv[1] if len(sys.argv) > 1 else "package-lock.json"
    try:
        packages = load_packages(lock_path)
        hits = query(packages)
    except Exception as exc:  # 任何錯誤都視為未通過（fail-closed）
        print(f"::error::OSV 查詢失敗：{exc}")
        return 1
    print(f"OSV.dev：查詢 {len(packages)} 個套件版本，命中 {len(hits)} 個")
    for name, version, ids in hits:
        print(f"  - {name}@{version}: {', '.join(ids)}")
    if hits:
        print(f"::error::OSV 偵測到 {len(hits)} 個有已知弱點的套件版本")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
