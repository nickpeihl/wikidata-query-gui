EditorMarker = L.GeoJSON.extend({

	_options: {},

	initialize: function (data, options) {
		this._options = options;

		this._xmlParser = new X2JS();

		L.GeoJSON.prototype.initialize.call(this, data, {
			pointToLayer: L.Util.bind(this._pointToLayer, this),
			onEachFeature: L.Util.bind(this._onEachFeature, this),
		});

		// disable when to many markers (bad performance)
		this._disableMarkerResize = this.getLayers().length > 1000;

		this._templates = $.get('popup.mustache')
			.then(v => {
				const $v = $(v);
				return {
					popup: $v.filter('#popup').html(),
					wait: $v.filter('#wait').html(),
					error: $v.filter('#error').html(),
				};
			});
	},

	onZoomChange(zoom) {
		this._options.zoom = zoom;
		if (!this._disableMarkerResize) {
			this.setStyle({radius: this._radiusFromZoom(zoom)});
		}
	},

	_radiusFromZoom(zoom) {
		return zoom * 0.75;
	},

	_getStyleValue(feature) {
		const color =
			feature.saved ? '#008000'
				: (feature.noChanges ? '#68df0a'
				: (feature.rejected ? '#ff0000'
				: (feature.loaded ? '#00a3e4'
					: '#0600e0')));

		return {
			stroke: false,
			fillColor: color,
			fillOpacity: 0.9,
			radius: this._radiusFromZoom(this._options.zoom),
		};
	},

	_pointToLayer: function (feature, latlng) {
		return L.circleMarker(latlng, this._getStyleValue(feature));
	},

	_onEachFeature: function (feature, layer) {
		layer.bindPopup(null, {
			className: 'mapeditor',
			closeButton: false,
			maxWidth: 280,
			autoPan: false
		}).on('mouseover', e => {
			if (!this._click) {
				layer.openPopup();
			}
		}).on('mouseout', e => {
			if (!this._click) {
				layer.closePopup();
			}
		}).off('click').on('click', e => {
			if (this._click) {
				layer.closePopup();
			} else {
				this._click = true;
				layer.openPopup();
			}
		}).on('popupclose', e => {
			this._click = false;
		}).on('popupopen', e => {
			this._onPopupOpen(e, feature, layer);
		});
	},

	corrected: function (layer) {
		if (this.hasLayer(layer)) {
			this.removeLayer(layer);
		} else {
			this.eachLayer(l => {
				if (l.error_id === layer.error_id) {
					this.removeLayer(l);
				}
			});
		}
	},

	_onPopupOpen: function (e, feature, layer) {
		const popup = e.popup;
		const content = popup.getContent();
		if (content) {
			return;
		}

		this._templates.then((templates) => {
			const tmplData = this._genBaseTemplate(feature);
			popup.setContent($(Mustache.render(templates.wait, tmplData))[0]);
			popup.update();

			const loadData = () => {
				if (popup.isOpen()) {
					// Popup still open, download content
					this._getPopupContent(
						feature, layer
					).then(content => {
						popup.setContent(content);
					}).catch(err => {
						tmplData.error = this.errorToText(err);
						popup.setContent($(Mustache.render(templates.error, tmplData))[0]);
					});
				} else {
					popup.setContent(null);
				}
			};

			if (this._click) {
				loadData();
			} else {
				// Don't call API unless user views it longer than this time
				setTimeout(loadData, 60);
			}
		});
	},

	_disableContainer: function ($target, disable) {
		$target.find('*').prop('disabled', disable);
	},

	_getPopupContent: function (feature, layer) {
		return Promise.all([
			$.ajax({
				url: `${this._options.apiUrl}/api/0.6/${feature.id.uid}`,
				dataType: 'xml',
			}),
			this._templates
		]).then(vals => {
			const [rawData, templates] = vals;
			const xmlData = this._parseXmlObj(rawData, feature);
			const data = this._parseAndUpdateXml(xmlData, feature);
			const $content = $(Mustache.render(templates.popup, data));
			layer.setStyle(this._getStyleValue(feature));

			// Since we have two buttons, make sure they don't conflict
			let isUploading = false;

			$content.on('click', '.mpe-footer button', e => {
				e.preventDefault();
				const $errorDiv = $content.find('.mpe-error');

				if (this._options.zoom < 16) {
					$errorDiv.html('Editing from space is hard.<br>Zoom in to Edit.');
					return;
				}

				if (isUploading) {
					return; // safety
				}

				const $target = $(e.target);
				const type = $target.data('type');
				if (type !== 'accept' && type !== 'reject') {
					return; // safety
				}
				const isAccepting = type === 'accept';
				$errorDiv.text('');

				isUploading = true;
				this._disableContainer($target.parent(), true);
				$target.addClass('uploading');

				const server = this._options.osmauth;
				server.xhrAsync({
					method: 'PUT',
					path: '/api/0.6/changeset/create',
					content: this._createChangeSetXml(feature, isAccepting),
					options: {header: {'Content-Type': 'text/xml'}}
				}).then((changeSetId) => {
					// If rejecting, need to re-parse the original XML and add just the rejection tag
					const xmlData2 = isAccepting ? xmlData : this._parseXmlObj(rawData, feature);
					return server.xhrAsync({
						method: 'POST',
						path: `/api/0.6/changeset/${changeSetId}/upload`,
						content: this._createChangeXml(xmlData2, feature, changeSetId, isAccepting),
						options: {header: {'Content-Type': 'text/xml'}}
					}).then(() => server.xhrAsync({
						method: 'PUT',
						path: `/api/0.6/changeset/${changeSetId}/close`,
						options: {header: {'Content-Type': 'text/xml'}}
					})).then(() => {
						feature.saved = true;
						$content.off('click');

						const cssclass = isAccepting ? 'mpe-check' : 'mpe-stop';
						const symbol = isAccepting ? '✓' : '⛔';
						const text = isAccepting ? 'modified' : 'rejected';
						const url = server.options().url + '/changeset/' + changeSetId;

						const htmlDone = `<div class="mpe-uploaded">
<span class="${cssclass}">${symbol}</span>&nbsp;${text}  <a href="${url}">#${changeSetId}</a>
</div>`;

						$(e.target).parent().html(htmlDone);
						layer.setStyle(this._getStyleValue(feature));
					});
				}).catch((err) => {
					$errorDiv.text(this.errorToText(err));
					$target.removeClass('uploading');
					this._disableContainer($target.parent(), false);
					isUploading = false;
				});
			});

			return $content[0];
		});
	},

	errorToText: function (err) {
		try {
			// simplify debugging for the advanced users
			console.error(err);

			// Force to string
			return "" + ((err instanceof Error && err.toString()) || err.message ||
				err.statusText || err.responseText || (typeof err === 'string' && err) || err.toString());
		} catch (e) {
			return 'Unknown error';
		}
	},


	_genBaseTemplate: function (feature) {
		return {
			type: feature.id.type,
			id: feature.id.id,
			mainWebsite: this._options.baseUrl,
			url_help: 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service',
		};
	},

	_parseXmlObj: function (rawData, feature) {
		const parsed = this._xmlParser.dom2js(rawData);
		const xmlFeature = parsed.osm[feature.id.type];

		if (xmlFeature.tag === undefined) {
			xmlFeature.tag = [];
		} else if (!Array.isArray(xmlFeature.tag)) {
			// A feature with a single tag is parsed as an object
			xmlFeature.tag = [xmlFeature.tag];
		}

		return parsed;
	},

	_findTagIndex: function (xmlTags, tagName) {
		let i;
		for (i = 0; i < xmlTags.length; i++) {
			if (xmlTags[i]._k === tagName) break;
		}
		return i >= xmlTags.length ? -1 : i;
	},

	_parseAndUpdateXml: function (xmlData, feature) {
		const data = this._genBaseTemplate(feature);
		const xmlFeature = xmlData.osm[feature.id.type];
		const xmlTags = xmlFeature.tag;
		const tagsKV = {};
		const fixes = {
			add: [],
			mod: [],
			del: []
		};

		for (const v of xmlTags) {
			tagsKV[v._k] = v._v;
		}

		// Create an object for the diff element visualization in a template
		const makeTmplData = (k, v) => typeof v !== 'object' ? {k, v} : {k, v: v.value, vlink: v.vlink};

		for (const tagName of Object.keys(feature.properties)) {
			const tmpl = makeTmplData(tagName, feature.properties[tagName]);
			let oldValue = tagsKV[tagName];
			if (oldValue === tmpl.v) {
				// ignore - orignial is the same as the replacement
			} else if (oldValue !== undefined) {
				// Find the index of the original xml tag
				const tagInd = this._findTagIndex(xmlTags, tagName);
				if (tagInd === -1) {
					throw new Error(`Internal error: unable to find ${tagName} in ${feature.id.uid}`)
				}
				tmpl.oldv = oldValue;
				if (tmpl.v !== undefined) {
					fixes.mod.push(tmpl);
					xmlTags[tagInd]._v = tmpl.v;
				} else {
					fixes.del.push(tmpl);
					xmlTags.splice(tagInd, 1);
				}
				delete tagsKV[tagName];
			} else if (tmpl.v !== undefined) {
				fixes.add.push(tmpl);
				xmlTags.push({_k: tagName, _v: tmpl.v});
			}
		}

		data.tags = [];
		for (const k of Object.keys(tagsKV)) {
			data.tags.push(makeTmplData(k, tagsKV[k]));
		}

		data.version = xmlFeature._version;
		data.comment = feature.comment;
		data.rejectTag = this._options.rejectTag;
		data.queryId = this._options.queryId;

		if (fixes.add.length || fixes.mod.length || fixes.del.length) {
			data.fixes = fixes;
			feature.loaded = true;
		} else {
			feature.noChanges = true;
		}

		if (this._options.rejectTag) {
			const rejected = tagsKV[this._options.rejectTag];
			if (rejected) {
				const r = rejected.split(';');
				if (r.includes(this._options.queryId)) {
					feature.rejected = true;
					data.rejected = true;
				}
			}
		}

		return data;
	},

	_createChangeSetXml: function (feature, isAccepting) {
		let comment = feature.comment;
		if (!isAccepting) {
			comment = `REJECTING ${this._options.queryId}: ${comment}`;
		}
		return this._xmlParser.js2xml(
			{
				osm: {
					changeset: {
						_version: this._options.version,
						_generator: this._options.program,
						tag: [
							{_k: "created_by", _v: `${this._options.program} ${this._options.version}`},
							{_k: "comment", _v: comment}
						]
					}
				}
			}
		);
	},

	_createChangeXml: function (xmlData, feature, changeSetId, isAccepting) {

		const type = feature.id.type;
		const xmlFeature = xmlData.osm[type];

		xmlFeature._changeset = changeSetId;

		delete xmlFeature._timestamp;
		delete xmlFeature._visible;
		delete xmlFeature._user;
		delete xmlFeature._uid;

		if (!isAccepting) {
			const queryId = this._options.queryId;
			const rejectTag = this._options.rejectTag;
			const xmlTags = xmlFeature.tag;
			const rejectTagPos = this._findTagIndex(xmlTags, rejectTag);

			if (rejectTagPos < 0) {
				xmlTags.push({_k: rejectTag, _v: queryId})
			} else {
				let val = xmlTags[rejectTagPos]._v.trim();
				if (val) {
					val += ';' + queryId;
				}
				xmlTags[rejectTagPos]._v = val;
			}
		}

		return this._xmlParser.js2xml(
			{
				osmChange: {
					modify: {
						[type]: xmlFeature
					}
				}
			}
		);
	},

});
