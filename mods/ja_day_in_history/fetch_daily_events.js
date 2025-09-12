#!/usr/bin/env node
/* jslint node: true */
'use strict';

/**
 * Daily Historical Events Fetcher
 * 
 * This script fetches historical events for the current day and caches them
 * for the Day in History module. Run this as a daily cron job.
 * 
 * Usage: node fetch_daily_events.js
 * Cron example: 0 6 * * * /usr/bin/node /path/to/enigma-bbs/mods/ja_day_in_history/fetch_daily_events.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration matching the main module
const defaultConfig = {
    varietyStrategy: 'era-based',
    minYear: 1,
    maxYear: 2030,
    excludeBirthsDeaths: true,
    eras: [
        { name: 'Ancient', min: 1, max: 500, quota: 1 },
        { name: 'Medieval', min: 501, max: 1500, quota: 1 },
        { name: 'Early Modern', min: 1501, max: 1800, quota: 1 },
        { name: 'Modern', min: 1801, max: 1950, quota: 1 },
        { name: 'Contemporary', min: 1951, max: 2030, quota: 1 }
    ]
};

function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data) : '');
}

function fetchHistoricalEventsFromAPI(callback) {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const options = {
        hostname: 'api.wikimedia.org',
        path: `/feed/v1/wikipedia/en/onthisday/all/${month}/${day}`,
        headers: {
            'User-Agent': 'Enigma BBS Day-in-History Module/1.1 (enigma-bbs.org)',
            'Accept': 'application/json',
            'Accept-Encoding': 'identity'
        }
    };

    log(`Fetching historical events from: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${month}/${day}`);

    const req = https.get(options, (res) => {
        if (res.statusCode !== 200) {
            return callback(new Error(`API request failed with status ${res.statusCode}`));
        }

        let data = '';
        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                const allEvents = parseWikimediaResponse(response);
                return callback(null, allEvents);
            } catch (err) {
                return callback(err);
            }
        });
    });

    req.on('error', (err) => {
        return callback(err);
    });

    req.setTimeout(10000, () => {
        req.destroy();
        return callback(new Error('Request timeout'));
    });
}

function parseWikimediaResponse(response) {
    try {
        const allEvents = [];

        // Process events section
        if (response.events && Array.isArray(response.events)) {
            for (const event of response.events) {
                if (event.year && event.text) {
                    const year = parseInt(event.year);
                    if (year >= defaultConfig.minYear && year <= defaultConfig.maxYear) {
                        allEvents.push({
                            year: year,
                            text: event.text,
                            type: 'event'
                        });
                    }
                }
            }
        }

        // Optionally include births and deaths if not excluded
        if (!defaultConfig.excludeBirthsDeaths) {
            ['births', 'deaths'].forEach(category => {
                if (response[category] && Array.isArray(response[category])) {
                    for (const item of response[category]) {
                        if (item.year && item.text) {
                            const year = parseInt(item.year);
                            if (year >= defaultConfig.minYear && year <= defaultConfig.maxYear) {
                                allEvents.push({
                                    year: year,
                                    text: item.text,
                                    type: category.slice(0, -1) // 'birth' or 'death'
                                });
                            }
                        }
                    }
                }
            });
        }

        // Return raw events - strategies will be applied by the main module
        log(`Parsed ${allEvents.length} raw events for caching`);
        
        return allEvents;

    } catch (err) {
        throw new Error(`Error parsing Wikimedia response: ${err.message}`);
    }
}

function selectEventsByEra(allEvents) {
    if (allEvents.length === 0) return [];

    const selectedEvents = [];

    // First pass: Try to get quota events from each defined era
    for (const era of defaultConfig.eras) {
        const eraEvents = allEvents.filter(event =>
            event.year >= era.min && event.year <= era.max
        );

        // Randomly select events from this era up to the quota
        const shuffled = eraEvents.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, era.quota);
        selectedEvents.push(...selected);
    }

    // Sort selected events by year
    selectedEvents.sort((a, b) => a.year - b.year);

    return selectedEvents;
}

function selectEventsBySource(allEvents) {
    // Implement source-balanced strategy
    // For now, just return a random selection
    return selectRandomEvents(allEvents, 5);
}

function selectOldestEvents(allEvents) {
    // Sort by year and take the oldest ones
    const sorted = allEvents.sort((a, b) => a.year - b.year);
    return sorted.slice(0, 5);
}

function selectRandomEvents(allEvents, count = 5) {
    const shuffled = allEvents.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function main() {
    const cacheFile = path.join(__dirname, 'day_in_history_cache.json');
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    log('Starting daily historical events fetch');

    fetchHistoricalEventsFromAPI((err, rawEvents) => {
        if (err) {
            log('ERROR: Failed to fetch historical events', { error: err.message });
            process.exit(1);
        }

        log(`Successfully fetched ${rawEvents.length} raw historical events`);

        // Save raw events to cache - strategies will be applied by the main module
        const cacheData = {
            date: today,
            timestamp: now.toISOString(),
            rawEvents: rawEvents,
            fetchedBy: 'cron-job'
        };

        fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2), (writeErr) => {
            if (writeErr) {
                log('ERROR: Failed to write cache file', { error: writeErr.message });
                process.exit(1);
            }

            log(`Raw historical events cached successfully to ${cacheFile}`);
            log('Daily fetch completed successfully - all strategies supported');
            process.exit(0);
        });
    });
}

// ENiGMA½ Event Scheduler Method
exports.fetchDailyEvents = function(args, callback) {
    console.log('ENiGMA½ Event Scheduler: Starting daily historical events fetch');
    main();
    return callback(null);
};

// Run the script directly if called from command line
if (require.main === module) {
    main();
}

module.exports.fetchHistoricalEventsFromAPI = fetchHistoricalEventsFromAPI;
module.exports.parseWikimediaResponse = parseWikimediaResponse;
module.exports.selectEventsByEra = selectEventsByEra;
module.exports.selectRandomEvents = selectRandomEvents;