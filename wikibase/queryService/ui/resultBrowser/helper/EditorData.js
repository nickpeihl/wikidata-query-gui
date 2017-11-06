var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};
wikibase.queryService.ui.resultBrowser.helper = wikibase.queryService.ui.resultBrowser.helper || {};

(function (factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('x2js'), require('underscore'), require('jquery'), require('extend'), require('osm-auth'), require('wellknown'), require('mustache'));
	} else {
		// Browser globals
		wikibase.queryService.ui.resultBrowser.helper.EditorData = factory(X2JS, _, $, $.extend, osmAuth, wellknown, Mustache);
	}
}(function (X2JS, _, $, extend, osmAuth, wellknown, Mustache) {

/**
 * A list of datatypes that contain geo:wktLiteral values conforming with GeoSPARQL.
 * @private
 */
const MAP_DATATYPES = [
	'http://www.opengis.net/ont/geosparql#wktLiteral', // used by Wikidata
	'http://www.openlinksw.com/schemas/virtrdf#Geometry' // used by LinkedGeoData.org
];
const GLOBE_EARTH = 'http://www.wikidata.org/entity/Q2';
const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
/**
 * A list of coordinate reference systems / spatial reference systems
 * that refer to Earth and use longitude-latitude axis order.
 * @private
 */
const EARTH_LONGLAT_SYSTEMS = [
	GLOBE_EARTH,
	CRS84
];

return class EditorData {

	constructor(opts) {
		this.enableWrite = true;
		if (opts.queryOpts.taskId) {
			if (!/^[0-9a-zA-Z_]([-:0-9a-zA-Z_]{0,30}[0-9a-zA-Z_])?$/.test(opts.queryOpts.taskId)) {
				throw new Error('Invalid taskId - must contain letters, digits, underscores, and may have dash and colon in the middle');
			}
			this._taskId = opts.queryOpts.taskId;
		}

		const minZoom = opts.queryOpts.minZoom;
		if (minZoom !== undefined) {
			if (typeof minZoom !== 'number' || minZoom < 0 || minZoom > 18 || (minZoom | 0) !== minZoom) {
				throw new Error('minZoom option must be an integer between 0 and 18');
			}
			this.minZoom = minZoom;
		} else {
			this.minZoom = 16;
		}

		const vote = opts.queryOpts.vote;
		if (vote !== undefined) {
			if (typeof vote !== 'boolean') {
				throw new Error('vote option must be either true or false');
			}
			this._vote = vote;
		} else {
			this._vote = false;
		}

		if (opts.queryOpts.comment) {
			const comment = opts.queryOpts.comment.trim();
			if (comment.length < 10) {
				throw new Error('Comment is too short');
			}
			this._comment = comment;
		} else {
			console.log('Editor has no "comment" option, disabling write mode');
			this.enableWrite = false;
		}

		this._labels = opts.queryOpts.labels;

		this._appVersion = opts.config.api.osm.version;
		this._appName = opts.config.api.osm.program;
		this._baseUrl = opts.config.api.osm.baseurl;
		this._apiUrl = opts.config.api.osm.apiurl;
		this._sparqlUrl = opts.config.api.sparql.uri;
		this._serviceUrl = opts.config.api.sparql.serviceuri;

		this._xmlParser = new X2JS();

		this._osmauth = osmAuth({
			oauth_consumer_key: opts.config.api.osm.oauth_key,
			oauth_secret: opts.config.api.osm.oauth_secret,
			auto: true,
			url: this._baseUrl,
			loading: (a, b, c) => {
				console.error('loading', a, b, c);
			},
			done: (a, b, c) => {
				console.error('done', a, b, c);
			}
		});

		this._columnGroups = EditorData._parseColumnHeaders(opts.columns, this._labels);
		const groups = Object.keys(this._columnGroups);
		this.isMultipleChoice = groups.length && !groups.includes('yes');
		if (!this.isMultipleChoice && (!this._labels || !this._labels.yes)) {
			this._labels = {yes: 'this change'};
		}

		this._osmDownloadCache = {};
		this._userInfo = false;
		this._changesetId = false;
		this.resetVersion = 0;
		this.baseLayer = '';
		this.$toolbar = opts.$toolbar;
	}

	init(templates) {
		this._templates = templates;
	}

	_combineTepmlateData(featureId, common, no, choices, actionResult, rootFlags) {
		const data = this.genBaseTemplate(featureId);
		data.version = featureId.version;
		data.comment = this._comment;
		if (this._taskId) {
			data.taskId = this._taskId;
		}
		if (this.isMultipleChoice) {
			data.common = {unchanged: common};
		} else {
			data.unchanged = common;
		}
		if (choices && choices.length > 0) {
			if (this.isMultipleChoice) {
				data.choices = choices;
			} else {
				Object.assign(data, choices[0]);
			}
		} else {
			data.noChanges = true;
		}
		if (actionResult) {
			data.result = actionResult;
		} else if (no) {
			data.no = no;
		}
		if (rootFlags) {
			Object.assign(data, rootFlags);
		}

		return data;
	}

	static _formatUserList(users, agree) {
		if (!users) return '';
		const which = agree ? 'this' : 'another';
		const also = agree ? 'also ' : '';
		return users.length > 1
			? `\n\n${users.length} users have ${also}voted for ${which} choice: ${users.map(c => c.user).join(', ')}.`
			: `\n\nUser ${users[0].user} has ${also}voted for ${which} choice.`
	}

	/**
	 * Combine data sources into the specific user choices
	 * @param {object} xmlFeature as given by OSM server
	 * @param {object} taskChoices key is the group id (yes,01,02,...), value is the object of desired tag changes
	 * @param {object} votes key is the group id, value is the list of users with their votes
	 * @return {*}
	 * @private
	 */
	_createChoices(xmlFeature, taskChoices, votes) {
		if (xmlFeature.tag === undefined) {
			xmlFeature.tag = [];
		} else if (!Array.isArray(xmlFeature.tag)) {
			// A geojson with a single xmlFeature.tag is parsed as an object
			xmlFeature.tag = [xmlFeature.tag];
		}
		delete xmlFeature._timestamp;
		delete xmlFeature._visible;
		delete xmlFeature._user;
		delete xmlFeature._uid;

		const tagsKV = EditorData._xmlTagsToKV(xmlFeature.tag);
		const voteKeys = Object.keys(votes);
		const voteSet = new Set(voteKeys);
		const choices = [];
		for (const groupId of Object.keys(taskChoices)) {
			const clone = extend(true, {}, xmlFeature);
			const choice = this._createOneChoice(tagsKV, clone, taskChoices[groupId], groupId);
			if (choice) choices.push(choice);
			voteSet.delete(groupId);
		}
		voteSet.delete('no');
		if (voteSet.size > 0) {
			throw new Error(`The task "${this._taskId}" has unexpected votes for this feature (votes=${[...voteSet.keys()].join(',')}). Only manual fixes are permitted.`)
		}

		let noChoice, common, newXml;
		if (choices.length > 0) {
			newXml = {};
			for (const choice of choices) {
				EditorData._setYeaNay(choice, votes, choice.groupId);
				newXml[choice.groupId] = choice.newXml;
				delete choice.newXml;
			}
			if (this._taskId) {
				noChoice = EditorData._setYeaNay({groupId: 'no', label: 'no'}, votes, 'no');
			}
			common = EditorData._extractCommonUnchanged(choices);
		} else {
			common = EditorData._objToKV(tagsKV);
		}

		const result = {};
		if (common && common.length) result.common = common;
		if (noChoice) result.noChoice = noChoice;
		if (choices.length > 0) result.choices = choices;
		if (newXml) result.newXml = newXml;

		return result;
	}

	static _setYeaNay(obj, votes, groupId) {
		const yeas = [];
		const nays = [];
		for (const id of Object.keys(votes)) {
			const list = id === groupId ? yeas : nays;
			for (const sd of votes[id]) {
				list.push(sd);
			}
		}
		if (yeas.length) obj.yeas = yeas;
		if (nays.length) obj.nays = nays;
		return obj;
	}

	_createOneChoice(tagsKV, xmlFeature, choiceTags, groupId) {
		const add = [], mod = [], del = [];
		const tagsCopy = {...tagsKV};
		const xmlTags = xmlFeature.tag;

		for (const tagName of Object.keys(choiceTags)) {
			const item = EditorData._kvToTempl(tagName, choiceTags[tagName]);
			let oldValue = tagsCopy[tagName];
			if (oldValue === item.v) {
				// ignore - original is the same as the replacement
			} else if (oldValue !== undefined) {
				// Find the index of the original xml tag
				const tagInd = EditorData._findTagIndex(xmlTags, tagName);
				item.oldv = oldValue;
				if (item.v !== undefined) {
					mod.push(item);
					xmlTags[tagInd]._v = item.v;
				} else {
					del.push(item);
					xmlTags.splice(tagInd, 1);
				}
				delete tagsCopy[tagName];
			} else if (item.v !== undefined) {
				add.push(item);
				xmlTags.push({_k: tagName, _v: item.v});
			}
		}

		if (add.length || mod.length || del.length) {
			const result = {};
			if (add.length) result.add = add;
			if (mod.length) result.mod = mod;
			if (del.length) result.del = del;

			const unchanged = EditorData._objToKV(tagsCopy);
			if (unchanged.length) result.unchanged = unchanged;

			result.newXml = xmlFeature;
			result.groupId = groupId;
			result.label = this._labels[groupId];

			return result;
		}
		return false;
	}

	genBaseTemplate(feature) {
		return {
			type: feature.type,
			id: feature.id,
			mainWebsite: this._baseUrl,
			url_help: 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service',
		};
	}

	_createChangesetXml() {
		const tags = {
			created_by: `${this._appName} ${this._appVersion}`,
			comment: this._comment,
			task_id: this._taskId
		};
		if (this.baseLayer) {
			tags.imagery_used = this.baseLayer;
		}
		return this._xmlParser.js2xml({
			osm: {
				changeset: {
					_version: this._appVersion,
					_generator: this._appName,
					tag: EditorData._objToAttr(tags)
				}
			}
		});
	}

	_createChangeXml(xmlFeature, type) {

		xmlFeature._changeset = this._changesetId;
		return this._xmlParser.js2xml(
			{
				osmChange: {
					modify: {
						[type]: xmlFeature
					}
				}
			}
		);
	}

	static _findTagIndex(xmlTags, tagName) {
		for (let i = 0; i < xmlTags.length; i++) {
			if (xmlTags[i]._k === tagName) {
				return i;
			}
		}
		throw new Error(`Internal error: unable to find ${tagName}`);
	}

	static _parseVotes(data) {
		if (!data.results.bindings.length) {
			return {};
		}

		function parseVote(val) {
			if (val.type === 'uri') {
				const match = val.value.match(/^https:\/\/www.openstreetmap.org\/meta\/pick_(.*)/);
				if (match) return match[1];
			}
		}

		function parseUser(val) {
			if (val.type === 'uri') {
				const match = val.value.match(/^https:\/\/www.openstreetmap.org\/user\/(.*)/);
				if (match) return match[1];
			}
		}

		function parseDate(val) {
			if (val.type === 'literal' && val.datatype === 'http://www.w3.org/2001/XMLSchema#dateTime') {
				return new Date(val.value);
			}
		}

		function addUser(users, name, key, value, cmpFunc) {
			if (!users.hasOwnProperty(name)) users[name] = {};
			if (!users[name].hasOwnProperty(key)) {
				users[name][key] = value;
			} else {
				users[name][key] = cmpFunc(users[name][key], value);
			}
		}

		const users = {};
		for (const res of data.results.bindings) {
			let p, o;
			p = parseUser(res.p);
			if (p !== undefined) {
				o = parseDate(res.o);
				if (o !== undefined) {
					addUser(users, p, 'date', o, (ov, nv) => (nv - ov) > 0 ? nv : ov);
					continue;
				}
				o = parseVote(res.o);
				if (o !== undefined) {
					addUser(users, p, 'vote', o, (ov, nv) => ov === 'no' ? ov : nv);
					// noinspection UnnecessaryContinueJS
					continue;
				}
			}
		}

		const result = {};
		for (const usr of Object.keys(users)) {
			const val = users[usr];
			if (val.vote === undefined || val.date === undefined) continue;
			if (!result.hasOwnProperty(val.vote)) result[val.vote] = [];
			result[val.vote].push({user: usr, date: val.date});
		}

		return result;
	}

	osmXhr() {
		return new Promise((accept, reject) => {
			this._osmauth.xhr(...arguments, (err, data) => {
				if (err) {
					reject(err);
				} else {
					accept(data);
				}
			});
		});
	};

	async findOpenChangeset() {
		if (this._changesetId) return this._changesetId;
		if (!this._osmauth.authenticated()) return false;

		let changesets = this._xmlParser.dom2js(await this.osmXhr({
			method: 'GET',
			path: `/api/0.6/changesets?open=true`,
			options: {header: {'Content-Type': 'text/xml'}}
		})).osm.changeset;
		if (!changesets) return false;
		if (!Array.isArray(changesets)) changesets = [changesets];
		for (const cs of changesets) {
			let tags = cs.tag;
			if (!tags) continue;
			if (!Array.isArray(tags)) tags = [tags];
			for (const tag of tags) {
				if (tag._k !== 'task_id') continue;
				if (tag._v === this._taskId) {
					this._changesetId = cs._id;
					return this._changesetId;
				} else {
					break;
				}
			}
		}

		return false;
	}

	async _downloadVotes(type, id) {
		// Get all of the data for the "taskid/type/id" combination.
		const query = encodeURI(`SELECT ?p ?o WHERE {osmroot:\\/task\\/${this._taskId}\\/${type}\\/${id} ?p ?o}`);

		const data = await $.ajax({
			url: `${this._sparqlUrl}?query=${query}&nocache=${Date.now()}`,
			headers: {Accept: 'application/sparql-results+json'}
		});

		return EditorData._parseVotes(data);
	}

	async saveFeatureToOSM(xmlFeature, featureId) {
		if (!this.enableWrite) {
			throw new Error('Writing to OSM is not enabled');
		}
		if (!this._changesetId) {
			this._changesetId = await this.osmXhr({
				method: 'PUT',
				path: '/api/0.6/changeset/create',
				content: this._createChangesetXml(),
				options: {header: {'Content-Type': 'text/xml'}}
			});
		}
		await this.osmXhr({
			method: 'POST',
			path: `/api/0.6/changeset/${this._changesetId}/upload`,
			content: this._createChangeXml(xmlFeature, featureId.type),
			options: {header: {'Content-Type': 'text/xml'}}
		});

		delete this._osmDownloadCache[featureId.uid];

		this.resetToolbar();
	}

	async closeChangeset() {
		if (this._changesetId) {
			const id = this._changesetId;
			this._changesetId = false;
			await this.osmXhr({
				method: 'PUT',
				path: `/api/0.6/changeset/${id}/close`,
				options: {header: {'Content-Type': 'text/xml'}}
			});
			this.resetToolbar();
		}
	}

	async saveMyVote(uid, groupId) {
		// TODO: Service should automatically pick this up from the OSM servers
		const {userId, userName} = await this.getUserInfoAsync(true);

		const method = groupId ? 'PUT' : 'DELETE';
		let path = `${this._serviceUrl}/v1/${this._taskId}/${uid}`;
		if (groupId) {
			path += '/' + groupId;
		}
		await this.osmXhr({
			prefix: false,
			method,
			path,
			data: {userId, userName},
			content: $.param({userId, userName})
		});

		this.resetToolbar();
	}

	async getUserInfoAsync(authenticate) {
		if (this._userInfo) return this._userInfo;
		if (!authenticate && !this._osmauth.authenticated()) return false;

		const xml = await this.osmXhr({
			method: 'GET',
			path: `/api/0.6/user/details`,
			options: {header: {'Content-Type': 'text/xml'}}
		});

		this.resetVersion++;

		const parsed = this._xmlParser.dom2js(xml).osm.user;
		this._userInfo = {
			userName: parsed._display_name,
			userId: parsed._id
		};

		if (parsed.home) {
			this._userInfo.home = {lat: parsed.home._lat, lon: parsed.home._lon, zoom: parsed.home._zoom};
		}

		if (parsed.messages && parsed.messages.received) {
			this._userInfo.unreadMessageCount = parseInt(parsed.messages.received._unread || '0');
		}

		return this._userInfo;
	}

	/**
	 * @param {object[]} rawColumns
	 * @param {object} labels
	 * @return {object} parsed columns
	 */
	static _parseColumnHeaders(rawColumns, labels) {
		const columns = {};

		if (!_.contains(rawColumns, 'id')) {
			throw new Error('Query has no "id" column. It must contain OSM ID URI, e.g. osmnode:123 or osmrel:456');
		}

		if (!_.contains(rawColumns, 'loc')) {
			throw new Error('Query has no "loc" column. It must contain geopoint of the OSM object');
		}

		// Find all tag columns, e.g.  "t1"
		const tagRe = /^([a-z]?)t([0-9]{1,2})$/;
		for (const tag of rawColumns) {
			if (tagRe.test(tag)) {
				columns[tag] = false;
			}
		}

		// Find all value columns, e.g.  "v1", and check that corresponding tag column exists
		const valRe = /^([a-z]?)v([0-9]{1,2})$/;
		for (const val of rawColumns) {
			if (valRe.test(val)) {
				const tag = val.replace(valRe, '$1t$2');
				if (!columns.hasOwnProperty(tag)) {
					throw new Error(`Result has a value column ${val}, but no tag column ${tag}`);
				}
				columns[tag] = val;
			}
		}

		// Check that there was a value column for every tag column, and create results
		const groups = {};
		for (const tag of Object.keys(columns).sort()) {
			if (columns[tag] === false) {
				const val = tag.replace(tagRe, '$1v$2');
				throw new Error(`Result has a tag column ${tag}, but no corresponding value column ${val}`);
			}
			const gr = tag.match(tagRe)[1] || 'yes';
			if (!groups.hasOwnProperty(gr)) groups[gr] = {};
			groups[gr][tag] = columns[tag];
		}

		const groupIds = Object.keys(groups);
		if (groups.hasOwnProperty('yes')) {
			if (groupIds.length > 1) {
				throw new Error(`Query must can be either yes/no (tags t1, t2, ...) or multiple choice (tags at1, bt1, ...) but not both.`)
			}
		} else if (groupIds.length > 0) {
			// Check that for each group, there is a label column
			if (!labels) {
				throw new Error('Multiple choice queries require "labels" query option, e.g. #defaultView:Editor{"labels":{"a":"first choice", ...}}');
			}
			for (const gr of groupIds) {
				if (!labels.hasOwnProperty(gr)) {
					throw new Error(`Result has group "${gr}" (${Object.keys(groups[gr]).join(',')}), but no corresponding label defined in #defaultView:Editor{"labels":{"${gr}":"group label"}}"`);
				}
			}
		}

		return groups;
	}

	/**
	 * @param {object} row
	 * @return {object} GeoJson
	 */
	static parseFeature(row) {
		// Parse ID
		if (!row.id) {
			throw new Error(`The 'id' is not set`);
		}
		if (row.id.type !== 'uri') {
			throw new Error(`The type of the ID column must be 'uri', not '${row.id.type}'. Value = ${row.id.value}`);
		}
		const idMatch = row.id.value.match(/https:\/\/www.openstreetmap.org\/((relation|node|way)\/[0-9]+)/);
		if (!idMatch) {
			throw new Error(`id column must be a OSM URI.  value=${row.id.value}`);
		}
		const uid = idMatch[1];

		// Parse location
		if (!row.loc || MAP_DATATYPES.indexOf(row.loc.datatype) === -1) {
			throw new Error(`${uid} has invalid location value '${row.loc && row.loc.value || ''}'`);
		}

		const split = EditorData._splitWktLiteral(row.loc.value);
		if (!split) {
			throw new Error(`${uid} has invalid location. value='${row.loc.value}'`);
		}

		if (EARTH_LONGLAT_SYSTEMS.indexOf(split.crs) === -1) {
			throw new Error(`${uid} location must be on Earth. value='${row.loc.value}'`);
		}

		const feature = wellknown.parse(split.wkt);
		const [type, id] = uid.split('/');
		feature.id = {type, id: id, uid};
		feature.rdfRow = row;

		return feature;
	}

	/**
	 * Extract desired tags from RDF results
	 *
	 * @param {Object} row
	 * @return {Object} GeoJSON properties
	 */
	_parseRow(row) {
		const result = {};
		for (const groupId of Object.keys(this._columnGroups)) {
			const group = this._columnGroups[groupId];
			const groupResult = {};
			for (const tagNameCol of Object.keys(group)) {
				const valNameCol = group[tagNameCol];
				const tagObj = row[tagNameCol];
				const valObj = row[valNameCol];

				// Tags can be either strings (literals), or URIs with "osmt:" prefix
				if (tagObj === undefined) {
					// tag is not defined - skip it
					continue;
				}
				let tag = tagObj.value;
				if (tagObj.type === 'uri') {
					const tagMatch = tag.match(/https:\/\/wiki.openstreetmap.org\/wiki\/Key:(.+)/);
					if (!tagMatch) {
						throw new Error(`Column '${tagNameCol}' must be a string or a osmt:* URI. tag = '${tag}'`);
					}
					tag = tagMatch[1];
				} else if (tagObj.type !== 'literal') {
					throw new Error(`Column '${tagNameCol}' must be a literal. type = '${tagObj.type}'`);
				}
				if (tag !== tag.trim()) {
					throw new Error(`Column '${tagNameCol}' contains trailing whitespace. tag = '${tag}'`);
				}
				if (groupResult.hasOwnProperty(tag)) {
					throw new Error(`Duplicate tag name '${tag}'`);
				}

				// Values can be either strings (literals), wd:Qxxx values (uri), or proper wikipedia links
				let value;

				// If unbound, tag is to be removed
				if (valObj !== undefined) {
					value = valObj.value;
					if (valObj.type === 'uri') {
						const wdMatch = value.match(/http:\/\/www.wikidata.org\/entity\/(Q.+)/);
						if (wdMatch) {
							value = wdMatch[1];
						} else {
							const wpMatch = value.match(/https:\/\/([^./]+).wikipedia.org\/wiki\/(.+)/);
							if (wpMatch) {
								value = `${wpMatch[1]}:${decodeURIComponent(wpMatch[2]).replace(/_/g, ' ')}`;
							} else {
								throw new Error(`Column '${valNameCol}' must be a string, a wd:*, or a proper wikipedia URI. value = '${value}'`);
							}
						}
					} else if (valObj.type !== 'literal') {
						throw new Error(`Column '${valNameCol}' must be a literal. type = '${valObj.type}'`);
					}
					if (value !== value.trim()) {
						throw new Error(`Column '${valNameCol}' contains trailing whitespace. value = '${value}'`);
					}
					if (valObj.type !== 'literal') {
						value = {value, vlink: valObj.value};
					}
				}

				groupResult[tag] = value;
			}
			result[groupId] = groupResult;
		}

		return result;
	}

	makeTemplateData(parsedResult, savedGroupId) {
		function apply(targets, ...valuesList) {
			for (const target of (Array.isArray(targets) ? targets : [targets])) {
				if (!target) continue;
				for (const values of valuesList) {
					for (const key of Object.keys(values)) {
						const val = values[key];
						target[key] = typeof val === 'function' ? val(target) : val;
					}
				}
			}
			return targets;
		}

		const choiceDat = {
			noButton: {
				btnClass: `no`,
				icon: `⛔`,
				btnLabel: `Reject`,
				title: (c) => `Mark this change as incorrect to prevent others from changing it with this task in the future.` +
					EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			saveButton: {
				btnClass: `save`,
				icon: `💾`,
				btnLabel: (c) => `Save ${c.label}`,
				title: (c) => `Upload this change to OpenStreetMap server.` +
					EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			voteButton: {
				btnClass: `vote`,
				icon: `👍`,
				btnLabel: (c) => `Vote for ${c.label}`,
				title: (c) => `Vote for this change. Another person must approve before OSM data is changed.` +
					EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			labelTitle: {
				title: (c) => EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			votedTitle: {
				title: (c) => `You have voted for ${c.label} on ${c.date}.` +
					EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			selected: {itemClass: 'mpe-item-selected'},
			rejected: {itemClass: 'mpe-item-rejected'},
			conflict: {itemClass: 'mpe-item-conflict'},
		};

		const resultDat = {
			noChange: {
				resultText: `There are no changes for this feature.`,
				title: `This task does not have any changes that can be applied to this feature.  Either the data was changed recently, or the task's underlying query needs to be fixed.`
			},
			voted: {
				btnClass: `vote`,
				icon: `👍`,
				resultText: (c) => `You have voted for ${c.label}`,
				title: (c) => `You have voted for ${c.label} on ${c.date}.` +
					EditorData._formatUserList(c.yeas, true) + EditorData._formatUserList(c.nays),
			},
			saved: {
				btnClass: `save`,
				icon: `💾`,
				resultText: (c) => `You have saved ${c.label}`,
				title: `You have saved this change to OpenStreetMap database. If you have made a mistake, click on the feature ID and edit it manually.`,
			},
			rejectedByMe: {
				btnClass: `no`,
				icon: `⛔`,
				resultText: `Rejected by me`,
				title: (c) => `You have rejected this change on ${c.date}.`,
			},
			rejected: {
				btnClass: `no`,
				icon: `⛔`,
				resultText: (c) => `Rejected by ${c.yeas[0].user}`,
				title: (c) => `This change has been previously rejected on ${c.yeas[0].date} by ${c.yeas[0].user}. You might want to contact the user, or if you are sure it is a mistake, click on the feature ID and edit it manually.`,
			},
			notLoggedIn: {
				btnClass: `no`,
				icon: `❗`,
				resultText: `Please login`,
				title: `Use the "login" button in the upper left corner before making any changes to OSM`,
			},
			editingDisabled: {
				btnClass: `no`,
				icon: `❗`,
				resultText: `Editing disabled`,
				title: `The underlying query does not meet some requirements. The editing has been disabled. See service documentation on how to fix the underlying query.`,
			},
			unvoteBtn: {
				unvote: {
					btnClass: `unvote`,
					icon: `⤺`,
					btnLabel: `Unvote`,
					title: `Delete my vote for this change.`,
				}
			},
		};

		let {featureId, common, noChoice, choices, newXml, myVote} = parsedResult;
		choices = extend(true, [], choices);
		noChoice = extend(true, {}, noChoice);

		if (savedGroupId) {
			if (myVote) throw new Error('Internal error: saved voted group');
			myVote = {date: new Date(), groupId: savedGroupId};
		}

		let status = 'loaded', actionResult, disableChoices;
		const yesVoted = choices && choices.filter(c => c.yeas).length || 0;
		if (myVote && myVote.groupId === 'no') {
			// i voted "no".  View: disable save, mark everything as red.  Actions: unvote
			apply(choices, choiceDat.rejected);
			actionResult = apply({
				label: noChoice.label,
				date: myVote.date
			}, resultDat.rejectedByMe, resultDat.unvoteBtn);
			disableChoices = true;
			status = 'rejected';
		} else if (myVote && savedGroupId) {
			// I saved the change.  View: highlight my choice.  Actions: none
			const choice = choices.filter(c => c.groupId === myVote.groupId)[0];
			apply(choice, choiceDat.selected);
			actionResult = apply({
				label: choice.label,
				date: myVote.date,
				changesetId: this._changesetId
			}, resultDat.saved);
			disableChoices = true;
			status = 'saved';
		} else if (myVote) {
			// I voted before.  View: highlight my choice.  Actions: unvote
			const choice = choices.filter(c => c.groupId === myVote.groupId)[0];
			apply(choice, choiceDat.selected);
			actionResult = apply({label: choice.label, date: myVote.date}, resultDat.voted, resultDat.unvoteBtn);
			disableChoices = true;
			status = 'voted';
		} else if (noChoice.yeas) {
			// others voted "no".  View: disable save, mark everything as red.  Actions: none
			apply(choices, choiceDat.rejected);
			actionResult = apply({label: noChoice.label, yeas: noChoice.yeas}, resultDat.rejected);
			disableChoices = true;
			status = 'rejected';
		} else if (yesVoted === 1) {
			// Another voter picked one choice.  View: highlight the choice.  Action: save same, or vote for others.
			apply(choices.filter(c => !c.yeas), choiceDat.voteButton);
			apply(noChoice, choiceDat.noButton);
			apply(choices.filter(c => c.yeas), choiceDat.saveButton, choiceDat.selected);
		} else if (yesVoted > 1) {
			// Others have voted for multiple choices.  View: highlight multiple choices in orange.  Actions: vote
			apply(choices, choiceDat.voteButton);
			apply(noChoice, choiceDat.noButton);
			apply(choices.filter(c => c.yeas), choiceDat.conflict);
			status = 'conflict';
		} else if (choices.length === 0) {
			// No changes are available for this feature.  View: none.  Action: none.
			actionResult = resultDat.noChange;
			status = 'noChanges';
		} else if (this._taskId && this._vote) {
			// voting is required, but none made so far.  View: none.  Action: vote
			apply(choices, choiceDat.voteButton);
			apply(noChoice, choiceDat.noButton);
		} else if (this._taskId) {
			// no votes, and they are not required.  View: none.  Actions: save or vote "no"
			apply(choices, choiceDat.saveButton);
			apply(noChoice, choiceDat.noButton);
		} else {
			// no task ID.  View: none  Action: save
			apply(choices, choiceDat.saveButton);
		}

		if (!this._osmauth.authenticated()) {
			disableChoices = true;
			if (!actionResult) actionResult = resultDat.notLoggedIn;
		} else if (!this.enableWrite || (!this._taskId && /\/embed\.html/.test(window.location))) {
			disableChoices = true;
			if (!actionResult) actionResult = resultDat.editingDisabled;
		}

		const rootFlags = disableChoices ? {labelOnly: true} : false;
		return {
			templateData: this._combineTepmlateData(featureId, common, noChoice, choices, actionResult, rootFlags),
			newXml, status
		};
	}

	/**
	 * @param {object} geojson
	 * @returns {Promise.<{featureId,common,no,choices,newXml,myVote}>}
	 */
	async downloadAndParse(geojson) {
		const [xmlData, votes] = await Promise.all([
			this._downloadOsmData(geojson.id.uid),
			this._downloadVotes(geojson.id.type, geojson.id.id),
		]);

		const xmlFeature = xmlData.osm[geojson.id.type];
		geojson.id.version = xmlFeature._version;

		const myVote = this._userInfo ? EditorData._removeMyVote(votes, this._userInfo.userName) : false;
		const result = this._createChoices(xmlFeature, this._parseRow(geojson.rdfRow), votes);
		result.myVote = myVote;
		result.featureId = geojson.id;

		// Track at which point (for which user) this content was generated
		geojson.resetVersion = this.resetVersion;

		return result;
	}

	/**
	 * @param templateData
	 * @param {string} groupId is not "no" - accepts this choice, otherwise rejects all
	 * @private
	 */
	_tagChoices(templateData, groupId) {
		const itemClass = 'mpe-item-' + (groupId !== 'no' ? 'selected' : 'rejected');
		if (!this.isMultipleChoice) {
			templateData.itemClass = itemClass;
		} else if (templateData.choices) {
			for (const choice of templateData.choices) {
				if (groupId === 'no' || groupId === choice.groupId) {
					choice.itemClass = itemClass;
				}
			}
		}
	}

	/**
	 * Split a geo:wktLiteral or compatible value
	 * into coordinate reference system URI
	 * and Simple Features Well Known Text (WKT) string,
	 * according to GeoSPARQL, Req 10.
	 *
	 * If the coordinate reference system is not specified,
	 * CRS84 is used as default value, according to GeoSPARQL, Req 11.
	 *
	 * @private
	 * @param {string} literal
	 * @return {?{ crs: string, wkt: string }}
	 */
	static _splitWktLiteral(literal) {
		// only U+0020 spaces as separator, not other whitespace, according to GeoSPARQL, Req 10
		const match = literal.match(/(<([^>]*)> +)?(.*)/);

		if (match) {
			return {crs: match[2] || CRS84, wkt: match[3]};
		} else {
			return null;
		}
	}

	async _downloadOsmData(uid) {
		if (!this._osmDownloadCache[uid]) {
			this._osmDownloadCache[uid] = this._xmlParser.dom2js(
				await $.ajax({
					url: `${this._apiUrl}/api/0.6/${uid}`,
					dataType: 'xml',
				}));
		}
		return this._osmDownloadCache[uid];
	}

	static _objToAttr(vals) {
		const result = [];
		for (const k of Object.keys(vals)) {
			result.push({_k: k, _v: vals[k]});
		}
		return result;
	}

	static _xmlTagsToKV(xmlTags) {
		const tagsKV = {};
		for (const v of xmlTags) {
			if (tagsKV.hasOwnProperty(v._k)) {
				throw new Error(`Object has multiple tag "${v._k}"`);
			}
			tagsKV[v._k] = v._v;
		}
		return tagsKV;
	}

	/**
	 * Convert key-values to an array of {k,v} objects
	 * @param {object} tagsKV
	 * @return {Array}
	 * @private
	 */
	static _objToKV(tagsKV) {
		const result = [];
		for (const k of Object.keys(tagsKV)) {
			result.push(EditorData._kvToTempl(k, tagsKV[k]));
		}
		return result;
	}

	static _kvToTempl(tagName, value) {
		return typeof value !== 'object'
			? {k: tagName, v: value}
			: {k: tagName, v: value.value, vlink: value.vlink};
	}

	static _removeMyVote(votes, userName) {
		for (const groupId of Object.keys(votes)) {
			const sd = votes[groupId];
			for (let i = 0; i < sd.length; i++) {
				const vote = sd[i];
				if (vote.user === userName) {
					sd.splice(i, 1);
					if (sd.length === 0) delete votes[groupId];
					return {groupId, date: vote.date};
				}
			}
		}
		return false;
	}

	renderTemplate(templateName, data) {
		return Mustache.render(this._templates[templateName], data, this._templates);
	}

	renderPopupTemplate(templateData) {
		return this.renderTemplate(this.isMultipleChoice ? 'multipopup' : 'popup', templateData);
	}

	/**
	 * Find all unchanged key-values that are the same in all choices
	 * Remove them from the choices, and return them as an array
	 * @param {object[]} choices
	 * @returns {object[]|false}
	 * @private
	 */
	static _extractCommonUnchanged(choices) {
		let commonTags = null;
		for (const choice of choices) {
			if (!choice.unchanged) {
				return false;
			}
			if (commonTags === null) {
				commonTags = new Set(choice.unchanged.map(v => v.k));
			} else {
				commonTags = new Set(choice.unchanged.filter(v => commonTags.has(v.k)).map(v => v.k));
			}
		}
		if (commonTags && commonTags.size > 0) {
			// Copy common tags from the first choice
			const result = [];
			for (const tag of choices[0].unchanged) {
				if (commonTags.has(tag.k)) {
					result.push(tag);
				}
			}
			// Remove common tags from all choices
			for (const choice of choices) {
				choice.unchanged = choice.unchanged.filter(v => !commonTags.has(v.k));
				if (choice.unchanged.length === 0) {
					delete choice.unchanged;
				}
			}
			return result;
		}
		return false;
	}

	resetToolbar() {
		const data = {mainWebsite: this._baseUrl};
		if (this._userInfo) Object.assign(data, this._userInfo);
		if (this._changesetId) data.changesetId = this._changesetId;
		const $toolbarContent = $(this.renderTemplate('toolbar', data));

		let clicked = false;
		$toolbarContent.on('click', 'button', async (e) => {
			e.preventDefault();
			const action = $(e.target).data('action');
			if (clicked || !action) return;
			try {
				clicked = true;
				switch (action) {
					case 'login':
						await this.getUserInfoAsync(true);
						await this.findOpenChangeset();
						this.resetToolbar();
						break;
					case 'logout':
						this._changesetId = false;
						this._userInfo = false;
						this._osmauth.logout();
						this.resetVersion++;
						this.resetToolbar();
						break;
					case 'close-cs':
						this.closeChangeset();
						break;
				}
			} catch (err) {
				clicked = false;
			}
		});
		this.$toolbar.html($toolbarContent);
	}

};}));
