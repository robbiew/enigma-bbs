/* jslint node: true */
'use strict';

const MenuModule = require('../../core/menu_module.js').MenuModule;
const ansi = require('../../core/ansi_term.js');
const async = require('async');
const https = require('https');
const getPredefinedMCIValue = require('../../core/predefined_mci.js').getPredefinedMCIValue;

exports.moduleInfo = {
  name: "Bot Barbeque",
  desc: "Simple telnet bot check: prompt for ESC twice to continue",
  author: "j0hnny A1pha",
  packageName: "com.brokenbitsyndicate.botbarbeque",
};

exports.getModule = class JaBotBarbeque extends MenuModule {
    constructor(options) {
        super(options);

        // default config values
        this.config = Object.assign({ countdown: 10, escapeMaxInterval: 1500 }, this.menuConfig.config || {});
        // state
        this._escapeHits = 0;
        this._lastEscapeTs = 0;
        this._timer = null;
        this._disconnected = false;

        // bind handlers
        this._onData = this._onData.bind(this);
    }

    enter() {
        // ensure base behavior (which calls initSequence by default)
        this.initSequence();
    }

    initSequence() {
        const self = this;

        // Get remote IP via predefined MCI 'IP' (fallback to client.remoteAddress)
        let ip = '';
        try {
            const mciIp = getPredefinedMCIValue(self.client, 'IP');
            ip = mciIp ? String(mciIp).replace(/^::ffff:/, '') : '';
        } catch (e) {
            ip = '';
        }
        if (!ip) {
            ip = (self.client && self.client.remoteAddress) ? String(self.client.remoteAddress).replace(/^::ffff:/, '') : '';
        }

        //
        // API key — use key menu config if present (for ipdata.co)
        // See https://docs.ipdata.co/docs/ for details on free tier limits and sign-up.
        //

        const apiKey =
            (this.menuConfig &&
                this.menuConfig.config &&
                this.menuConfig.config.apiKey) || '';

        const lookupIp = cb => {
            if (!ip) {
                return cb(null, { bad: false, location: 'Unknown' });
            }

            // Helper to call a URL and parse JSON with a simple parser
            const callJson = (url, timeoutMs, done) => {
                // Sanitize URL for logging (remove sensitive query params like api-key)
                try {
                    const u = new URL(url);
                    // Build a sanitized display path (mask api-key if present)
                    if (u.searchParams.has('api-key')) {
                        u.searchParams.set('api-key', 'REDACTED');
                    }
                    const provider = u.hostname;
                    const pathForLog = `${u.pathname}${u.search ? '?' + u.searchParams.toString() : ''}`;
                    self.client.log.info({ provider, path: pathForLog, ip }, 'geo lookup request (sanitized)');
                } catch (e) {
                    /* ignore logging errors */
                }
    
                const r = https.get(url, { timeout: timeoutMs }, res => {
                    let body = '';
                    res.on('data', c => (body += c));
                    res.on('end', () => {
                        // log a short summary of the response for diagnostics (do not log full body at info)
                        try {
                            const summary = {
                                statusCode: res.statusCode,
                                length: body.length,
                                remoteAddress: res.socket && res.socket.remoteAddress,
                            };
                            self.client.log.info({ ip, provider: res.socket && res.socket.remoteAddress, summary }, 'geo lookup response received');
    
                            // At trace level log headers and a small snippet of the body (sanitized)
                            try {
                                const headers = Object.keys(res.headers || {});
                                // keep only a small snippet to avoid huge logs, and avoid leaking api keys
                                // removed trace-level response snippet logging in production
                            } catch (e) {
                                /* ignore */
                            }
                        } catch (e) {
                            /* ignore */
                        }
    
                        try {
                            const j = JSON.parse(body);
                            return done(null, j);
                        } catch (e) {
                            return done(e);
                        }
                    });
                });
                r.on('error', err => {
                    try {
                        self.client.log.info({ ip, err: err.message }, 'geo lookup request error');
                    } catch (e) {}
                    return done(err);
                });
                r.on('timeout', () => {
                    r.destroy();
                    try {
                        self.client.log.info({ ip }, 'geo lookup request timeout');
                    } catch (e) {}
                    return done(new Error('timeout'));
                });
            };
    

            // If an ipdata API key is configured, prefer using it; otherwise use ipapi.co directly.
            if (apiKey && String(apiKey).trim()) {
                // Log attempt to call ipdata (don't log the key)
                try {
                    self.client.log.info({ ip }, 'Attempting ipdata.co lookup (apiKey present)');
                } catch (e) {
                    /* ignore logging errors */
                }

                const url = `https://api.ipdata.co/${encodeURI(ip)}?api-key=${apiKey}`;
                callJson(url, 3000, (err, json) => {
                    if (err || !json) {
                        // log fallback reason
                        try {
                            self.client.log.info(
                                { ip, reason: err ? err.message : 'no-response' },
                                'ipdata.co lookup failed; falling back to ipapi.co'
                            );
                        } catch (e) {
                            /* ignore */
                        }

                        // fallback to ipapi
                        const fallback = `https://ipapi.co/${encodeURI(ip)}/json/`;
                        return callJson(fallback, 3000, (ferr, fjson) => {
                            if (ferr || !fjson) {
                                try {
                                    self.client.log.info({ ip }, 'Fallback ipapi.co lookup failed; returning IP only');
                                } catch (e) {}
                                return cb(null, { bad: false, location: ip });
                            }
                            const parts = [];
                            if (fjson.city) parts.push(fjson.city);
                            if (fjson.region) parts.push(fjson.region);
                            const fcountry = fjson.country_name || fjson.country || '';
                            if (fcountry) parts.push(fcountry);
                            const flinkOrg = fjson.org || fjson.hostname || '';
                            const final = {
                                bad: false,
                                location: parts.length ? parts.join(', ') : (fjson.ip || ip),
                                country: fcountry,
                                org: flinkOrg,
                            };

                            try {
                                self.client.log.info({ ip, provider: 'ipapi.co', location: final.location }, 'Fallback lookup result');
                            } catch (e) {}

                            return cb(null, final);
                        });
                    }

                    try {
                        const parts = [];
                        if (json.city) parts.push(json.city);
                        if (json.region) parts.push(json.region);
                        const country = json.country_name || json.country || '';
                        if (country) parts.push(country);
                        const location = parts.length ? parts.join(', ') : (json.ip || ip);
                        const org =
                            (json.asn && json.asn.name) ? json.asn.name : (json.org || json.organization || '');

                        const threat = json.threat || {};
                        const isBad =
                            Boolean(threat.is_tor) ||
                            Boolean(threat.is_proxy) ||
                            Boolean(threat.is_known_abuser) ||
                            Boolean(threat.is_threat);

                        try {
                            self.client.log.info({ ip, provider: 'ipdata.co', location, org, bad: isBad }, 'ipdata.co lookup result');
                        } catch (e) {
                            /* ignore */
                        }

                        return cb(null, { bad: isBad, location, country, org });
                    } catch (e) {
                        return cb(null, { bad: false, location: ip });
                    }
                });
            } else {
                // No apiKey — use ipapi.co directly (better IPv6 coverage without key)
                const fallback = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
                callJson(fallback, 3000, (ferr, fjson) => {
                    if (ferr || !fjson) {
                        return cb(null, { bad: false, location: ip });
                    }
                    const parts = [];
                    if (fjson.city) parts.push(fjson.city);
                    if (fjson.region) parts.push(fjson.region);
                    const fcountry = fjson.country_name || fjson.country || '';
                    if (fcountry) parts.push(fcountry);
                    const flinkOrg = fjson.org || fjson.hostname || '';
                    const final = {
                        bad: false,
                        location: parts.length ? parts.join(', ') : (fjson.ip || ip),
                        country: fcountry,
                        org: flinkOrg,
                    };
                    return cb(null, final);
                });
            }
        };

        // Perform IP lookup first — if bad actor, disconnect immediately without notice.
        lookupIp((err, lookup) => {
            if (err) {
                // proceed without location info
            }

            if (lookup && lookup.bad) {
                try {
                    // immediate disconnect with no art or message
                    self.client.end();
                } catch (e) {
                    /* best effort */
                }
                return;
            }

            // Decide if we need to run a lightweight fallback geo lookup (helps with some IPv6 results)
            const needsFallback =
                lookup &&
                (!lookup.location || lookup.location === ip || lookup.location === String(ip));

            const doDisplay = finalLookup => {
                const info = finalLookup || lookup || {};

                // Display the configured art (e.g. "BOTBBQ") if present, then show the message below it.
                const artName = this.menuConfig.art || this.menuConfig.config?.art || 'BOTBBQ';

                // Clear screen and display art via theme/display helpers from MenuModule
                self.client.term.rawWrite(ansi.resetScreen());
                self.displayAsset(artName, this.menuConfig.config || {}, (err, artData) => {
                    if (err) {
                        // If art fails to display, continue gracefully and log
                        self.client.log.warn({ error: err.message, art: artName }, 'Could not display art for bot-check');
                    }

                    // Compute start row below art
                    const startRow = (artData && artData.height) ? artData.height + 1 : 1;

                    // Show connecting location centered (if available)
                    // Print location (city/region/country) and, if present, print org on its own centered line below.
                    const termWidth = Math.max(1, parseInt(self.client.term.termWidth || 80, 10));
                    // Helper to strip Renegade/ENiGMA pipe colour codes for accurate centering
                    const stripPipeCodes = s => String(s || '').replace(/\|[A-Z\d]{2}/g, '');
                    const centerCol = text => {
                        const len = stripPipeCodes(text).length;
                        return Math.max(1, Math.floor((termWidth - len) / 2) + 1);
                    };

                    let locationText = '';
                    let orgText = '';
                    if (info) {
                        // Treat pure-IP results as "unknown" for display purposes
                        const isIpLike = s => typeof s === 'string' && (/(?:^\d{1,3}(?:\.\d{1,3}){3}$)|(?:^[A-Fa-f0-9:]{3,39}$)/.test(s));
                        const locParts = [];
                        if (info.location && !isIpLike(info.location)) locParts.push(info.location);
                        if (info.country && (!info.location || !info.location.includes(info.country))) locParts.push(info.country);
                        if (locParts.length) {
                            locationText = `Connecting from ${locParts.join(', ')}`;
                        } else if (info.country) {
                            locationText = `Connecting from ${info.country}`;
                        } else {
                            // If we only have a raw IP (or nothing), present a friendly unknown message
                            locationText = 'Connecting from Unknown';
                        }
                        
                    }

                    let rowsUsed = 0;
                    if (locationText) {
                        const locRow = startRow;
                        // Use ANSI SGR (via core/ansi_term.js) instead of pipe codes for direct terminal output.
                        const ansiLocation = `${ansi.sgr(['bold','cyan'])}${locationText}${ansi.sgr(['normal','reset'])}`;
                        const locCol = Math.max(1, Math.floor((termWidth - stripPipeCodes(locationText).length) / 2) + 1);
                        self.client.term.rawWrite(ansi.goto(locRow, locCol));
                        self.client.term.rawWrite(ansiLocation);
                        rowsUsed = 1;
                    }
    
                    // Prepare prompt and countdown placement (centered)
                    const promptText = 'Press Escape Twice to Continue';
                    const promptRow = startRow + (rowsUsed ? rowsUsed + 1 : 0); // add a blank line if we printed location/org
                    const countdownRow = promptRow + 2; // leave a blank line between prompt and countdown
    
                    // Draw centered prompt using ANSI SGR
                    const ansiPrompt = `${ansi.sgr(['bold','white'])}${ansi.sgr(['blueBG'])}${promptText}${ansi.sgr(['normal','reset'])}`;
                    const promptCol = Math.max(1, Math.floor((termWidth - promptText.length) / 2) + 1);
                    self.client.term.rawWrite(ansi.goto(promptRow, promptCol));
                    self.client.term.rawWrite(ansiPrompt);

                    // start listening for raw input (so we receive escape)
                    self.client.term.output.on('data', self._onData);

                    // start countdown
                    let secs = parseInt(self.config.countdown, 10) || 10;

                    // helper to write centered countdown (clears fixed area based on the maximum length)
                    const initialSecs = parseInt(self.config.countdown, 10) || 10;
                    const maxText = `Continuing in ${initialSecs} second${initialSecs === 1 ? '' : 's'}...`;
                    const maxLen = maxText.length;
                    const leftColForMax = Math.max(1, Math.floor((termWidth - maxLen) / 2) + 1);

                    const writeCountdown = s => {
                        const text = `Continuing in ${s} second${s === 1 ? '' : 's'}...`;
                        const ansiCountdown = `${ansi.sgr(['bold','cyan'])}${text}${ansi.sgr(['normal','reset'])}`;
                        // Clear the full max area first (prevents leftover characters when text shrinks)
                        self.client.term.rawWrite(`${ansi.goto(countdownRow, leftColForMax)}${' '.repeat(maxLen)}`);
                        // Then write the current centered colored text
                        const col = Math.max(1, Math.floor((termWidth - text.length) / 2) + 1);
                        self.client.term.rawWrite(`${ansi.goto(countdownRow, col)}${ansiCountdown}`);
                    };

                    // initial draw
                    writeCountdown(secs);

                    const tick = () => {
                        if (self._disconnected) {
                            return;
                        }
                        if (secs === 0) {
                            // timed out
                            self._cleanup();
                            try {
                                self.client.end();
                            } catch (e) {
                                /* best effort */
                            }
                            self._disconnected = true;
                            return;
                        }
                        secs -= 1;
                        writeCountdown(secs);
                        self._timer = setTimeout(tick, 1000);
                    };

                    // schedule next ticks (first tick after 1s so initial display shows full countdown)
                    this._timer = setTimeout(tick, 1000);
                });
            };

            if (!needsFallback) {
                return doDisplay();
            }

            // fallback geo lookup (ipapi.co) for better IPv6 handling
            const fallbackUrl = `https://ipapi.co/${encodeURI(ip)}/json/`;
            const fbReq = https.get(fallbackUrl, { timeout: 3000 }, res => {
                let fbData = '';
                res.on('data', c => (fbData += c));
                res.on('end', () => {
                    try {
                        const fjson = JSON.parse(fbData);
                        const fparts = [];
                        if (fjson.city) fparts.push(fjson.city);
                        if (fjson.region) fparts.push(fjson.region);
                        const fcountry = fjson.country_name || fjson.country || '';
                        if (fcountry) fparts.push(fcountry);
                        const flinkOrg = fjson.org || fjson.hostname || '';
                        const finalLookup = {
                            bad: false,
                            location: fparts.length ? fparts.join(', ') : (fjson.ip || ip),
                            country: fcountry,
                            org: flinkOrg,
                        };
                        return doDisplay(finalLookup);
                    } catch (e) {
                        return doDisplay();
                    }
                });
            });

            fbReq.on('error', () => {
                return doDisplay();
            });
            fbReq.on('timeout', () => {
                fbReq.destroy();
                return doDisplay();
            });
        });
    }

    _onData(data) {
        // Expect Buffer or string; normalize to Buffer
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'binary');
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            // ESC is 0x1b (27)
            if (b === 0x1b) {
                const now = Date.now();
                if (this._escapeHits === 0) {
                    this._escapeHits = 1;
                    this._lastEscapeTs = now;
                } else {
                    // check interval
                    if (now - this._lastEscapeTs <= (this.config.escapeMaxInterval || 1500)) {
                        // second escape within the allowed interval -> success
                        this._escapeHits = 0;
                        this._lastEscapeTs = 0;
                        this._onSuccess();
                        return;
                    } else {
                        // too slow; treat as first escape again
                        this._escapeHits = 1;
                        this._lastEscapeTs = now;
                    }
                }
            } else {
                // any other key resets the escape count
                this._escapeHits = 0;
                this._lastEscapeTs = 0;
            }
        }
    }

    _onSuccess() {
        // stop timer and remove listener
        this._cleanup();

        // navigate to next menu (as configured by menu.hjson)
        // Use client.menuStack.next() to follow menu.next
        try {
            this.client.menuStack.next();
        } catch (e) {
            // fallback: attempt to goto configured next menuName if present
            if (this.menuConfig && this.menuConfig.next) {
                try {
                    this.client.menuStack.goto(this.menuConfig.next);
                } catch (e2) {
                    // last resort: do nothing
                }
            }
        }
    }

    _cleanup() {
        // stop countdown
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        // remove data listener
        try {
            this.client.term.output.removeListener('data', this._onData);
        } catch (e) {
            // ignore
        }
    }

    leave() {
        // cleanup when leaving menu
        this._cleanup();
        super.leave();
    }
};