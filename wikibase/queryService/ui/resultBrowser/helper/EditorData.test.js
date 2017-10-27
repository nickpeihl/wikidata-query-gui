const assert = require('assert');
const ED = require('./EditorData');

describe('timing test', () => {
	const baseurl = 'https://master.apis.dev.openstreetmap.org';
	const url_help = 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service';
	const date1 = '2017-10-21T06:44:31Z';
	const date2 = '2017-10-21T07:44:31Z';
	const date3 = '2017-11-21T06:44:31Z';

	function newLib(opts) {
		opts = opts || {};
		return new ED({
			queryOpts: {
				taskId: opts.taskId || 'my-query',
				comment: opts.comment || 'my comment',
				labels: opts.labels,
			},
			isEditorMode: opts.isEditorMode || false,
			config: {
				api: {
					osm: {
						version: '42.0.0',
						program: 'Tester',
						baseurl,
					},
					sparql: {
						uri: null,
						serviceuri: null,
					}
				}
			},
			columns: ['id', 'loc', ...(opts.columns || [])]
		});
	}

	it('changset xml', () => {
		const lib = newLib();
		const xml = lib._createChangeSetXml({
			comment: 'my comment'
		});

		// language=HTML
		assert.equal(xml, '<osm><changeset version="42.0.0" generator="Tester">' +
			'<tag k="created_by" v="Tester 42.0.0" />' +
			'<tag k="comment" v="my comment" />' +
			'<tag k="taskId" v="my-query" />' +
			'</changeset></osm>');
	});

	it('_findTagIndex', () => {
		assert.equal(ED._findTagIndex([], 'foo'), -1);
		assert.equal(ED._findTagIndex([{}], 'foo'), -1);
		assert.equal(ED._findTagIndex([{_k: 'foo'}], 'foo'), 0);
		assert.equal(ED._findTagIndex([{_k: 'bar'}, {_k: 'foo'}], 'foo'), 1);
	});

	it('_objToAttr', () => {
		assert.deepEqual(ED._objToAttr({}), []);
		assert.deepEqual(
			ED._objToAttr({a: 'aab', b: 'bbb'}),
			[{_k: "a", _v: "aab"}, {_k: "b", _v: "bbb"}]
		);
	});

	describe('_createChoices', () => {

		let test = (oldTags, choices, serviceData, expectedData, labels) => {
			const lib = newLib({labels});
			const xmlTags = ED._objToAttr(oldTags);
			const actual = lib._createChoices(xmlTags, choices, serviceData);
			assert.deepEqual(actual, expectedData);
		};

		it('empty', () => test({}, [], {}, []));
		it('empty - throws', () => assert.throws(() => test({}, [], {'yes': []}, [])));

		it('no change', () => test(
			{foo: 'bar'},
			{'yes': {foo: 'bar'}},
			{},
			[{nochange: [{k: 'foo', v: 'bar'}]}]
		));

		it('no change', () => test(
			{foo: 'bar'},
			{'yes': {foo: 'bar'}},
			{},
			[{nochange: [{k: 'foo', v: 'bar'}]}]
		));

		it('add', () => test(
			{b: 'bar'},
			{'yes': {a: 'foo'}},
			{},
			[{
				nochange: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'Change',
				groupId: 'yes',
			}]
		));

		it('mod', () => test(
			{a: 'bar'},
			{'yes': {a: 'foo'}},
			{},
			[{
				mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
				newXml: ED._objToAttr({a: 'foo'}),
				label: 'Change',
				groupId: 'yes',
			}]
		));

		it('del', () => test(
			{a: 'foo'},
			{'yes': {a: undefined}},
			{},
			[{
				del: [{k: 'a', oldv: 'foo', v: undefined}],
				newXml: ED._objToAttr({}),
				label: 'Change',
				groupId: 'yes',
			}]
		));

		it('multi', () => test(
			{a: 'aaa', b: 'bbb', c: 'ccc'},
			{
				a: {a: 'aab', d: 'ddd', c: undefined},
				b: {b: 'bbc', e: 'eee', a: undefined}
			},
			{},
			[
				{
					nochange: [{k: 'b', v: 'bbb'}],
					add: [{k: 'd', v: 'ddd'}],
					mod: [{k: 'a', oldv: 'aaa', v: 'aab'}],
					del: [{k: 'c', oldv: 'ccc', v: undefined}],
					newXml: ED._objToAttr({a: 'aab', b: 'bbb', d: 'ddd'}),
					groupId: 'a',
					label: 'group a'
				},
				{
					nochange: [{k: 'c', v: 'ccc'}],
					add: [{k: 'e', v: 'eee'}],
					mod: [{k: 'b', oldv: 'bbb', v: 'bbc'}],
					del: [{k: 'a', oldv: 'aaa', v: undefined}],
					newXml: ED._objToAttr({b: 'bbc', c: 'ccc', e: 'eee'}),
					groupId: 'b',
					label: 'group b'
				}
			],
			{a: 'group a', b: 'group b'}
		));

		it('votes - yes', () => test(
			{b: 'bar'},
			{'yes': {a: 'foo'}},
			{'yes': [{user: 'usr1'}, {user: 'usr2'}]},
			[{
				nochange: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'Change',
				groupId: 'yes',
				votes: 2,
				save: true,
				votedUsers: 'usr1, usr2'
			}]
		));


		it('votes - no', () => test(
			{b: 'bar'},
			{'yes': {a: 'foo'}},
			{'yes': [{user: 'usr1'}], 'no': [{user: 'usr2'}, {user: 'usr3'}]},
			[{
				nochange: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'Change',
				groupId: 'yes',
				conflict: 'usr2, usr3',
				votes: 1,
				votedUsers: 'usr1'
			}]
		));

		it('votes - multi', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{'b': [{user: 'usr1'}, {user: 'usr2'}]},
			[{
				mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
				newXml: ED._objToAttr({a: 'bbb'}),
				label: 'group a',
				groupId: 'a',
				conflict: 'usr1, usr2'
			}, {
				mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
				newXml: ED._objToAttr({a: 'ccc'}),
				label: 'group b',
				groupId: 'b',
				save: true,
				votes: 2,
				votedUsers: 'usr1, usr2'
			}],
			{a: 'group a', b: 'group b'}
		));

		it('votes - multi-no', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{'b': [{user: 'usr1'}, {user: 'usr2'}], 'no': [{user: 'usr3'}]},
			[{
				mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
				newXml: ED._objToAttr({a: 'bbb'}),
				label: 'group a',
				groupId: 'a',
				conflict: 'usr1, usr2, usr3'
			}, {
				mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
				newXml: ED._objToAttr({a: 'ccc'}),
				label: 'group b',
				groupId: 'b',
				votes: 2,
				votedUsers: 'usr1, usr2',
				conflict: 'usr3'
			}],
			{a: 'group a', b: 'group b'}
		));

	});

	describe('_parseServiceData', () => {
		it('empty', () => {
			assert.deepEqual(ED._parseServiceData({results: {bindings: []}}), {});
		});

		it('yes no', () => {
			const rawData = {
				head: {vars: ['p', 'o']},
				results: {
					bindings: [
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_yes'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date1}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer2'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_yes'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/ayesayer2'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date2}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/naysayer'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_no'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/naysayer'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date3}
						}
					]
				}
			};
			assert.deepEqual(ED._parseServiceData(rawData), {
				yes: [
					{user: 'ayesayer', date: new Date(date1)},
					{user: 'ayesayer2', date: new Date(date2)}
				],
				no: [{user: 'naysayer', date: new Date(date3)}]
			});
		});
		it('multi val', () => {
			const rawData = {
				head: {vars: ['p', 'o']},
				results: {
					bindings: [
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr1'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_1'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr1'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date1}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr2'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_2'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr2'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date2}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr3'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_2'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr3'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date3}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr4'},
							o: {type: 'uri', value: 'https://www.openstreetmap.org/meta/pick_no'}
						},
						{
							p: {type: 'uri', value: 'https://www.openstreetmap.org/user/usr4'},
							o: {datatype: 'http://www.w3.org/2001/XMLSchema#dateTime', type: 'literal', value: date3}
						}
					]
				}
			};
			assert.deepEqual(ED._parseServiceData(rawData), {
				'1': [{user: 'usr1', date: new Date(date1)}],
				'2': [{user: 'usr2', date: new Date(date2)}, {user: 'usr3', date: new Date(date3)}],
				no: [{user: 'usr4', date: new Date(date3)}]
			});
		});
	});

	describe('_parseColumnHeaders', () => {
		const test = (columns, expectedData, labels) => {
			const lib = newLib();
			const actual = ED._parseColumnHeaders(columns, labels);
			assert.deepEqual(actual, expectedData);
		};
		const error = columns => assert.throws(() => test(columns));

		it('minimum', () => test(['id', 'loc'], {}));
		it('missing minimum', () => {
			error(['id']);
			error(['loc'])
		});

		it('one column', () => test(['id', 'loc', 'v0', 't0'], {'yes': {t0: 'v0'}}));
		it('one column - err', () => {
			error(['id', 'loc', 't0']);
			error(['id', 'loc', 'v0'])
		});
		it('two columns', () => test(['id', 'loc', 'v1', 't1', 'v5', 't5'], {'yes': {t1: 'v1', t5: 'v5'}}));

		it('multiple choice', () => test(['id', 'loc', 'av1', 'at1', 'alabel', 'bv1', 'bt1', 'blabel'], {
			a: {at1: 'av1'},
			b: {bt1: 'bv1'}
		}, {a:'group a', b: 'group b'}));
	});

	describe('_parseRow', () => {
		it('single value', () => {
			const row = {
				t1: {type: "literal", value: "tag1"},
				v1: {type: "literal", value: "val1"}
			};

			const actual = newLib({columns:['t1', 'v1']})._parseRow(row);

			assert.deepEqual(actual, {'yes': {tag1: 'val1'}});
		});

		it('multiple values', () => {
			const row = {
				at1: {type: "literal", value: "tag1"},
				av1: {type: "literal", value: "val1"},
				bt1: {type: "literal", value: "tag2"},
				bv1: {type: "literal", value: "val2"}
			};

			const actual = newLib({
				columns: ['at1', 'av1', 'bt1', 'bv1'],
				labels: {a: 'grp A', b: 'grp B'}
			})._parseRow(row);

			assert.deepEqual(actual, {'a': {tag1: 'val1'}, 'b': {tag2: 'val2'}});
		});
	});

	it('parseFeature', () => {
		const rowData = {
			id: {
				type: "uri",
				value: "https://www.openstreetmap.org/node/123"
			},
			loc: {
				datatype: "http://www.opengis.net/ont/geosparql#wktLiteral",
				type: "literal",
				value: "Point(-75.0 43.0)"
			}
		};
		assert.deepEqual(ED.parseFeature(rowData),
			{
				coordinates: [-75, 43],
				id: {id: "123", type: "node", uid: "node/123"},
				type: "Point",
				rowData
			}
		);
	});
});
