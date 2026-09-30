"""Exercise the generated Nix service commands and the backend on a prepared checkout.

Requires free development ports. Uses the exported process-compose configuration,
without the interactive launcher's port-killing preHook. Leaves data in place.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

config_path = sys.argv[1]
existing = sys.argv[2:] == ["--existing-services"]
config = json.loads(Path(config_path).read_text())
env = dict(os.environ)
env.update(item.split("=", 1) for item in config["environment"])
env["NODE_ENV"] = "development"
logs = Path(".logs/nix-smoke")
logs.mkdir(parents=True, exist_ok=True)
children = []
service_socket = str((logs / "process-compose.sock").resolve())


def check_services():
    if existing or not Path(service_socket).exists():
        return
    result = subprocess.run(
        ["process-compose", "-U", "-u", service_socket, "process", "list", "-o", "json"],
        capture_output=True, text=True, timeout=10, env=env, check=True)
    for service in json.loads(result.stdout):
        if service["exit_code"] != 0 or service["restarts"] > 0:
            raise RuntimeError(f"Service failed or restarted: {service['name']} "
                               f"(exit={service['exit_code']}, restarts={service['restarts']})")


def launch(command, name, cwd=None):
    log = (logs / f"{name}.log").open("w")
    proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    log.close()
    children.append(proc)
    return proc


def wait_for(url, timeout, check=lambda response: True):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        check_services()
        for child in children:
            if child.poll() is not None:
                raise RuntimeError(f"Process exited early: {child.args} ({child.returncode})")
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if check(response):
                    print(f"Ready: {url}", flush=True)
                    return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for {url}; inspect {logs}")


try:
    # Never kill another developer's services or mask a failure with their health endpoints.
    ports = [3001] if existing else [3001, 5433, 6379, 7880, 4848, 8080, 4443, 8001]
    for port in ports:
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} is occupied; stop its service before testing")
    if not existing:
        launch(["process-compose", "-f", config_path, "-t=false", "-U", "-u", service_socket],
               "services")
    # LiveKit must actually connect to Redis; NumPy/LiveKit native imports must load.
    wait_for("http://127.0.0.1:7880", 180)
    wait_for("http://127.0.0.1:8001/health", 900)
    wait_for("http://127.0.0.1:4848", 180)
    launch(["pnpm", "exec", "dotenv", "-e", ".env.local", "--", "pnpm", "exec",
            "tsx", "src/index.ts"], "backend", "apps/backend")
    wait_for("http://127.0.0.1:3001/api/health", 120,
             lambda response: (lambda data: data["database"]["connected"] and
                               data["commonDatabase"]["connected"])(json.load(response)["data"]))
    # Catch services that briefly bind a health port before crashing/restarting.
    time.sleep(10)
    wait_for("http://127.0.0.1:8001/health", 10)
    wait_for("http://127.0.0.1:3001/api/health", 10)
    print("Nix runtime smoke test passed", flush=True)
except BaseException:
    # Keep actionable errors in the job output even if artifact upload fails.
    for log_path in logs.glob("*.log"):
        print(f"\n--- Last 100 lines of {log_path} ---", file=sys.stderr)
        print("\n".join(log_path.read_text(errors="replace").splitlines()[-100:]),
              file=sys.stderr, flush=True)
    raise
finally:
    for child in reversed(children):
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for child in children:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
