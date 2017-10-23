var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};
wikibase.queryService.ui.resultBrowser.helper = wikibase.queryService.ui.resultBrowser.helper || {};

wikibase.queryService.ui.resultBrowser.helper.EditorMarker = L.GeoJSON.extend({

	_options: {},

	initialize: function (data, options) {
		this._options = options;

		this._xmlParser = new X2JS();
		this._editorData = new wikibase.queryService.ui.resultBrowser.helper.EditorData(this._options);

		L.GeoJSON.prototype.initialize.call(this, data, {
			pointToLayer: L.Util.bind(this._pointToLayer, this),
			onEachFeature: L.Util.bind(this._onEachFeature, this),
		});

		// disable when to many markers (bad performance)
		this._disableMarkerResize = this.getLayers().length > 1000;

		this._templates = options.templates;
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

	_getStyleValue(geojson) {
		const color =
			geojson.saved ? '#008000'
				: (geojson.noChanges ? '#68df0a'
				: (geojson.rejected ? '#ff0000'
				: (geojson.loaded ? '#00a3e4'
					: '#0600e0')));

		return {
			stroke: false,
			fillColor: color,
			fillOpacity: 0.9,
			radius: this._radiusFromZoom(this._options.zoom),
		};
	},

	_pointToLayer: function (geojson, latlng) {
		return L.circleMarker(latlng, this._getStyleValue(geojson));
	},

	_onEachFeature: function (geojson, layer) {
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
			this._onPopupOpen(e, geojson, layer);
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

	_onPopupOpen: async function (e, geojson, layer) {
		const popup = e.popup;
		const content = popup.getContent();
		if (content) {
			return;
		}

		const templates = await this._templates;
		const tmplData = this._editorData.genBaseTemplate(geojson);
		popup.setContent($(Mustache.render(templates.wait, tmplData))[0]);
		popup.update();

		const loadData = async () => {
			if (popup.isOpen()) {
				try {
					// Popup still open, download content
					const content = await this._getPopupContent(geojson, layer);
					popup.setContent(content);
				} catch (err) {
					tmplData.error = this.errorToText(err);
					popup.setContent($(Mustache.render(templates.error, tmplData))[0]);
				}
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
	},

	_disableContainer: function ($target, disable) {
		$target.find('*').prop('disabled', disable);
	},

	_downloadOsmData: async function (geojson) {
		const rawData = await $.ajax({
			url: `${this._options.apiUrl}/api/0.6/${geojson.id.uid}`,
			dataType: 'xml',
		});

		return this._xmlParser.dom2js(rawData);
	},

	_getPopupContent: async function (geojson, layer) {
		const [templates, xmlData, serviceData] = await Promise.all([
			this._templates,
			this._downloadOsmData(geojson),
			this._editorData.downloadServiceData(geojson),
		]);

		const xmlObj = xmlData.osm[geojson.id.type];
		const templateData = this._editorData.parseXmlTags(xmlObj, geojson);
		this._editorData.setButtonsText(templateData, xmlObj, serviceData);

		const $content = $(Mustache.render(templates.popup, templateData));
		layer.setStyle(this._getStyleValue(geojson));

		// Since we have two buttons, make sure they don't conflict
		let isUploading = false;

		$content.on('click', '.mpe-footer button', async (e) => {
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
			if (type !== 'accept' && type !== 'reject' && type !== 'vote') {
				return; // safety
			}
			$errorDiv.text('');

			try {
				isUploading = true;
				this._disableContainer($target.parent(), true);
				$target.addClass('uploading');

				let cssClass, symbol, text, changeSetId;
				switch (type) {
					case 'accept':
						changeSetId = await this._editorData.uploadChangeset(geojson, xmlData);
						cssClass = 'mpe-check';
						symbol = '💾';
						text = 'modified';
						break;
					case 'vote':
						await this._editorData.saveToService(geojson, 'yes');
						cssClass = 'mpe-check';
						symbol = '✓';
						text = 'voted';
						break;
					case 'reject':
						await this._editorData.saveToService(geojson, 'no');
						cssClass = 'mpe-stop';
						symbol = '⛔';
						text = 'rejected';
						break;
				}

				geojson.saved = true;
				$content.off('click');

				let csLink = '';
				if (changeSetId) {
					csLink = ` <a href="${config.api.osm.baseurl}/changeset/${changeSetId}">#${changeSetId}</a>`;
				}
				const htmlDone = `<div class="mpe-uploaded"><span class="${cssClass}">${symbol}</span>&nbsp;${text}${csLink}</div>`;

				$(e.target).parent().html(htmlDone);
				layer.setStyle(this._getStyleValue(geojson));
			} catch (err) {
				$errorDiv.text(this.errorToText(err));
				$target.removeClass('uploading');
				this._disableContainer($target.parent(), false);
				isUploading = false;
			}
		});

		return $content[0];
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

});
