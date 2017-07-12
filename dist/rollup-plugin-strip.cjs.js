'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var acorn = _interopDefault(require('acorn'));
var estreeWalker = require('estree-walker');
var MagicString = _interopDefault(require('magic-string'));
var rollupPluginutils = require('rollup-pluginutils');

var whitespace = /\s/;

function getName ( node ) {
	if ( node.type === 'Identifier' ) return node.name;
	if ( node.type === 'ThisExpression' ) return 'this';
	if ( node.type === 'Super' ) return 'super';

	return null;
}

function flatten ( node ) {
	var name;
	var parts = [];

	while ( node.type === 'MemberExpression' ) {
		if ( node.computed ) return null;

		parts.unshift( node.property.name );
		node = node.object;
	}

	name = getName( node );

	if ( !name ) return null;

	parts.unshift( name );
	return parts.join( '.' );
}

function strip ( options ) {
	if ( options === void 0 ) options = {};

	var include = options.include || '**/*.js';
	var exclude = options.exclude;
	var filter = rollupPluginutils.createFilter( include, exclude );
	var sourceMap = options.sourceMap !== false;

	var removeDebuggerStatements = options.debugger !== false;
	var functions = ( options.functions || [ 'console.*', 'assert.*' ] )
		.map( function (keypath) { return keypath.replace( /\./g, '\\.' ).replace( /\*/g, '\\w+' ); } );

	var firstpass = new RegExp( ("\\b(?:" + (functions.join( '|' )) + "|debugger)\\b") );
	var pattern = new RegExp( ("^(?:" + (functions.join( '|' )) + ")$") );

	return {
		name: 'strip',

		transform: function transform ( code, id ) {
			if ( !filter( id ) ) return null;
			if ( !firstpass.test( code ) ) return null;

			var ast;

			try {
				ast = acorn.parse( code, {
					ecmaVersion: 6,
					sourceType: 'module'
				});
			} catch ( err ) {
				err.message += " in " + id;
				throw err;
			}

			var magicString = new MagicString( code );
			var edited = false;

			function remove ( start, end ) {
				while ( whitespace.test( code[ start - 1 ] ) ) start -= 1;
				magicString.remove( start, end );
			}

			estreeWalker.walk( ast, {
				enter: function enter ( node, parent ) {
					if ( sourceMap ) {
						magicString.addSourcemapLocation( node.start );
						magicString.addSourcemapLocation( node.end );
					}

					if ( removeDebuggerStatements && node.type === 'DebuggerStatement' ) {
						remove( node.start, node.end );
						edited = true;
					}

					else if ( node.type === 'CallExpression' ) {
						var keypath = flatten( node.callee );
						if ( keypath && pattern.test( keypath ) ) {
							if ( parent.type === 'ExpressionStatement' ) {
								remove( parent.start, parent.end );
							} else {
								magicString.overwrite( node.start, node.end, 'void 0' );
							}
							edited = true;

							this.skip();
						}
					}
				}
			});

			if ( !edited ) return null;

			code = magicString.toString();
			var map = sourceMap ? magicString.generateMap() : null;

			return { code: code, map: map };
		}
	};
}

module.exports = strip;
