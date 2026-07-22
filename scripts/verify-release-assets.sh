#!/usr/bin/env bash
#
# 릴리스에 설치 파일과 업데이터 정보가 빠짐없이 올라갔는지 검사한다.
#
#   scripts/verify-release-assets.sh v1.0.6
#
# 매트릭스 잡이 서로 다른 Draft에 자산을 나눠 올리거나(#54) 한 플랫폼 빌드가
# 조용히 빠지면, 워크플로는 전부 success인데 설치 파일이 없는 릴리스가 나간다.
# latest.json에 플랫폼 키가 빠지면 그 플랫폼의 자동 업데이트가 조용히 멈춘다.
# 게시 전에 이 검사를 통과해야 한다.
#
# 필요한 도구: gh(로그인 상태), jq
set -euo pipefail

tag="${1:-}"
if [ -z "$tag" ]; then
  echo "사용법: $0 <tag>   (예: $0 v1.0.6)" >&2
  exit 2
fi

repo="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
version="${tag#v}"

# Draft는 태그로 바로 조회할 수 없어(getReleaseByTag는 404) 목록에서 찾는다.
release="$(gh api "repos/${repo}/releases?per_page=100" \
  --jq "[.[] | select(.tag_name == \"${tag}\")] | first // empty")"
if [ -z "$release" ]; then
  echo "❌ ${repo} 에 태그 ${tag} 인 릴리스가 없습니다." >&2
  exit 1
fi

release_id="$(printf '%s' "$release" | jq -r '.id')"
is_draft="$(printf '%s' "$release" | jq -r '.draft')"
echo "릴리스 #${release_id} (${tag}, draft=${is_draft}) 검사 중..."

# 정상 릴리스의 구성 — 자산 14개, latest.json의 platforms 키 11개.
# 번들 이름이 바뀌면 여기도 함께 고쳐야 한다(조용히 지나가지 않게 하는 것이 목적).
expected_assets=(
  "token-usage-app_${version}_amd64.AppImage"
  "token-usage-app_${version}_amd64.AppImage.sig"
  "token-usage-app_${version}_amd64.deb"
  "token-usage-app_${version}_amd64.deb.sig"
  "token-usage-app-${version}-1.x86_64.rpm"
  "token-usage-app-${version}-1.x86_64.rpm.sig"
  "token-usage-app_${version}_x64-setup.exe"
  "token-usage-app_${version}_x64-setup.exe.sig"
  "token-usage-app_${version}_x64_en-US.msi"
  "token-usage-app_${version}_x64_en-US.msi.sig"
  "token-usage-app_${version}_universal.dmg"
  "token-usage-app_universal.app.tar.gz"
  "token-usage-app_universal.app.tar.gz.sig"
  "latest.json"
)
expected_platforms=(
  darwin-aarch64
  darwin-aarch64-app
  darwin-x86_64
  darwin-x86_64-app
  linux-x86_64
  linux-x86_64-appimage
  linux-x86_64-deb
  linux-x86_64-rpm
  windows-x86_64
  windows-x86_64-msi
  windows-x86_64-nsis
)

assets_json="$(gh api "repos/${repo}/releases/${release_id}/assets?per_page=100")"
mapfile -t actual_assets < <(printf '%s' "$assets_json" | jq -r '.[].name' | sort)

failed=0

# 1) 자산 목록
missing_assets=()
for name in "${expected_assets[@]}"; do
  found=0
  for actual in "${actual_assets[@]}"; do
    [ "$actual" = "$name" ] && found=1 && break
  done
  [ "$found" -eq 1 ] || missing_assets+=("$name")
done

extra_assets=()
for actual in "${actual_assets[@]}"; do
  found=0
  for name in "${expected_assets[@]}"; do
    [ "$actual" = "$name" ] && found=1 && break
  done
  [ "$found" -eq 1 ] || extra_assets+=("$actual")
done

if [ "${#missing_assets[@]}" -eq 0 ]; then
  echo "✅ 자산 ${#expected_assets[@]}개 모두 있습니다."
else
  failed=1
  echo "❌ 자산 ${#missing_assets[@]}개가 없습니다:"
  printf '   - %s\n' "${missing_assets[@]}"
fi
if [ "${#extra_assets[@]}" -gt 0 ]; then
  echo "⚠️  목록에 없는 자산 ${#extra_assets[@]}개가 있습니다(검사 목록을 갱신하세요):"
  printf '   - %s\n' "${extra_assets[@]}"
fi

# 2) latest.json — 자동 업데이트가 이 파일 하나에 걸려 있다.
latest_id="$(printf '%s' "$assets_json" | jq -r '.[] | select(.name == "latest.json") | .id' | head -n 1)"
if [ -z "$latest_id" ]; then
  failed=1
  echo "❌ latest.json이 없어 업데이터 검사를 건너뜁니다."
else
  latest_json="$(gh api "repos/${repo}/releases/assets/${latest_id}" \
    -H 'Accept: application/octet-stream')"

  latest_version="$(printf '%s' "$latest_json" | jq -r '.version // empty')"
  if [ "$latest_version" = "$version" ]; then
    echo "✅ latest.json version: ${latest_version}"
  else
    failed=1
    echo "❌ latest.json version이 ${version} 이어야 하는데 '${latest_version}' 입니다."
  fi

  missing_platforms=()
  for key in "${expected_platforms[@]}"; do
    has="$(printf '%s' "$latest_json" | jq -r --arg k "$key" '.platforms | has($k)')"
    [ "$has" = "true" ] || missing_platforms+=("$key")
  done
  if [ "${#missing_platforms[@]}" -eq 0 ]; then
    echo "✅ latest.json platforms 키 ${#expected_platforms[@]}개 모두 있습니다."
  else
    failed=1
    echo "❌ latest.json에 플랫폼 키 ${#missing_platforms[@]}개가 없습니다" \
         "— 해당 플랫폼의 자동 업데이트가 멈춥니다:"
    printf '   - %s\n' "${missing_platforms[@]}"
  fi
fi

# 3) 같은 태그의 Draft가 여러 개면 자산이 갈렸다는 뜻이다(#54).
same_tag_count="$(gh api "repos/${repo}/releases?per_page=100" \
  --jq "[.[] | select(.tag_name == \"${tag}\")] | length")"
if [ "$same_tag_count" -gt 1 ]; then
  failed=1
  echo "❌ 태그 ${tag} 인 릴리스가 ${same_tag_count}개입니다 — 자산이 갈렸습니다."
fi

if [ "$failed" -eq 0 ]; then
  echo "🎉 ${tag} 릴리스는 게시할 수 있는 상태입니다."
else
  echo "게시하지 마세요. 위 항목을 해결한 뒤 다시 검사하세요." >&2
fi
exit "$failed"
