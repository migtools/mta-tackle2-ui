# NVR Extraction Logic
# This file contains the logic to extract operator NVR from bundle image labels
# Saved for future use when we're ready to add NVR to Slack notifications
# DO NOT COMMIT - for reference only

# Install jq for JSON parsing
if ! command -v jq &> /dev/null; then
  echo "Installing jq..."
  microdnf install -y jq || {
    echo "Warning: jq installation failed, NVR extraction will be skipped"
  }
fi

# Extract operator container NVR from bundle image labels
# Strategy:
# 1. Get FBC snapshot (fbc-mta-8-2 app)
# 2. Find corresponding mta-8-2 snapshot (created just before FBC)
# 3. Extract bundle image from mta-8-2 snapshot
# 4. Inspect bundle image labels for operator NVR
NVR=""

# Get latest FBC snapshot
FBC_APP="fbc-mta-8-2"
FBC_SNAPSHOT=$(oc get snapshots -n art-mta-tenant \
  -l appstudio.openshift.io/application=$FBC_APP \
  --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")

if [ -n "$FBC_SNAPSHOT" ]; then
  echo "FBC snapshot: $FBC_SNAPSHOT"

  # Get FBC snapshot creation time
  FBC_TIME=$(oc get snapshot $FBC_SNAPSHOT -n art-mta-tenant \
    -o jsonpath='{.metadata.creationTimestamp}')

  # Find corresponding mta-8-2 snapshot (created before FBC)
  MTA_SNAPSHOT=$(oc get snapshots -n art-mta-tenant \
    -l appstudio.openshift.io/application=mta-8-2 \
    --sort-by=.metadata.creationTimestamp \
    -o json | \
    jq -r --arg fbc_time "$FBC_TIME" \
      '.items[] | select(.metadata.creationTimestamp < $fbc_time) | .metadata.name' | \
    tail -1)

  if [ -n "$MTA_SNAPSHOT" ]; then
    echo "Found mta-8-2 snapshot: $MTA_SNAPSHOT"

    # Get bundle image from mta-8-2 snapshot
    BUNDLE_IMAGE=$(oc get snapshot $MTA_SNAPSHOT -n art-mta-tenant -o json | \
      jq -r '.spec.components[] | select(.name == "mta-8-2-mta-operator-bundle") | .containerImage')

    if [ -n "$BUNDLE_IMAGE" ]; then
      echo "Bundle image: $BUNDLE_IMAGE"

      # Extract operator NVR from bundle image labels
      LABELS=$(oc image info $BUNDLE_IMAGE -o json 2>/dev/null | \
        jq -r '.config.config.Labels // {}')

      if [ -n "$LABELS" ] && [ "$LABELS" != "{}" ]; then
        COMPONENT=$(echo "$LABELS" | jq -r '."com.redhat.component" // ""')
        VERSION=$(echo "$LABELS" | jq -r '.version // ""')
        RELEASE=$(echo "$LABELS" | jq -r '.release // ""')

        if [ -n "$COMPONENT" ] && [ -n "$VERSION" ] && [ -n "$RELEASE" ]; then
          NVR="${COMPONENT}-${VERSION}-${RELEASE}"
          echo "✅ Extracted operator NVR from bundle labels: $NVR"
        fi
      fi
    fi
  fi
fi

# Fallback to digest if no NVR found
if [ -z "$NVR" ] && [ -n "$FBC_IMAGE" ]; then
  echo "Using digest as fallback"
  if echo "$FBC_IMAGE" | grep -q '@sha256:'; then
    DIGEST=$(echo "$FBC_IMAGE" | sed 's/.*@sha256://' | cut -c1-12)
    NVR="sha256:${DIGEST}"
  fi
fi

echo "Final NVR: $NVR"

# To include in MESSAGE JSON:
# "NVR": "$NVR",
