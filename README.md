Node2Node: Socket.io
============================================

This module adds a new Transport to Socket.io called "nodeTransport", with which you can make socket.io connections between instances of nodes.
The way this is done is quite similar to the xhr-multipart transport. There is also a module from [remy](https://github.com/remy) called [Socket.io-node-client](https://github.com/remy/Socket.io-node-client), which depends on webSocket transport.

## Requirements

- a patched version of socket.IO-Node. Unfortunately right now this is not part of the official release yet. I have come up however with an architecture, thats needs nearly no changes to Socket.IO, and have started a pull request. I will update to the official version of socket.io-Node as soon as this modification is in the master tree.

## How to use

To install and run do the following

	git clone https://github.com/dotmaster/node2node-socket.io node2node-socket.io
	git submodules update --init //this clones the patched version of socket.io

### Implementing it on your project

On the server:

	var http = require('http'), 
			io = require('./path/to/node2node-socket.io'),
			
	server = http.createServer(function(req, res){
		// your normal server code
		res.writeHead(200, {'Content-Type': 'text/html'});
		res.end('<h1>Hello world</h1>');
	});
	
	server.listen(80);
			
	// socket.io, I choose you
	var socket = io.listen(server);
	
	socket.on('connection', function(client){
	  // new client is here!
	  client.on('message', function(){ … })
	  client.on('disconnect', function(){ … })
	});
	
On the client:

    io = require('node2node-socket.io')
  
    var Client = new io.nodeClient('0.0.0.0', 1234);
    Client.connect(); //is async!! but send requests will buffers up if no connection there yet
    Client.on('connect', function(){...})
    Client.on('message', function(client){...})
    Client.on('disconnect', function(){...})  

## Features

NodeClient features a client side heartbeat function, which means that if the server was to hang up, the client would get a timeout too and will try to reconnect in an exponentially augmenting time interval until a maximum of retries is reached.

Some more 'error' events are added to the Client Object, so you can subscribe to them. The error Object always has a type and a message field.

Logging can be turned on/off in nodeClient by passing an option to the nodeClient like new io.nodeClient('0.0.0.0', 1234, {logging: true})

NEW from 0.0.2! Now uses nodeBase to do coherent logging.

## Events

- reconnect-failed //emitted after all reconnection attempts failed and we are not trying to connect anymore, until manualConnect() is called
- reconnecting
- disconnect
- connect

## Methods

- connect()
- disconnect()
- manualConnect() ... like connect, but resets the retry timeout and status variable first

## Status variables

- connected
- connecting
- reconnecting

#options

- logging: true,
- logLevel: 'ALL'

socket.io specific options

- reconnect: true,
- secure: false,
- timeout: 25000,// if no heartbeat message is received in this time frame, we consider the client disconnected
- resource: 'socket.io'
- maxReconnectionAttempts: 10,
- reconnectionDelay: 500

## Modifications to Socket.io

- a static function called addTransport is exposed to the outside world to add new transports to socket.io
- the Client base class of every transport is exposed to the outside world

## Credits

- Gregor Schwab &lt;greg@synaptic-labs.net&gt; ([dotmaster](http://github.com/dotmaster))

- Guillermo Rauch &lt;guillermo@learnboost.com&gt; ([Guille](http://github.com/guille))

- Arnout Kazemier ([3rd-Eden](http://github.com/3rd-Eden))

## License 

(The MIT License)

Copyright (c) 2011 Gregor Schwab &lt;dev@synaptic-labs.net&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
