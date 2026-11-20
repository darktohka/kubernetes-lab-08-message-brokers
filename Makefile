REGISTRY ?= lighthouse.tohka.us/drone-management
TAG      ?= latest
# The cluster nodes are aarch64; the image build stage is pinned to
# $BUILDPLATFORM so no toolchain runs under emulation.
PLATFORM ?= linux/arm64
NS       ?= dani
SERVICES := drone-management location-management scheduling frontend

.PHONY: help build push release infra db deploy rollout verify logs clean

help:
	@echo "targets:"
	@echo "  build     build all four docker images"
	@echo "  push      push them to \$$(REGISTRY)"
	@echo "  release   build + push"
	@echo "  infra     apply secrets, postgres, kafka, redis and wait for postgres"
	@echo "  db        (re)run the database/role provisioning job"
	@echo "  deploy    apply the four application workloads + ingress"
	@echo "  rollout   restart the workloads so they pick up :latest"
	@echo "  verify    smoke-test the public endpoints"
	@echo "  logs      tail all workload logs"
	@echo "  clean      delete the application workloads (keeps postgres/kafka data)"

build:
	@set -e; for s in $(SERVICES); do \
	  case $$s in \
	    frontend) dir=./frontend ;; \
	    *)        dir=./services/$$s ;; \
	  esac; \
	  echo "==> docker build $(REGISTRY)/$$s:$(TAG) ($$dir, $(PLATFORM))"; \
	  docker build --platform $(PLATFORM) --provenance=false --sbom=false \
	    -t $(REGISTRY)/$$s:$(TAG) $$dir; \
	done

push:
	@set -e; for s in $(SERVICES); do \
	  echo "==> docker push $(REGISTRY)/$$s:$(TAG)"; \
	  docker push $(REGISTRY)/$$s:$(TAG); \
	done

release: build push

infra:
	kubectl apply -n $(NS) -f k8s/01-secrets.yaml
	kubectl apply -n $(NS) -f k8s/02-postgres-cluster.yaml
	kubectl apply -n $(NS) -f k8s/04-kafka.yaml
	kubectl apply -n $(NS) -f k8s/05-redis.yaml
	@echo "==> waiting for the postgres cluster to become ready"
	kubectl wait --for=condition=Ready cluster/drones-pg -n $(NS) --timeout=600s

db:
	-kubectl delete job db-init -n $(NS) --ignore-not-found
	kubectl apply -n $(NS) -f k8s/03-db-init-job.yaml
	kubectl wait --for=condition=complete job/db-init -n $(NS) --timeout=600s
	kubectl logs job/db-init -n $(NS) --tail=20

deploy:
	kubectl apply -n $(NS) -f k8s/20-drone-management.yaml
	kubectl apply -n $(NS) -f k8s/21-location-management.yaml
	kubectl apply -n $(NS) -f k8s/22-scheduling.yaml
	kubectl apply -n $(NS) -f k8s/23-frontend.yaml
	kubectl apply -n $(NS) -f k8s/30-ingress.yaml
	kubectl rollout status deployment/drone-management -n $(NS) --timeout=300s
	kubectl rollout status deployment/location-management -n $(NS) --timeout=300s
	kubectl rollout status deployment/scheduling -n $(NS) --timeout=300s
	kubectl rollout status deployment/frontend -n $(NS) --timeout=300s

rollout:
	kubectl rollout restart deployment/drone-management deployment/location-management deployment/scheduling deployment/frontend -n $(NS)
	kubectl rollout status deployment/drone-management -n $(NS) --timeout=300s
	kubectl rollout status deployment/location-management -n $(NS) --timeout=300s
	kubectl rollout status deployment/scheduling -n $(NS) --timeout=300s
	kubectl rollout status deployment/frontend -n $(NS) --timeout=300s

verify:
	@set -e; base=https://dronemandaniel.sapi.click; \
	echo "== frontend";        curl -s -o /dev/null -w '%{http_code}\n' $$base/; \
	echo "== drones";          curl -s $$base/api/drones | head -c 400; echo; \
	echo "== locations";       curl -s $$base/api/locations | head -c 300; echo; \
	echo "== scheduling state";curl -s $$base/api/scheduling/state | head -c 300; echo

logs:
	kubectl logs -n $(NS) -l app.kubernetes.io/part-of=drones-as-a-service --max-log-requests=10 -f --tail=50

clean:
	kubectl delete -n $(NS) -f k8s/20-drone-management.yaml --ignore-not-found
	kubectl delete -n $(NS) -f k8s/21-location-management.yaml --ignore-not-found
	kubectl delete -n $(NS) -f k8s/22-scheduling.yaml --ignore-not-found
	kubectl delete -n $(NS) -f k8s/30-ingress.yaml --ignore-not-found
