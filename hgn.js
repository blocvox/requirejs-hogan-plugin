// Based on RequireJS Hogan Plugin v0.2.0 (2012/06/29). Copyright (c) 2012 Miller Medeiros. MIT License.
(function(define,Array){ "use strict";
define(
    [
        'hogan',
        'text',
        'module'
    ],
    function(
        hogan,
        text,
        module
    ){
        var
            DEFAULT_EXTENSION = ".mustache",
            _wrotePartialModule = false,
            _buildTemplate,
            _nameMap = { },
            _partialStrings = [ ]
        ;

        function load(name, req, onLoad, config) {
            var
                // This is the hgn-specific config. It can have a compilationOptions property.
                hgnConfig = module.config() || { compilationOptions: { } },
                partialRefs = [ ],
                partialTmpls = { }
            ;

            name = getPartialPath(name);
            partialRefs.push(name);

            getPartials(partialRefs);

            function getPartialPath(partial, context){
                var orig = partial;

                if (context) {
                    while (true) {
                        if (partial.substr(0,3) == '../') {
                            // Remove filename
                            context = context.substr(0, context.lastIndexOf('/'));

                            // Remove current folder
                            context = context.substr(0, context.lastIndexOf('/') + 1);

                            // Remove parent reference
                            partial =  partial.substr(3);

                            continue;
                        }

                        if (partial.substr(0,2) == './') {
                            partial = partial.substr(2);
                            continue;
                        }

                        break;
                    }

                    // Remove filename, if present; context is only in valid state if last character is '/'
                    if(context.substr(context.length-1) != '/') context = context.substr(0, context.lastIndexOf('/') + 1);

                    partial = context + partial;
                }

                _nameMap[orig] = partial;

                return partial;
            }

            function getPartials(partials){
                var partial, url;

                do {
                    if (!partials.length) {
                        // Invoke the passed continuation...
                        onLoad( partialTmpls[name].render );

                        // ...and call it a day.
                        return;
                    }

                    partial = partials.pop();
                }
                while (partialTmpls[partial] !== undefined);

                text.get(
                    req.toUrl(partial + (hgnConfig.templateExtension || DEFAULT_EXTENSION)),
                    process,
                    function(err) { if (hgnConfig.errback) hgnConfig.errback(text,req,partial,hgnConfig.templateExtension || DEFAULT_EXTENSION, process); }
                );

                function process(data) { processPartialText(data, partial); }
            }

            function processPartialText(data, partial){
                var
                    refs = [ ],
                    compilationOptions = extend(hgnConfig.compilationOptions)
                ;

                // Minify HTML.
                data = data.replace(/\s+/g,' ');

                var tokens = hogan.scan(data, compilationOptions.delimeters);
                tokens.forEach(function(token, index){
                    if (token.tag != '>') return;

                    // Update the token to use our normalized partial reference.
                    token.n = getPartialPath(token.n, partial);

                    // Make a note of the reference.
                    if (partialRefs.indexOf(token.n) == -1) partialRefs.push(token.n);
                });

                var tree = hogan.parse(tokens, data, compilationOptions);
                var tmpl = hogan.generate(tree, data, compilationOptions);
                var origRender = tmpl.render;
                tmpl.render = function() {
                    var args = Array.prototype.slice.call(arguments);

                    // Provide our partials hash, unless caller provided one.
                    if (!args[1]) args[1] = partialTmpls;

                    return origRender.apply(tmpl, args);
                };
                partialTmpls[partial] = tmpl;

                // Save the stringified version if we're in a build.
                if (config.isBuild) {
                    compilationOptions.asString = true;

                    _partialStrings.push({
                        name: partial,
                        fn: hogan.generate(
                            tree,
                            data,
                            compilationOptions
                        )
                    });
                }

                getPartials(partialRefs);
            }
        }

        function write(pluginName, moduleName, writeModule){
            var
                partialPath = _nameMap[moduleName],
                config = module.config() || { },
                partialModuleName = config.partialModuleName || "_hgnPartials"
            ;

            if (! _partialStrings.some( function(item) { return partialPath == item.name; } ) ) return;

            if (!_wrotePartialModule) writePartialModule();

            // For each hgn template, we write a module definition
            if (!_buildTemplate) _buildTemplate = hogan.compile(
                // TODO interpolate {{partialModuleName}}
                'define("{{pluginName}}!{{moduleName}}", ["' + partialModuleName + '"], function(partials){' +
                    'return partials["{{partialPath}}"].render;' +
                '});\n'
            );

            writeModule( _buildTemplate.render({
                pluginName : pluginName,
                moduleName : moduleName,
                partialPath: partialPath
            }) );

            // We only execute the following once. It defines a module that yields a map of all compiled
            // templates in a form suitable for use as the partials argument (2nd arg) when executing a
            // compiled template's render method. E.g.
            //   {
            //     'templates/Something': {
            //        /* Hogan template instance */
            //        render: function(data, partials) { /* stuff to build Something */ }
            //      }
            //     'templates/AnotherOne': {
            //        render: function(data, partials) { /* stuff to build AnotherOne */ }
            //      }
            //   }

            // It also wraps each template's render method in a function that will provide this map as
            // the 2nd argument to the original render function automatically, unless one is explicitly
            // provided by the caller. For example, a render may look like:
            //   function(data, partials) {
            //     return "Hello, " + data.name + "! " + partials["Details"](data);
            //   }
            // Simplified, such a method is wrapped to effectively look like this:
            //   function(data, partials) {
            //     if (!partials) partials = partialsClosure;
            //     return "Hello, " + data.name + "! " + partials["Details"](data);
            //   }
            function writePartialModule() {
                _wrotePartialModule = true;

                var tmplText =
                    [
                        // TODO interpolate {{partialModuleName}}
                        "define('" + partialModuleName + "', [ 'hogan' ], function(Hogan) {",
                            "var partials = {};",

                            "function addPartial(name, partial) {",
                                "var tmpl = new Hogan.Template(partial,'',Hogan);",
                                "var origRender = tmpl.render;",
                                "tmpl.render = function(){",
                                    "var args = Array.prototype.slice.call(arguments);",
                                    "if (!args[1]) args[1] = partials;",
                                    "return origRender.apply(tmpl, args);",
                                "};",
                                "partials[name] = tmpl;",
                            "}",

                            '{{#partials}}',
                                "addPartial('{{name}}', {{{fn}}});",
                            '{{/partials}}',

                            "return partials;",
                        "});"
                    ].
                    join(' ')
                ;

                writeModule( hogan.
                    compile(tmplText).
                    render( { partials: _partialStrings } )
                );
            }
        }

        function extend(o){
            var F = function() {};
            F.prototype = o;
            return new F();
        }

        return {
            load : load,
            write : write
        };
    }
);
})(define, Array);