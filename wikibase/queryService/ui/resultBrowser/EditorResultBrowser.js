var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};

wikibase.queryService.ui.resultBrowser.EditorResultBrowser = ( function( $, L, d3, window, config, EditorMarker, EditorData ) {
	'use strict';

	const TILE_LAYER = {
		'OpenStreetMap': {
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
	SELF.prototype.draw = function( $element ) {
		this._templates = $.get('popup.mustache')
			.then(v => {
				const $v = $(v);
				return {
					popup: $v.filter('#popup').html(),
					wait: $v.filter('#wait').html(),
					error: $v.filter('#error').html(),
					toolbar: $v.filter('#toolbar').html(),
				};
			});

		// this._templates.then(t => {
		// 	$element.append($(Mustache.render(t.toolbar, {}))[0]);
		// });

		const result = this._result;

		if (result.results.bindings.length === 0) {
			throw new Error('Nothing found!');
		}

		this._ed = new EditorData({
			queryOpts: this._options,
			config,
			templates: this._templates,
			columns: result.head.vars,
		});

		let center = [0, 0];
		const userInfo = this._ed.getUserInfo(false);
		if (userInfo && userInfo.home) {
			center = [userInfo.home.lon, userInfo.home.lat];
		}

		this._markerLayer = new EditorMarker({
			"type": "FeatureCollection",
			"features": result.results.bindings.map(EditorData.parseFeature)
		}, {
			zoom: this._getSafeZoom(),
			templates: this._templates,
			editorData: this._ed,
		});

		const tileLayers = {};
		$.each(TILE_LAYER, (name, layer) => tileLayers[name] = L.tileLayer(layer.url, layer.options));

		const $container = $('<div>').attr('id', 'map').height('100vh');
		$element.html($container);
		this._map = L.map('map', {
			center: center,
			maxZoom: 18,
			minZoom: 2,
			fullscreenControl: true,
			preferCanvas: true,
			layers: [tileLayers['OpenStreetMap'], this._markerLayer]
		}).on('zoomend',
			() => this._markerLayer.onZoomChange(this._getSafeZoom())
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

		// TODO: needed?
		$element.html($container);
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
