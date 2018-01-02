var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};
wikibase.queryService.ui.resultBrowser = wikibase.queryService.ui.resultBrowser || {};

wikibase.queryService.ui.resultBrowser.MapRegionResultBrowser = ( function( $, L, d3, window, config, EditorMarker, EditorData ) {
	'use strict';

	/**
	 * A result browser for long lat coordinates
	 *
	 * @class wikibase.queryService.ui.resultBrowser.MapRegionResultBrowser
	 * @licence GNU GPL v2+
	 *
	 * @author Yuri Astrakhan
	 * @constructor
	 *
	 */
	function SELF() {
	}

	SELF.prototype = new wikibase.queryService.ui.resultBrowser.AbstractResultBrowser();

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

		const regionsUrl = window.location.protocol + window.location.host +
			'/regions?topojson=1&sparql=' +
			encodeURIComponent(this.getSparqlApi()._originalQuery);

		const $container = $('<iframe>', {
			src: 'http://mapshaper.org/?files=' + regionsUrl,
			id:  'myFrame',
			frameborder: 0,
			scrolling: 'no'
		}).height('100vh').width('100%');

		$element.html($container);

	};

	return SELF;
}( jQuery, L, d3, window, CONFIG,
	wikibase.queryService.ui.resultBrowser.helper.EditorMarker,
	wikibase.queryService.ui.resultBrowser.helper.EditorData) );
