# Integration Test Pipeline

## Overview

This custom integration test pipeline validates MTA operator deployments using File-Based Catalog (FBC) images from Konflux snapshots.

## Pool-Based Architecture

Uses OCPCTL cluster pools to lease pre-provisioned clusters for instant access and cost efficiency.

**Workflow:**
1. **Lease cluster** - Get pre-provisioned cluster from pool (instant!)
2. **Cleanup existing MTA** - Remove any previous MTA installation
3. **Deploy operator from FBC** - Install MTA operator using the FBC catalog image
4. **Run E2E tests** - Execute comprehensive Cypress test suite
5. **Release cluster** - Return cluster to pool for reuse
6. **Slack notification** - Send test results with NVR and Konflux link

**Benefits:**
- ⚡ **Instant cluster access** (no 15-30 min provision wait)
- 💰 **Cost-effective** (reuses clusters vs provisioning new ones each time)
- 🎯 **Reliable** (no provision timeout failures)
- 🔄 **Auto-release** (clusters automatically returned after lease expires)

**Requirements:**
- **OCPCTL cluster pool:** Pool must have available ready clusters
- **Auto-refresh enabled:** Pool setting `auto_refresh_enabled: true` prevents 7-day expiration issues
- **Pool capacity:** At least 1-2 clusters for concurrent testing

## Why Custom Pipeline

We use a custom pipeline instead of Konflux's built-in `deploy-fbc-operator` pipeline to support:

- **Pre-release testing**: Operator bundles are pushed to `registry.stage.redhat.io` before production
- **Registry mirroring**: Automatic redirection from `registry.redhat.io` → `registry.stage.redhat.io` via ImageDigestMirrorSet
- **Full deployment validation**: Creates MTA CR and runs end-to-end tests

## Reusable Tasks

The pipeline is composed of modular Tekton Tasks in `.tekton/tasks/`. Each task can be referenced independently by any Konflux ITS pipeline:

### Cluster Lifecycle Tasks

| Task                    | File                                       | Description                                      |
| ----------------------- | ------------------------------------------ | ------------------------------------------------ |
| `ocpctl-pool-lease`     | `.tekton/tasks/ocpctl-pool-lease.yaml`     | Lease pre-provisioned cluster from pool          |
| `ocpctl-pool-release`   | `.tekton/tasks/ocpctl-pool-release.yaml`   | Release cluster back to pool                     |
| `ocpctl-provision`      | `.tekton/tasks/ocpctl-provision.yaml`      | Provision ephemeral cluster + wait for READY     |
| `ocpctl-cleanup`        | `.tekton/tasks/ocpctl-cleanup.yaml`        | Delete ephemeral cluster + wait for DESTROYED    |
| `cleanup-mta`           | `.tekton/tasks/cleanup-mta.yaml`           | Remove existing MTA installation from cluster    |

### Deployment & Testing Tasks

| Task                    | File                                       | Description                                      |
| ----------------------- | ------------------------------------------ | ------------------------------------------------ |
| `verify-image-pullable` | `.tekton/tasks/verify-image-pullable.yaml` | Pre-flight check to verify FBC image is pullable |
| `deploy-mta-operator`   | `.tekton/tasks/deploy-mta-operator.yaml`   | Deploy MTA operator from FBC image               |
| `run-ui-e2e-tests`      | `.tekton/tasks/run-ui-e2e-tests.yaml`      | Run Cypress E2E tests against deployed MTA UI    |

### Notification Tasks

| Task                    | File                                       | Description                                      |
| ----------------------- | ------------------------------------------ | ------------------------------------------------ |
| `slack-notification`    | `.tekton/tasks/slack-notification.yaml`    | Send test results to Slack with NVR and link     |

### Using tasks in another pipeline

Reference any task via the Tekton git resolver:

```yaml
- name: provision-my-cluster
  taskRef:
    resolver: git
    params:
      - name: url
        value: https://github.com/migtools/mta-tackle2-ui
      - name: revision
        value: main
      - name: pathInRepo
        value: .tekton/tasks/ocpctl-provision.yaml
  params:
    - name: clusterName
      value: my-test-cluster
    - name: version
      value: "4.18"
```

All tasks use sensible defaults — only required params need to be provided.

## Pipeline Steps (Pool-Based)

### 1. parse-metadata

Extracts the FBC image reference from the Konflux snapshot.

### 2. verify-image-pullable

Pre-flight check to ensure FBC image exists and is pullable before leasing a cluster.

### 3. lease-cluster

Leases a pre-provisioned cluster from OCPCTL pool (`ci-sno-pool-1`):

- Pool: `ci-sno-pool-1` 
- Profile: `aws-sno-ga` (Single-Node OpenShift on AWS)
- OpenShift version: 4.22.0
- Lease duration: 4 hours (auto-release after expiry)
- **Instant access** - no provision wait time

**Failure modes:**
- If pool has 0 ready clusters → Pipeline fails fast (under 1 minute)
- No wasted compute resources on unavailable clusters

### 4. cleanup-existing-mta

Removes any previous MTA installation from the leased cluster:

- Deletes Tackle CR (triggers operator cleanup)
- Removes Subscription, CSV, CatalogSource
- Deletes ImageDigestMirrorSet
- Removes `konveyor-tackle` namespace

**Why needed:** Pool clusters are reused, so previous test installations must be cleaned up.

### 5. deploy-operator

Installs and configures the MTA operator:

- Downloads kubeconfig from OCPCTL API
- Applies ImageDigestMirrorSet for `registry.redhat.io` → `registry.stage.redhat.io`
- Creates CatalogSource from FBC snapshot image
- Subscribes to `mta-operator` (channel: `stable-v8.1`)
- Creates Tackle CR with resource limits
- Waits for MTA UI deployment to be ready
- Retrieves MTA UI route and Keycloak credentials

### 6. run-e2e-tests

Runs comprehensive Cypress E2E test suite:

- Clones `migtools/mta-tackle2-ui` repository (main branch)
- Installs dependencies and Cypress
- Executes test suite with tags: `@ci`, `@tier0`, `@tier2_A`, `@tier3_A-F`
- Excludes tests requiring secrets (JIRA, metrics, Git, Maven, etc.)
- **Includes `jq` installation** for test data seeding scripts
- Returns `PASSED` or `FAILED` status

### 7. release-cluster (finally)

Returns the leased cluster to the pool (always runs, even on failure):

- Sends release request to OCPCTL API
- Cluster becomes available for next test
- **Non-blocking:** Failure doesn't fail pipeline (auto-release handles it)

### 8. slack-notification (finally)

Sends test completion notification to Slack:

- **Conditional:** Only runs if tests actually executed (not if lease failed)
- Includes: Test status, NVR, Konflux UI link
- Format: `{status: "PASSED", nvr: "mta-operator-container-8.2.1-...", link: "..."}`

## Configuration

- **OCPCTL URL**: `https://ocpctl.mg.dog8code.com`
- **Pool**: `ci-sno-pool-1`
- **Profile**: `aws-sno-ga`
- **Namespace**: `konveyor-tackle` (formerly `openshift-mta`)
- **Operator channel**: `stable-v8.1`
- **Cluster version**: OpenShift 4.22.0
- **Lease duration**: 4 hours (auto-release enabled)
- **Total runtime**: ~1.7 hours (pool) vs ~2 hours (ephemeral)

## Prerequisites

### OCPCTL API Key Secret

The pipeline requires a Kubernetes Secret named `ocpctl-ci-key` in the Konflux workspace:

- **Secret name**: `ocpctl-ci-key`
- **Key**: `api-key`
- **Value**: OCPCTL API key for the CI account

Create via Konflux UI: Secrets → Add secret.

### Registry Credentials

**CRITICAL**: The pipeline requires pull credentials for `registry.stage.redhat.io` to be configured in the cluster's **global pull secret**.

**Why**: Pre-release operator bundles and images are published to `registry.stage.redhat.io` before production. The pipeline applies an ImageDigestMirrorSet to redirect `registry.redhat.io` → `registry.stage.redhat.io`, but OLM will fail to pull images if stage registry credentials are not available.

**Setup**: The `deploy-mta-operator` task includes a `configure-pull-secret` step that:

1. Checks if stage registry credentials exist in the global pull secret
2. If missing, merges credentials from the `stage-registry-pull-secret` Kubernetes Secret
3. Updates the cluster's global pull secret

**Required Secret** (create in Konflux workspace):

- **Secret name**: `stage-registry-pull-secret`
- **Type**: `kubernetes.io/dockerconfigjson`
- **Key**: `.dockerconfigjson`
- **Value**: Docker config JSON with `registry.stage.redhat.io` credentials

### Slack Notifications

The pipeline sends test completion notifications to Slack. This requires a Slack Workflow webhook URL configured as a Kubernetes Secret.

**Required Secret** (create in Konflux workspace):

- **Secret name**: `slack-webhook`
- **Type**: `Opaque`
- **Key**: `url`
- **Value**: Slack workflow trigger URL (e.g., `https://hooks.slack.com/triggers/...`)

**How to set up a Slack Workflow:**

1. Go to your Slack workspace
2. Create a new Workflow with the trigger type "Webhook"
3. Add variables: `status`, `nvr`, `link`
4. Configure message template (example):
   ```
   Test: {{status}}
   NVR: {{nvr}}
   <{{link}}|View Pipeline>
   ```
5. Publish the workflow and copy the webhook URL

**Notification payload:**

```json
{
  "status": "PASSED" | "FAILED",
  "nvr": "mta-operator-container-8.2.1-202608112039.p2.g240a021.assembly.stream.el9",
  "link": "https://konflux-ui.apps.kflux-ocp-p01.7ayg.p1.openshiftapps.com/ns/art-mta-tenant/applications/fbc-mta-8-2/pipelineruns/mta-fbc-8-2-ui-e2e-test-xxxxx"
}
```

**Features:**
- ✅ **NVR extraction:** Automatically extracts build NVR from FBC image tag
- 🔗 **Konflux UI link:** Direct link to pipeline run in Konflux UI (not raw OpenShift console)
- 🎯 **Conditional:** Only sends notification if tests actually ran (not on lease failures)

## Adding a New Pipeline for a New MTA Version

When creating integration tests for a new MTA operator version (e.g., 8.3.x), follow these steps:

### 1. Determine the Operator Channel

MTA uses **stable channels** for each minor version:

- MTA 8.1.x → `stable-v8.1`
- MTA 8.2.x → `stable-v8.2`
- MTA 8.3.x → `stable-v8.3`

**How to find the channel**:

```bash
# Check available channels in the FBC image
oc image extract <fbc-image> --path /configs/:/tmp/fbc-configs/
cat /tmp/fbc-configs/mta-operator/catalog.json | jq '.schema'

# Or inspect the CatalogSource after deployment
oc get packagemanifests mta-operator -o jsonpath='{.status.channels[*].name}'
```

### 2. Update the Pipeline

Copy and modify the existing pipeline (e.g., `mta-fbc-e2e-pipeline.yaml` → `mta-fbc-8-3-e2e-pipeline.yaml`):

**Required changes**:

- Update `channelName` parameter in the `deploy-operator` task from `stable-v8.2` to `stable-v8.3`
- Update OpenShift version if testing against a specific version (param: `version` in `provision-cluster`)
- Update pipeline metadata name to reflect the version

**Example**:

```yaml
- name: deploy-operator
  params:
    - name: channelName
      value: "stable-v8.3" # ← Update this
```

### 3. Create Integration Test Scenario

Create a new ITS manifest referencing the new pipeline:

```bash
oc apply -f - <<EOF
apiVersion: appstudio.redhat.com/v1beta2
kind: IntegrationTestScenario
metadata:
  name: mta-fbc-8-3-ui-e2e-test
  namespace: art-mta-tenant
spec:
  application: mta-ui
  resolverRef:
    resolver: git
    params:
      - name: url
        value: https://github.com/migtools/mta-tackle2-ui
      - name: revision
        value: main
      - name: pathInRepo
        value: .tekton/integration-tests/mta-fbc-8-3-e2e-pipeline.yaml
EOF
```

## Troubleshooting Guide

### Issue: OLM InstallPlan Stuck in "Installing" State

**Symptoms**:

- `oc get installplan` shows InstallPlan stuck in "Installing" phase
- CSV never reaches "Succeeded" state
- No operator pods created

**Root Cause**: OLM cannot pull images from `registry.stage.redhat.io` due to missing credentials in global pull secret

**Solution**:

1. Verify stage registry credentials exist in global pull secret:

   ```bash
   oc get secret pull-secret -n openshift-config -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq '.auths | has("registry.stage.redhat.io")'
   ```

   Should return `true`

2. If missing, ensure `stage-registry-pull-secret` exists in Konflux workspace and contains valid credentials

3. The `configure-pull-secret` step in `deploy-mta-operator` task should automatically merge credentials, but you can manually verify:
   ```bash
   # Check the task step logs
   tkn pipelinerun logs <pipelinerun-name> -t deploy-operator -s configure-pull-secret
   ```

### Issue: MTA UI Route Returns 404 or Redirect Loop

**Symptoms**:

- Cypress test fails with "404 Not Found" or redirect errors
- UI route exists but page doesn't load

**Root Cause**: MTA Control Plane (MCP) pod is not ready, only UI pod is running

**Solution**:
The `deploy-mta-operator` task includes a `wait-mcp-ready` step that polls until `oc get mcp` shows READY status. Verify this step completed:

```bash
tkn pipelinerun logs <pipelinerun-name> -t deploy-operator -s wait-mcp-ready
```

Expected output:

```
tackle-mcp-5f7b8d9c6-abcde   2/2   Running   0   2m
MCP is ready!
```

If MCP is not starting:

- Check MCP pod logs: `oc logs -n openshift-mta deployment/tackle-mcp`
- Verify Tackle CR was created: `oc get tackle -n openshift-mta`

### Issue: Pipeline Fails During Cluster Provisioning (Image Not Pullable)

**Symptoms**:

- Pipeline fails at `verify-image-pullable` step
- Error: "Failed to inspect image"

**Root Cause**: FBC image doesn't exist in `registry.stage.redhat.io` or is not yet published

**Solution**:

1. Verify the FBC image exists:

   ```bash
   skopeo inspect docker://<fbc-image-from-snapshot>
   ```

2. Check if the snapshot component image is correct:

   ```bash
   oc get snapshot <snapshot-name> -o jsonpath='{.spec.components[?(@.name=="mta-ui")].containerImage}'
   ```

3. If the image uses `registry.redhat.io` instead of `registry.stage.redhat.io`, the `verify-image-pullable` task will automatically rewrite the registry. Check task logs to confirm.

### Issue: Existing MTA Resources Cause Deployment Conflicts

**Symptoms**:

- CatalogSource or Subscription already exists errors
- Operator deploys but uses wrong version

**Root Cause**: Previous test run left resources in the cluster

**Solution**:
The `deploy-mta-operator` task includes a `pre-cleanup` step that removes existing MTA resources before deployment. Verify this step ran:

```bash
tkn pipelinerun logs <pipelinerun-name> -t deploy-operator -s pre-cleanup
```

Expected output shows deletion of:

- Tackle CR
- Subscription
- CatalogSource
- InstallPlan
- CSV

If resources persist, manually clean up:

```bash
oc delete tackle --all -n openshift-mta
oc delete subscription mta-operator -n openshift-mta
oc delete catalogsource mta-fbc-catalog -n openshift-mta
```

### Issue: ImageDigestMirrorSet Not Working

**Symptoms**:

- OLM pulls from `registry.redhat.io` instead of `registry.stage.redhat.io`
- Pull fails with authentication errors

**Root Cause**: ImageDigestMirrorSet requires node reboot or MachineConfigPool sync

**Solution**:
The `deploy-mta-operator` task applies ImageDigestMirrorSet and waits for MachineConfigPool to sync. For OCPCTL SNO clusters, this is automatic. Verify:

```bash
oc get imagedigestmirrorset stage-registry-mirror -o yaml
oc get mcp -o wide
```

MCP should show `UPDATED=True` and `DEGRADED=False`.

## Best Practices

### Pre-Flight Checks

- Always verify the FBC image is pullable before provisioning the cluster (saves ~15-20 minutes on failures)
- The `verify-image-pullable` task runs automatically and will fail fast if the image is inaccessible

### Resource Cleanup

- The `cleanup-cluster` task runs as a `finally` step and will always execute, even on pipeline failure
- Cleanup timeout is 30 minutes — if deletion hangs, check OCPCTL API status

### Debugging Failed Tests

- Cypress screenshots are base64-encoded and printed in the `run-e2e-tests` logs on failure
- JUnit reports and Mochawesome JSON are also dumped to logs
- To extract screenshots: copy the base64 string and decode: `echo "<base64>" | base64 -d > screenshot.png`

### OpenShift Version Selection

- MTA 8.2.x is certified for OpenShift 4.17-4.21
- Always test against the **minimum supported version** to catch compatibility issues early
- Default cluster version in pipeline: `4.21` (update via `version` param in `provision-cluster` task)

## Test Repository

Tests run from `migtools/mta-tackle2-ui` repository (main branch).

The repository contains:

- Cypress E2E test suite in `cypress/` directory
- Test configuration and environment setup
- Default test credentials in `.env.example`
