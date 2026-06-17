#!/usr/bin/env bash
# Waits for the Tsaagan companion extension to connect, then runs a trusted-click
# proof: goto example.com -> snapshot -> click "More information" by ref ->
# eval location.href to confirm real navigation (isTrusted, no coordinate math).
set -u
PORT="${TSG_PORT:-39817}"
URL="http://127.0.0.1:${PORT}"
post() { curl -s -m 30 -X POST "$URL/" -H 'content-type: application/json' -d "$1"; }

echo "[prove] waiting for extension to connect (reload the Tsaagan card in chrome://extensions)..."
connected=false
for i in $(seq 1 120); do            # up to ~3 min
  s=$(post '{"action":"status","args":{}}')
  if echo "$s" | grep -q '"connected":true'; then connected=true; echo "[prove] connected after ${i}s"; break; fi
  sleep 1.5
done
if [ "$connected" != "true" ]; then echo "[prove] FAIL: extension never connected"; exit 1; fi

echo "[prove] goto example.com"
post '{"action":"goto","args":{"url":"https://example.com"}}'; echo
sleep 2
echo "[prove] snapshot"
snap=$(post '{"action":"snapshot","args":{}}'); echo "$snap"
# find the data-kref index whose name contains "More information"
ref=$(echo "$snap" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const m=(j.marks||[]).find(x=>/more information/i.test(x.name||""));process.stdout.write(m?String(m.i):"")}catch(e){}})')
echo "[prove] More information ref = ${ref:-<none>}"
if [ -z "$ref" ]; then echo "[prove] FAIL: could not find link in snapshot"; exit 1; fi
echo "[prove] trusted click ref=$ref"
post "{\"action\":\"click\",\"args\":{\"ref\":$ref}}"; echo
sleep 2
echo "[prove] verify location.href"
post '{"action":"eval","args":{"js":"location.href"}}'; echo
echo "[prove] DONE — if href shows iana.org, trusted click works end-to-end."
