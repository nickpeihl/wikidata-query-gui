var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};

wikibase.queryService.ui.resultBrowser.EditorResultBrowser = ( function( $, L, d3, _, wellknown, window, config, EditorMarker, osmAuth ) {
	'use strict';

	/**
	 * A list of datatypes that contain geo:wktLiteral values conforming with GeoSPARQL.
	 * @private
	 */
	const MAP_DATATYPES = [
		'http://www.opengis.net/ont/geosparql#wktLiteral', // used by Wikidata
		'http://www.openlinksw.com/schemas/virtrdf#Geometry' // used by LinkedGeoData.org
	];
	const GLOBE_EARTH = 'http://www.wikidata.org/entity/Q2';
	const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
	/**
	 * A list of coordinate reference systems / spatial reference systems
	 * that refer to Earth and use longitude-latitude axis order.
	 * @private
	 */
	const EARTH_LONGLAT_SYSTEMS = [
		GLOBE_EARTH,
		CRS84
	];

	const TILE_LAYER = {
		'Wikimedia': {
			url: 'https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png',
			options: {
				id: 'wikipedia-map-01',
				attribution: ' <a href="http://maps.wikimedia.org/">Wikimedia</a> | &copy; <a href="http://openstreetmap.org/copyright">Open Street Map</a> contributors'
			}
		},
		'OpenStreetMap': {
			url: 'http://{s}.tile.osm.org/{z}/{x}/{y}.png',
			options: {
				attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
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

	const osmauth = osmAuth({
		oauth_consumer_key: config.api.osm.oauth_key,
		oauth_secret: config.api.osm.oauth_secret,
		auto: true,
		url: config.api.osm.baseurl
	});

	osmauth.xhrAsync = function () {
		return new Promise((accept, reject) => {
			this.xhr(...arguments, (err, data) => {
				if (err) {
					reject(err);
				} else {
					accept(data);
				}
			});
		});
	};

	let ScrollToTopButton = null;

	/**
	 * A result browser for long lat coordinates
	 *
	 * @class wikibase.queryService.ui.resultBrowser.EditorResultBrowser
	 * @licence GNU GPL v2+
	 *
	 * @author Jonas Kress
	 * @author Katie Filbert
	 * @constructor
	 *
	 */
	function SELF() {
		this._getMarkerGroupColor = d3.scale.category10();
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
	 * Maps group name to a certain color
	 * @private
	 */
	SELF.prototype._getMarkerGroupColor = null;

	/**
	 * Draw a map to the given element
	 *
	 * @param {jQuery} $element target element
	 */
	SELF.prototype.draw = function( $element ) {
		const tileLayers = {};
		$.each(TILE_LAYER, (name, layer) => tileLayers[name] =L.tileLayer(layer.url, layer.options));

		this._markerGroups = this._createMarkerLayer();

		const container = $('<div>').attr('id', 'map').height('100vh');
		$element.html(container);
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
		$element.html(container);
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
		const features = [];
		const columns = this._parseColumnHeaders(this._result.head.vars);
		const results = this._result.results.bindings;

		for (const row of results) {
			features.push(this._parseFeature(row, columns));
		}

		if (Object.keys(features).length === 0) {
			throw new Error('Nothing found!');
		}

		const geojson = {
			"type": "FeatureCollection",
			"features": features
		};

		let rejectTag = false;
		const rejectTagMatch = this._sparqlApi._originalQuery.match( /#rejectTag:([_a-z][_a-z0-9]*)($|\n| |\t)/ );
		if ( rejectTagMatch ) {
			rejectTag = rejectTagMatch[1];
		}

		let queryId = false;
		if (rejectTag) {
			// For now, only allow queryId when rejectTag was also specified
			const rejectIdMatch = this._sparqlApi._originalQuery.match(/#queryId:([-_0-9a-zA-Z]+)($|\n| |\t)/);
			if (rejectIdMatch) {
				queryId = rejectIdMatch[1];
			}
		}

		return new EditorMarker(geojson, {
			zoom: this._getSafeZoom(),
			baseUrl: config.api.osm.baseurl,
			apiUrl: config.api.osm.apiurl,
			osmauth,
			program: config.api.osm.program,
			version: config.api.osm.version,
			rejectTag,
			queryId,
		});
	};

	/**
	 * @private
	 * @param {object[]} rawColumns
	 * @return {object} parsed columns
	 */
	SELF.prototype._parseColumnHeaders = function (rawColumns) {
		const columns = {};

		if (!_.contains(rawColumns, 'id')) {
			throw new Error('Query has no "id" column. It must contain OSM ID URI, e.g. osmnode:123 or osmrel:456');
		}

		if (!_.contains(rawColumns, 'loc')) {
			throw new Error('Query has no "loc" column. It must contain geopoint of the OSM object');
		}

		if (!_.contains(rawColumns, 'comment')) {
			throw new Error('Query has no "comment" column. It must contain the description of the change.');
		}

		// Find all tag columns, e.g.  "t1"
		for (const tag of rawColumns) {
			if (tag.match(/t[0-9]+/)) {
				columns[tag] = false;
			}
		}

		// Find all value columns, e.g.  "v1", and check that corresponding tag column exists
		for (const val of rawColumns) {
			if (val.match(/v[0-9]+/)) {
				const tag = 't' + val.slice(1);
				if (!columns.hasOwnProperty(tag)) {
					throw new Error(`Result has a value column ${val}, but no tag column ${tag}`);
				}
				columns[tag] = val;
			}
		}

		// Check that there was a value column for every tag column
		for (const tag of Object.keys(columns)) {
			if (columns[tag] === false) {
				const val = 'v' + tag.slice(1);
				throw new Error(`Result has a tag column ${tag}, but no value column ${val}`);
			}
		}

		return columns;
	};

	/**
	 * @private
	 * @param {object} row
	 * @param {object} columns
	 * @return {object} GeoJson
	 */
	SELF.prototype._parseFeature = function (row, columns) {
		// Parse ID
		if (!row.id) {
			throw new Error(`The 'id' is not set`);
		}
		if (row.id.type !== 'uri') {
			throw new Error(`The type of the ID column must be 'uri', not '${row.id.type}'. Value = ${row.id.value}`);
		}
		const idMatch = row.id.value.match(/https:\/\/www.openstreetmap.org\/((relation|node|way)\/[0-9]+)/);
		if (!idMatch) {
			throw new Error(`id column must be a OSM URI.  value=${row.id.value}`);
		}
		const uid = idMatch[1];

		// Parse location
		if ( !row.loc || MAP_DATATYPES.indexOf( row.loc.datatype ) === -1 ) {
			throw new Error(`${uid} has invalid location value '${row.loc && row.loc.value || ''}'`);
		}

		const split = this._splitWktLiteral( row.loc.value );
		if ( !split ) {
			throw new Error(`${uid} has invalid location. value='${row.loc.value}'`);
		}

		if ( EARTH_LONGLAT_SYSTEMS.indexOf( split.crs ) === -1 ) {
			throw new Error(`${uid} location must be on Earth. value='${row.loc.value}'`);
		}

		// Parse comment
		if (!row.comment) {
			throw new Error(`${uid} has no comment value`);
		}
		if (row.comment.type !== 'literal') {
			throw new Error(`${uid} comment type must be 'literal', not '${row.comment.type}'. Value = ${row.comment.value}`);
		}
		const comment = row.comment.value.trim();
		if (!comment.length) {
			throw new Error(`${uid} has an empty comment`);
		}

		const feature = wellknown.parse( split.wkt );
		const [type, id] = uid.split('/');
		feature.id = {type, id: id, uid};
		feature.comment = comment;

		// Parse tags
		feature.properties = this._extractGeoJsonProperties(row, columns, uid);

		return feature;
	};

	/**
	 * Split a geo:wktLiteral or compatible value
	 * into coordinate reference system URI
	 * and Simple Features Well Known Text (WKT) string,
	 * according to GeoSPARQL, Req 10.
	 *
	 * If the coordinate reference system is not specified,
	 * CRS84 is used as default value, according to GeoSPARQL, Req 11.
	 *
	 * @private
	 * @param {string} literal
	 * @return {?{ crs: string, wkt: string }}
	 */
	SELF.prototype._splitWktLiteral = function( literal ) {
		// only U+0020 spaces as separator, not other whitespace, according to GeoSPARQL, Req 10
		const match = literal.match(/(<([^>]*)> +)?(.*)/);

		if ( match ) {
			return { crs: match[2] || CRS84, wkt: match[3] };
		} else {
			return null;
		}
	};

	/**
	 * Extract desired tags
	 *
	 * @private
	 * @param {Object} row
	 * @param {Object} columns
	 * @return {?Object} GeoJSON
	 */
	SELF.prototype._extractGeoJsonProperties = function( row, columns ) {
		const result = {};

		for (const tagNameCol of Object.keys(columns)) {
			const valNameCol = columns[tagNameCol];
			const tagObj = row[tagNameCol];
			const valObj = row[valNameCol];

			// Tags can be either strings (literals), or URIs with "osmt:" prefix
			if (tagObj === undefined) {
				// tag is not defined - skip it
				continue;
			}
			let tag = tagObj.value;
			if (tagObj.type === 'uri') {
				const tagMatch = tag.match(/https:\/\/wiki.openstreetmap.org\/wiki\/Key:(.+)/);
				if (!tagMatch) {
					throw new Error(`Column '${tagNameCol}' must be a string or a osmt:* URI. tag = '${tag}'`);
				}
				tag = tagMatch[1];
			} else if (tagObj.type !== 'literal') {
				throw new Error(`Column '${tagNameCol}' must be a literal. type = '${tagObj.type}'`);
			}
			if (tag !== tag.trim()) {
				throw new Error(`Column '${tagNameCol}' contains trailing whitespace. tag = '${tag}'`);
			}
			if (result.hasOwnProperty(tag)) {
				throw new Error(`Duplicate tag name '${tag}'`);
			}

			// Values can be either strings (literals), wd:Qxxx values (uri), or proper wikipedia links
			let value;

			// If unbound, tag is to be removed
			if (valObj !== undefined) {
				value = valObj.value;
				if (valObj.type === 'uri') {
					const wdMatch = value.match(/http:\/\/www.wikidata.org\/entity\/(Q.+)/);
					if (wdMatch) {
						value = wdMatch[1];
					} else {
						const wpMatch = value.match(/https:\/\/([^./]+).wikipedia.org\/wiki\/(.+)/);
						if (wpMatch) {
							value = `${wpMatch[1]}:${decodeURIComponent(wpMatch[2]).replace(/_/g, ' ')}`;
						} else {
							throw new Error(`Column '${valNameCol}' must be a string, a wd:*, or a proper wikipedia URI. value = '${value}'`);
						}
					}
				} else if (valObj.type !== 'literal') {
					throw new Error(`Column '${valNameCol}' must be a literal. type = '${valObj.type}'`);
				}
				if (value !== value.trim()) {
					throw new Error(`Column '${valNameCol}' contains trailing whitespace. value = '${value}'`);
				}
				if (valObj.type !== 'literal') {
					value = {value, vlink: valObj.value};
				}
			}

			result[tag] = value;
		}

		return result;
	};

	return SELF;
}( jQuery, L, d3, _, wellknown, window, CONFIG, EditorMarker, osmAuth ) );
