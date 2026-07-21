#!/usr/bin/env sh
set -eu

read_secret() {
  name="$1"
  path="/run/secrets/$2"
  if [ ! -s "$path" ]; then
    echo "required runtime secret is unavailable: $name" >&2
    exit 1
  fi
  export "$name=$(cat "$path")"
}

read_secret BETTER_AUTH_SECRET better_auth_secret
read_secret A2A_SECRET a2a_secret
read_secret ANALYTICS_PUBLIC_KEY analytics_public_key
read_secret OPENAI_API_KEY openai_api_key

if [ ! -s /run/secrets/database_password ]; then
  echo "required runtime secret is unavailable: DATABASE_PASSWORD" >&2
  exit 1
fi
encoded_password=$(node -e 'let value=""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => process.stdout.write(encodeURIComponent(value)))' < /run/secrets/database_password)
export DATABASE_URL_BASE="postgresql://inbound:${encoded_password}@postgres:5432"
unset encoded_password

exec node scripts/prod-start.mjs
