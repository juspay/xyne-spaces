#!/bin/bash
# Creates the Ubuntu node pool for xyne-claw (required for Kata+Firecracker).
# All other GKE nodes run COS which blocks KVM — Ubuntu exposes /dev/kvm.
#
# Run once. Safe to re-run (gcloud will error if pool already exists).

gcloud container node-pools create kata-sandbox-ng \
    --cluster=xyne-spaces-gke-cluster \
    --region=asia-south1 \
    --machine-type=n1-standard-4 \
    --disk-size=100 \
    --disk-type=pd-ssd \
    --image-type=UBUNTU_CONTAINERD \
    --enable-nested-virtualization \
    --num-nodes=0 \
    --enable-autoscaling \
    --min-nodes=0 \
    --max-nodes=3 \
    --node-labels=workload-type=xyne-claw \
    --node-taints=workload=xyne-claw:NoSchedule \
    --service-account=default
