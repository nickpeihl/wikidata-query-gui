OsmoseMarker = L.GeoJSON.extend({

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

		this._btnTextSave = 'Save!';
		this._btnTextLoginAndSave = 'Log in & save!';
		this._mainWebsite = 'https://www.openstreetmap.org';
	},

	onZoomChange(zoom) {
		if (!this._disableMarkerResize) {
			this.setStyle({radius: this._radiusFromZoom(zoom)});
		}
	},

	_radiusFromZoom(zoom) {
		return zoom * 0.75;
	},

	_getStyleValue(feature) {
		const color =
			feature.saved
				? '#008000'
				: (feature.noChanges ? '#0000ff'
				: '#e04545');
		return {
			color: color,
			opacity: 0.8,
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
			$(content)
				.find('.mpe-save-btn')
				.text(this._options.osmauth.authenticated() ? this._btnTextSave : this._btnTextLoginAndSave);
			return;
		}

		this._templates.then((templates) => {
			const tmplData = this._genBaseTemplate(feature);
			popup.setContent($(Mustache.render(templates.wait, tmplData))[0]);
			popup.update();

			// Don't call API unless user views it over 100ms
			setTimeout(() => {
				if (popup.isOpen) {
					// Popup still open, so download content
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
			}, 100);
		});
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
			const xmlData = this._xmlParser.dom2js(rawData);

			const data = this._parseAndUpdateXml(xmlData, feature);
			const $content = $(Mustache.render(templates.popup, data));
			if (feature.noChanges) {
				// We just found out that it hasn't changed
				layer.setStyle(this._getStyleValue(feature));
			}

			let isUploading = false;

			$content.one('click', '.mpe-save-btn', e => {
				e.preventDefault();
				if (isUploading) return;
				isUploading = true;
				$(e.target).prop('disabled', true);

				const server = this._options.osmauth;
				server.xhrAsync({
					method: 'PUT',
					path: '/api/0.6/changeset/create',
					content: this._createChangeSetXml(feature),
					options: {header: {'Content-Type': 'text/xml'}}
				}).then((changeSetId) => {
					return server.xhrAsync({
						method: 'POST',
						path: `/api/0.6/changeset/${changeSetId}/upload`,
						content: this._createChangeXml(xmlData, feature, changeSetId),
						options: {header: {'Content-Type': 'text/xml'}}
					}).then(() => server.xhrAsync({
						method: 'PUT',
						path: `/api/0.6/changeset/${changeSetId}/close`,
						options: {header: {'Content-Type': 'text/xml'}}
					})).then(() => {
						feature.saved = true;
						$content.off('click');
						const htmlDone = `<div class="mpe-saved">
<span class="mpe-savedcheck">✓</span> saved
<a href="${server.options().url}/changeset/${changeSetId}">#${changeSetId}</a>
</div>`;
						$(e.target).parent().html(htmlDone);
						layer.setStyle(this._getStyleValue(feature));
					});
				}).catch((err) => {
					$content
						.find('.mpe-error')
						.text(this.errorToText(err));
					$(e.target).removeProp('disabled');
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
			mainWebsite: this._mainWebsite,
			url_help: 'https://wiki.openstreetmap.org/wiki/Wikidata%2BOSM_SPARQL_query_service',
		};
	},

	_parseAndUpdateXml: function (xmlData, feature) {
		const data = this._genBaseTemplate(feature);
		const xmlFeature = xmlData.osm[feature.id.type];
		const tagsKV = {};
		const fixes = {
			add: [],
			mod: [],
			del: []
		};

		let xmlTags = xmlFeature.tag;
		if (xmlTags === undefined) {
			xmlTags = [];
			xmlFeature.tag = xmlTags;
		} else if (!Array.isArray(xmlTags)) {
			// A feature with a single tag is parsed as an object
			xmlTags = [xmlTags];
			xmlFeature.tag = xmlTags;
		}
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
				let tagInd;
				for (tagInd = 0; tagInd < xmlTags.length; tagInd++) {
					if (xmlTags[tagInd]._k === tagName) break;
				}
				if (tagInd >= xmlTags.length) {
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
		data.saveText = this._options.osmauth.authenticated() ? this._btnTextSave : this._btnTextLoginAndSave;

		if (fixes.add.length || fixes.mod.length || fixes.del.length) {
			data.fixes = fixes;
		} else {
			feature.noChanges = true;
		}

		return data;
	},

	_createChangeSetXml: function (feature) {
		return this._xmlParser.js2xml(
			{
				osm: {
					changeset: {
						_version: this._options.version,
						_generator: this._options.program,
						tag: [
							{_k: "created_by", _v: `${this._options.program} ${this._options.version}`},
							{_k: "comment", _v: feature.comment}
						]
					}
				}
			}
		);
	},

	_createChangeXml: function (xmlData, feature, changeSetId) {
		const type = feature.id.type;
		const osmObj = xmlData.osm[type];
		osmObj._changeset = changeSetId;

		delete osmObj._timestamp;
		delete osmObj._visible;
		delete osmObj._user;
		delete osmObj._uid;

		return this._xmlParser.js2xml(
			{
				osmChange: {
					modify: {
						[type]: osmObj
					}
				}
			}
		);
	},

});
