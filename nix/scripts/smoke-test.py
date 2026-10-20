"""Exercise the generated Nix service commands and the backend on a prepared checkout.

Usage: smoke-test.py <services-config.json> <process-compose.sock> [--existing-services]

Requires free development ports. Uses the exported process-compose configuration,
without the interactive launcher's port-killing preHook. Leaves data in place.

The socket is process-compose's control API for the running bundle. It is checked
in both modes: a service that restarted or exited non-zero fails the test.

With --existing-services, services are expected to be running already; a healthy
backend is reused (the dev image runs one), otherwise the test starts its own.
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
service_socket = sys.argv[2]
existing = sys.argv[3:] == ["--existing-services"]
config = json.loads(Path(config_path).read_text())
env = dict(os.environ)
env.update(item.split("=", 1) for item in config["environment"])
env["NODE_ENV"] = "development"
logs = Path(".logs/nix-smoke")
logs.mkdir(parents=True, exist_ok=True)
children = []


def process_list():
    # Both bundles expose process-compose's API on the same Unix socket, so this
    # works whether the test launched the services or found them running.
    if not Path(service_socket).exists():
        return None
    result = subprocess.run(
        ["process-compose", "-U", "-u", service_socket, "process", "list", "-o", "json"],
        capture_output=True, text=True, timeout=10, env=env)
    if result.returncode != 0:
        return None  # the API is not answering yet
    try:
        return json.loads(result.stdout)
    except ValueError:
        return None


def check_services():
    services = process_list()
    if services is None:
        return
    for service in services:
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


def backend_healthy():
    try:
        with urllib.request.urlopen("http://127.0.0.1:3001/api/health", timeout=3) as response:
            data = json.load(response)["data"]
            return data["database"]["connected"] and data["commonDatabase"]["connected"]
    except (OSError, ValueError, KeyError):
        return False


def port_occupied(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


try:
    # Never kill another developer's services or mask a failure with their health endpoints.
    if not existing:
        for port in [3001, 5433, 6379, 7880, 4848, 8080, 4443, 8001]:
            if port_occupied(port):
                raise RuntimeError(f"Port {port} is occupied; stop its service before testing")
        launch(["process-compose", "-f", config_path, "-t=false", "-U", "-u", service_socket],
               "services")
    # LiveKit must actually connect to Redis; NumPy/LiveKit native imports must load.
    wait_for("http://127.0.0.1:7880", 180)
    wait_for("http://127.0.0.1:8001/health", 900)
    wait_for("http://127.0.0.1:4848", 180)
    # Reuse a backend that is already serving, like the dev image's.
    if backend_healthy():
        print("Reusing the running backend", flush=True)
    else:
        if existing and port_occupied(3001):
            raise RuntimeError("Port 3001 is occupied but not healthy; stop it before testing")
        launch(["pnpm", "exec", "dotenv", "-e", ".env.local", "--", "pnpm", "exec",
                "tsx", "src/index.ts"], "backend", "apps/backend")
    wait_for("http://127.0.0.1:3001/api/health", 120,
             lambda response: (lambda data: data["database"]["connected"] and
                               data["commonDatabase"]["connected"])(json.load(response)["data"]))
    # Catch services that briefly bind a health port before crashing/restarting.
    time.sleep(10)
    wait_for("http://127.0.0.1:8001/health", 10)
    wait_for("http://127.0.0.1:3001/api/health", 10)
    # Report the process-compose health the whole run was checked against.
    services = process_list()
    if services is not None:
        restarts = sum(service["restarts"] for service in services)
        failures = [service["name"] for service in services if service["exit_code"] != 0]
        print(f"process-compose health: {len(services)} processes, "
              f"{restarts} restarts, {len(failures)} failures ({service_socket})", flush=True)
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
