var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.RdfNamespaces = {};

( function ( $, RdfNamespaces ) {
	'use strict';

	RdfNamespaces.NAMESPACE_SHORTCUTS = {

		'OSM Data': {
			osmnode: 'https://www.openstreetmap.org/node/',
			osmway: 'https://www.openstreetmap.org/way/',
			osmrel: 'https://www.openstreetmap.org/relation/',
			osmt: 'https://wiki.openstreetmap.org/wiki/Key:',
			osmm: 'https://www.openstreetmap.org/meta/',
			pageviews: 'https://dumps.wikimedia.org/other/pageviews/'
		},

		'OSM Metadata': {
			osmd: 'http://wiki.openstreetmap.org/entity/',
			osmdt: 'http://wiki.openstreetmap.org/prop/direct/',
			osmds: 'http://wiki.openstreetmap.org/entity/statement/',
			osmp: 'http://wiki.openstreetmap.org/prop/',
			osmdref: 'http://wiki.openstreetmap.org/reference/',
			osmdv: 'http://wiki.openstreetmap.org/value/',
			osmps: 'http://wiki.openstreetmap.org/prop/statement/',
			osmpsv: 'http://wiki.openstreetmap.org/prop/statement/value/',
			osmpsn: 'http://wiki.openstreetmap.org/prop/statement/value-normalized/',
			osmpq: 'http://wiki.openstreetmap.org/prop/qualifier/',
			osmpqv: 'http://wiki.openstreetmap.org/prop/qualifier/value/',
			osmpqn: 'http://wiki.openstreetmap.org/prop/qualifier/value-normalized/',
			osmpr: 'http://wiki.openstreetmap.org/prop/reference/',
			osmprv: 'http://wiki.openstreetmap.org/prop/reference/value/',
			osmprn: 'http://wiki.openstreetmap.org/prop/reference/value-normalized/',
			osmdno: 'http://wiki.openstreetmap.org/prop/novalue/',
			osmdata: 'http://wiki.openstreetmap.org/wiki/Special:EntityData/'
		},

		Wikidata: {
			wikibase: 'http://wikiba.se/ontology#',
			wd: 'http://www.wikidata.org/entity/',
			wdt: 'http://www.wikidata.org/prop/direct/',
			wds: 'http://www.wikidata.org/entity/statement/',
			p: 'http://www.wikidata.org/prop/',
			wdref: 'http://www.wikidata.org/reference/',
			wdv: 'http://www.wikidata.org/value/',
			ps: 'http://www.wikidata.org/prop/statement/',
			psv: 'http://www.wikidata.org/prop/statement/value/',
			psn: 'http://www.wikidata.org/prop/statement/value-normalized/',
			pq: 'http://www.wikidata.org/prop/qualifier/',
			pqv: 'http://www.wikidata.org/prop/qualifier/value/',
			pqn: 'http://www.wikidata.org/prop/qualifier/value-normalized/',
			pr: 'http://www.wikidata.org/prop/reference/',
			prv: 'http://www.wikidata.org/prop/reference/value/',
			prn: 'http://www.wikidata.org/prop/reference/value-normalized/',
			wdno: 'http://www.wikidata.org/prop/novalue/',
			wdata: 'http://www.wikidata.org/wiki/Special:EntityData/'
		},
		W3C: {
			rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
			rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
			owl: 'http://www.w3.org/2002/07/owl#',
			skos: 'http://www.w3.org/2004/02/skos/core#',
			xsd: 'http://www.w3.org/2001/XMLSchema#',
			prov: 'http://www.w3.org/ns/prov#'
		},
		'Social/Other': {
			schema: 'http://schema.org/',
			geo: 'http://www.opengis.net/ont/geosparql#',
			geof: 'http://www.opengis.net/def/geosparql/function/'
		},
		Blazegraph: {
			bd: 'http://www.bigdata.com/rdf#',
			bds: 'http://www.bigdata.com/rdf/search#',
			gas: 'http://www.bigdata.com/rdf/gas#',
			hint: 'http://www.bigdata.com/queryHints#'
		}
	};

	RdfNamespaces.ENTITY_TYPES = {
		'http://wiki.openstreetmap.org/prop/direct/': 'property',
		'http://wiki.openstreetmap.org/prop/': 'property',
		'http://wiki.openstreetmap.org/prop/novalue/': 'property',
		'http://wiki.openstreetmap.org/prop/statement/': 'property',
		'http://wiki.openstreetmap.org/prop/statement/value/': 'property',
		'http://wiki.openstreetmap.org/prop/statement/value-normalized/': 'property',
		'http://wiki.openstreetmap.org/prop/qualifier/': 'property',
		'http://wiki.openstreetmap.org/prop/qualifier/value/': 'property',
		'http://wiki.openstreetmap.org/prop/qualifier/value-normalized/': 'property',
		'http://wiki.openstreetmap.org/prop/reference/': 'property',
		'http://wiki.openstreetmap.org/prop/reference/value/': 'property',
		'http://wiki.openstreetmap.org/prop/reference/value-normalized/': 'property',
		'http://wiki.openstreetmap.org/wiki/Special:EntityData/': 'item',
		'http://wiki.openstreetmap.org/entity/': 'item'
	};

	RdfNamespaces.ALL_PREFIXES = $.map( RdfNamespaces.NAMESPACE_SHORTCUTS, function ( n ) {
		return n;
	} ).reduce( function ( p, v, i ) {
		return $.extend( p, v );
	}, {} );

	RdfNamespaces.STANDARD_PREFIXES = {
		osmnode: 'PREFIX osmnode: <https://www.openstreetmap.org/node/>',
		osmway: 'PREFIX osmway: <https://www.openstreetmap.org/way/>',
		osmrel: 'PREFIX osmrel: <https://www.openstreetmap.org/relation/>',
		osmt: 'PREFIX osmt: <https://wiki.openstreetmap.org/wiki/Key:>',
		osmm: 'PREFIX osmm: <https://www.openstreetmap.org/meta/>',
		pageviews: 'PREFIX pageviews: <https://dumps.wikimedia.org/other/pageviews/>',

		osmd: 'PREFIX osmd: <http://wiki.openstreetmap.org/entity/>',
		osmdt: 'PREFIX osmdt: <http://wiki.openstreetmap.org/prop/direct/>',
		osmp: 'PREFIX osmp: <http://wiki.openstreetmap.org/prop/>',
		osmps: 'PREFIX osmps: <http://wiki.openstreetmap.org/prop/statement/>',
		osmpq: 'PREFIX osmpq: <http://wiki.openstreetmap.org/prop/qualifier/>',
	};

	RdfNamespaces.getPrefixMap = function ( entityTypes ) {
		var prefixes = {};
		$.each( RdfNamespaces.ALL_PREFIXES, function ( prefix, url ) {
			if ( entityTypes[url] ) {
				prefixes[prefix] = entityTypes[url];
			}
		} );
		return prefixes;
	};

} )( jQuery, wikibase.queryService.RdfNamespaces );
