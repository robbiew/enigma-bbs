/* jslint node: true */
'use strict';

//	ENiGMA½
const Message			= require('../../core/message.js');
const stringFormat		= require('../../core/string_format.js');
const persistMessage	= require('../../core/message_area.js').persistMessage;

//	deps
const fs				= require('fs');
const moment			= require('moment');
const async				= require('async');

/*
	USAGE:

	Create an scheduled event entry similar to the following:

	postAdsToSomeArea: {
		schedule: at 9:30 pm on Sun
		action: @method:mods/message_post_evt/message_post_evt.js:messagePostEvent
		args: [
			"areaTag1,areaTag2",
			"/path/to/some/message/template/file.asc",
			"{\"to\":\"My Peeps\",\"from\":\"LOLBOT\",\"subject\":\"An Automated Post!\"}"
		]
	}

	The first two arguments are required. The 3rd argument is an *escaped* JSON object that
	may contain one or more of the following members:
		- to
		- from
		- subject
		- tsFormat - specifies how you want {ts} formatted
		- templateEncoding - defaults to utf8

	Your template file may contain the following variables:
		- to
		- from
		- subject
		- ts
	
	Variables must be enclosed in {}, e.g.: {to}

*/

exports.messagePostEvent		= messagePostEvent;	

function messagePostEvent(args, cb) {

	if(args.length < 2) {
		return cb(new Error('At least [areaTag, pathToTemplate] required in args'));
	}

	let messageFormatInfo;
	if(args.length > 2) {
		try {
			messageFormatInfo = JSON.parse(args[2]);
		} catch(e) {
			return cb(new Error(`Invalid JSON: ${args[2]}`));
		}
	} else {
		messageFormatInfo = {};
	}

	messageFormatInfo.to				= messageFormatInfo.to || 'All';
	messageFormatInfo.from				= messageFormatInfo.from || 'j0hnny a1pha';
	messageFormatInfo.subject			= messageFormatInfo.subject || 'Automated Post';
	messageFormatInfo.tsFormat			= messageFormatInfo.tsFormat || 'ddd, MMMM Do, YYYY';
	messageFormatInfo.ts				= moment().format(messageFormatInfo.tsFormat); 
	messageFormatInfo.templateEncoding	= messageFormatInfo.templateEncoding || 'utf-8';

	fs.readFile(args[1], messageFormatInfo.templateEncoding, (err, data) => {
		if(err) {
			return cb(err);
		}

		//	allow multiple area tags, separated by ','
		const areaTags = args[0].split(',');
		async.eachSeries(areaTags, (areaTag, next) => {
			
			const msg = new Message({
				areaTag			: areaTag,
				toUserName		: messageFormatInfo.to,
				fromUserName	: messageFormatInfo.from,
				subject			: messageFormatInfo.subject,
				message			: stringFormat(data, messageFormatInfo),
			});

			return persistMessage(msg, next);
		}, err => {
			return cb(err);
		});
	});
}
