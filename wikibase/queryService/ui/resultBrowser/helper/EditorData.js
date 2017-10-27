var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};
wikibase.queryService.ui.resultBrowser.helper = wikibase.queryService.ui.resultBrowser.helper || {};

(function (factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('x2js'), require('underscore'), require('jquery'), require('extend'), require('osm-auth'), require('wellknown'));
	} else {
		// Browser globals
		wikibase.queryService.ui.resultBrowser.helper.EditorData = factory(X2JS, _, $, $.extend, osmAuth, wellknown);
	}
}(function (X2JS, _, $, extend, osmAuth, wellknown) {

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

		this._userInfo = this.getUserInfo(false);
		this._changesetId = this.findOpenChangeset();
	}

	_createChangeSetXml(geojson) {
		return this._xmlParser.js2xml({
			osm: {
				changeset: {
					_version: this._appVersion,
					_generator: this._appName,
					tag: EditorData._objToAttr({
						created_by: `${this._appName} ${this._appVersion}`,
						comment: this._comment,
						taskId: `${this._taskId}`,
					})
				}
			}
		});
	}

	setButtonsText(geojson, serviceData) {

		const buttons = [];


		// // Decide which buttons to show
		// if (serviceData.no) {
		// 	td.rejected = serviceData.no[0].user;
		// 	td.reject_date = serviceData.no[0].date;
		// } else {
		// 	const yesVotes = (serviceData.yes && serviceData.yes.length) || 0;
		// 	if (yesVotes < this._needVotes) {
		// 		td.accept_title = 'Vote for this change. Another person must approve before OSM data is changed.';
		// 		td.accept_text = 'Vote YES';
		// 		td.accept_type = 'vote';
		// 	} else {
		// 		td.accept_title = 'Upload this change to OpenStreetMap server.';
		// 		if (yesVotes === 1) {
		// 			td.accept_title += ` User ${serviceData.yes[0].user} has also agreed on this change on ${serviceData.yes[0].date}`;
		// 		} else if (yesVotes > 1) {
		// 			const yesUserList = serviceData.yes.map(v=>v.user).join(', ');
		// 			const yesLastDate = serviceData.yes.map(v=>v.user).join(', ');
		// 			td.accept_title += ` Users ${yesUserList} have also agreed on this change. Last vote was on `;
		// 		}
		// 		td.accept_text = 'Save';
		// 		td.accept_type = 'accept';
		// 	}
		// }

		return buttons;
	}

	makeTemplData(xmlFeature, geojson) {
		const newTags = this._parseRow(geojson.rowData);
		const choices = this._createChoices(xmlFeature.tag, newTags);

		const data = this.genBaseTemplate(geojson);

		if (add.length || mod.length || del.length) {
			geojson.loaded = true;
		} else {
			geojson.noChanges = true;
		}

		data.version = xmlFeature._version;
		data.taskId = this._taskId;
		data.choices = choices;

		return data;
	}

	_createChoices(xmlTags, taskChoices) {
		if (xmlTags === undefined) {
			xmlTags = [];
		} else if (!Array.isArray(xmlTags)) {
			// A geojson with a single xmlTags is parsed as an object
			xmlTags = [xmlTags];
		}
		const tagsKV = {};
		for (const v of xmlTags) {
			if (tagsKV.hasOwnProperty(v._k)) {
				throw new Error(`Object has multiple tag "${v._k}"`);
			}
			tagsKV[v._k] = v._v;
		}
		// Create an object for the diff element visualization in a template
		const makeTmplData = (k, v) => typeof v !== 'object' ? {k, v} : {k, v: v.value, vlink: v.vlink};

		const results = [];
		for (const groupId of Object.keys(taskChoices)) {
			const choiceTags = taskChoices[groupId];
			const add = [], mod = [], del = [];
			const tagsCopy = Object.assign({}, tagsKV);
			const xmlTagsCopy = extend(true, [], xmlTags);

			for (const tagName of Object.keys(choiceTags)) {
				const item = makeTmplData(tagName, choiceTags[tagName]);
				let oldValue = tagsCopy[tagName];
				if (oldValue === item.v) {
					// ignore - original is the same as the replacement
				} else if (oldValue !== undefined) {
					// Find the index of the original xml tag
					const tagInd = EditorData._findTagIndex(xmlTagsCopy, tagName);
					if (tagInd === -1) {
						throw new Error(`Internal error: unable to find ${tagName}`);
					}
					item.oldv = oldValue;
					if (item.v !== undefined) {
						mod.push(item);
						xmlTagsCopy[tagInd]._v = item.v;
					} else {
						del.push(item);
						xmlTagsCopy.splice(tagInd, 1);
					}
					delete tagsCopy[tagName];
				} else if (item.v !== undefined) {
					add.push(item);
					xmlTagsCopy.push({_k: tagName, _v: item.v});
				}
			}

			if (add.length || mod.length || del.length) {
				const nochange = [];
				for (const k of Object.keys(tagsCopy)) {
					nochange.push(makeTmplData(k, tagsCopy[k]));
				}
				const result = {};
				if (add.length) result.add = add;
				if (mod.length) result.mod = mod;
				if (del.length) result.del = del;
				if (nochange.length) result.nochange = nochange;
				result.newXml = xmlTagsCopy;
				if (groupId) {
					result.groupId = groupId;
					result.label = this._labels[groupId];
				}
				results.push(result);
			}
		}

		if (!results.length) {
			const nochange = [];
			for (const k of Object.keys(tagsKV)) {
				nochange.push(makeTmplData(k, tagsKV[k]));
			}
			return nochange.length ? [{nochange}] : [];
		}

		return results;
	}

	genBaseTemplate(geojson) {
		return {
			type: geojson.id.type,
			id: geojson.id.id,
			mainWebsite: this._baseUrl,
			url_help: 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service',
		};
	}

	_createChangeXml(xmlData, geojson, changeSetId) {

		const type = geojson.id.type;
		const xmlFeature = xmlData.osm[type];

		xmlFeature._changeset = changeSetId;

		delete xmlFeature._timestamp;
		delete xmlFeature._visible;
		delete xmlFeature._user;
		delete xmlFeature._uid;

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
		let i;
		for (i = 0; i < xmlTags.length; i++) {
			if (xmlTags[i]._k === tagName) break;
		}
		return i >= xmlTags.length ? -1 : i;
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

		// const data = await $.ajax({
		// 	url: `${this._baseUrl}/api/0.6/changesets?open=true&user=`,
		// 	headers: {Accept: 'application/sparql-results+json'}
		// });
		//
		// const parsed = await EditorData._parseServiceData(data);
		//
		// await this.osmXhr({
		// 	method: 'GET',
		// 	path: `/api/0.6/changesets?open=true`,
		// 	options: {header: {'Content-Type': 'text/xml'}}
		// });
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

	async uploadChangeset(geojson, xmlData) {
		if (!this.enableWrite) {
			throw new Error('Writing to OSM is not enabled');
		}
		if (!this._changesetId) {
			this._changesetId = await this.osmXhr({
				method: 'PUT',
				path: '/api/0.6/changeset/create',
				content: this._createChangeSetXml(geojson),
				options: {header: {'Content-Type': 'text/xml'}}
			});
		}
		await this.osmXhr({
			method: 'POST',
			path: `/api/0.6/changeset/${this._changeSetId}/upload`,
			content: this._createChangeXml(xmlData, geojson, this._changeSetId),
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

	async saveToService(geojson, selection) {
		// TODO: Service should automatically pick this up from the OSM servers
		const {userId, userName} = await this.getUserInfo(true);

		return this.osmXhr({
			prefix: false,
			method: 'PUT',
			path: `${this._serviceUrl}/v1/${this._taskId}/${geojson.id.uid}/${selection}`,
			data: {userId, userName},
			// options: {header: {'Content-Type': 'application/x-www-form-urlencoded'}},
			content: $.param({userId, userName})
		});
	}

	async getUserInfo(authenticate) {
		if (this._userInfo) return this._userInfo;
		if (!authenticate && !this._osmauth.authenticated()) return false;

		const xml = await this.osmXhr({
			method: 'GET',
			path: `/api/0.6/user/details`,
			options: {header: {'Content-Type': 'text/xml'}}
		});

		const parsed = this._xmlParser.dom2js(xml);
		this._userInfo = {
			userName: parsed.osm.user._display_name,
			userId: parsed.osm.user._id
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
			const gr = tag.match(tagRe)[1];
			if (!groups.hasOwnProperty(gr)) groups[gr] = {};
			groups[gr][tag] = columns[tag];
		}

		const groupIds = Object.keys(groups);
		if (groups.hasOwnProperty('')) {
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
		feature.rowData = row;

		return feature;
	}

	/**
	 * Extract desired tags
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

};}));
