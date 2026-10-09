# Override envars using -e
# make push-all -e NS=asia.gcr.io/xyne-spaces -e VERSION=1.0.0
NS ?= asia.gcr.io/xyne-spaces
VERSION ?= $(shell git rev-parse --short=7 HEAD)
BACKEND_IMAGE_NAME ?= xyne-spaces-backend
RUNNER_IMAGE_NAME ?= xyne-spaces-runner
DASHBOARD_IMAGE_NAME ?= xyne-spaces-dashboard
DASHBOARD_EDGE_IMAGE_NAME ?= xyne-spaces-dashboard-edge
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

# Export the built dashboard bundles (dist + releases/dashboard.zip) for
# upload to the dashboard edge's bucket: the normal bundle to
# $(DASHBOARD_BUNDLE_OUT) and the SDLC-mode bundle (build:sdlc, base
# /sdlc-app/) to $(DASHBOARD_BUNDLE_OUT)-sdlc. Same build args as
# push-dashboard so the builder stage is served from cache.
DASHBOARD_BUNDLE_OUT ?= out/dashboard-bundle
export-dashboard-bundle:
	$(info Exporting dashboard bundles to $(DASHBOARD_BUNDLE_OUT) and $(DASHBOARD_BUNDLE_OUT)-sdlc / git-head: $(SOURCE_COMMIT))
	rm -rf $(DASHBOARD_BUNDLE_OUT) $(DASHBOARD_BUNDLE_OUT)-sdlc
	docker buildx build -f apps/dashboard/Dockerfile --target bundle --output type=local,dest=$(DASHBOARD_BUNDLE_OUT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "VITE_POSTHOG_KEY=$(VITE_POSTHOG_KEY)" --build-arg "VITE_POSTHOG_HOST=$(VITE_POSTHOG_HOST)" .
	docker buildx build -f apps/dashboard/Dockerfile --target bundle --output type=local,dest=$(DASHBOARD_BUNDLE_OUT)-sdlc --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "BUILD_SCRIPT=build:sdlc" --build-arg "VITE_POSTHOG_KEY=$(VITE_POSTHOG_KEY)" --build-arg "VITE_POSTHOG_HOST=$(VITE_POSTHOG_HOST)" .
	$(info Exported: $(DASHBOARD_BUNDLE_OUT) and $(DASHBOARD_BUNDLE_OUT)-sdlc)

# Dashboard edge targets (nginx + Node app serving bundles from object storage; apps/dashboard-edge)
build-dashboard-edge:
	$(info Building $(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard-edge/Dockerfile -t $(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --load .

push-dashboard-edge:
	$(info Pushing to registry: $(NS)/$(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f apps/dashboard-edge/Dockerfile -t $(NS)/$(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --push .
	$(info Successfully pushed: $(NS)/$(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-dashboard-edge:
	docker rmi $(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(DASHBOARD_EDGE_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

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

# ============================================================================
# Electron desktop app (apps/electron)
#
# Phase 1: produce binaries only. Nothing here signs, notarizes, or publishes.
# The macOS `pkg` ships via MDM, which sets no com.apple.quarantine attribute,
# so Gatekeeper's quarantine check never runs and an unsigned pkg installs
# cleanly. See docs/electron-distribution.md.
#
# Platform support:
#   linux / windows -> built with buildx via apps/electron/Dockerfile.build, so
#                      the existing Linux CI agent needs nothing beyond Docker
#                      (the Windows targets need wine, which the image supplies).
#   mac             -> must run on a macOS host; `pkg` and `dmg` use productbuild
#                      and hdiutil, which cannot run in a Linux container.
#
# Artifacts always land in $(ELECTRON_ARTIFACT_DIR)/<platform>/, whichever route
# produced them.
#
# Every value is overridable with -e and no secret is written here. Phase 1 needs
# no credentials at all; phase 2 must pass signing material through buildx
# `--secret` (ELECTRON_BUILD_SECRETS), never `--build-arg`, which would persist
# it in image history.
# ============================================================================
ELECTRON_DIR ?= apps/electron
DASHBOARD_DIR ?= apps/dashboard
ELECTRON_BUILD_CONFIG ?= build.prod.json
ELECTRON_ARTIFACT_DIR ?= out/electron
ELECTRON_DOCKERFILE ?= $(ELECTRON_DIR)/Dockerfile.build
# Pin to a digest in CI for reproducibility:
#   -e ELECTRON_BUILDER_IMAGE=electronuserland/builder@sha256:...
ELECTRON_BUILDER_IMAGE ?= electronuserland/builder:wine
# The builder image is amd64-only. Pinned so an arm64 workstation produces the
# same artifacts as the amd64 CI agent instead of silently switching platform.
# (Target architectures come from electron-builder's prebuilt Electron
# downloads, not from the build host, so arm64 artifacts still build here.)
ELECTRON_BUILD_PLATFORM ?= linux/amd64
# Empty default: the build uses the version already in $(ELECTRON_DIR)/package.json.
ELECTRON_VERSION ?=
PNPM_VERSION ?= 10.15.0

# Deliberately OFF. With no `mac.identity` in the electron-builder config,
# electron-builder would otherwise auto-discover any Developer ID in the host
# keychain and silently produce a differently-signed artifact than CI does.
# Phase 2 sets this to true alongside CSC_LINK.
CSC_IDENTITY_AUTO_DISCOVERY ?= false
export CSC_IDENTITY_AUTO_DISCOVERY

# Phase 2 hook: space-separated buildx secret specs, e.g.
#   -e ELECTRON_BUILD_SECRETS='id=win_cert,env=CSC_LINK id=win_pass,env=CSC_KEY_PASSWORD'
# Empty in phase 1. Secrets are referenced by id inside the Dockerfile with
# --mount=type=secret so they never enter a layer or image history.
ELECTRON_BUILD_SECRETS ?=
ELECTRON_SECRET_FLAGS := $(foreach spec,$(ELECTRON_BUILD_SECRETS),--secret $(spec))

# Narrow the target list for a platform, e.g. -e ELECTRON_WIN_TARGETS='nsis portable'.
# Empty default: build every target the electron-builder config lists.
#
# NOTE: narrowing the Windows list does NOT make the build runnable on Apple
# Silicon. EVERY Windows target needs wine - nsis executes the installer it just
# produced to generate the uninstaller, portable self-extracts, and msi runs WiX
# candle.exe - and wine inside an emulated amd64 container aborts on the host's
# 16KB page size ("anon_mmap_fixed: Assertion failed" / "qemu: uncaught target
# signal 6"). Electron packaging itself completes; only the wine post-steps die.
# Windows artifacts therefore require a NATIVE amd64 host, which the CI agent is.
# Leave this empty in CI; it exists to skip a target for other reasons.
ELECTRON_WIN_TARGETS ?=
ELECTRON_LINUX_TARGETS ?=

ELECTRON_BUILD_ARGS = \
	--build-arg "BUILDER_IMAGE=$(ELECTRON_BUILDER_IMAGE)" \
	--build-arg "ELECTRON_BUILD_CONFIG=$(ELECTRON_BUILD_CONFIG)" \
	--build-arg "PNPM_VERSION=$(PNPM_VERSION)"

# $(1) = platform name (used for the output directory)
# $(2) = electron-builder platform flag (--linux / --win)
define ELECTRON_BUILDX
	$(info Building electron $(1) artifacts via $(ELECTRON_DOCKERFILE) ($(ELECTRON_BUILDER_IMAGE)))
	@rm -rf "$(ELECTRON_ARTIFACT_DIR)/$(1)"
	@mkdir -p "$(ELECTRON_ARTIFACT_DIR)/$(1)"
	docker buildx build -f $(ELECTRON_DOCKERFILE) \
		--platform $(ELECTRON_BUILD_PLATFORM) \
		--target artifacts \
		$(ELECTRON_BUILD_ARGS) \
		--build-arg "ELECTRON_PLATFORM=$(2)" \
		$(ELECTRON_SECRET_FLAGS) \
		--output "type=local,dest=$(ELECTRON_ARTIFACT_DIR)/$(1)" \
		.
endef

# Stamp a CI version into $(ELECTRON_DIR)/package.json. No-op unless
# ELECTRON_VERSION is set. Edits the working tree only; never commits.
electron-version:
ifneq ($(strip $(ELECTRON_VERSION)),)
	$(info Stamping electron version $(ELECTRON_VERSION))
	cd $(ELECTRON_DIR) && npm version "$(ELECTRON_VERSION)" --no-git-tag-version --allow-same-version
else
	$(info ELECTRON_VERSION unset - using version from $(ELECTRON_DIR)/package.json)
	@true
endif

# Stage the dashboard bundle as the app's fallback UI. Required before any
# platform build: `ui-active` is listed in the electron-builder config's `files`,
# and getBundledUIPath() reads it on first launch, before the OTA updater runs.
#
# Two entry points on purpose:
#   electron-ui-copy  consumes an ALREADY-BUILT $(DASHBOARD_DIR)/dist. This is the
#                     CI path, because CI builds the dashboard with
#                     deployment-specific VITE_* variables that are not available
#                     here; rebuilding would silently produce a bundle configured
#                     for the wrong backend.
#   electron-ui       builds the dashboard first. Local and standalone use.
electron-ui-copy:
	@[ -d "$(DASHBOARD_DIR)/dist" ] || { \
		echo "ERROR: $(DASHBOARD_DIR)/dist not found." >&2; \
		echo "       Build the dashboard first, or use 'make electron-ui' to build it here." >&2; \
		exit 1; }
	$(info Staging $(DASHBOARD_DIR)/dist into $(ELECTRON_DIR)/ui-active)
	cd $(ELECTRON_DIR) && pnpm run copy-ui

electron-ui:
	$(info Building dashboard bundle for electron ui-active)
	cd $(ELECTRON_DIR) && pnpm run build:dashboard
	$(MAKE) electron-ui-copy

# Install the electron workspace's dependencies on the HOST. Only the macOS
# build needs this: the Linux and Windows builds install inside the container.
electron-deps:
	$(info Installing electron workspace dependencies)
	pnpm install --frozen-lockfile --prefer-offline --filter xyne-spaces-electron...

# Linux: deb + rpm + AppImage (whatever the config lists).
electron-build-linux:
	$(call ELECTRON_BUILDX,linux,--linux $(ELECTRON_LINUX_TARGETS))

# Windows: nsis (x64 + arm64, self-updating) + msi (x64, MDM) + portable.
electron-build-win:
	$(call ELECTRON_BUILDX,windows,--win $(ELECTRON_WIN_TARGETS))

# macOS: pkg (MDM) + dmg (download) + zip (update feed). Requires a macOS host.
electron-build-mac:
	@[ "$$(uname -s)" = "Darwin" ] || { \
		echo "ERROR: electron-build-mac requires a macOS host (pkg/dmg use productbuild + hdiutil)." >&2; \
		echo "       Current host: $$(uname -s). Use electron-build-win / electron-build-linux here." >&2; \
		exit 1; }
	$(info Building macOS artifacts with $(ELECTRON_BUILD_CONFIG) (unsigned: CSC_IDENTITY_AUTO_DISCOVERY=$(CSC_IDENTITY_AUTO_DISCOVERY)))
	cd $(ELECTRON_DIR) && pnpm run build:prepare \
		&& pnpm exec electron-builder --config $(ELECTRON_BUILD_CONFIG) --mac
	@rm -rf "$(ELECTRON_ARTIFACT_DIR)/mac" && mkdir -p "$(ELECTRON_ARTIFACT_DIR)/mac"
	@find "$(ELECTRON_DIR)/release" -type f \( \
		-name '*.pkg' -o -name '*.dmg' -o -name '*.zip' \
		-o -name '*.blockmap' -o -name 'latest*.yml' \
	\) -exec cp -f {} "$(ELECTRON_ARTIFACT_DIR)/mac/" \;

# Checksum and summarize whatever the platform targets produced. Separate target
# so CI can archive one directory after running any subset of the builds.
electron-artifacts:
	@[ -d "$(ELECTRON_ARTIFACT_DIR)" ] && [ -n "$$(find "$(ELECTRON_ARTIFACT_DIR)" -type f -print -quit)" ] || { \
		echo "ERROR: no artifacts under $(ELECTRON_ARTIFACT_DIR) - did a build target run?" >&2; \
		exit 1; }
	$(info Checksumming artifacts in $(ELECTRON_ARTIFACT_DIR))
	@cd "$(ELECTRON_ARTIFACT_DIR)" && find . -type f ! -name SHA256SUMS -print0 \
		| xargs -0 $$(command -v sha256sum || echo shasum -a 256) > SHA256SUMS
	@cat "$(ELECTRON_ARTIFACT_DIR)/SHA256SUMS"
	@find "$(ELECTRON_ARTIFACT_DIR)" -type f ! -name SHA256SUMS -exec ls -lh {} \;

electron-clean:
	cd $(ELECTRON_DIR) && pnpm run clean
	rm -rf "$(ELECTRON_ARTIFACT_DIR)"

.PHONY: build-backend push-backend clean-backend prisma-generate build-runner push-runner clean-runner build-dashboard push-dashboard clean-dashboard export-dashboard-bundle build-dashboard-edge push-dashboard-edge clean-dashboard-edge build-external-dashboard push-external-dashboard clean-external-dashboard build-lighton-ocr-wrapper push-lighton-ocr-wrapper clean-lighton-ocr-wrapper build-transcription-agent push-transcription-agent clean-transcription-agent build-claw push-claw clean-claw build-claw-auth-backend push-claw-auth-backend clean-claw-auth-backend build-claw-auth-frontend push-claw-auth-frontend clean-claw-auth-frontend build-claw-all push-claw-all clean-claw-all lint-dashboard typecheck run-pr-police build-all push-all clean-all test configure-docker revoke-sa electron-version electron-deps electron-ui electron-ui-copy electron-build-mac electron-build-win electron-build-linux electron-artifacts electron-clean
