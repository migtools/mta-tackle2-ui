# FBC vs Component Application Testing

## Why IntegrationTestScenario is on `fbc-mta-8-2` instead of `mta-8-2`

### Application Types

**`mta-8-2` Application:**

- Builds 22 individual MTA container images (UI, Hub, Operator, Analyzers, etc.)
- Snapshot created every time any component changes
- Does **not** produce an FBC (File-Based Catalog) image

**`fbc-mta-8-2` Application:**

- Builds 1 FBC catalog image only
- Snapshot created when complete MTA release is assembled
- FBC references all 22 component images at validated versions

### Why Test FBC Snapshots?

#### 1. **FBC Represents Complete Releases**

The FBC catalog defines the entire MTA release by referencing specific versions of all components:

```yaml
# Inside FBC catalog
relatedImages:
  - mta-ui @ sha256:abc123
  - mta-hub @ sha256:def456
  - mta-operator @ sha256:ghi789
  # ... all 22 components at validated versions
```

**Testing FBC = Testing the complete integrated system customers will install**

#### 2. **Snapshot Frequency**

| Application   | Snapshot Trigger      | Frequency      |
| ------------- | --------------------- | -------------- |
| `mta-8-2`     | Every component build | 100s per month |
| `fbc-mta-8-2` | Release assembly only | ~5 per month   |

Running E2E tests on every component change would:

- Waste OCPCTL cluster resources
- Test incomplete/unvalidated component combinations
- Cost $$$$$ in compute resources

#### 3. **Pipeline Requirements**

Our E2E pipeline requires an FBC image to:

1. Create OLM CatalogSource
2. Install operator via OLM
3. OLM pulls all component images referenced in FBC

`mta-8-2` snapshots don't contain FBC images → Pipeline would fail immediately.

#### 4. **Release Alignment**

**`mta-8-2` snapshot:**

- Represents individual component update
- May have incompatible component versions
- Not what customers install

**`fbc-mta-8-2` snapshot:**

- Represents complete validated release (e.g., MTA 8.2.1)
- All components validated to work together by ART team
- Exactly what customers install via OLM

### Example Workflow

```
Developer Activity:
  - Day 1-14: Multiple commits to various components
  - mta-8-2 creates 50+ snapshots
  - No E2E tests run yet

ART Release Assembly:
  - Day 15: ART team assembles MTA 8.2.1
  - Validates all components work together
  - Creates FBC catalog with validated component versions
  - fbc-mta-8-2 creates 1 snapshot

Integration Tests:
  - Trigger on FBC snapshot
  - Deploy complete MTA 8.2.1 system
  - Run 72 E2E tests
  - Validate release-ready system
```

### Summary

**Test FBC snapshots because they represent complete, validated, customer-ready releases.**

Testing individual component snapshots would be like testing car parts instead of testing the assembled car. We test the **complete vehicle** (FBC with all components), not individual **parts** (one component at a time).

### Configuration

**IntegrationTestScenario:**

```yaml
name: mta-fbc-8-2-ui-e2e-test
application: fbc-mta-8-2 # ✅ FBC application
pipeline: mta-fbc-e2e-pipeline.yaml
```
