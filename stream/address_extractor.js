
/**
  The address extractor is responsible for cloning documents where a valid address
  data exists.

  The hasValidAddress() function examines the address property which was populated
  earier in the pipeline by the osm.tag.mapper stream and therefore MUST come after
  that stream in the pipeline or it will fail to find any address information.

  There are a few different outcomes for this stream depending on the data contained
  in each individual document, the result can be, 0, 1 or 2 documents being emitted.

  In the case of the document missing a valid doc.name.default string then it is not
  considered to be a point-of-interest in it's own right, it will be discarded.

  In the case where the document contains BOTH a valid house number & street name we
  consider this record to be an address in it's own right and we clone that record,
  duplicating the data across to the new doc instance while adjusting it's id and type.

  In a rare case it is possible that the record contains neither a valid name nor a valid
  address. If this case in encountered then the parser should be modified so these records
  are no longer passed down the pipeline; as they will simply be discarded because they are
  not searchable.
**/

var through = require('through2'),
    isObject = require('is-object'),
    extend = require('extend'),
    peliasLogger = require( 'pelias-logger' ).get( 'openstreetmap' ),
    Document = require('pelias-model').Document,
    idOrdinal = 0; // used for addresses lacking an id (to keep them unique)

function hasValidAddress( doc ){
  if( !isObject( doc ) ){ return false; }
  if( !isObject( doc.address ) ){ return false; }
  if( 'string' !== typeof doc.address.number ){ return false; }
  if( 'string' !== typeof doc.address.street ){ return false; }
  if( !doc.address.number.length ){ return false; }
  if( !doc.address.street.length ){ return false; }
  return true;
}

module.exports = function(){

  var stream = through.obj( function( doc, enc, next ) {
    var isNamedPoi = !!doc.getName('default');

    // create a new record for street addresses
    if( hasValidAddress( doc ) ){
      var type = isNamedPoi ? 'poi-address' : 'address';
      var record;

      // accept semi-colon delimited house numbers
      // ref: https://github.com/pelias/openstreetmap/issues/21
      var streetnumbers = doc.address.number.split(';').map(Function.prototype.call, String.prototype.trim);
      streetnumbers.forEach( function( streetno, i ){

        try {

          var newid = [ 'osm', doc.getType(), type, (doc.getSourceId() || ++idOrdinal) ];
          if( i > 0 ){ newid.push( streetno ); }

          // copy data to new document
          record = new Document( 'osm', 'address', newid.join('-') )
            .setName( 'default', streetno + ' ' + doc.address.street )
            .setCentroid( doc.getCentroid() )
            .setSourceId(doc.getSourceId());

          setProperties( record, doc );
        }

        catch( e ){
          peliasLogger.error( 'address_extractor error' );
          peliasLogger.error( e.stack );
          peliasLogger.error( JSON.stringify( doc, null, 2 ) );
        }

        if( record !== undefined ){
          // copy meta data (but maintain the id & type assigned above)
          record._meta = extend( true, {}, doc._meta, { id: record.getId(), type: record.getType() } );
          this.push( record );
        }

      }, this);

    }

    // forward doc downstream is it's a POI in it's own right
    // note: this MUST be below the address push()
    if( isNamedPoi ){
      this.push( doc );
    }

    return next();

  });

  // catch stream errors
  stream.on( 'error', peliasLogger.error.bind( peliasLogger, __filename ) );

  return stream;
};

// properties to map from the osm record to the pelias doc
var addrProps = [ 'name', 'number', 'street', 'zip' ];
var adminProps = [ 'admin0', 'admin1', 'admin1_abbr', 'admin2', 'local_admin', 'locality', 'neighborhood' ];

// call document setters and ignore non-fatal errors
function setProperties( record, doc ){
  addrProps.forEach( function ( prop ){
    try {
      record.setAddress( prop, doc.getAddress( prop ) );
    } catch ( ex ) {}
  });

  try {
    record.setAlpha3( doc.getAlpha3() );
  } catch ( ex ) {}

  adminProps.forEach( function ( level ){
    try {
      record.setAdmin( level, doc.getAdmin( level ) );
    } catch ( ex ) {}
  });
}

// export for testing
module.exports.hasValidAddress = hasValidAddress;
