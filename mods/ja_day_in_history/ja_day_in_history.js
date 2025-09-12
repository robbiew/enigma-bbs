/* jslint node: true */
'use strict';

const MenuModule = require('../../core/menu_module.js').MenuModule;
const fs = require('fs');
const path = require('path');

exports.moduleInfo = {
    name: 'Day in History',
    desc: 'Displays historical events that occurred on the current day with configurable variety strategies',
    author: 'j0hnny A1pha',
    packageName: 'com.brokenbitsyndicate.dayinhistory',
};

exports.getModule = class DayInHistoryModule extends MenuModule {
    constructor(options) {
        super(options);
        this.events = [];

        // Map commands to strategies since ENiGMA isn't passing our custom extraArgs
        let detectedStrategy = 'era-based'; // default

        if (options.extraArgs && options.extraArgs.command) {
            const command = options.extraArgs.command;

            switch (command) {
                case 'D':
                    detectedStrategy = 'era-based';
                    break;
                case 'D1':
                    detectedStrategy = 'oldest-first';
                    break;
                case 'D2':
                    detectedStrategy = 'source-balanced';
                    break;
                case 'D3':
                    detectedStrategy = 'random';
                    break;
                default:
                    detectedStrategy = 'era-based';
                    break;
            }
        }

        // Configuration options for variety strategies
        const defaultConfig = {
            varietyStrategy: detectedStrategy,
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

        // Merge configuration (but command-based detection takes precedence)
        this.config = Object.assign({}, defaultConfig);
    }

    mciReady(mciData, cb) {
        super.mciReady(mciData, err => {
            if (err) {
                return cb(err);
            }

            const self = this;
            const async = require('async');

            async.series([
                callback => {
                    return self.displayHeader(callback);
                },
                callback => {
                    return self.loadCachedEvents(callback);
                },
                callback => {
                    return self.displayEvents(callback);
                },
                callback => {
                    // Use ENiGMA½'s pausePrompt method with explicit position
                    return self.pausePrompt({ row: 24, col: 1 }, callback);
                }
            ], (err) => {
                if (err) {
                    self.client.log.warn('Error during Day in History sequence', {
                        error: err.message,
                    });
                }
                return cb(err);
            });
        });
    }

    getCacheFilePath() {
        // Store cache in the module's directory
        const moduleDir = path.dirname(__filename);
        return path.join(moduleDir, 'day_in_history_cache.json');
    }

    loadCachedEvents(cb) {
        const self = this;
        const cacheFile = this.getCacheFilePath();

        // Load cached data - no fallback to API
        fs.readFile(cacheFile, 'utf8', (err, data) => {
            if (err) {
                self.client.log.error({
                    module: 'DayInHistory',
                    error: err.message
                }, 'Cache file not found - ensure cron job is running');
                return cb(new Error('Historical events cache not available. Please ensure the daily cron job is configured and running.'));
            }

            try {
                const cached = JSON.parse(data);
                
                // Check if cache has valid data
                if (!cached.rawEvents || cached.rawEvents.length === 0) {
                    self.client.log.error({
                        module: 'DayInHistory'
                    }, 'Cache file contains no events');
                    return cb(new Error('No historical events available in cache.'));
                }

                // Apply the current strategy to the cached raw events
                self.events = self.applyStrategy(cached.rawEvents);
                
                return cb(null);
                
            } catch (parseErr) {
                self.client.log.error({
                    module: 'DayInHistory',
                    error: parseErr.message
                }, 'Failed to parse cache file - cache may be corrupted');
                return cb(new Error('Historical events cache is corrupted. Please regenerate cache with cron job.'));
            }
        });
    }

    applyStrategy(rawEvents) {
        // Apply the selected variety strategy to raw events
        let selectedEvents;
        switch (this.config.varietyStrategy) {
            case 'era-based':
                selectedEvents = this.selectEventsByEra(rawEvents);
                break;
            case 'source-balanced':
                selectedEvents = this.selectEventsBySource(rawEvents);
                break;
            case 'oldest-first':
                selectedEvents = this.selectOldestEvents(rawEvents);
                break;
            case 'random':
                selectedEvents = this.selectRandomEvents(rawEvents);
                break;
            default:
                selectedEvents = this.selectRandomEvents(rawEvents);
                break;
        }

        return selectedEvents;
    }

    displayHeader(cb) {
        // Header will be displayed as part of displayEvents() to avoid double screen clear
        return cb(null);
    }


    selectEventsByEra(allEvents) {
        if (allEvents.length === 0) return [];

        const selectedEvents = [];

        // First pass: Try to get quota events from each defined era
        for (const era of this.config.eras) {
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

    selectEventsBySource(allEvents) {
        // Implement source-balanced strategy
        // For now, just return a random selection
        return this.selectRandomEvents(allEvents, 5);
    }

    selectOldestEvents(allEvents) {
        // Sort by year and take the oldest ones
        const sorted = allEvents.sort((a, b) => a.year - b.year);
        return sorted.slice(0, 5);
    }

    selectRandomEvents(allEvents, count = 5) {
        const shuffled = allEvents.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    displayEvents(cb) {
        // Single screen clear and complete display
        this.client.term.write('\x1B[2J\x1B[H');

        if (this.events.length === 0) {
            this.client.term.write('\r\n \x1B[31;1mNo historical events found for today.\x1B[0m\r\n');
            return cb(null);
        }

        const now = new Date();
        const day = now.getDate();
        const month = now.toLocaleString('default', { month: 'long' });
        const year = now.getFullYear();

        // Get ordinal ending (st, nd, rd, th) - matching Go version logic
        const getNumEnding = (day) => {
            if (day === 1 || (day % 10 === 1 && day !== 11)) return 'st';
            if (day === 2 || (day % 10 === 2 && day !== 12)) return 'nd';
            if (day === 3 || (day % 10 === 3 && day !== 13)) return 'rd';
            return 'th';
        };

        // Draw header and events in one operation
        this.client.term.write('\r\n \x1B[30;1m\x1B[0m-\x1B[36m---\x1B[32;1m-\x1B[0m\x1B[36m--\x1B[32;1m-\x1B[0m\x1B[36m-\x1B[32;1m--------- ------------------------------------ ------ -- -  \x1B[0m\r\n');

        this.client.term.write(' \x1B[42m\x1B[37;1m>> \x1B[32;1mGlimpse In Time v1  \x1B[0m\x1B[42m\x1B[30m>>\x1B[40m\x1B[32m>>  \x1B[0m\x1B[37;1m\x1B[36;1mENiGMA mod inspired by Smooth \x1B[0m\x1B[36m<\x1B[37;1mPHEN0M\x1B[0m\x1B[36m>\x1B[0m\r\n');

        this.client.term.write(' \x1B[30;1m-\x1B[0m\x1B[36m--\x1B[32;1m--\x1B[0m\x1B[36m---\x1B[32;1m-\x1B[0m\x1B[36m-\x1B[32;1m----- --- -------------------------------- ------ -- -  \x1B[0m\r\n');

        this.client.term.write(` \x1B[41m\x1B[30m>>\x1B[40m \x1B[35;1mOn \x1B[0m\x1B[33;1mTHIS DAY\x1B[35;1m, These \x1B[33;1mEVENTS \x1B[35;1mHappened... \x1B[0m\x1B[31m:: \x1B[33m${month} ${day}${getNumEnding(day)} \x1B[31m::\x1B[0m\r\n`);

        this.client.term.write(' \x1B[30;1m-\x1B[0m\x1B[36m--\x1B[32;1m--\x1B[0m\x1B[36m---\x1B[32;1m-\x1B[0m\x1B[36m-\x1B[32;1m--\x1B[0m\x1B[36m--\x1B[32;1m-\x1B[0m\x1B[36m---\x1B[32;1m--- ---------------------------- ------ -- -  \x1B[0m\r\n');

        // Position cursor at row 8, column 1 for events display (matching Go version)
        this.client.term.write('\x1B[8;1H');

        // Calculate dynamic display limits - pause is on row 24, footer ends on row 23
        const maxContentRows = 15; // Rows 8-22 (footer starts on row 20, pause on row 24)
        let yPos = 8;
        let eventsDisplayed = 0;

        // Get current time for footer - matching Go version
        const currentTime = now.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).replace(/^(\d+):/, '$1:');

        for (let index = 0; index < this.events.length; index++) {
            const event = this.events[index];

            // Create prefix with proper 4-digit year padding and calculate text wrapping
            const paddedYear = event.year.toString().padStart(4, ' '); // Always 4 characters
            const prefix = ` \x1B[36;1m${paddedYear}\x1B[0m\x1B[36m <\x1B[30;1m:\x1B[0m\x1B[36m> `;
            const prefixDisplayLength = 10; // " YYYY <:> " = always 10 characters now
            const maxLineLength = 75 - prefixDisplayLength; // Leave room for prefix

            // Word wrap the event text
            const wrappedLines = this.wrapText(event.text.trim(), maxLineLength);
            const eventRows = wrappedLines.length + 1; // +1 for blank line after event

            // Check if this event will fit in remaining space
            const rowsFromStart = yPos - 8; // Current position relative to start (row 8)
            const rowsNeeded = rowsFromStart + eventRows;

            if (rowsNeeded > maxContentRows || eventsDisplayed >= 5) {
                // This event won't fit or we've hit the 5 event limit, stop here
                if (this.config.debugVariety) {
                    this.client.log.debug({
                        module: 'DayInHistory',
                        eventIndex: index + 1,
                        eventRows: eventRows,
                        rowsFromStart: rowsFromStart,
                        maxContentRows: maxContentRows,
                        eventsDisplayed: eventsDisplayed
                    }, `Event ${index + 1} won't fit or limit reached, stopping display`);
                }
                break;
            }

            // Display first line with prefix (year is now always 4 digits padded)
            this.client.term.write(`\x1B[${yPos};1H`);
            this.client.term.write(`${prefix}\x1B[37;1m${wrappedLines[0]}\x1B[0m\r\n`);
            yPos++;

            // Display continuation lines with proper indentation (10 spaces to align with text)
            for (let i = 1; i < wrappedLines.length; i++) {
                this.client.term.write(`\x1B[${yPos};1H`);
                this.client.term.write(`          \x1B[37;1m${wrappedLines[i]}\x1B[0m\r\n`);
                yPos++;
            }

            // Add blank line between events
            yPos++;
            eventsDisplayed++;
        }

        // Position footer at row 20-22 (3 rows before pause on row 24)
        this.client.term.write('\x1B[20;1H');
        this.client.term.write(' \x1B[30;1m-\x1B[0m\x1B[36m---\x1B[32;1m-\x1B[0m\x1B[36m--\x1B[32;1m-\x1B[0m\x1B[36m-\x1B[32;1m-----\x1B[0m\x1B[36m-\x1B[32;1m--------------------------------------- ---  --- -- -  \x1B[0m\r\n');

        // Include strategy in footer like previous versions - show ACTUAL strategy used
        const strategyDisplay = ` \x1B[36m(${this.config.varietyStrategy})\x1B[0m`;

        this.client.term.write(` \x1B[41m\x1B[30m>>\x1B[40m \x1B[37;1mGenerated on ${month} ${day}, ${year} at ${currentTime}${strategyDisplay}\x1B[0m\r\n`);

        this.client.term.write(' \x1B[30;1m-\x1B[0m\x1B[36m---\x1B[32;1m-\x1B[0m\x1B[36m--\x1B[32;1m-\x1B[0m\x1B[36m-\x1B[32;1m-----\x1B[0m\x1B[36m-\x1B[32;1m--------------------------------------- ---  --- -- -  \x1B[0m\r\n');

        return cb(null);
    }

    // Word wrapping helper function
    wrapText(text, maxLineLength) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;

            if (testLine.length <= maxLineLength) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    // Word is too long, break it up
                    if (word.length > maxLineLength) {
                        lines.push(word.substring(0, maxLineLength - 3) + '...');
                        currentLine = '';
                    } else {
                        currentLine = word;
                    }
                }
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.length > 0 ? lines : [''];
    }

};
