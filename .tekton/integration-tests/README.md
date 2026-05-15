# Integration Test Pipeline

## Overview

This custom integration test pipeline validates MTA operator deployments using File-Based Catalog (FBC) images from Konflux snapshots.

**Pipeline workflow:**

1. **Provision ephemeral cluster** - Creates a temporary Hypershift cluster on AWS via EaaS
2. **Deploy operator from FBC** - Installs MTA operator using the FBC catalog image from the snapshot
3. **Run E2E tests** - Executes Cypress login test to validate the deployment

## Why Custom Pipeline

We use a custom pipeline instead of Konflux's built-in `deploy-fbc-operator` pipeline to support:

- **Pre-release testing**: Operator bundles are pushed to `registry.stage.redhat.io` before production
- **Registry mirroring**: Automatic redirection from `registry.redhat.io` → `registry.stage.redhat.io`
- **Full deployment validation**: Creates MTA CR and runs end-to-end tests

## Pipeline Steps

### 1. parse-metadata
Extracts the FBC image reference from the Konflux snapshot.

### 2. provision-eaas-space
Creates an isolated namespace in the EaaS management cluster.

### 3. provision-cluster
Provisions an ephemeral Hypershift cluster with:
- OpenShift version: 4.17.0
- Instance type: m5.xlarge
- Registry mirroring: `registry.redhat.io` → `registry.stage.redhat.io`

### 4. deploy-operator
Installs and configures the MTA operator:
- Creates CatalogSource from FBC snapshot image
- Subscribes to `mta-operator` (channel: `stable-v8.1`)
- Creates Tackle CR with resource limits
- Waits for MTA UI deployment to be ready
- Retrieves MTA UI route and Keycloak credentials

### 5. run-e2e-tests
Runs Cypress login test:
- Clones `migtools/mta-tackle2-ui` repository
- Executes `e2e/tests/login.test.ts` against deployed MTA instance
- Validates authentication flow and UI accessibility

## Configuration

- **Namespace:** `openshift-mta`
- **Operator channel:** `stable-v8.1`
- **Cluster version:** OpenShift 4.17.0
- **Instance type:** m5.xlarge
- **Total runtime:** ~20-30 minutes

## Registry Credentials

Stage registry credentials (`registry.stage.redhat.io`) are provisioned automatically by EaaS:

1. The `hypershift` secret in the EaaS management cluster contains stage credentials
2. ClusterTemplate injects these credentials into the ephemeral cluster's global pull secret
3. OLM uses these credentials automatically when pulling operator bundles
4. No manual credential configuration required in the pipeline

## Test Repository

Tests run from `migtools/mta-tackle2-ui` repository (release-0.9 branch).

The repository contains:
- Cypress E2E test suite in `cypress/` directory
- Test configuration and environment setup
- Default test credentials in `.env.example`
