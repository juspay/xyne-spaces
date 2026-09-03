# Override envars using -e
# make push-all -e NS=asia.gcr.io/xyne-spaces -e VERSION=1.0.0
NS ?= asia.gcr.io/xyne-spaces
VERSION ?= $(shell git rev-parse --short=7 HEAD)
BACKEND_IMAGE_NAME ?= xyne-spaces-backend
RUNNER_IMAGE_NAME ?= xyne-spaces-runner
DASHBOARD_IMAGE_NAME ?= xyne-spaces-dashboard
EXTERNAL_DASHBOARD_IMAGE_NAME ?= xyne-spaces-dashboard-external
LIGHTON_OCR_WRAPPER_IMAGE_NAME ?= lighton-ocr-server
TRANSCRIPTION_AGENT_IMAGE_NAME ?= xyne-spaces-transcription-agent
CLAW_IMAGE_NAME ?= xyne-spaces-claw
CLAW_AUTH_BACKEND_IMAGE_NAME ?= xyne-spaces-claw-auth-backend
CLAW_AUTH_FRONTEND_IMAGE_NAME ?= xyne-spaces-claw-auth-frontend
SOURCE_COMMIT := $(or $(SOURCE_COMMIT),$(shell git rev-parse HEAD))
SOURCE_SHORT_COMMIT := $(or $(SOURCE_SHORT_COMMIT),$(shell git rev-parse --short=10 HEAD))

# PostHog client-side analytics (public key, but injected from CI so it stays out
# of git). Empty default: local builds ship a bundle with analytics disabled.
VITE_POSTHOG_KEY ?=
VITE_POSTHOG_HOST ?=

#temp2
# Backend targets 3s
build-backend:
	$(info Version $(VERSION) / Short: $(SOURCE_SHORT_COMMIT))
	$(info Building $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/backend/Dockerfile -t $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --load .

push-backend:
	$(info Pushing to registry: $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/backend/Dockerfile -t $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --push .
	$(info Successfully pushed: $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-backend:
	docker rmi $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

prisma-generate:
	$(info Generating backend Prisma clients)
	cd apps/backend && pnpm run db:generate
	cd apps/backend && pnpm run db:common:generate

# Runner targets
build-runner:
	$(info Building $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/backend/Docker.runner -t $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --build-arg "CACHIX_AUTH_TOKEN=$(CACHIX_AUTH_TOKEN)" --load .

push-runner:
	$(info Pushing to registry: $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/backend/Docker.runner -t $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --build-arg "CACHIX_AUTH_TOKEN=$(CACHIX_AUTH_TOKEN)" --push .
	$(info Successfully pushed: $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-runner:
	docker rmi $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Dashboard targets
build-dashboard:
	$(info Building $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard/Dockerfile -t $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "VITE_POSTHOG_KEY=$(VITE_POSTHOG_KEY)" --build-arg "VITE_POSTHOG_HOST=$(VITE_POSTHOG_HOST)" --load .

push-dashboard:
	$(info Pushing to registry: $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard/Dockerfile -t $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "VITE_POSTHOG_KEY=$(VITE_POSTHOG_KEY)" --build-arg "VITE_POSTHOG_HOST=$(VITE_POSTHOG_HOST)" --push .
	$(info Successfully pushed: $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-dashboard:
	docker rmi $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# External Dashboard targets (public call-join SPA — deployed without mTLS)
build-external-dashboard:
	$(info Building $(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard-external/Dockerfile -t $(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --load .

push-external-dashboard:
	$(info Pushing to registry: $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard-external/Dockerfile -t $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --push .
	$(info Successfully pushed: $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-external-dashboard:
	docker rmi $(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# LightOnOCR Wrapper targets (Python application)
build-lighton-ocr-wrapper:
	$(info Building $(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	cd lighton-ocr-server && docker buildx build -f Dockerfile -t $(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-lighton-ocr-wrapper:
	$(info Pushing to registry: $(NS)/$(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	cd lighton-ocr-server && docker buildx build -f Dockerfile -t $(NS)/$(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-lighton-ocr-wrapper:
	docker rmi $(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(LIGHTON_OCR_WRAPPER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Transcription agent targets (Python / LiveKit agent). Self-contained build context
# (apps/backend/python-agent) because the Dockerfile COPYs only from its own directory.
build-transcription-agent:
	$(info Building $(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	cd apps/backend/python-agent && docker buildx build -f Dockerfile -t $(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-transcription-agent:
	$(info Pushing to registry: $(NS)/$(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	cd apps/backend/python-agent && docker buildx build -f Dockerfile -t $(NS)/$(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-transcription-agent:
	docker rmi $(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(TRANSCRIPTION_AGENT_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Claw runtime targets (xyne-claw — the agent runtime). Root build context (.)
# because the Dockerfile COPYs packages/xyne-claw-shared/ and packages/kata-sdk/ too.
build-claw:
	$(info Building $(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw/Dockerfile -t $(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-claw:
	$(info Pushing to registry: $(NS)/$(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw/Dockerfile -t $(NS)/$(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-claw:
	docker rmi $(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(CLAW_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Claw-auth backend targets
build-claw-auth-backend:
	$(info Building $(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw-auth/backend/Dockerfile -t $(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-claw-auth-backend:
	$(info Pushing to registry: $(NS)/$(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw-auth/backend/Dockerfile -t $(NS)/$(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-claw-auth-backend:
	docker rmi $(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(CLAW_AUTH_BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Claw-auth frontend targets (nginx-served SPA)
build-claw-auth-frontend:
	$(info Building $(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw-auth/frontend/Dockerfile -t $(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-claw-auth-frontend:
	$(info Pushing to registry: $(NS)/$(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/xyne-claw-auth/frontend/Dockerfile -t $(NS)/$(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-claw-auth-frontend:
	docker rmi $(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(CLAW_AUTH_FRONTEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# push-built-* : push an image that the matching build-* target already built into this
# machine's Docker daemon (retag that image to the registry ref and push it). Used by CI
# so the EXACT image Trivy scanned is what gets pushed - no rebuild, no registry round-trip.
push-built-backend:
	docker tag $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)
	docker push $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)

push-built-runner:
	docker tag $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)
	docker push $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)

push-built-dashboard:
	docker tag $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)
	docker push $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)

push-built-external-dashboard:
	docker tag $(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)
	docker push $(NS)/$(EXTERNAL_DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT)

lint-dashboard:
	$(info Running dashboard quality checks)
	cd apps/dashboard && pnpm install --frozen-lockfile && pnpm run lint:errors-only && pnpm run type-check

# Python type checking (local development only)
typecheck:
	$(info Running Pyright type checking on Python agent)
	cd apps/backend/python-agent && pyright

# PR Police - Build CI image and run yama
run-pr-police:
	$(info Running PR Police for branch: $(BRANCH_NAME))
	$(info Building xyne-spaces-ci:$(SOURCE_SHORT_COMMIT))
	@docker buildx build -f Dockerfile.ci -t xyne-spaces-ci:$(SOURCE_SHORT_COMMIT) --load .
	@cat "$(GOOGLE_APPLICATION_CREDENTIALS)" | docker run --rm -i \
		-e BITBUCKET_BASE_URL=$(BITBUCKET_BASE_URL) \
		-e BITBUCKET_USERNAME=$(BITBUCKET_USERNAME) \
		-e BITBUCKET_TOKEN=$(BITBUCKET_TOKEN) \
		-e GOOGLE_VERTEX_PROJECT=$(GOOGLE_VERTEX_PROJECT) \
		-e GOOGLE_VERTEX_LOCATION=$(GOOGLE_VERTEX_LOCATION) \
		-e LANGFUSE_SECRET_KEY=$(LANGFUSE_SECRET_KEY) \
		-e LANGFUSE_PUBLIC_KEY=$(LANGFUSE_PUBLIC_KEY) \
		-e LANGFUSE_BASE_URL=$(LANGFUSE_BASE_URL) \
		-e LANGFUSE_ENABLED=$(LANGFUSE_ENABLED) \
		xyne-spaces-ci:$(SOURCE_SHORT_COMMIT) \
		sh -c 'cat > /tmp/gcp-creds.json && export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-creds.json && pnpm run yama review -- --workspace XYNE --repository xyne-spaces --branch $(BRANCH_NAME)'

# Combined claw targets
build-claw-all: build-claw build-claw-auth-backend build-claw-auth-frontend

push-claw-all: push-claw push-claw-auth-backend push-claw-auth-frontend

clean-claw-all: clean-claw clean-claw-auth-backend clean-claw-auth-frontend

# Combined targets
build-all: build-backend build-runner build-dashboard build-external-dashboard build-lighton-ocr-wrapper build-transcription-agent build-claw-all

push-all: push-backend push-runner push-dashboard push-external-dashboard push-lighton-ocr-wrapper push-transcription-agent push-claw-all

clean-all: clean-backend clean-runner clean-dashboard clean-external-dashboard clean-lighton-ocr-wrapper clean-transcription-agent clean-claw-all

test:
	$(info Running tests for all components)
	# Add your test commands here
	echo "All tests completed"

# GCP authentication
configure-docker:
	gcloud auth activate-service-account $(SERVICE_ACCOUNT) --key-file=$(GCP) --project=$(PROJECT_ID) -q
	gcloud auth configure-docker asia.gcr.io -q

revoke-sa:
	gcloud auth revoke $(SERVICE_ACCOUNT) -q || true

.PHONY: build-backend push-backend clean-backend prisma-generate build-runner push-runner clean-runner build-dashboard push-dashboard clean-dashboard build-external-dashboard push-external-dashboard clean-external-dashboard build-lighton-ocr-wrapper push-lighton-ocr-wrapper clean-lighton-ocr-wrapper build-transcription-agent push-transcription-agent clean-transcription-agent build-claw push-claw clean-claw build-claw-auth-backend push-claw-auth-backend clean-claw-auth-backend build-claw-auth-frontend push-claw-auth-frontend clean-claw-auth-frontend build-claw-all push-claw-all clean-claw-all lint-dashboard typecheck run-pr-police build-all push-all clean-all test configure-docker revoke-sa
