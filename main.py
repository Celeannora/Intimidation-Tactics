from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"
NODE = "node.exe" if os.name == "nt" else "node"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Launch the MTG Deck Builder using Vite instead of static-serving index.html."
    )
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--no-kill-port", action="store_true")
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--force-install", action="store_true")
    return parser.parse_args()


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def ensure_node() -> None:
    if which(NODE) is None:
        raise RuntimeError("Node.js is not installed or not on PATH. Install Node 18+ from https://nodejs.org/ and retry.")
    if which(NPM) is None:
        raise RuntimeError("npm is not installed or not on PATH. Install Node.js (which bundles npm) and retry.")


def ensure_package_json() -> Path:
    pkg = ROOT / "package.json"
    if not pkg.exists():
        raise FileNotFoundError(f"Could not find package.json in {ROOT}")
    return pkg


def npm_install(force: bool = False) -> None:
    node_modules = ROOT / "node_modules"
    vite_bin = node_modules / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if not force and node_modules.exists() and vite_bin.exists():
        return
    print("Installing npm dependencies (this can take a minute)...")
    result = subprocess.run([NPM, "install"], cwd=ROOT, shell=False)
    if result.returncode != 0:
        raise RuntimeError(f"`npm install` failed with exit code {result.returncode}.")
    if not vite_bin.exists():
        raise RuntimeError("`npm install` completed but Vite binary is still missing. Try `--force-install`.")


def port_is_in_use(port: int) -> bool:
    for host in ("127.0.0.1", "::1"):
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.25)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def stop_process_on_port(port: int) -> None:
    if os.name != "nt":
        subprocess.run(["sh", "-c", f"lsof -ti tcp:{port} | xargs -r kill -9"], check=False)
        return
    command = (
        f"$pids = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue "
        "| Select-Object -ExpandProperty OwningProcess -Unique; "
        "foreach ($processId in $pids) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", command], check=False)


def free_port(port: int, no_kill: bool) -> None:
    if not port_is_in_use(port):
        return
    if no_kill:
        raise RuntimeError(
            f"Port {port} is already in use. Stop the existing server or rerun with `--port {port + 1}`."
        )
    print(f"Port {port} is already in use; stopping stale process...")
    stop_process_on_port(port)
    if port_is_in_use(port):
        raise RuntimeError(
            f"Port {port} is still in use after attempting to free it. Rerun with `--port {port + 1}`."
        )


def run() -> int:
    args = parse_args()
    ensure_node()
    ensure_package_json()
    if not args.skip_install:
        npm_install(force=args.force_install)
    free_port(args.port, args.no_kill_port)

    vite = ROOT / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if not vite.exists():
        raise RuntimeError("Vite executable is missing even after install. Try `python main.py --force-install`.")

    cmd: list[str] = [str(vite), "--host", str(args.host), "--port", str(args.port), "--strictPort"]
    if args.preview:
        cmd.insert(1, "preview")

    display_host = "localhost" if args.host in {"0.0.0.0", "::"} else args.host
    print(f"Launching {'production preview' if args.preview else 'Vite dev server'} at http://{display_host}:{args.port}/")
    print("Press Ctrl+C to stop.")

    try:
        return subprocess.call(cmd, cwd=ROOT)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Failed to execute Vite: {exc}") from exc
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


def main() -> int:
    try:
        return run()
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"UNEXPECTED ERROR: {exc.__class__.__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
