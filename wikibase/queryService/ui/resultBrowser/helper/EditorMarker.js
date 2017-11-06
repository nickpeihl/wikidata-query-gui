var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};
wikibase.queryService.ui.resultBrowser.helper = wikibase.queryService.ui.resultBrowser.helper || {};

wikibase.queryService.ui.resultBrowser.helper.EditorMarker = L.GeoJSON.extend({

	_options: {},

	initialize: function (data, options) {
		this._zoom = options.zoom;
		this._ed = options.editorData;
		this._resultBrowser = options.resultBrowser;

		L.GeoJSON.prototype.initialize.call(this, data, {
			pointToLayer: L.Util.bind(this._pointToLayer, this),
			onEachFeature: L.Util.bind(this._onEachFeature, this),
		});

		// disable when to many markers (bad performance)
		this._disableMarkerResize = this.getLayers().length > 1000;
	},

	onZoomChange(zoom) {
		this._zoom = zoom;
		const $map = $('#map');
		if (zoom >= this._ed.minZoom) {
			$map.removeClass('hideEdit');
		} else {
			$map.addClass('hideEdit');
		}
		if (!this._disableMarkerResize) {
			this.setStyle({radius: this._radiusFromZoom(zoom)});
		}
	},

	_radiusFromZoom(zoom) {
		return zoom * 0.75;
	},

	_getStyleValue(geojson) {
		return {
			stroke: false,

			fillColor: {
				loaded: '#00a3e4',
				noChanges: '#ded335',
				rejected: '#ff0000',
				voted: '#68df0a',
				saved: '#008000',
			}[geojson.status] || '#0600e0',

			fillOpacity: 0.9,
			radius: this._radiusFromZoom(this._zoom),
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

	_onPopupOpen: async function (e, geojson, layer) {
		const popup = e.popup;
		const content = popup.getContent();
		if (content && geojson.resetVersion === this._ed.resetVersion) {
			return;
		}

		const tmplData = this._ed.genBaseTemplate(geojson.id);
		popup.setContent(this._ed.renderTemplate('wait', tmplData));
		popup.update();

		const loadData = async () => {
			if (geojson.loadingFlag) return;
			try {
				// Popup still open, download content. Prevent multi-loading
				geojson.loadingFlag = true;
				await this._setPopupContent(popup, geojson, layer);
				geojson.loaded = true;
			} catch (err) {
				tmplData.error = this.errorToText(err);
				popup.setContent(this._ed.renderTemplate('error', tmplData));
			} finally {
				geojson.loadingFlag = false;
			}
		};

		if (this._click) {
			loadData();
		} else {
			// Don't call API unless user views it longer than this time
			setTimeout(() => popup.isOpen() ? loadData() : popup.setContent(null), 70);
		}
	},

	_disableContainer: function ($target, disable) {
		$target.find('*').prop('disabled', disable);
	},

	_setPopupContent: async function (popup, geojson, layer) {
		const parsedResult = await this._ed.downloadAndParse(geojson);
		const {newXml, templateData, status} = this._ed.makeTemplateData(parsedResult);
		geojson.status = status;
		layer.setStyle(this._getStyleValue(geojson));

		// Ensure multiple buttons don't conflict
		let isUploading = false;
		const $content = $(this._ed.renderPopupTemplate(templateData));
		const $errorDiv = $content.find('.mpe-action-error');

		$content.on('click', 'button', async (e) => {
			if (isUploading || e.target.tagName !== 'BUTTON') {
				console.error(isUploading, e.target);
				return;
			} // safety

			const $target = $(e.target);
			const $popup = $target.closest('.mpe');
			const action = $target.data('action');
			const groupId = $target.data('group');

			try {
				isUploading = true;
				$errorDiv.text('');
				this._disableContainer($popup, true);
				$target.addClass('uploading');

				switch (action) {
					case 'save':
						await this._ed.saveFeatureToOSM(newXml[groupId], geojson.id);
						const {templateData, status} = this._ed.makeTemplateData(parsedResult, groupId);
						geojson.status = status;
						popup.setContent(this._ed.renderPopupTemplate(templateData));
						layer.setStyle(this._getStyleValue(geojson));
						break;
					case 'vote':
					case 'no':
						await this._ed.saveMyVote(geojson.id.uid, groupId);
						break;
					case 'unvote':
						await this._ed.saveMyVote(geojson.id.uid);
						break;
					default:
						throw new Error(`Unexpected type ${type}`);
				}

				$content.off('click');
				if (action !== 'save') {
					await this._setPopupContent(popup, geojson, layer);
				}
			} catch (err) {
				$errorDiv.text(this.errorToText(err));
			} finally {
				$target.removeClass('uploading');
				this._disableContainer($popup, false);
				isUploading = false;
			}
		});

		// $popup.html($content);
		popup.setContent($content[0]);
	},

	errorToText: function (err) {
		try {
			// simplify debugging for the advanced users
			console.error(err);

			// Force to string
			return "" + ((err instanceof Error && err.toString()) || err.message || err.statusText || err.responseText
				|| (typeof err === 'string' && err)
				|| (err instanceof ProgressEvent && err.type === 'error' && 'Network error')
				|| err.toString());
		} catch (e) {
			return 'Unknown error';
		}
	},

});
