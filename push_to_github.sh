#!/bin/bash
# ============================================================
# Push MMM Tool to GitHub
# ============================================================
# Run this script from the mmm_tool directory to create a new
# GitHub repo and push all code.
#
# Prerequisites:
#   - GitHub CLI (gh) installed: https://cli.github.com/
#   - Authenticated: gh auth login
#
# Usage:
#   cd mmm_tool
#   bash ../push_to_github.sh
# ============================================================

REPO_NAME="mmm-tool"
DESCRIPTION="Marketing Mix Modeling Tool — End-to-end MMM platform built on Meta Robyn methodology"

echo "Creating GitHub repository: $REPO_NAME"
gh repo create "$REPO_NAME" --public --description "$DESCRIPTION" --source . --push

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Successfully pushed to GitHub!"
    echo "   Visit: https://github.com/$(gh api user --jq '.login')/$REPO_NAME"
else
    echo ""
    echo "❌ Failed. Trying manual approach..."
    echo ""
    echo "1. Go to https://github.com/new"
    echo "2. Create a repo named: $REPO_NAME"
    echo "3. Don't initialize with README"
    echo "4. Then run:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/$REPO_NAME.git"
    echo "   git push -u origin main"
fi
