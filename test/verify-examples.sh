#!/usr/bin/env bash
# Build every framework example the way the "Deploy Examples" workflow does.
#
# Why this exists: examples consume the library through `file:../..` and resolve
# the library's bare `import('heic2any')` with Vite/Rollup. A green build here is
# the cheapest proof that the published manifest still works for bundler users —
# removing the optional `heic2any` peer declaration, for instance, makes all five
# fail with `Rollup failed to resolve import "heic2any"`.
#
# Usage: bash test/verify-examples.sh   (from the repo root)
set -u
cd "$(dirname "$0")/.." || exit 1

echo "=== root: build dist for the examples to import ==="
npm run build >/dev/null 2>&1 || { echo "lib build FAILED"; exit 1; }
echo "lib built"

fail=0
for fw in react vue svelte angular vanilla; do
  printf "%-9s " "$fw"
  if [ ! -d "examples/$fw" ]; then echo "skipped (missing)"; continue; fi
  ( cd "examples/$fw" || exit 1
    npm ci --prefer-offline --no-audit --no-fund >"/tmp/ic-ci-$fw.log" 2>&1 || exit 2
    npm run build -- --base="/image-compression/examples/$fw/" >"/tmp/ic-build-$fw.log" 2>&1 || exit 3
  )
  case $? in
    0) echo "npm ci + build OK" ;;
    2) echo "npm ci FAILED  (/tmp/ic-ci-$fw.log)";    fail=1 ;;
    3) echo "build FAILED   (/tmp/ic-build-$fw.log)"; fail=1 ;;
    *) echo "FAILED"; fail=1 ;;
  esac
done

[ "$fail" -eq 0 ] && echo "all examples built ✓" || echo "some examples FAILED ✗"
exit $fail
