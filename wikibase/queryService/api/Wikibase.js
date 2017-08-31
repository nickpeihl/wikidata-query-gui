var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.api = wikibase.queryService.api || {};

wikibase.queryService.api.Wikibase = ( function( $ ) {
	'use strict';

	var API_ENDPOINT = 'https://www.wikidata.org/w/api.php';
	var LANGUAGE = 'en';

	var SEARCH_ENTITES = {
		action: 'wbsearchentities',
		format: 'json',
		limit: 50,
		continue: 0,
		language: LANGUAGE,
		uselang: LANGUAGE
	},
	QUERY_LANGUGES = {
		action: 'query',
		meta: 'siteinfo',
		format: 'json',
		siprop: 'languages'
	},
	QUERY_LABELS = {
		action: 'wbgetentities',
		props: 'labels',
		format: 'json',
		languages: LANGUAGE,
		languagefallback: '1'
	},
	QUERY_DATATYPE = {
		action: 'wbgetentities',
		props: 'datatype',
		format: 'json'
	};

	/**
	 * API for the Wikibase API
	 *
	 * @class wikibase.queryService.api.Wikibase
	 * @license GNU GPL v2+
	 *
	 * @author Jonas Kress
	 * @constructor
	 * @param {string} endpoint default: 'https://www.wikidata.org/w/api.php'
	 */
	function SELF( endpoint, defaultLanguage ) {
		this._endpoint = API_ENDPOINT;

		if ( endpoint ) {
			this._endpoint = endpoint;
		}

		if ( defaultLanguage ) {
			this._language = defaultLanguage;
		}
	}

	/**
	 * @property {string}
	 * @private
	 */
	SELF.prototype._endpoint = null;

	/**
	 * @property {string}
	 * @private
	 */
	SELF.prototype._language = null;

	/**
	 * Search an entity with using wbsearchentities
	 *
	 * @param {string} term search string
	 * @param {string} type entity type to search for
	 * @param {string} language of search string default:en
	 *
	 * @return {jQuery.Promise}
	 */
	SELF.prototype.searchEntities = function( term, type, language ) {
		var query = SEARCH_ENTITES;
		query.search = term;

		if ( type ) {
			query.type = type;
		}
		if ( this._language || language ) {
			query.language = language || this._language;
			query.uselang = language || this._language;
		} else {
			query.language = LANGUAGE;
			query.uselang = LANGUAGE;
		}

		return this._query( query );
	};

	/**
	 * List of supported languages
	 *
	 * @return {jQuery.Promise}
	 */
	SELF.prototype.getLanguages = function() {
		return this._query( QUERY_LANGUGES );
	};

	/**
	 * Get labels for given entities
	 *
	 * @param {string|string[]} ids entity IDs
	 * @return {jQuery.Promise}
	 */
	SELF.prototype.getLabels = function( ids ) {

		if ( typeof ids === 'string' ) {
			ids = [ ids ];
		}

		var query = QUERY_LABELS;
		query.ids = ids.join( '|' );

		if ( this._language  ) {
			query.languages = this._language;
		}

		return this._query( query );
	};

	/**
	 * Get datatype of property
	 *
	 * @param {string} id property ID
	 * @return {jQuery.Promise}
	 */
	SELF.prototype.getDataType = function( id ) {
		var query = QUERY_DATATYPE,
			deferred = $.Deferred();

		query.ids = id;

		this._query( query ).done( function( data ) {
			if ( data.entities && data.entities[id] && data.entities[id].datatype ) {
				deferred.resolve( data.entities[id].datatype );
			}
			deferred.reject();

		} ).fail( deferred.reject );

		return deferred.promise();
	};

	/**
	 * @private
	 */
	SELF.prototype._query = function( query ) {
		return $.ajax( {
			url: this._endpoint + '?' + jQuery.param( query ),
			dataType: 'jsonp'
		} );
	};

	/**
	 * Set the default language
	 *
	 * @param {string} language of search string default:en
	 */
	SELF.prototype.setLanguage = function( language ) {
		this._language = language;
	};

	return SELF;

}( jQuery ) );




// Override default class with OSM+Wikidata custom one
wikibase.queryService.api.Wikibase = ( function () {
  "use strict";

  // $HACK$: the parent class hasn't been overridden yet, store it for the future use
  const SuperClass = wikibase.queryService.api.Wikibase;

  const knownLabels = {
    'osmm:type': 'object type',
    'osmm:version': 'object version',
    'osmm:loc': 'center point',
    'osmm:user': 'last edited by',
    'osmm:isClosed': 'is way an area or a line',
    'osmm:has': 'relation member',
    'osmm:changeset': 'changeset id',

    'osmmeta:type': 'object type',
    'osmmeta:version': 'object version',
    'osmmeta:loc': 'center point',
    'osmmeta:user': 'last edited by',
    'osmmeta:isClosed': 'is way an area or a line',
    'osmmeta:has': 'relation member',
    'osmmeta:changeset': 'changeset id',
  };

  return class extends SuperClass {

    async getLabels( ids ) {

      if ( typeof ids === 'string' ) {
        ids = [ ids ];
      }

      const osmTags = {};
      ids = ids.filter( id => {
        const isWikidataTag = /^[PQ][0-9]+$/.test(id);
        if (!isWikidataTag) {
          const label = knownLabels[id] ||
            (id.startsWith('osmt:') && id.slice('osmt:'.length) + ' tag') ||
            (id.startsWith('osmtag:') && id.slice('osmtag:'.length) + ' tag') ||
            (id.startsWith('osmway:') && 'way #' + id.slice('osmway:'.length)) ||
            (id.startsWith('osmnode:') && 'node #' + id.slice('osmnode:'.length)) ||
            (id.startsWith('osmrel:') && 'relation #' + id.slice('osmrel:'.length)) ||
            '';
          osmTags[id] = {
            labels: {en: {value: label}}
          };
        }
        return isWikidataTag;
      } );

      const result = ids.length > 0 ? await SuperClass.prototype.getLabels.call( this, ids ) : {entities: {}};
      Object.assign(result.entities, osmTags);
      return result;
    }
  };

}() );
