var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};

wikibase.queryService.ui.resultBrowser.EditorResultBrowser = ( function( $, L, d3, window, config, EditorMarker, EditorData ) {
	'use strict';

	const TILE_LAYER = {
		'OpenStreetMap (Standard)': {
			url: 'http://{s}.tile.osm.org/{z}/{x}/{y}.png',
			options: {
				attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
			}
		},
		'Wikimedia': {
			url: 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png',
			options: {
				id: 'wikipedia-map-01',
				attribution: ' <a href="http://maps.wikimedia.org/">Wikimedia</a> | &copy; <a href="http://openstreetmap.org/copyright">Open Street Map</a> contributors'
			}
		},
		'MapBox Satellite': {
			url: '//{s}.tiles.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoieXVyaWsiLCJhIjoiOGFabWI0ZyJ9.hHX02Xu24V9KA48UetvNAA',
			options: {
				attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a>',
				maxNativeZoom: 16
			}
		}
	};

	/**
	 * A result browser for long lat coordinates
	 *
	 * @class wikibase.queryService.ui.resultBrowser.EditorResultBrowser
	 * @licence GNU GPL v2+
	 *
	 * @author Jonas Kress
	 * @author Katie Filbert
	 * @author Yuri Astrakhan
	 * @constructor
	 *
	 */
	function SELF() {
	}

	SELF.prototype = new wikibase.queryService.ui.resultBrowser.AbstractResultBrowser();

	/**
	 * @property {L.Map}
	 * @private
	 **/
	SELF.prototype._map = null;

	/**
	 * @property {Object}
	 * @private
	 **/
	SELF.prototype._markerLayer = null;

	/**
	 * Draw a map to the given element
	 *
	 * @param {jQuery} $element target element
	 */
	SELF.prototype.draw = async function( $element ) {
		const result = this._result;
		if (result.results.bindings.length === 0) {
			throw new Error('Nothing found!');
		}

		const $toolbar = $('<div>');
		this._ed = new EditorData({
			queryOpts: this._options,
			config,
			columns: result.head.vars,
			$toolbar
		});

		const [rawTemplates, userInfo] = await Promise.all([
			$.get('popup.mustache'),
			this._ed.getUserInfoAsync(false),
			this._ed.findOpenChangeset(),  // the result is cached
		]);

		const templates = {};
		$(rawTemplates).each((id, item) => {
			if (item.id) {
				templates[item.id] = $(item).html();
			}
		});
		this._ed.init(templates);

		let center = [0, 0];
		if (userInfo && userInfo.home) {
			center = [userInfo.home.lon, userInfo.home.lat];
		}

		this._markerLayer = new EditorMarker({
			"type": "FeatureCollection",
			"features": result.results.bindings.map(EditorData.parseFeature)
		}, {
			zoom: this._getSafeZoom(),
			editorData: this._ed,
			resultBrowser: this,
		});

		const tileLayers = {};
		$.each(TILE_LAYER, (name, layer) => tileLayers[name] = L.tileLayer(layer.url, layer.options));

		const $container = $('<div>').attr('id', 'map').height('100vh');
		$container.append($toolbar);
		this._ed.resetToolbar();

		$element.html($container);

		this._map = L.map('map', {
			center: center,
			maxZoom: 18,
			minZoom: 2,
			fullscreenControl: true,
			preferCanvas: true,
			layers: [tileLayers['OpenStreetMap (Standard)'], this._markerLayer]
		}).on('zoomend',
			() => this._markerLayer.onZoomChange(this._getSafeZoom())
		).on('baselayerchange',
			(e) => this._ed.baseLayer = e.name
		).addControl(
			L.control.zoomBox({
				modal: false,
				className: 'glyphicon glyphicon-zoom-in'
			})
		).addControl(
			L.control.layers(tileLayers, null)
		);

		if (userInfo && userInfo.home && userInfo.home.zoom) {
			this._map.setZoom(Math.min(9, userInfo.home.zoom));
		} else {
			this._map.fitBounds(this._markerLayer.getBounds());
		}

		// force zoom refresh
		this._markerLayer.onZoomChange(this._getSafeZoom());
	};

	/**
	 * @private
	 */
	SELF.prototype._getSafeZoom = function() {
		return !this._map ? 6 : this._map.getZoom()
	};

	return SELF;
}( jQuery, L, d3, window, CONFIG,
	wikibase.queryService.ui.resultBrowser.helper.EditorMarker,
	wikibase.queryService.ui.resultBrowser.helper.EditorData) );
