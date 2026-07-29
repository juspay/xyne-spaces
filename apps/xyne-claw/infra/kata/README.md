# xyne-claw Kata + Firecracker Setup

Runs xyne-claw inside Firecracker microVMs via Kata Containers.
Each pod gets a dedicated kernel — Docker runs natively inside, fully isolated from the host.

## Why
xyne-claw executes untrusted external code. Standard containers share the host kernel
and can be escaped. Firecracker microVMs provide hardware-level isolation via KVM.

## Deployment Order

### 1. Create Ubuntu node pool (one-time)
```bash
bash 00-node-pool.sh
```
Must be Ubuntu (not COS) — KVM is blocked on GKE's Container-Optimized OS.

### 2. Apply RBAC for kata-deploy
```bash
kubectl apply -f 01-rbac.yaml
```

### 3. Deploy kata-deploy DaemonSet
```bash
kubectl apply -f 02-kata-deploy.yaml
```
Installs Firecracker + kata-runtime binaries on every node in the pool.
Auto-creates RuntimeClasses: `kata-fc`, `kata-qemu`, `kata-clh`.

### 4. Force a node up (autoscaler starts at 0)
```bash
kubectl apply -f 03-node-warmer.yaml
```
Wait for kata-deploy pod to show `Running`:
```bash
kubectl get pods -n kube-system -l name=kata-deploy -w
```
Then delete the warmer:
```bash
kubectl delete -f 03-node-warmer.yaml
```

### 5. Verify RuntimeClass registered
```bash
kubectl get runtimeclass
# Should show kata-fc alongside existing gvisor
```

### 6. Deploy xyne-claw with kata-fc
The xyne-claw deployment needs:
- `runtimeClassName: kata-fc`
- `nodeAffinity` pointing to `kata-sandbox-ng` pool
- Toleration for `workload=xyne-claw:NoSchedule`
- Dockerfile updated to run full `dockerd` (not just CLI)

## Files
| File | Purpose |
|---|---|
| `00-node-pool.sh` | Create Ubuntu GKE node pool |
| `01-rbac.yaml` | RBAC for kata-deploy service account |
| `02-kata-deploy.yaml` | DaemonSet that installs Kata+Firecracker on nodes |
| `03-node-warmer.yaml` | Temporary pod to force autoscaler to bring up a node |
| `docker-entrypoint.sh` | Entrypoint that starts dockerd before xyne-claw app |
