//versions prior to node 0.4 don't support node_modules for lookup, so unshift the node_modules folder to require paths for those
if (new RegExp('v(\\d)\.(\\d)\.(\\d)').exec(process.version)[2] < 4) require(__dirname + "/lib/setup").ext('node_modules');
//export through socket.io
module.exports = require('./node_modules/socket.io');
var Listener = module.exports.Listener;
var nodeTransport = require('./nodeTransport')
Listener.addTransport('nodeTransport', nodeTransport)
//add nodeClient to the list of exports
module.exports.nodeClient = require('./nodeClient').nodeClient;