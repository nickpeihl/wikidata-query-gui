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
			$map.removeClass('disableEdit');
		} else {
			$map.addClass('disableEdit');
		}
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
		if (content) {
			return;
		}

		const tmplData = this._ed.genBaseTemplate(geojson.id);
		popup.setContent(this._ed.renderTemplate('wait', tmplData));
		popup.update();

		const loadData = async () => {
			try {
				// Popup still open, download content
				await this._setPopupContent(popup, geojson, layer);
			} catch (err) {
				tmplData.error = this.errorToText(err);
				popup.setContent(this._ed.renderTemplate('error', tmplData));
			}
		};

		if (this._click) {
			await loadData();
		} else {
			// Don't call API unless user views it longer than this time
			setTimeout(() => popup.isOpen() ? loadData() : popup.setContent(null), 70);
		}
	},

	_disableContainer: function ($target, disable) {
		$target.find('*').prop('disabled', disable);
	},

	_setPopupContent: async function (popup, geojson, layer) {
		const {$content, choices, templateData} = await this._ed.renderPopupHtml(geojson);
		layer.setStyle(this._getStyleValue(geojson));

		// Since we multiple buttons, make sure they don't conflict
		let isUploading = false;
		const $errorDiv = $content.find('.mpe-action-error');

		$content.on('click', 'button', async (e) => {
			e.preventDefault();
			if (isUploading) return; // safety

			const $target = $(e.target);
			const groupId = $target.data('group');
			if (!groupId) return;

			try {
				isUploading = true;
				$errorDiv.text('');
				this._disableContainer($target.parent(), true);
				$target.addClass('uploading');

				let changesetId;
				if ($target.data('type') === 'save') {
					const choice = choices.filter(c => c.groupId === groupId)[0];
					changesetId = await this._ed.uploadChangeset(choice.newXml, geojson.id.type);
				} else {
					await this._ed.saveToService(geojson.id.uid, groupId);
				}

				popup.setContent(this._ed.getUpdatedContent(templateData, groupId, changesetId));

				geojson.saved = true;
				layer.setStyle(this._getStyleValue(geojson));

				$content.off('click'); // This might not even be needed after popup content is set
			} catch (err) {
				isUploading = false;
				$errorDiv.text(this.errorToText(err));
				$target.removeClass('uploading');
				this._disableContainer($target.parent(), false);
			}
		});

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
