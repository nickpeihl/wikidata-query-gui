const assert = require('assert');
const EditorData = require('./EditorData');

describe('timing test', function () {
	const baseurl = 'https://master.apis.dev.openstreetmap.org';
	const url_help = 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service';

	it('changset xml', () => {
		const lib = new EditorData({
			version: '42.0.0',
			program: 'Tester',
			taskId: 'my-query',
			baseUrl: baseurl,
			osmauth: null,
			sparqlUrl: null,
			serviceUrl: null,
		});
		const xml = lib.createChangeSetXml({
			comment: 'my comment'
		});

		// language=HTML
		assert.equal(xml, '<osm><changeset version="42.0.0" generator="Tester">' +
			'<tag k="created_by" v="Tester 42.0.0" />' +
			'<tag k="taskId" v="my-query" />' +
			'<tag k="comment" v="my comment" />' +
			'</changeset></osm>');
	});

	it('_findTagIndex', () => {
		assert.equal(EditorData._findTagIndex([], 'foo'), -1);
		assert.equal(EditorData._findTagIndex([{}], 'foo'), -1);
		assert.equal(EditorData._findTagIndex([{_k: 'foo'}], 'foo'), 0);
		assert.equal(EditorData._findTagIndex([{_k: 'bar'}, {_k: 'foo'}], 'foo'), 1);
	});

	describe('parseXmlTags', () => {
		const lib = new EditorData({
			version: '42.0.0',
			program: 'Tester',
			taskId: 'my-query',
			baseUrl: baseurl,
			osmauth: null,
			sparqlUrl: null,
			serviceUrl: null,
		});

		const id = {type: 'node', id: 13};

		let runTest = function (geojson, expectedGeojson, oldTags, expectedData) {
			const xmlTags = dictToTags(oldTags);
			geojson.comment = 'my-comment';
			Object.assign(expectedGeojson, geojson);
			const data = lib.parseXmlTags({
				tag: xmlTags,
				_version: '123'
			}, geojson);

			expectedData.version = '123';
			expectedData.comment = geojson.comment;
			expectedData.taskId = 'my-query';
			assert.deepEqual(data, expectedData, 'data mismatch');
			assert.deepEqual(geojson, expectedGeojson, 'geojson mismatch');
		};

		it('empty', () => runTest(
			{id, properties: {}},
			{noChanges: true},
			{},
			{
				id: 13,
				mainWebsite: baseurl,
				url_help: url_help,
				type: 'node',
				tags: []
			}));

		it('no change', () => runTest(
			{id, properties: {foo: 'bar'}},
			{noChanges: true},
			{foo: 'bar'},
			{
				id: 13,
				mainWebsite: baseurl,
				url_help: url_help,
				type: 'node',
				tags: [
					{k: 'foo', v: 'bar'}
				]
			}));

		it('add', () => runTest(
			{id, properties: {a: 'foo'}},
			{loaded: true},
			{b: 'bar'},
			{
				id: 13,
				mainWebsite: baseurl,
				url_help: url_help,
				type: 'node',
				tags: [
					{k: 'b', v: 'bar'}
				],
				fixes: {
					add: [{k: 'a', v: 'foo'}],
					mod: [],
					del: [],
				}
			}));

		it('mod', () => runTest(
			{id, properties: {a: 'foo'}},
			{loaded: true},
			{a: 'bar'},
			{
				id: 13,
				mainWebsite: baseurl,
				url_help: url_help,
				type: 'node',
				tags: [
				],
				fixes: {
					add: [],
					mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
					del: [],
				}
			}));

		it('del', () => runTest(
			{id, properties: {a: undefined}},
			{loaded: true},
			{a: 'foo'},
			{
				id: 13,
				mainWebsite: baseurl,
				url_help: url_help,
				type: 'node',
				tags: [
				],
				fixes: {
					add: [],
					mod: [],
					del: [{k: 'a', oldv: 'foo', v: undefined}],
				}
			}));
	});

	describe('_parseServiceData', () => {
		it('empty', () => {
			assert.deepEqual(EditorData._parseServiceData({results: {bindings: []}}), {});
		});

		it('non-empty', () => {
			const rawData = {
				head: {vars: ['p', 'o']},
				results: {
					bindings: [
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_yes'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer'},
							o: {
								datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
								type: 'literal',
								value: '2017-10-21T06:44:31Z'
							}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_yes'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer2'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer2'},
							o: {
								datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
								type: 'literal',
								value: '2017-10-21T07:44:31Z'
							}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_no'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/user/naysayer'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/naysayer'},
							o: {
								datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
								type: 'literal',
								value: '2017-11-21T06:44:31Z'
							}
						}
					]
				}
			};
			assert.deepEqual(EditorData._parseServiceData(rawData), {
				yes: [
					{user: 'ayesayer', date: new Date('2017-10-21T06:44:31Z')},
					{user: 'ayesayer2', date: new Date('2017-10-21T07:44:31Z')}
				],
				no: [{user: 'naysayer', date: new Date('2017-11-21T06:44:31Z')}]
			});
		});
	});


	function dictToTags(vals) {
		const result = [];
		for (const k of Object.keys(vals)) {
			result.push({_k: k, _v: vals[k]});
		}
		return result;
	}

	describe('setButtonsText', () => {
		let runTest = function (td, serviceData, expectedData) {
			const lib = new EditorData({
				version: '42.0.0',
				program: 'Tester',
				taskId: 'my-query',
				baseUrl: baseurl,
				osmauth: null,
				sparqlUrl: null,
				serviceUrl: null,
			});

			lib.setButtonsText(td, {}, serviceData);
			assert.deepEqual(td, expectedData, 'templateData mismatch');
		};

		it('empty', () => {
			runTest({}, {}, {
				buttons: [
					{
						label: 'Vote YES',
						title: 'Vote for this change. Another person must approve before OSM data is changed.',
						type: 'yes'
					}
				]
			});

		});

	});
});
