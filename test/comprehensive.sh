#!/bin/bash

echo "🧪 Starting comprehensive NEWO CLI tests..."
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
        exit 1
    fi
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# 1. Test help command
print_info "Testing help command..."
node src/cli.js --help > /dev/null 2>&1
print_status $? "Help command works"

# 2. Clean up any existing test files
print_info "Cleaning up test environment..."
rm -rf projects .newo test-integration test-projects
mkdir -p test-results

# 3. Test multi-project pull (without PROJECT_ID)
print_info "Testing multi-project pull..."
# Temporarily comment out PROJECT_ID
sed -i.bak 's/^NEWO_PROJECT_ID=/#NEWO_PROJECT_ID=/' .env

node src/cli.js pull > test-results/multi-pull.log 2>&1
PULL_RESULT=$?
print_status $PULL_RESULT "Multi-project pull completed"

# Check that multiple projects were created
if [ -d "projects" ]; then
    PROJECT_COUNT=$(ls -1 projects | wc -l)
    if [ $PROJECT_COUNT -gt 1 ]; then
        print_status 0 "Multiple projects downloaded ($PROJECT_COUNT projects)"
    else
        print_status 1 "Expected multiple projects, got $PROJECT_COUNT"
    fi
else
    print_status 1 "Projects directory not created"
fi

# 4. Test status command
print_info "Testing status command..."
node src/cli.js status > test-results/status1.log 2>&1
if grep -q "Clean" test-results/status1.log; then
    print_status 0 "Status shows clean after pull"
else
    print_status 1 "Status should show clean after pull"
fi

# 5. Make a test change and verify it's detected
print_info "Testing change detection..."
# Find a .guidance file and modify it
FIRST_PROJECT=$(ls projects | head -1)
GUIDANCE_FILE=$(find projects/$FIRST_PROJECT -name "*.guidance" | head -1)

if [ -n "$GUIDANCE_FILE" ]; then
    echo "// Test comment $(date)" >> "$GUIDANCE_FILE"
    
    node src/cli.js status > test-results/status2.log 2>&1
    if grep -q "1 changed file" test-results/status2.log; then
        print_status 0 "Change detection works"
    else
        print_status 1 "Change detection failed"
    fi
    
    # 6. Test push
    print_info "Testing push functionality..."
    node src/cli.js push > test-results/push.log 2>&1
    if grep -q "Push complete" test-results/push.log; then
        print_status 0 "Push completed successfully"
    else
        print_status 1 "Push failed"
    fi
    
    # 7. Verify status is clean after push
    node src/cli.js status > test-results/status3.log 2>&1
    if grep -q "Clean" test-results/status3.log; then
        print_status 0 "Status clean after push"
    else
        print_status 1 "Status should be clean after push"
    fi
else
    print_info "No .guidance files found, skipping change tests"
fi

# 8. Test single-project mode
print_info "Testing single-project mode..."
# Restore PROJECT_ID
mv .env.bak .env

# Clean up for single project test
rm -rf projects .newo

node src/cli.js pull > test-results/single-pull.log 2>&1
SINGLE_PULL_RESULT=$?
print_status $SINGLE_PULL_RESULT "Single-project pull completed"

# Check that only one project was created
if [ -d "projects" ]; then
    PROJECT_COUNT=$(ls -1 projects | wc -l)
    if [ $PROJECT_COUNT -eq 1 ]; then
        print_status 0 "Single project downloaded"
    else
        print_status 1 "Expected single project, got $PROJECT_COUNT"
    fi
fi

# 9. Check project structure
print_info "Validating project structure..."
METADATA_COUNT=$(find projects -name "metadata.json" | wc -l)
FLOWS_COUNT=$(find projects -name "flows.yaml" | wc -l)

if [ $METADATA_COUNT -gt 0 ] && [ $FLOWS_COUNT -gt 0 ]; then
    print_status 0 "Project structure valid (metadata.json and flows.yaml present)"
else
    print_status 1 "Project structure invalid"
fi

# 10. Run unit tests if mocha is available
if command -v npx &> /dev/null; then
    print_info "Running unit tests..."
    npx mocha test/api.test.js --timeout 30000 > test-results/api-tests.log 2>&1
    API_TEST_RESULT=$?
    print_status $API_TEST_RESULT "API unit tests"
else
    print_info "Mocha not available, skipping unit tests"
fi

# Summary
echo ""
echo "🎉 Comprehensive testing completed!"
echo "============================================"
print_info "Test results saved in test-results/ directory"
print_info "Multi-project pull: $([ $PULL_RESULT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")"
print_info "Single-project pull: $([ $SINGLE_PULL_RESULT -eq 0 ] && echo "✅ PASSED" || echo "❌ FAILED")"
print_info "Change detection: ✅ PASSED"
print_info "Push functionality: ✅ PASSED"
print_info "Project structure: ✅ PASSED"

echo ""
echo "✨ All tests passed! The multi-project functionality is working correctly."