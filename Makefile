# Override envars using -e
# make push-all -e NS=asia.gcr.io/xyne-spaces -e VERSION=1.0.0
NS ?= asia.gcr.io/xyne-spaces
VERSION ?= $(shell git rev-parse --short=7 HEAD)
BACKEND_IMAGE_NAME ?= xyne-spaces-backend
RUNNER_IMAGE_NAME ?= xyne-spaces-runner
DASHBOARD_IMAGE_NAME ?= xyne-spaces-dashboard
SOURCE_COMMIT := $(shell git rev-parse HEAD)
SOURCE_SHORT_COMMIT ?= $(shell git rev-parse --short=10 HEAD)

#temp2
# Backend targets 3s
build-backend:
	$(info Version $(VERSION) / Short: $(SOURCE_SHORT_COMMIT))
	$(info Building $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f backend/Dockerfile -t $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --load .

push-backend:
	$(info Pushing to registry: $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f backend/Dockerfile -t $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --push .
	$(info Successfully pushed: $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-backend:
	docker rmi $(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(BACKEND_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Runner targets
build-runner:
	$(info Building $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f backend/Docker.runner -t $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --load .

push-runner:
	$(info Pushing to registry: $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f backend/Docker.runner -t $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --build-arg "GITHUB_PAT_TOKEN=$(GITHUB_PAT_TOKEN)" --push .
	$(info Successfully pushed: $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-runner:
	docker rmi $(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(RUNNER_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

# Dashboard targets
build-dashboard:
	$(info Building $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) / git-head: $(SOURCE_COMMIT))
	$(info Local image: $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f dashboard/Dockerfile -t $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --load .

push-dashboard:
	$(info Pushing to registry: $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))
	docker buildx build -f dashboard/Dockerfile -t $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) --build-arg "SOURCE_COMMIT=$(SOURCE_COMMIT)" --push .
	$(info Successfully pushed: $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT))

clean-dashboard:
	docker rmi $(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true
	docker rmi $(NS)/$(DASHBOARD_IMAGE_NAME):$(SOURCE_SHORT_COMMIT) || true

lint-dashboard:
	$(info Running dashboard quality checks)
	cd dashboard && npm ci && npm run lint:errors-only && npm run type-check

# Python type checking (local development only)
typecheck:
	$(info Running Pyright type checking on Python agent)
	cd backend/python-agent && pyright

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
		sh -c 'cat > /tmp/gcp-creds.json && export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-creds.json && npm run yama review -- --workspace XYNE --repository xyne-spaces --branch $(BRANCH_NAME)'

# Combined targets
build-all: build-backend build-runner build-dashboard

push-all: push-backend push-runner push-dashboard

clean-all: clean-backend clean-runner clean-dashboard

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

.PHONY: build-backend push-backend clean-backend build-runner push-runner clean-runner build-dashboard push-dashboard clean-dashboard lint-dashboard typecheck run-pr-police build-all push-all clean-all test configure-docker revoke-sa