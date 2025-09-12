/* jslint node: true */
'use strict';

//  ENiGMA½
const msgArea = require('../../core/message_area.js');
const MenuModule = require('../../core/menu_module.js').MenuModule;
const ViewController = require('../../core/view_controller.js').ViewController;
const stringFormat = require('../../core/string_format.js');
const FileEntry = require('../../core/file_entry.js');
const FileBaseFilters = require('../../core/file_base_filter.js');
const Errors = require('../../core/enig_error.js').Errors;
const { getAvailableFileAreaTags } = require('../../core/file_base_area.js');
const { valueAsArray } = require('../../core/misc_util.js');

//  deps
const _ = require('lodash');
const async = require('async');

// Performance optimization cache for newscan
const newscanCache = {
    batchResults: new Map(),        // userId -> {results, timestamp}
    areaAccess: new Map(),          // userId_areaTag -> boolean
    cacheTimeout: 30000,            // 30 seconds

    // Clear expired cache entries
    cleanup() {
        const now = Date.now();
        for (const [key, value] of this.batchResults.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.batchResults.delete(key);
            }
        }
    },

    // Get cached batch results if still valid
    getBatchResults(userId) {
        this.cleanup();
        const cached = this.batchResults.get(userId);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.results;
        }
        return null;
    },

    // Cache batch results
    setBatchResults(userId, results) {
        this.batchResults.set(userId, {
            results: results,
            timestamp: Date.now()
        });
    },

    // Invalidate cache for a specific user (called when messages are marked as read)
    invalidateUser(userId) {
        this.batchResults.delete(userId);
    }
};

exports.moduleInfo = {
    name: 'New Scan',
    desc: 'Performs a new scan against various areas of the system',
    author: 'NuSkooler',
};

// Export cache invalidation function for use by other modules
exports.invalidateUserCache = function (userId) {
    newscanCache.invalidateUser(userId);
};

/*
 * * Adapted from original NewScan module to add user configurable newscan areas
*/

const MciCodeIds = {
    ScanStatusLabel: 1, //  TL1
    ScanStatusList: 2, //  VM2 (appends)
};

const Steps = {
    MessageConfs: 'messageConferences',
    FileBase: 'fileBase',

    Finished: 'finished',
};

exports.getModule = class NewScanModule extends MenuModule {
    constructor(options) {
        super(options);

        this.newScanFullExit = _.get(options, 'lastMenuResult.fullExit', false);

        this.currentStep = Steps.MessageConfs;
        this.currentScanAux = {};

        //  :TODO: Make this conf/area specific:
        //  :TODO: Use newer custom info format - TL10+
        const config = this.menuConfig.config;
        this.scanStartFmt = config.scanStartFmt || 'Scanning {confName} - {areaName}...';
        this.scanFinishNoneFmt = config.scanFinishNoneFmt || 'Nothing new in {confName} - {areaName}';
        this.scanFinishNewFmt = config.scanFinishNewFmt || '{count} entries found';
        this.scanCompleteMsg = config.scanCompleteMsg || 'Finished newscan - Press any key to continue';
    }

    updateScanStatus(statusText) {
        // Clear the status area first by padding with spaces
        const clearLine = ' '.repeat(80); // Use a reasonable line width
        this.setViewText('allViews', MciCodeIds.ScanStatusLabel, clearLine);
        this.setViewText('allViews', MciCodeIds.ScanStatusList, clearLine);
        // Then set the new status
        this.setViewText('allViews', MciCodeIds.ScanStatusLabel, statusText);
    }

    updateCurrentAreaDisplay(areaName, confName) {
        // Update custom MCI codes that can display current area information
        // This uses the updateCustomViewTextsWithFilter method to update any custom MCI codes
        // that might be configured to show current area information
        if (this.viewControllers && this.viewControllers.allViews) {
            this.updateCustomViewTextsWithFilter('allViews', 10, {
                currentAreaName: areaName,
                currentConfName: confName,
                currentArea: areaName,
                currentConf: confName,
                scanAreaName: areaName,
                scanConfName: confName
            });
        }
    }

    // Optimized batch function to get new message counts for multiple areas at once
    // CRITICAL FIX: Use core ENiGMA½ functions to ensure newscan dates are properly respected
    getBatchNewMessageCountsForUser(userId, areaTags, cb) {
        if (!Array.isArray(areaTags) || areaTags.length === 0) {
            return cb(null, {});
        }

        // CRITICAL FIX: Don't use cache for newscan operations as it can interfere with
        // newscan date settings and real-time read status updates
        // The performance benefit isn't worth the complexity of cache invalidation

        // Use the core function for each area to ensure proper newscan date handling
        // This respects the user_message_area_last_read table which is updated by set newscan date
        const results = {};

        async.eachLimit(areaTags, 5, (areaTag, nextArea) => {
            // Use the core function that properly handles newscan dates
            msgArea.getNewMessageCountInAreaForUser(userId, areaTag, (err, count) => {
                if (!err) {
                    results[areaTag] = {
                        lastReadId: 0, // We don't need this for the newscan logic
                        newCount: count || 0
                    };
                } else {
                    // Log error but continue with other areas
                    this.client.log.warn({
                        error: err.message,
                        areaTag: areaTag,
                        userId: userId
                    }, 'Error getting new message count for area');
                    results[areaTag] = {
                        lastReadId: 0,
                        newCount: 0
                    };
                }
                return nextArea(); // Continue even if one area fails
            });
        }, () => {
            // Ensure all requested areas are in the results
            areaTags.forEach(areaTag => {
                if (!results[areaTag]) {
                    results[areaTag] = {
                        lastReadId: 0,
                        newCount: 0
                    };
                }
            });

            return cb(null, results);
        });
    }

    // CRITICAL FIX: Get filtered new messages that respect global newscan date
    // This method ensures that even if an area doesn't have a specific newscan date set,
    // it will still respect any global newscan date the user has configured
    getFilteredNewMessagesForArea(areaTag, cb) {
        const self = this;

        // First get the standard new messages using core ENiGMA½ logic
        msgArea.getNewMessagesInAreaForUser(
            self.client.user.userId,
            areaTag,
            (err, newMessages) => {
                if (err) {
                    return cb(err);
                }

                if (!newMessages || newMessages.length === 0) {
                    return cb(null, []);
                }

                // Check if user has set a global newscan date
                const globalNewscanDate = self.client.user.properties['GlobalNewscanDate'];
                if (!globalNewscanDate) {
                    // No global newscan date set, return all new messages
                    return cb(null, newMessages);
                }

                // Parse the global newscan date
                const moment = require('moment');
                const newscanMoment = moment(globalNewscanDate);
                if (!newscanMoment.isValid()) {
                    self.client.log.warn({
                        globalNewscanDate: globalNewscanDate
                    }, 'Invalid global newscan date format, ignoring');
                    return cb(null, newMessages);
                }

                // Filter messages to only include those newer than the global newscan date
                const filteredMessages = newMessages.filter(msg => {
                    const msgMoment = moment(msg.modTimestamp);
                    return msgMoment.isValid() && msgMoment.isSameOrAfter(newscanMoment);
                });

                self.client.log.debug({
                    areaTag: areaTag,
                    totalMessages: newMessages.length,
                    filteredMessages: filteredMessages.length,
                    globalNewscanDate: globalNewscanDate
                }, 'Applied global newscan date filter');

                return cb(null, filteredMessages);
            }
        );
    }

    // Fallback method using individual queries (original behavior)
    fallbackToIndividualQueries(userId, areaTags, cb) {
        const results = {};

        async.eachLimit(areaTags, 3, (areaTag, nextArea) => {
            msgArea.getNewMessageCountInAreaForUser(userId, areaTag, (err, count) => {
                if (!err) {
                    results[areaTag] = {
                        lastReadId: 0, // We don't get this from individual queries
                        newCount: count || 0
                    };
                }
                return nextArea(); // Continue even if one area fails
            });
        }, () => {
            return cb(null, results);
        });
    }

    newScanMessageConference(cb) {
        //  lazy init
        if (!this.sortedMessageConfs) {
            const getAvailOpts = { includeSystemInternal: true }; //  find new private messages, bulletins, etc.

            this.sortedMessageConfs = _.map(
                msgArea.getAvailableMessageConferences(this.client, getAvailOpts),
                (v, k) => {
                    return {
                        confTag: k,
                        conf: v,
                    };
                }
            );

            //
            //  Sort conferences by name, other than 'system_internal' which should
            //  always come first such that we display private mails/etc. before
            //  other conferences & areas
            //
            this.sortedMessageConfs.sort((a, b) => {
                if ('system_internal' === a.confTag) {
                    return -1;
                } else {
                    return a.conf.name.localeCompare(b.conf.name, {
                        sensitivity: false,
                        numeric: true,
                    });
                }
            });

            this.currentScanAux.conf = this.currentScanAux.conf || 0;
            this.currentScanAux.area = this.currentScanAux.area || 0;
        }

        const currentConf = this.sortedMessageConfs[this.currentScanAux.conf];

        this.newScanMessageArea(currentConf, () => {
            if (this.sortedMessageConfs.length > this.currentScanAux.conf + 1) {
                this.currentScanAux.conf += 1;
                this.currentScanAux.area = 0;

                return this.newScanMessageConference(cb); //  recursive to next conf
            }

            this.updateScanStatus(this.scanCompleteMsg);
            return cb(Errors.DoesNotExist('No more conferences'));
        });
    }

    newScanMessageArea(conf, cb) {
        // Get user's configured newscan areas
        const userNewscanTags = this.client.user.properties['NewScanMessageAreaTags'] || '';
        const selectedAreaTags = userNewscanTags.length > 0 ? userNewscanTags.split(',') : [];

        // If user hasn't configured any areas, fall back to scanning all areas
        const useUserSelection = selectedAreaTags.length > 0;

        const omitMessageAreaTags = valueAsArray(
            _.get(this, 'menuConfig.config.omitMessageAreaTags', [])
        );

        let sortedAreas = msgArea
            .getSortedAvailMessageAreasByConfTag(conf.confTag, { client: this.client })
            .filter(area => {
                return !omitMessageAreaTags.includes(area.areaTag);
            });

        // Filter to only user-selected areas if they have configured newscan
        if (useUserSelection) {
            sortedAreas = sortedAreas.filter(area => {
                return selectedAreaTags.includes(area.areaTag);
            });

            this.client.log.debug(
                {
                    confTag: conf.confTag,
                    selectedCount: sortedAreas.length,
                    totalSelected: selectedAreaTags.length
                },
                'Filtering newscan to user-selected areas'
            );
        }

        const currentArea = sortedAreas[this.currentScanAux.area];

        //
        //  Scan and update index until we find something. If results are found,
        //  we'll goto the list module & show them.
        //
        const self = this;
        async.waterfall(
            [
                function checkAndUpdateIndex(callback) {
                    //  Advance to next area if possible
                    if (sortedAreas.length >= self.currentScanAux.area + 1) {
                        self.currentScanAux.area += 1;
                        return callback(null);
                    } else {
                        self.updateScanStatus(self.scanCompleteMsg);
                        return callback(Errors.DoesNotExist('No more areas')); //  this will stop our scan
                    }
                },
                function updateStatusScanStarted(callback) {
                    self.updateScanStatus(
                        stringFormat(self.scanStartFmt, {
                            confName: conf.conf.name,
                            confDesc: conf.conf.desc,
                            areaName: currentArea.area.name,
                            areaDesc: currentArea.area.desc,
                        })
                    );

                    // DISABLED: Update the current area display for custom MCI codes
                    // This was causing user disconnections due to non-existent MCI views
                    // self.updateCurrentAreaDisplay(currentArea.area.name, conf.conf.name);

                    return callback(null);
                },
                function getNewMessagesCountInArea(callback) {
                    msgArea.getNewMessageCountInAreaForUser(
                        self.client.user.userId,
                        currentArea.areaTag,
                        (err, newMessageCount) => {
                            callback(err, newMessageCount);
                        }
                    );
                },
                function displayMessageList(newMessageCount) {
                    if (newMessageCount <= 0) {
                        return self.newScanMessageArea(conf, cb); //  next area, if any
                    }

                    // Get the actual new messages to pass to the message list
                    self.getFilteredNewMessagesForArea(
                        currentArea.areaTag,
                        (err, newMessages) => {
                            if (err) {
                                self.client.log.error({
                                    error: err.message,
                                    areaTag: currentArea.areaTag
                                }, 'Error getting filtered new messages for area');
                                return self.newScanMessageArea(conf, cb);
                            }

                            if (!newMessages || newMessages.length === 0) {
                                // No new messages found, continue to next area
                                return self.newScanMessageArea(conf, cb);
                            }

                            const nextModuleOpts = {
                                extraArgs: {
                                    messageAreaTag: currentArea.areaTag,
                                    messageList: newMessages, // Pass the filtered list of new messages
                                },
                            };

                            return self.gotoMenu(
                                self.menuConfig.config.messageListMenu || 'newScanMessageList',
                                nextModuleOpts
                            );
                        }
                    );
                },
            ],
            err => {
                return cb(err);
            }
        );
    }

    newScanFileBase(cb) {
        //  :TODO: add in steps
        const omitFileAreaTags = valueAsArray(
            _.get(this, 'menuConfig.config.omitFileAreaTags', [])
        );
        const filterCriteria = {
            newerThanFileId: FileBaseFilters.getFileBaseLastViewedFileIdByUser(
                this.client.user
            ),
            areaTag: getAvailableFileAreaTags(this.client).filter(
                ft => !omitFileAreaTags.includes(ft)
            ),
            order: 'ascending', //  oldest first
        };

        FileEntry.findFiles(filterCriteria, (err, fileIds) => {
            if (err || 0 === fileIds.length) {
                return cb(err ? err : Errors.DoesNotExist('No more new files'));
            }

            FileBaseFilters.setFileBaseLastViewedFileIdForUser(
                this.client.user,
                fileIds[fileIds.length - 1]
            );

            const menuOpts = {
                extraArgs: {
                    fileList: fileIds,
                },
            };

            return this.gotoMenu(
                this.menuConfig.config.newScanFileBaseList || 'newScanFileBaseList',
                menuOpts
            );
        });
    }

    getSaveState() {
        return {
            currentStep: this.currentStep,
            currentScanAux: this.currentScanAux,
        };
    }

    restoreSavedState(savedState) {
        this.currentStep = savedState.currentStep;
        this.currentScanAux = savedState.currentScanAux;
    }

    performScanCurrentStep(cb) {
        switch (this.currentStep) {
            case Steps.MessageConfs:
                this.newScanMessageConference(() => {
                    this.currentStep = Steps.FileBase;
                    return this.performScanCurrentStep(cb);
                });
                break;

            case Steps.FileBase:
                this.newScanFileBase(() => {
                    this.currentStep = Steps.Finished;
                    this.updateScanStatus(this.scanCompleteMsg);
                    // Wait for key press before finishing
                    this.client.once('key press', () => {
                        return this.performScanCurrentStep(cb);
                    });
                });
                break;

            default:
                return cb(null);
        }
    }

    mciReady(mciData, cb) {
        if (this.newScanFullExit) {
            //  user has canceled the entire scan @ message list view
            return cb(null);
        }

        super.mciReady(mciData, err => {
            if (err) {
                return cb(err);
            }

            const self = this;
            const vc = (self.viewControllers.allViews = new ViewController({
                client: self.client,
            }));

            //  :TODO: display scan step/etc.

            async.series(
                [
                    function loadFromConfig(callback) {
                        const loadOpts = {
                            callingMenu: self,
                            mciMap: mciData.menu,
                            noInput: true,
                        };

                        vc.loadFromMenuConfig(loadOpts, callback);
                    },
                    function performCurrentStepScan(callback) {
                        return self.performScanCurrentStep(callback);
                    },
                ],
                err => {
                    if (err) {
                        self.client.log.error(
                            { error: err.toString() },
                            'Error during new scan'
                        );
                    }
                    return cb(err);
                }
            );
        });
    }

    leave() {
        super.leave();
    }
};
