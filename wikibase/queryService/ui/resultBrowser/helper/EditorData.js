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
			this.vote = vote;
		} else {
			this.vote = false;
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
			url: this._baseUrl
		});

		this._columnGroups = EditorData._parseColumnHeaders(opts.columns, this._labels);
		const groups = Object.keys(this._columnGroups);
		this.isMultipleChoice = groups.length && !groups.includes('yes');
		if (!this.isMultipleChoice && (!this._labels || !this._labels.yes)) {
			this._labels = {yes: 'this change'};
		}

		this._userInfo = false;
		this._changesetId = false;
		this.baseLayer = '';
	}

	init(templates) {
		this._templates = templates;
	}

	_makeTemplateData(featureId, choices, serviceData, oldVote) {
		const hasChanges = choices.length && choices[0].newXml;
		const data = this.genBaseTemplate(featureId);

		data.version = featureId.version;
		data.comment = this._comment;
		if (this._taskId) {
			data.taskId = this._taskId;
		}

		if (choices.length) {
			if (!hasChanges && this.isMultipleChoice) {
				data.common = choices[0];
			} else {
				if (this.isMultipleChoice) {
					const common = EditorData._extractCommonUnchanged(choices);
					if (common) {
						data.common = {unchanged: common};
					}
				}
				data.choices = choices;
			}
		}

		if (hasChanges) {
			if (this._taskId) {
				data.no = {
					groupId: 'no',
					btnClass: 'no',
					icon: '⛔',
					resultText: 'rejected',
					btnLabel: 'reject',
					title: 'If this change is a mistake, mark it as invalid to prevent others from changing it with this task in the future.',
				};
				const nays = EditorData._getDisagreedUsers(serviceData, 'no');
				if (nays) {
					data.no.conflict = EditorData._formatUserList(nays);
				}
			}

			if (oldVote) {
				this._updateWithSelection(data, oldVote.groupId, oldVote.date);
			} else if (serviceData.hasOwnProperty('no')) {
				const nays = serviceData.no;
				nays.sort((a, b) => +a.date - b.date);
				data.result = {...data.no};
				data.result.title = `This change has been previously rejected on ${nays[0].date} by ${nays[0].user}. You might want to contact the user, or if you are sure it is a mistake, click on the Object ID and edit it manually.`;
				data.result.resultText = 'Rejected by';
				data.result.user = encodeURI(nays[0].user);
			}
		} else {
			data.result = {
				resultText: `There are no changes for this feature.`,
				title: `This task does not have any changes that can be applied to this feature.`
			};
		}

		return data;
	}

	static _formatUserList(users, agree) {
		const which = agree ? 'this' : 'another';
		return users.length > 1
			? `${users.length} users have voted for ${which} choice: ${users.join(', ')}.`
			: `User ${users[0]} has voted for ${which} choice.`
	}

	/**
	 * Combine data sources into the specific user choices
	 * @param {object} xmlFeature as given by OSM server
	 * @param {object} taskChoices key is the group id (yes,01,02,...), value is the object of desired tag changes
	 * @param {object} serviceData key is the group id, value is the list of users with their votes
	 * @return {*}
	 * @private
	 */
	_createChoices(xmlFeature, taskChoices, serviceData) {
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
		const serviceKeys = new Set(Object.keys(serviceData));
		const choices = [];
		for (const groupId of Object.keys(taskChoices)) {
			const clone = extend(true, {}, xmlFeature);
			const choice = this._createOneChoice(tagsKV, clone, taskChoices[groupId], groupId);
			if (choice) choices.push(choice);
			serviceKeys.delete(groupId);
		}
		serviceKeys.delete('no');
		if (serviceKeys.size > 0) {
			throw new Error(`The task "${this._taskId}" has unexpected votes for this feature (votes=${[...serviceKeys.keys()].join(',')}). Only manual fixes are permitted.`)
		}

		if (!choices.length) {
			const unchanged = EditorData._objToKV(tagsKV);
			return unchanged.length ? [{unchanged}] : [];
		}

		const votedGroupCount = Object.keys(serviceData).length;
		for (const choice of choices) {
			const nays = EditorData._getDisagreedUsers(serviceData, choice.groupId);
			const hasVotes = serviceData.hasOwnProperty(choice.groupId);

			if (nays) {
				choice.conflict = EditorData._formatUserList(nays);
			} else if (!this.vote || (hasVotes && votedGroupCount === 1)) {
				choice.okToSave = true;
			}

			if (hasVotes) {
				choice.agreed = EditorData._formatUserList(serviceData[choice.groupId].map(c => c.user), true);
			}

			if (choice.okToSave) {
				choice.btnClass = 'save';
				choice.resultText = 'You have saved ' + choice.label;
				choice.icon = '💾';
				choice.btnLabel = 'Save ' + choice.label;
				choice.title = 'Upload this change to OpenStreetMap server.';
			} else {
				choice.btnClass = 'vote';
				choice.resultText = 'You have voted for ' + choice.label;
				choice.icon = '👍';
				choice.btnLabel = 'Vote for ' + choice.label;
				choice.title = 'Vote for this change. Another person must approve before OSM data is changed.';
			}
		}

		return choices;
	}

	static _getDisagreedUsers(serviceData, groupId) {
		const users = [];
		for (const id of Object.keys(serviceData)) {
			if (id !== groupId) {
				for (const sd of serviceData[id]) {
					users.push(sd.user);
				}
			}
		}
		return users.length ? users : false;
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

	_createChangeXml(xmlFeature, type, changeSetId) {

		xmlFeature._changeset = changeSetId;
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

	static _parseServiceData(data) {
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

	logout() {
		this._changesetId = false;
		this._userInfo = false;
		this._osmauth.logout();
	}

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

	async downloadServiceData(type, id) {
		// Get all of the data for the "taskid/type/id" combination.
		const query = encodeURI(`SELECT ?p ?o WHERE {osmroot:\\/task\\/${this._taskId}\\/${type}\\/${id} ?p ?o}`);

		const data = await $.ajax({
			url: `${this._sparqlUrl}?query=${query}&nocache=${Date.now()}`,
			headers: {Accept: 'application/sparql-results+json'}
		});

		return EditorData._parseServiceData(data);
	}

	async uploadChangeset(xmlFeature, featureType) {
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
			content: this._createChangeXml(xmlFeature, featureType, this._changesetId),
			options: {header: {'Content-Type': 'text/xml'}}
		});
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
		}
	}

	async saveToService(uid, groupId) {
		// TODO: Service should automatically pick this up from the OSM servers
		const {userId, userName} = await this.getUserInfoAsync(true);

		return this.osmXhr({
			prefix: false,
			method: 'PUT',
			path: `${this._serviceUrl}/v1/${this._taskId}/${uid}/${groupId}`,
			data: {userId, userName},
			// options: {header: {'Content-Type': 'application/x-www-form-urlencoded'}},
			content: $.param({userId, userName})
		});
	}

	async getUserInfoAsync(authenticate) {
		if (this._userInfo) return this._userInfo;
		if (!authenticate && !this._osmauth.authenticated()) return false;

		const xml = await this.osmXhr({
			method: 'GET',
			path: `/api/0.6/user/details`,
			options: {header: {'Content-Type': 'text/xml'}}
		});

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

	async renderPopupHtml(geojson) {
		const [xmlData, serviceData, {userName}] = await Promise.all([
			this.downloadOsmData(geojson.id.uid),
			this.downloadServiceData(geojson.id.type, geojson.id.id),
			await this.getUserInfoAsync(true)
		]);

		const xmlFeature = xmlData.osm[geojson.id.type];
		geojson.id.version = xmlFeature._version;

		const oldVote = EditorData._removeExistingVote(serviceData, userName);
		const choices = this._createChoices(xmlFeature, this._parseRow(geojson.rdfRow), serviceData);
		const templateData = this._makeTemplateData(geojson.id, choices, serviceData, oldVote);

		return {
			$content: $(this.renderTemplate(this.isMultipleChoice ? 'multipopup' : 'popup', templateData)),
			choices,
			templateData,
		};
	}

	getUpdatedContent(templateData, groupId, changesetId) {
		this._updateWithSelection(templateData, groupId, new Date(), changesetId);
		return this.renderTemplate(this.isMultipleChoice ? 'multipopup' : 'popup', templateData);
	}

	_updateWithSelection(templateData, groupId, date, changesetId) {
		if (groupId === 'no') {
			templateData.result = {...templateData.no};
			if (templateData.choices) {
				for (const choice of templateData.choices) {
					choice.itemClass = 'mpe-item-rejected';
				}
			}
		} else {
			const choice = templateData.choices.filter(c => c.groupId === groupId)[0];
			templateData.result = {
				btnClass: choice.btnClass,
				btnLabel: choice.btnLabel,
				groupId: choice.groupId,
				resultText: choice.resultText,
			};
			choice.itemClass = 'mpe-item-selected';
			if (changesetId) {
				templateData.result.changesetId = changesetId;
			}
		}
		templateData.result.title = `You have voted for this change on ${date}. If you have made a mistake, click on the Object ID and edit it manually.`;
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

	async downloadOsmData(uid) {
		const rawData = await $.ajax({
			url: `${this._apiUrl}/api/0.6/${uid}`,
			dataType: 'xml',
		});

		return this._xmlParser.dom2js(rawData);
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

	static _removeExistingVote(serviceData, userName) {
		for (const groupId of Object.keys(serviceData)) {
			const sd = serviceData[groupId];
			for (let i = 0; i < sd.length; i++) {
				const vote = sd[i];
				if (vote.user === userName) {
					sd.splice(i, 1);
					if (sd.length === 0) delete serviceData[groupId];
					return {groupId, date: vote.date};
				}
			}
		}
		return false;
	}

	renderTemplate(templateName, data) {
		return Mustache.render(this._templates[templateName], data, this._templates);
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
};}));
