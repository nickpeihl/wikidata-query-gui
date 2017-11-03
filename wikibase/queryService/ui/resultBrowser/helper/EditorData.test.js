const assert = require('assert');
const ED = require('./EditorData');
const deepEqual = assert.deepEqual;

describe('timing test', () => {
	const baseurl = 'https://master.apis.dev.openstreetmap.org';
	const mainWebsite = 'https://master.apis.dev.openstreetmap.org';
	const taskId = 'my-query';
	const comment = 'my comment';
	const baseLayer = 'my base';
	const url_help = 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service';
	const date1 = '2017-10-21T06:44:31Z';
	const date2 = '2017-10-21T07:44:31Z';
	const date3 = '2017-11-21T06:44:31Z';

	function newLib(opts) {
		opts = opts || {};
		const inst = new ED({
			queryOpts: {
				taskId: opts.taskId !== undefined ? opts.taskId : taskId,
				noVote: opts.noVote !== undefined ? opts.noVote : false,
				comment: opts.comment || comment,
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
		inst.baseLayer = opts.baseLayer || baseLayer;
		return inst;
	}

	it('changeset xml', () => {
		const lib = newLib();
		const xml = lib._createChangeSetXml({comment});

		// language=HTML
		assert.equal(xml, `<osm><changeset version="42.0.0" generator="Tester">` +
			`<tag k="created_by" v="Tester 42.0.0" />` +
			`<tag k="comment" v="${comment}" />` +
			`<tag k="task_id" v="${taskId}" />` +
			`<tag k="imagery_used" v="${baseLayer}" />` +
			`</changeset></osm>`);
	});

	it('_findTagIndex', () => {
		assert.equal(ED._findTagIndex([], 'foo'), -1);
		assert.equal(ED._findTagIndex([{}], 'foo'), -1);
		assert.equal(ED._findTagIndex([{_k: 'foo'}], 'foo'), 0);
		assert.equal(ED._findTagIndex([{_k: 'bar'}, {_k: 'foo'}], 'foo'), 1);
	});

	it('_objToAttr', () => {
		deepEqual(ED._objToAttr({}), []);
		deepEqual(
			ED._objToAttr({a: 'aab', b: 'bbb'}),
			[{_k: "a", _v: "aab"}, {_k: "b", _v: "bbb"}]
		);
	});

	describe('_createChoices', () => {

		let test = (oldTags, choices, serviceData, expectedData, labels) => {
			const lib = newLib({labels});
			const xmlTags = ED._objToAttr(oldTags);
			const actual = lib._createChoices(xmlTags, choices, serviceData);
			deepEqual(actual, expectedData);
		};

		it('empty', () => test({}, [], {}, []));
		it('empty - throws', () => assert.throws(() => test({}, [], {yes: []}, [])));

		it('no change', () => test(
			{foo: 'bar'},
			{yes: {foo: 'bar'}},
			{},
			[{unchanged: [{k: 'foo', v: 'bar'}]}]
		));

		it('no change', () => test(
			{foo: 'bar'},
			{yes: {foo: 'bar'}},
			{},
			[{unchanged: [{k: 'foo', v: 'bar'}]}]
		));

		it('add', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{},
			[{
				unchanged: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'this change',
				btnLabel: 'Vote for this change',
				groupId: 'yes',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
			}]
		));

		it('mod', () => test(
			{a: 'bar'},
			{yes: {a: 'foo'}},
			{},
			[{
				mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
				newXml: ED._objToAttr({a: 'foo'}),
				label: 'this change',
				btnLabel: 'Vote for this change',
				groupId: 'yes',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
			}]
		));

		it('del', () => test(
			{a: 'foo'},
			{yes: {a: undefined}},
			{},
			[{
				del: [{k: 'a', oldv: 'foo', v: undefined}],
				newXml: ED._objToAttr({}),
				label: 'this change',
				btnLabel: 'Vote for this change',
				groupId: 'yes',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
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
					unchanged: [{k: 'b', v: 'bbb'}],
					add: [{k: 'd', v: 'ddd'}],
					mod: [{k: 'a', oldv: 'aaa', v: 'aab'}],
					del: [{k: 'c', oldv: 'ccc', v: undefined}],
					newXml: ED._objToAttr({a: 'aab', b: 'bbb', d: 'ddd'}),
					groupId: 'a',
					label: 'group a',
					btnLabel: 'Vote for group a',
					btnClass: 'vote',
					icon: '👍',
					resultText: 'voted',
					title: 'Vote for this change. Another person must approve before OSM data is changed.',
				},
				{
					unchanged: [{k: 'c', v: 'ccc'}],
					add: [{k: 'e', v: 'eee'}],
					mod: [{k: 'b', oldv: 'bbb', v: 'bbc'}],
					del: [{k: 'a', oldv: 'aaa', v: undefined}],
					newXml: ED._objToAttr({b: 'bbc', c: 'ccc', e: 'eee'}),
					groupId: 'b',
					label: 'group b',
					btnLabel: 'Vote for group b',
					btnClass: 'vote',
					icon: '👍',
					resultText: 'voted',
					title: 'Vote for this change. Another person must approve before OSM data is changed.',
				}
			],
			{a: 'group a', b: 'group b'}
		));

		it('votes - yes', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{yes: [{user: 'usr1'}, {user: 'usr2'}]},
			[{
				unchanged: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'this change',
				btnLabel: 'Save this change',
				groupId: 'yes',
				okToSave: true,
				agreed: '2 users have voted for this choice: usr1, usr2.',
				btnClass: 'save',
				icon: '💾',
				resultText: 'saved',
				title: 'Upload this change to OpenStreetMap server.',
			}]
		));


		it('votes - no', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{yes: [{user: 'usr1'}], no: [{user: 'usr2'}, {user: 'usr3'}]},
			[{
				unchanged: [{k: 'b', v: 'bar'}],
				add: [{k: 'a', v: 'foo'}],
				newXml: ED._objToAttr({b: 'bar', a: 'foo'}),
				label: 'this change',
				btnLabel: 'Vote for this change',
				groupId: 'yes',
				conflict: '2 users have voted for another choice: usr2, usr3.',
				agreed: 'User usr1 has voted for this choice.',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
			}]
		));

		it('votes - multi', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{b: [{user: 'usr1'}, {user: 'usr2'}]},
			[{
				mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
				newXml: ED._objToAttr({a: 'bbb'}),
				label: 'group a',
				btnLabel: 'Vote for group a',
				groupId: 'a',
				conflict: '2 users have voted for another choice: usr1, usr2.',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',

			}, {
				mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
				newXml: ED._objToAttr({a: 'ccc'}),
				label: 'group b',
				btnLabel: 'Save group b',
				groupId: 'b',
				okToSave: true,
				agreed: '2 users have voted for this choice: usr1, usr2.',
				btnClass: 'save',
				icon: '💾',
				resultText: 'saved',
				title: 'Upload this change to OpenStreetMap server.',
			}],
			{a: 'group a', b: 'group b'}
		));

		it('votes - multi-no', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{b: [{user: 'usr1'}, {user: 'usr2'}], no: [{user: 'usr3'}]},
			[{
				mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
				newXml: ED._objToAttr({a: 'bbb'}),
				label: 'group a',
				btnLabel: 'Vote for group a',
				groupId: 'a',
				conflict: '3 users have voted for another choice: usr1, usr2, usr3.',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
			}, {
				mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
				newXml: ED._objToAttr({a: 'ccc'}),
				label: 'group b',
				btnLabel: 'Vote for group b',
				groupId: 'b',
				agreed: '2 users have voted for this choice: usr1, usr2.',
				conflict: 'User usr3 has voted for another choice.',
				btnClass: 'vote',
				icon: '👍',
				resultText: 'voted',
				title: 'Vote for this change. Another person must approve before OSM data is changed.',
			}],
			{a: 'group a', b: 'group b'}
		));

	});

	describe('_parseServiceData', () => {
		it('empty', () => {
			deepEqual(ED._parseServiceData({results: {bindings: []}}), {});
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
			deepEqual(ED._parseServiceData(rawData), {
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
			deepEqual(ED._parseServiceData(rawData), {
				'1': [{user: 'usr1', date: new Date(date1)}],
				'2': [{user: 'usr2', date: new Date(date2)}, {user: 'usr3', date: new Date(date3)}],
				no: [{user: 'usr4', date: new Date(date3)}]
			});
		});
	});

	describe('_parseColumnHeaders', () => {
		const test = (columns, expectedData, labels) => {
			const actual = ED._parseColumnHeaders(columns, labels);
			deepEqual(actual, expectedData);
		};
		const error = columns => assert.throws(() => test(columns));

		it('minimum', () => test(['id', 'loc'], {}));
		it('missing minimum', () => {
			error(['id']);
			error(['loc'])
		});

		it('one column', () => test(['id', 'loc', 'v0', 't0'], {yes: {t0: 'v0'}}));
		it('one column - err', () => {
			error(['id', 'loc', 't0']);
			error(['id', 'loc', 'v0'])
		});
		it('two columns', () => test(['id', 'loc', 'v1', 't1', 'v5', 't5'], {yes: {t1: 'v1', t5: 'v5'}}));

		it('multiple choice', () => test(['id', 'loc', 'av1', 'at1', 'alabel', 'bv1', 'bt1', 'blabel'], {
			a: {at1: 'av1'},
			b: {bt1: 'bv1'}
		}, {a: 'group a', b: 'group b'}));
	});

	describe('_parseRow', () => {
		it('single value', () => {
			const row = {
				t1: {type: "literal", value: "tag1"},
				v1: {type: "literal", value: "val1"}
			};

			const actual = newLib({columns: ['t1', 'v1']})._parseRow(row);

			deepEqual(actual, {yes: {tag1: 'val1'}});
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

			deepEqual(actual, {a: {tag1: 'val1'}, b: {tag2: 'val2'}});
		});
	});

	it('parseFeature', () => {
		const rdfRow = {
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
		deepEqual(ED.parseFeature(rdfRow),
			{
				coordinates: [-75, 43],
				id: {id: "123", type: "node", uid: "node/123"},
				type: "Point",
				rdfRow
			}
		);
	});

	describe('_makeTemplData', () => {
		const no = {
			btnClass: 'no',
			groupId: 'no',
			btnLabel: 'reject',
			resultText: 'rejected',
			title: 'If this change is a mistake, mark it as invalid to prevent others from changing it with this task in the future.',
			icon: '⛔',
		};

		const statusNo = {
			btnClass: 'no',
			groupId: 'no',
			btnLabel: 'reject',
			resultText: 'Rejected by',
			title: 'This change has been previously rejected on usrNo date by usrNo. You might want to contact the user, or if you are sure it is a mistake, click on the Object ID and edit it manually.',
			icon: '⛔',
			user: 'usrNo',
		};

		const statusMeNo = {
			btnClass: 'no',
			groupId: 'no',
			btnLabel: 'reject',
			resultText: 'rejected',
			title: 'You have voted for this change on 2017-10-21T06:44:31Z. If you have made a mistake, click on the Object ID and edit it manually.',
			icon: '⛔',
		};

		const featureId = {type: 'node', id: '123', version: 42};

		const dflts = {mainWebsite, taskId, url_help, comment, ...featureId};
		const dfltsNT = {mainWebsite, url_help, comment, ...featureId};

		const voteNo = {no: [{user: 'usrNo', date: 'usrNo date'}]};
		const voteYes = {yes: [{user: 'usrYes', date: 'usrYes date'}]};
		const voteA = {a: [{user: 'usr1', date: 'usr1 date'}]};
		const myNo = {groupId: 'no', date: date1};
		const myYes = {groupId: 'yes', date: date1};
		const myA = {groupId: 'a', date: date1};

		const unchanged = [{unchanged: [{k: 'foo', v: 'bar'}]}];
		const mods = {
			newXml: ED._objToAttr({a: 'foo'}),
			mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
		};
		const mods2 = {
			newXml: ED._objToAttr({a: 'foo2'}),
			mod: [{k: 'a', oldv: 'bar', v: 'foo2'}],
		};
		const changeBtn = {btnLabel: 'Change', groupId: 'yes', btnClass: 'vote'};
		// const rejection = {
		// 	resultText: 'Rejected by',
		// 	title: 'This change has been previously rejected on usrNo date by usrNo. You might want to contact the user, or if you are sure it is a mistake, click on the Object ID and edit it manually.',
		// 	user: 'usrNo',
		// 	rejected: {
		// 		title: 'This change has been previously rejected on usrNo date by usrNo. You might want to contact the user, or if you are sure it is a mistake, click on the Object ID and edit it manually.',
		// 		user: 'usrNo'
		// 	}
		// };

		it('empty', () => deepEqual(newLib()._makeTemplData(featureId, [], {}), dflts));
		it('NT empty', () => deepEqual(newLib({taskId: false})._makeTemplData(featureId, [], {}), dfltsNT));
		it('empty+no', () => deepEqual(newLib()._makeTemplData(featureId, [], voteNo), dflts));
		it('empty+yes', () => deepEqual(newLib()._makeTemplData(featureId, [], voteYes), dflts));
		it('NV empty', () => deepEqual(newLib({noVote: true})._makeTemplData(featureId, [], {}), dflts));
		it('NV empty+yes', () => deepEqual(newLib({noVote: true})._makeTemplData(featureId, [], voteYes), dflts));

		it('unchanged', () => deepEqual(
			newLib()._makeTemplData(featureId, unchanged, {}),
			{...dflts, choices: unchanged}));
		it('NT unchanged', () => deepEqual(
			newLib({taskId: false})._makeTemplData(featureId, unchanged, {}),
			{...dfltsNT, choices: unchanged}));
		it('unchanged+no', () => deepEqual(
			newLib()._makeTemplData(featureId, unchanged, voteNo),
			{...dflts, choices: unchanged}));
		it('unchanged+yes', () => deepEqual(
			newLib()._makeTemplData(featureId, unchanged, voteYes),
			{...dflts, choices: unchanged}));
		it('NV unchanged', () => deepEqual(
			newLib({noVote: true})._makeTemplData(featureId, unchanged, {}),
			{...dflts, choices: unchanged}));
		it('NV unchanged+yes', () => deepEqual(
			newLib({noVote: true})._makeTemplData(featureId, unchanged, voteYes),
			{...dflts, choices: unchanged}));

		const modChoices = [{...changeBtn, ...mods}];
		it('mod', () => deepEqual(
			newLib()._makeTemplData(featureId, modChoices, {}),
			{...dflts, choices: modChoices, no}));
		it('NT mod', () => deepEqual(
			newLib({taskId: false})._makeTemplData(featureId, modChoices, {}),
			{...dfltsNT, comment, choices: modChoices}));
		it('mod+no', () => deepEqual(
			newLib()._makeTemplData(featureId, modChoices, voteNo),
			{...dflts, choices: modChoices, no, status: statusNo}));
		it('mod+my no', () => deepEqual(
			newLib()._makeTemplData(featureId, modChoices, {}, myNo),
			{...dflts, choices: modChoices, no, status: statusMeNo}));
		it('mod+yes', () => deepEqual(
			newLib()._makeTemplData(featureId, modChoices, voteYes),
			{...dflts, choices: modChoices, no: {...no, conflict: 'User usrYes has voted for another choice.'}}));
		it('mod+my yes', () => deepEqual(
			newLib()._makeTemplData(featureId, modChoices, {}, myYes),
			{...dflts, choices: modChoices, no, status: {
				btnClass: 'vote',
				btnLabel: 'Change',
				groupId: 'yes',
				title: 'You have voted for this change on 2017-10-21T06:44:31Z. If you have made a mistake, click on the Object ID and edit it manually.',
			}}));
		it('NV mod', () => deepEqual(
			newLib({noVote: true})._makeTemplData(featureId, modChoices, {}),
			{...dflts, choices: modChoices, no}));
		it('NV mod+yes', () => deepEqual(
			newLib({noVote: true})._makeTemplData(featureId, modChoices, voteYes),
			{...dflts, choices: modChoices, no: {...no, conflict: 'User usrYes has voted for another choice.'}}));

		it('mod choices', () => deepEqual(
			newLib()._makeTemplData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], {}),
			{...dflts, no, choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]}));
		it('mod choices+no', () => deepEqual(
			newLib()._makeTemplData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteNo),
			{...dflts, no, status: statusNo, choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]}));
		it('mod choices+yes', () => deepEqual(
			newLib()._makeTemplData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteA),
			{
				...dflts, no: {...no, conflict: 'User usr1 has voted for another choice.'},
				choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]
			}));
		it('mod choices+my no', () => deepEqual(
			newLib()._makeTemplData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteNo),
			{...dflts, no, status: statusNo, choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]}));
	});

	describe('_removeExistingVote', () => {
		const date = '2017-10-21T06:44:31Z';
		function test(sd, expectedRes, expectedSd) {
			deepEqual(ED._removeExistingVote(sd, 'me'), expectedRes);
			deepEqual(sd, expectedSd);
		}

		it('empty', () => test({}, false, {}));
		it('yes:me', () => test({yes: [{user: 'me', date}]},
			{groupId: 'yes', date}, {}));
		it('yes:me+1a', () => test({yes: [{user: 'me', date}, {user: 'usr2'}]},
			{groupId: 'yes', date}, {yes: [{user: 'usr2'}]}));
		it('yes:me+1b', () => test({yes: [{user: 'usr2'}, {user: 'me', date}]},
			{groupId: 'yes', date}, {yes: [{user: 'usr2'}]}));
		it('yes:me+2', () => test({yes: [{user: 'usr2'}, {user: 'me', date}], no: [{user: 'usr3'}]},
			{groupId: 'yes', date}, {yes: [{user: 'usr2'}], no: [{user: 'usr3'}]}));
	});
});
