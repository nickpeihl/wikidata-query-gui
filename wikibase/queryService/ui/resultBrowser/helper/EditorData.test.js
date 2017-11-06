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
				vote: opts.vote !== undefined ? opts.vote : false,
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

	function newXml(tags) {
		return {tag: ED._objToAttr(tags)};
	}

	it('changeset xml', () => {
		const lib = newLib();
		const xml = lib._createChangesetXml();

		// language=HTML
		assert.equal(xml, `<osm><changeset version="42.0.0" generator="Tester">` +
			`<tag k="created_by" v="Tester 42.0.0" />` +
			`<tag k="comment" v="${comment}" />` +
			`<tag k="task_id" v="${taskId}" />` +
			`<tag k="imagery_used" v="${baseLayer}" />` +
			`</changeset></osm>`);
	});

	it('change xml', () => {
		const lib = newLib();
		lib._changesetId = '123';
		const xml = lib._createChangeXml(
			{
				"_id": "4307334408",
				"_changeset": "100",
				"_timestamp": "2017-11-03T23:09:18Z",
				"_version": "8",
				"_visible": "true",
				"_user": "nyuriks",
				"_uid": "6041",
				"_lat": "40.7209106",
				"_lon": "-73.9919976",
				tag: [
					{_k: 'a', _v: 'b'}
				]
			}, 'node');

		deepEqual(xml, '<osmChange><modify>' +
			'<node id="4307334408" changeset="123" timestamp="2017-11-03T23:09:18Z" version="8" visible="true" user="nyuriks" uid="6041" lat="40.7209106" lon="-73.9919976">' +
			'<tag k="a" v="b" />' +
			'</node>' +
			'</modify></osmChange>');
	});

	it('_findTagIndex', () => {
		assert.throws(() => ED._findTagIndex([], 'foo'));
		assert.throws(() => ED._findTagIndex([{}], 'foo'));
		assert.equal(ED._findTagIndex([{_k: 'foo'}], 'foo'), 0);
		assert.equal(ED._findTagIndex([{_k: 'bar'}, {_k: 'foo'}], 'foo'), 1);
	});

	it('_objToAttr', () => {
		deepEqual(ED._objToAttr({}), []);
		deepEqual(
			ED._objToAttr({a: 'aab', b: 'bbb'}),
			[{_k: 'a', _v: 'aab'}, {_k: 'b', _v: 'bbb'}]
		);
	});

	describe('_createChoices', () => {

		let test = (oldTags, choices, votes, expectedData, labels) => {
			const columns = [];
			if (labels) {
				Object.keys(labels).forEach(v => {
					columns.push(v + 't1');
					columns.push(v + 'v1')
				});
			}
			const lib = newLib({labels, vote: true, columns});
			const actual = lib._createChoices(newXml(oldTags), choices, votes);
			deepEqual(actual, expectedData);
		};

		it('empty', () => test({}, [], {}, []));
		it('empty - throws', () => assert.throws(() => test({}, [], {yes: []}, [])));

		it('no change', () => test(
			{foo: 'bar'},
			{yes: {foo: 'bar'}},
			{},
			{common: [{k: 'foo', v: 'bar'}]}
		));

		it('add', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{},
			{
				choices: [{
					add: [{k: 'a', v: 'foo'}],
					label: 'this change',
					groupId: 'yes',
				}],
				common: [{k: 'b', v: 'bar'}],
				newXml: {yes: newXml({b: 'bar', a: 'foo'})},
				noChoice: {groupId: 'no', label: 'no'},
			}
		));

		it('mod', () => test(
			{a: 'bar'},
			{yes: {a: 'foo'}},
			{},
			{
				choices: [{
					mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
					label: 'this change',
					groupId: 'yes',
				}],
				newXml: {yes: newXml({a: 'foo'})},
				noChoice: {groupId: 'no', label: 'no'},
			}
		));

		it('del', () => test(
			{a: 'foo'},
			{yes: {a: undefined}},
			{},
			{
				choices: [{
					del: [{k: 'a', oldv: 'foo', v: undefined}],
					label: 'this change',
					groupId: 'yes',
				}],
				newXml: {yes: newXml({})},
				noChoice: {groupId: 'no', label: 'no'},
			}
		));

		it('multi', () => test(
			{a: 'aaa', b: 'bbb', c: 'ccc'},
			{
				a: {a: 'aab', d: 'ddd', c: undefined},
				b: {b: 'bbc', e: 'eee', a: undefined}
			},
			{},
			{
				choices: [{
					add: [{k: 'd', v: 'ddd'}],
					mod: [{k: 'a', oldv: 'aaa', v: 'aab'}],
					del: [{k: 'c', oldv: 'ccc', v: undefined}],
					unchanged: [{k: 'b', v: 'bbb'}],
					groupId: 'a',
					label: 'group a',
				}, {
					add: [{k: 'e', v: 'eee'}],
					mod: [{k: 'b', oldv: 'bbb', v: 'bbc'}],
					del: [{k: 'a', oldv: 'aaa', v: undefined}],
					unchanged: [{k: 'c', v: 'ccc'}],
					groupId: 'b',
					label: 'group b',

				}],
				newXml: {a: newXml({a: 'aab', b: 'bbb', d: 'ddd'}), b: newXml({b: 'bbc', c: 'ccc', e: 'eee'})},
				noChoice: {groupId: 'no', label: 'no'},
			},
			{a: 'group a', b: 'group b'}
		));

		it('votes - yes', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{yes: [{user: 'usr1'}, {user: 'usr2'}]},
			{
				newXml: {yes: newXml({b: 'bar', a: 'foo'})},
				noChoice: {
					groupId: 'no', label: 'no', nays: [{user: 'usr1'}, {user: 'usr2'}]
				},
				common: [{k: 'b', v: 'bar'}],
				choices: [{
					add: [{k: 'a', v: 'foo'}],
					label: 'this change',
					groupId: 'yes',
					yeas: [{user: 'usr1'}, {user: 'usr2'}]
				}],
			}
		));


		it('votes - no', () => test(
			{b: 'bar'},
			{yes: {a: 'foo'}},
			{yes: [{user: 'usr1'}], no: [{user: 'usr2'}, {user: 'usr3'}]},
			{
				choices: [{
					add: [{k: 'a', v: 'foo'}],
					label: 'this change',
					groupId: 'yes',
					nays: [{user: 'usr2'}, {user: 'usr3'}],
					yeas: [{user: 'usr1'}],
				}],
				common: [{k: 'b', v: 'bar'}],
				newXml: {yes: newXml({b: 'bar', a: 'foo'})},
				noChoice: {
					groupId: 'no',
					label: 'no',
					nays: [{user: 'usr1'}],
					yeas: [{user: 'usr2'}, {user: 'usr3'}]
				},
			}
		));

		it('votes - multi', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{b: [{user: 'usr1'}, {user: 'usr2'}]},
			{
				choices: [{
					mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
					groupId: 'a',
					label: 'group a',
					nays: [{user: 'usr1'}, {user: 'usr2'}],
				}, {
					mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
					groupId: 'b',
					label: 'group b',
					yeas: [{user: 'usr1'}, {user: 'usr2'}],
				}],
				newXml: {a: newXml({a: 'bbb'}), b: newXml({a: 'ccc'})},
				noChoice: {
					groupId: 'no', label: 'no', nays: [{user: 'usr1'}, {user: 'usr2'}],
				},
			},
			{a: 'group a', b: 'group b'}
		));

		it('votes - multi-no', () => test(
			{a: 'aaa'},
			{a: {a: 'bbb'}, b: {a: 'ccc'}},
			{b: [{user: 'usr1'}, {user: 'usr2'}], no: [{user: 'usr3'}]},
			{
				choices: [{
					mod: [{k: 'a', oldv: 'aaa', v: 'bbb'}],
					groupId: 'a',
					label: 'group a',
					nays: [{user: 'usr1'}, {user: 'usr2'}, {user: 'usr3'}],
				}, {
					mod: [{k: 'a', oldv: 'aaa', v: 'ccc'}],
					groupId: 'b',
					label: 'group b',
					nays: [{user: 'usr3'}],
					yeas: [{user: 'usr1'}, {user: 'usr2'}],
				}],
				newXml: {a: newXml({a: 'bbb'}), b: newXml({a: 'ccc'})},
				noChoice: {
					groupId: 'no', label: 'no',
					nays: [{user: 'usr1'}, {user: 'usr2'}],
					yeas: [{user: 'usr3'}],
				},
			},
			{a: 'group a', b: 'group b'}
		));

	});

	describe('_parseVotes', () => {
		it('empty', () => {
			deepEqual(ED._parseVotes({results: {bindings: []}}), {});
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
			deepEqual(ED._parseVotes(rawData), {
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
			deepEqual(ED._parseVotes(rawData), {
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
				t1: {type: 'literal', value: 'tag1'},
				v1: {type: 'literal', value: 'val1'}
			};

			const actual = newLib({columns: ['t1', 'v1']})._parseRow(row);

			deepEqual(actual, {yes: {tag1: 'val1'}});
		});

		it('multiple values', () => {
			const row = {
				at1: {type: 'literal', value: 'tag1'},
				av1: {type: 'literal', value: 'val1'},
				bt1: {type: 'literal', value: 'tag2'},
				bv1: {type: 'literal', value: 'val2'}
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
				type: 'uri',
				value: 'https://www.openstreetmap.org/node/123'
			},
			loc: {
				datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral',
				type: 'literal',
				value: 'Point(-75.0 43.0)'
			}
		};
		deepEqual(ED.parseFeature(rdfRow),
			{
				coordinates: [-75, 43],
				id: {id: '123', type: 'node', uid: 'node/123'},
				type: 'Point',
				rdfRow
			}
		);
	});

	describe('_makeTemplateData', () => {
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
			title: 'You have voted for this change on 2017-10-21T06:44:31Z.',
			icon: '⛔',
		};

		const featureId = {type: 'node', id: '123', version: 42};

		const resultNothing = {
			result: {
				resultText: 'There are no changes for this feature.',
				title: 'This task does not have any changes that can be applied to this feature.',
			}
		};

		const dflts = {mainWebsite, taskId, url_help, comment, ...featureId};
		const dfltsUnch = {mainWebsite, taskId, url_help, comment, ...featureId, ...resultNothing};
		const dfltsNT = {mainWebsite, url_help, comment, ...featureId};
		const dfltsNTUnch = {mainWebsite, url_help, comment, ...featureId, ...resultNothing};

		const vote = {vote: true};
		const voteNo = {no: [{user: 'usrNo', date: 'usrNo date'}]};
		const voteYes = {yes: [{user: 'usrYes', date: 'usrYes date'}]};
		const voteA = {a: [{user: 'usr1', date: 'usr1 date'}]};
		const myNo = {groupId: 'no', date: date1};
		const myYes = {groupId: 'yes', date: date1};
		const myA = {groupId: 'a', date: date1};

		const unchanged = [{unchanged: [{k: 'foo', v: 'bar'}]}];
		const mods = {
			newXml: newXml({a: 'foo'}),
			mod: [{k: 'a', oldv: 'bar', v: 'foo'}],
		};
		const mods2 = {
			newXml: newXml({a: 'foo2'}),
			mod: [{k: 'a', oldv: 'bar', v: 'foo2'}],
		};
		const changeBtn = {btnLabel: 'Change', groupId: 'yes', btnClass: 'vote', resultText: 'Blah'};
		const rejClass = {itemClass: 'mpe-item-rejected'};

		it('empty', () => deepEqual(newLib()._makeTemplateData(featureId, [], {}), dfltsUnch));
		it('VT empty', () => deepEqual(newLib(vote)._makeTemplateData(featureId, [], {}), dfltsUnch));
		it('NT empty', () => deepEqual(newLib({taskId: false})._makeTemplateData(featureId, [], {}), dfltsNTUnch));
		it('VT empty+no', () => deepEqual(newLib(vote)._makeTemplateData(featureId, [], voteNo), dfltsUnch));
		it('VT empty+yes', () => deepEqual(newLib(vote)._makeTemplateData(featureId, [], voteYes), dfltsUnch));

		it('unchanged', () => deepEqual(
			newLib()._makeTemplateData(featureId, unchanged, {}),
			{...dfltsUnch, choices: unchanged}));
		it('NT unchanged', () => deepEqual(
			newLib({taskId: false})._makeTemplateData(featureId, unchanged, {}),
			{...dfltsNTUnch, choices: unchanged}));
		it('unchanged+no', () => deepEqual(
			newLib()._makeTemplateData(featureId, unchanged, voteNo),
			{...dfltsUnch, choices: unchanged}));
		it('unchanged+yes', () => deepEqual(
			newLib()._makeTemplateData(featureId, unchanged, voteYes),
			{...dfltsUnch, choices: unchanged}));
		it('VT unchanged+yes', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, unchanged, voteYes),
			{...dfltsUnch, choices: unchanged}));

		const modChoices = [{...changeBtn, ...mods}];
		it('mod', () => deepEqual(
			newLib()._makeTemplateData(featureId, modChoices, {}),
			{...dflts, choices: modChoices, no}));
		it('NT mod', () => deepEqual(
			newLib({taskId: false})._makeTemplateData(featureId, modChoices, {}),
			{...dfltsNT, comment, choices: modChoices}));
		it('VT mod+no', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, modChoices, voteNo),
			{...dflts, choices: modChoices, no, result: statusNo}));
		it('VT mod+my no', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, modChoices, {}, myNo),
			{...dflts, choices: modChoices, no, result: statusMeNo, canUnvote: true}));
		it('VT mod+yes', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, modChoices, voteYes),
			{...dflts, choices: modChoices, no: {...no, nays: 'User usrYes has voted for another choice.'}}));
		it('VT mod+my yes', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, modChoices, {}, myYes),
			{
				...dflts, choices: modChoices, no, canUnvote: true, result: {
				btnClass: 'vote',
				btnLabel: 'Change',
				groupId: 'yes',
				resultText: 'Blah',
				title: 'You have voted for this change on 2017-10-21T06:44:31Z.',
			}
			}));
		it('mod', () => deepEqual(
			newLib()._makeTemplateData(featureId, modChoices, {}),
			{...dflts, choices: modChoices, no}));
		it('mod+yes', () => deepEqual(
			newLib()._makeTemplateData(featureId, modChoices, voteYes),
			{...dflts, choices: modChoices, no: {...no, nays: 'User usrYes has voted for another choice.'}}));

		it('mod choices', () => deepEqual(
			newLib()._makeTemplateData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], {}),
			{...dflts, no, choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]}));
		it('VT mod choices+no', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteNo),
			{...dflts, no, result: statusNo, choices: [{...changeBtn, ...mods, ...rejClass}, {...changeBtn, ...mods2, ...rejClass}]}));
		it('VT mod choices+yes', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteA),
			{
				...dflts, no: {...no, nays: 'User usr1 has voted for another choice.'},
				choices: [{...changeBtn, ...mods}, {...changeBtn, ...mods2}]
			}));
		it('VT mod choices+my no', () => deepEqual(
			newLib(vote)._makeTemplateData(featureId, [{...changeBtn, ...mods}, {...changeBtn, ...mods2}], voteNo),
			{...dflts, no, result: statusNo, choices: [{...changeBtn, ...mods, ...rejClass}, {...changeBtn, ...mods2, ...rejClass}]}));
	});

	describe('_removeMyVote', () => {
		const date = '2017-10-21T06:44:31Z';

		function test(sd, expectedRes, expectedSd) {
			deepEqual(ED._removeMyVote(sd, 'me'), expectedRes);
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

	describe('_extractCommonUnchanged', () => {
		function test(choices, expectedRes, expectedChoices) {
			deepEqual(ED._extractCommonUnchanged(choices), expectedRes, 'result');
			deepEqual(choices, expectedChoices, 'choices');
		}

		it('empty', () => test([], false, []));
		it('single', () => test([{}], false, [{}]));
		it('single-empty', () => test([{unchanged: []}], false, [{unchanged: []}]));
		const k1 = {k: 'a', v: 'b'};
		const k2 = {k: 'b', v: 'c'};
		it('k1', () => test([{unchanged: [k1]}], [k1], [{}]));
		it('k2', () => test([{unchanged: [k1, k2]}], [k1, k2], [{}]));
		it('2-k', () => test([{unchanged: [k1]}, {unchanged: [k1, k2]}], [k1], [{}, {unchanged: [k2]}]));
		it('2-k2', () => test([{unchanged: [k1, k2]}, {unchanged: [k1, k2]}], [k1, k2], [{}, {}]));
		it('2-k2', () => test([{unchanged: [k1]}, {unchanged: [k2]}], false, [{unchanged: [k1]}, {unchanged: [k2]}]));
	});
});
