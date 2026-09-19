#!/bin/bash
set -euo pipefail

# GitHub Actionsによるプルリクエスト作成・承認を許可
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
gh api --method PUT "repos/${REPO}/actions/permissions/workflow" \
  --field "can_approve_pull_request_reviews=true" \
  --field "default_workflow_permissions=read"

# 公開後のリリースとタグを変更不可にする
gh api --method PUT "repos/${REPO}/immutable-releases"
