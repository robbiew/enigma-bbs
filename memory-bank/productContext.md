# Product Context

Project: Enigma BBS — telnet-first-menu bot-check user module (JA Bot Barbeque)

Summary:
This memory artifact records the high-level product and operational context for the telnet-first-menu user module implemented at [`mods/ja_bot_barbeque/ja_bot_barbeque.js`](mods/ja_bot_barbeque/ja_bot_barbeque.js:1). The module's purpose is to perform a simple human-interaction check (press ESC twice) and perform an IP reputation/geolocation lookup to silently drop known bad actors.

Current scope:
- Implement a user module placed under `mods/ja_bot_barbeque`.
- Display themed ANSI art (BOTBBQ), center prompt and countdown, require two ESC presses within a short interval to continue.
- Perform IP lookup using ipdata.co when an API key is provided in the menu config, fallback to ipapi.co for broader IPv6 coverage.
- If IP lookup flags the address as a threat, disconnect immediately and silently.
- Add logging and diagnostic traces to help determine whether provider calls are occurring and what responses are returned.

Important files (source of truth):
- Module: [`mods/ja_bot_barbeque/ja_bot_barbeque.js`](mods/ja_bot_barbeque/ja_bot_barbeque.js:1)
- Menu config: [`config/menus/broken_bit_syndicate-login.hjson`](config/menus/broken_bit_syndicate-login.hjson:1)
- Global logging config: [`config/config.hjson`](config/config.hjson:1)
- Example API reference: [`mods/ja_bot_barbeque/api_example.sh`](mods/ja_bot_barbeque/api_example.sh:1) (note: present in repo as an example)

Current status (as of last update):
- Module implemented and wired in as menu `telnetBotCheck`.
- ipdata calls are attempted when apiKey set in menu config; fallback to ipapi for IPv6 or on error.
- Logging increased to trace level in [`config/config.hjson`](config/config.hjson:1) to capture detailed request/response traces.
- Additional sanitized request/response trace logging added to the module to avoid leaking API keys while making provider requests more observable.
- User observed that ipdata.co dashboard showed no hits for their tests and that raw IPv6 addresses appeared instead of resolved city/region/country.

Key decisions made:
- Keep implementation as a user module under `mods/` to avoid modifying core.
- Prefer ipdata.co when API key present (provider exposes threat flags), but remain tolerant and fall back to ipapi.co for IPv6 coverage.
- Do not log API keys; instead produce sanitized URLs and a REDACTED placeholder in logs.
- Elevate rotating-file logger to trace to capture detailed diagnostic output for the short term.

Operational notes and how to debug:
- After deploying code changes, restart ENiGMA process so new code and logging level take effect.
- Tail and pretty-print logs to see trace entries:
  - tail -F /home/bbs/enigma-bbs/logs/enigma-bbs.log | bunyan
- Look for these log keys/messages:
  - "geo lookup request (sanitized)" — indicates module attempted a provider call and shows sanitized path/provider.
  - "geo lookup request trace" — trace-level sanitized URL (safe to correlate with provider dashboard).
  - "geo lookup response received" and "geo lookup response details" — show status, length, headers, and a small body snippet.
  - "ipdata.co lookup result" or "Fallback lookup result" — parsed summary the module used to display location or determine threats.

Next immediate tasks (engineering):
- Create persistent memory-bank (this directory) so decisions and progress are recorded (this file is first).
- Run a connection test with an external telnet client (IPv6 case) and tail logs to confirm provider requests appear.
- If provider calls do not appear in external dashboards:
  - Verify server can reach the provider (network/firewall/NAT issues).
  - Confirm the host's outbound IP (NAT) is the one expected by ipdata dashboard and not masked by IPv6 scope.
  - Temporarily flip lookup order (ipapi first) to validate IPv6 geolocation behavior.