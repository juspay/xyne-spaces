#!/bin/bash
set -e
kubectl apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v0.3.10/manifest.yaml
kubectl apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v0.3.10/extensions.yaml
echo "Waiting for agent-sandbox controller..."
kubectl rollout status deployment/agent-sandbox-controller -n agent-sandbox-system --timeout=120s
echo "Done."
