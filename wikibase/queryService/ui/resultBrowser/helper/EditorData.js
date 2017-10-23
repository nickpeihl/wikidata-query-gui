var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};
wikibase.queryService.ui.resultBrowser.helper = wikibase.queryService.ui.resultBrowser.helper || {};

(function (factory) {
	if (typeof module === 'object' && module.exports) {
		module.exports = factory(require('x2js'), require('jquery'));
	} else {
		// Browser globals
		wikibase.queryService.ui.resultBrowser.helper.EditorData = factory(X2JS, $);
	}
}(function (X2JS, $) { return class EditorData {

	constructor(opts) {
		this._appVersion = opts.version;
		this._appName = opts.program;
		this._taskId = opts.taskId;
		// If there is a taskId, we can vote/reject.
		// Without it, user can only save or ignore (dev mode)
		this._needVotes = opts.taskId ? 1 : 0;
		this._baseUrl = opts.baseUrl;
		this._osmauth = opts.osmauth;
		this._sparqlUrl = opts.sparqlUrl;
		this._serviceUrl = opts.serviceUrl;
		this._noVote = opts.noVote;

		this._userInfo = false;
		this._changesetId = false;

		this._xmlParser = new X2JS();
	}

	createChangeSetXml(geojson) {
		let comment = geojson.comment;
		return this._xmlParser.js2xml(
			{
				osm: {
					changeset: {
						_version: this._appVersion,
						_generator: this._appName,
						tag: [
							{_k: "created_by", _v: `${this._appName} ${this._appVersion}`},
							{_k: "taskId", _v: `${this._taskId}`},
							{_k: "comment", _v: comment}
						]
					}
				}
			}
		);
	}

	setButtonsText(td, geojson, serviceData) {
		td.buttons = [];

		// Decide which buttons to show
		if (serviceData.no) {
			td.rejected = serviceData.no[0].user;
			td.reject_date = serviceData.no[0].date;
		} else {
			const yesVotes = (serviceData.yes && serviceData.yes.length) || 0;
			if (yesVotes < this._needVotes) {
				td.accept_title = 'Vote for this change. Another person must approve before OSM data is changed.';
				td.accept_text = 'Vote YES';
				td.accept_type = 'vote';
			} else {
				td.accept_title = 'Upload this change to OpenStreetMap server.';
				if (yesVotes === 1) {
					td.accept_title += ` User ${serviceData.yes[0].user} has also agreed on this change on ${serviceData.yes[0].date}`;
				} else if (yesVotes > 1) {
					const yesUserList = serviceData.yes.map(v=>v.user).join(', ');
					const yesLastDate = serviceData.yes.map(v=>v.user).join(', ');
					td.accept_title += ` Users ${yesUserList} have also agreed on this change. Last vote was on `;
				}
				td.accept_text = 'Save';
				td.accept_type = 'accept';
			}
		}

		return td;
	}

	async getUserInfo() {
		if (this._userInfo) return this._userInfo;

		const xml = await this._osmauth.xhrAsync({
			method: 'GET',
			path: `/api/0.6/user/details`,
			options: {header: {'Content-Type': 'text/xml'}}
		});

		const parsed = this._xmlParser.dom2js(xml);
		this._userInfo = {
			userName: parsed.osm.user._display_name,
			userId: parsed.osm.user._id
		};

		return this._userInfo;
	}

	parseXmlTags(xmlFeature, geojson) {
		const xmlTags = this._normalizeTagList(xmlFeature.tag);
		const tagsKV = {};
		const add = [], mod = [], del = [];

		for (const v of xmlTags) {
			if (tagsKV.hasOwnProperty(v._k)){
				throw new Error(`Object has multiple tag "${v._k}"`);
			}
			tagsKV[v._k] = v._v;
		}

		// Create an object for the diff element visualization in a template
		const makeTmplData = (k, v) => typeof v !== 'object' ? {k, v} : {k, v: v.value, vlink: v.vlink};

		for (const tagName of Object.keys(geojson.properties)) {
			const tmpl = makeTmplData(tagName, geojson.properties[tagName]);
			let oldValue = tagsKV[tagName];
			if (oldValue === tmpl.v) {
				// ignore - original is the same as the replacement
			} else if (oldValue !== undefined) {
				// Find the index of the original xml tag
				const tagInd = EditorData._findTagIndex(xmlTags, tagName);
				if (tagInd === -1) {
					throw new Error(`Internal error: unable to find ${tagName} in ${geojson.id.uid}`);
				}
				tmpl.oldv = oldValue;
				if (tmpl.v !== undefined) {
					mod.push(tmpl);
					xmlTags[tagInd]._v = tmpl.v;
				} else {
					del.push(tmpl);
					xmlTags.splice(tagInd, 1);
				}
				delete tagsKV[tagName];
			} else if (tmpl.v !== undefined) {
				add.push(tmpl);
				xmlTags.push({_k: tagName, _v: tmpl.v});
			}
		}

		const data = this.genBaseTemplate(geojson);
		data.tags = [];
		for (const k of Object.keys(tagsKV)) {
			data.tags.push(makeTmplData(k, tagsKV[k]));
		}

		if (add.length || mod.length || del.length) {
			data.fixes = {add, mod, del};
			geojson.loaded = true;
		} else {
			geojson.noChanges = true;
		}

		data.version = xmlFeature._version;
		data.comment = geojson.comment;
		data.taskId = this._taskId;

		return data;
	}

	_normalizeTagList(tag) {
		if (tag === undefined) {
			return [];
		} else if (!Array.isArray(tag)) {
			// A geojson with a single tag is parsed as an object
			return [tag];
		} else {
			return tag;
		}
	}

	genBaseTemplate(geojson) {
		return {
			type: geojson.id.type,
			id: geojson.id.id,
			mainWebsite: this._baseUrl,
			url_help: 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service',
		};
	}

	createChangeXml(xmlData, geojson, changeSetId) {

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

	async uploadChangeset(geojson, xmlData) {
		if (!this._changesetId) {
			this._changesetId = await this._osmauth.xhrAsync({
				method: 'PUT',
				path: '/api/0.6/changeset/create',
				content: this._editorData.createChangeSetXml(geojson),
				options: {header: {'Content-Type': 'text/xml'}}
			});
		}
		await this._osmauth.xhrAsync({
			method: 'POST',
			path: `/api/0.6/changeset/${this._changeSetId}/upload`,
			content: this.createChangeXml(xmlData, geojson, this._changeSetId),
			options: {header: {'Content-Type': 'text/xml'}}
		});
	}

	async closeChangeset() {
		if (this._changesetId) {
			const id = this._changesetId;
			this._changesetId = false;
			await this._osmauth.xhrAsync({
				method: 'PUT',
				path: `/api/0.6/changeset/${id}/close`,
				options: {header: {'Content-Type': 'text/xml'}}
			});
		}
	}

	async findOpenChangeset() {
		if (this._changesetId) return this._changesetId;

		// const data = await $.ajax({
		// 	url: `${this._baseUrl}/api/0.6/changesets?open=true&user=`,
		// 	headers: {Accept: 'application/sparql-results+json'}
		// });
		//
		// const parsed = await EditorData._parseServiceData(data);
		//
		// await this._osmauth.xhrAsync({
		// 	method: 'GET',
		// 	path: `/api/0.6/changesets?open=true`,
		// 	content: this.createChangeXml(xmlData, geojson, this._changeSetId),
		// 	options: {header: {'Content-Type': 'text/xml'}}
		// });
	}

	async downloadServiceData(geojson) {
		// Get all of the data for the "taskid/type/id" combination.
		const type = geojson.id.type;
		const id = geojson.id.id;
		const query = encodeURI(`SELECT ?p ?o WHERE {osmroot:\\/task\\/${this._taskId}\\/${type}\\/${id} ?p ?o}`);

		const data = await $.ajax({
			url: `${this._sparqlUrl}?query=${query}&nocache=${Date.now()}`,
			headers: {Accept: 'application/sparql-results+json'}
		});

		return EditorData._parseServiceData(data);
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
			p = parseVote(res.p);
			if (p !== undefined) {
				o = parseUser(res.o);
				if (o !== undefined) {
					addUser(users, o, 'vote', p, (ov, nv) => ov === 'no' ? ov : nv);
				}
				continue;
			}

			p = parseUser(res.p);
			if (p !== undefined) {
				o = parseDate(res.o);
				if (o !== undefined) {
					addUser(users, p, 'date', o, (ov, nv) => (nv - ov) > 0 ? nv : ov);
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

	async saveToService(geojson, selection) {
		// TODO: Service should automatically pick this up from the OSM servers
		const {userId, userName} = await this.getUserInfo();

		return this._osmauth.xhrAsync({
			prefix: false,
			method: 'PUT',
			path: `${this._serviceUrl}/v1/${this._taskId}/${geojson.id.uid}/${selection}`,
			data: {userId, userName},
			// options: {header: {'Content-Type': 'application/x-www-form-urlencoded'}},
			content: $.param({userId, userName})
		});
	}

};}));
