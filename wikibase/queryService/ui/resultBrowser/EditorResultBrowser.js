var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};

wikibase.queryService.ui.resultBrowser.EditorResultBrowser = ( function( $, L, d3, wellknown, window, config ) {
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
	SELF.prototype._markerGroups = null;

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

		this._markerGroups = this._createMarkerLayer();

		const tileLayers = {};
		$.each(TILE_LAYER, (name, layer) => tileLayers[name] =L.tileLayer(layer.url, layer.options));

		const $container = $('<div>').attr('id', 'map').height('100vh');
		$element.html($container);
		this._map = L.map('map', {
			center: [0, 0],
			maxZoom: 18,
			minZoom: 2,
			fullscreenControl: true,
			preferCanvas: true,
			layers: [tileLayers['OpenStreetMap'], this._markerGroups]
		}).fitBounds(
			this._markerGroups.getBounds()
		).on('zoomend',
			() => this._markerGroups.onZoomChange(this._getSafeZoom())
		).addControl(
			L.control.zoomBox({
				modal: false,
				className: 'glyphicon glyphicon-zoom-in'
			})
		).addControl(
			L.control.layers(tileLayers, null)
		);

		// force zoom refresh
		this._markerGroups.onZoomChange(this._getSafeZoom());

		// TODO: needed?
		$element.html($container);
	};

	/**
	 * @private
	 */
	SELF.prototype._getSafeZoom = function() {
		return !this._map ? 6 : this._map.getZoom()
	};

	/**
	 * @private
	 */
	SELF.prototype._createMarkerLayer = function() {
		const editorData = new wikibase.queryService.ui.resultBrowser.helper.EditorData({
			queryOpts: this._options,
			config,
			templates: this._templates,
		});

		const features = [];
		const columns = editorData.parseColumnHeaders(this._result.head.vars);
		const results = this._result.results.bindings;

		for (const row of results) {
			const feature = editorData.parseFeature(row);
			feature.properties = editorData.extractGeoJsonProperties(row, columns, feature.id.uid);
			features.push(feature);
		}

		if (Object.keys(features).length === 0) {
			throw new Error('Nothing found!');
		}

		const geojson = {
			"type": "FeatureCollection",
			"features": features
		};

		return new wikibase.queryService.ui.resultBrowser.helper.EditorMarker(geojson, {
			zoom: this._getSafeZoom(),
			templates: this._templates,
			editorData
		});
	};

	return SELF;
}( jQuery, L, d3, wellknown, window, CONFIG ) );
