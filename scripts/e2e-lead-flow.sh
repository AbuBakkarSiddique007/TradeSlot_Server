#!/usr/bin/env bash
# TradeSlot — Lead Flow E2E test (one-shot)
#
# Covers: login -> set today's zone -> in-zone booking (slots)
#         -> out-of-zone webchat lead (asks phone) -> out-of-zone WhatsApp lead
#         -> trader leads API.
#
# Usage:  TRADER_EMAIL=you@x.com TRADER_PASSWORD=secret bash scripts/e2e-lead-flow.sh
# Env:    API_URL (default http://localhost:5000/api/v1)
#
# NOTE: run the server locally and execute during the day. The zone is
# matched on the server's local calendar day; between ~00:00-06:00 in a
# UTC+x timezone the client/local and server dates can disagree.

set -u

API="${API_URL:-http://localhost:5000/api/v1}"
EMAIL="${TRADER_EMAIL:?Set TRADER_EMAIL (trader login email)}"
PASSWORD="${TRADER_PASSWORD:?Set TRADER_PASSWORD (trader login password)}"

TODAY="$(date +%F)"
STAMP="$(date +%s)"

parse() { node -e "const s=require('fs').readFileSync(0,'utf8');try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch(e){console.log(s)}"; }
field() { node -e "const s=require('fs').readFileSync(0,'utf8');const o=JSON.parse(s);const v=eval('o'+process.argv[1]);if(v!==undefined)console.log(v)" "$1"; }
say() { printf '\n=== %s ===\n' "$1"; }

say "0. Local API: $API / today: $TODAY / stamp: $STAMP"

say "1. Login trader"
LOGIN="$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
TOKEN="$(echo "$LOGIN" | field ".token")"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "undefined" ]; then
  echo "Login failed. Response:"; echo "$LOGIN" | parse; exit 1
fi
AUTH="Authorization: Bearer $TOKEN"
echo "Logged in ok."

say "2. Set today's work area (North London, postcodes SW1 + N1)"
curl -s -X POST "$API/trader/work-area" -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"date\":\"$TODAY\",\"zoneName\":\"North London\",\"postalCodes\":[\"SW1\",\"N1\"]}" | parse

say "3. Webchat IN-ZONE request (SW1A 1AA is inside SW1 -> should OFFER SLOTS, no lead)"
R1="$(curl -s -X POST "$API/channels/webchat/message" -H "Content-Type: application/json" \
  -d "{\"senderRef\":\"web-in-$STAMP\",\"content\":\"fix a leak at SW1A 1AA\"}")"
echo "$R1" | node -e "const s=require('fs').readFileSync(0,'utf8');try{const o=JSON.parse(s);console.log('state:',o.state);console.log('reply:',o.reply.text);console.log('slot chips offered:',o.reply.options?.length??0)}catch(e){console.log(s)}"

say "4. Webchat OUT-OF-ZONE (Manchester -> should ask for phone, NO slots)"
R2="$(curl -s -X POST "$API/channels/webchat/message" -H "Content-Type: application/json" \
  -d "{\"senderRef\":\"web-out-$STAMP\",\"content\":\"fix a leak in Manchester\"}")"
echo "$R2" | node -e "const s=require('fs').readFileSync(0,'utf8');try{const o=JSON.parse(s);console.log('state:',o.state);console.log('reply:',o.reply.text)}catch(e){console.log(s)}"

say "5. Webchat LEAD - reply with phone number to the same out-of-zone session"
R3="$(curl -s -X POST "$API/channels/webchat/message" -H "Content-Type: application/json" \
  -d "{\"senderRef\":\"web-out-$STAMP\",\"content\":\"07700 900123\"}")"
echo "$R3" | node -e "const s=require('fs').readFileSync(0,'utf8');try{const o=JSON.parse(s);console.log('state:',o.state);console.log('reply:',o.reply.text)}catch(e){console.log(s)}"

say "6. WhatsApp mock OUT-OF-ZONE (senderRef is the phone, auto-captured)"
WA="$(curl -s -X POST "$API/channels/whatsapp/message" -H "Content-Type: application/json" \
  -d "{\"from\":\"+44 7700 900456\",\"body\":\"fix a leak in Manchester\"}")"
echo "$WA" | node -e "const s=require('fs').readFileSync(0,'utf8');try{const o=JSON.parse(s);console.log('state:',o.state);console.log('reply:',o.reply.text)}catch(e){console.log(s)}"
echo "Mock WhatsApp outbox tail:"
if [ -f /tmp/tradeslot-mock-wa-outbox.log ]; then
  tail -n 3 /tmp/tradeslot-mock-wa-outbox.log
else
  echo "(outbox log not found on this host)"
fi

say "7. Trader leads API (expect 2 leads: webchat + WhatsApp)"
curl -s "$API/trader/leads" -H "$AUTH" | parse