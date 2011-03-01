if (new RegExp('v(\\d)\.(\\d)\.(\\d)').exec(process.version)[2]<4) require(__dirname + "/lib/setup").ext('node_modules');
module.exports = require('./node_modules/socket.io');
var Listener = module.exports.Listener;
var nodeTransport = require('./nodeTransport')
Listener.addTransport('nodeTransport', nodeTransport)
module.exports.nodeClient = require ('./nodeClient').nodeClient;
