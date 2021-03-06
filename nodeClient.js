var urlparse = require('url').parse,
    frame = '~m~',
    qs = require('querystring');
var multipart = require("./node_modules/multipart/lib/multipart");
var events = require('events');
var StringDecoder = require('string_decoder').StringDecoder
var util = require('util');
var path = require('path');

var nodeBase = require('./node_modules/nodeBase');
util.inherits(Socket, nodeBase);

//util.inherits(Socket, events.EventEmitter);
/**
 * @desc simulates a socket.io client with HTTP client
 */
var http = require('http'),
    url = require('url');
/*
  PROTOTYPING SOCKET.IO CLIENT BEHAVIOUR
    var socket = new io.Socket({node_server_url}); 
    socket.connect();
    socket.on('connect', function(){ … }) 
    socket.on('message', function(){ … }) 
    socket.on('disconnect', function(){ … })
*/



function Socket(ip, port, opts)
{
    //this.client  = http.createClient(port, ip);
    if (typeof port !== 'number') throw new Error('[nodeClient] Socket Constructor: need a number for port. But port was ' + typeof port);
    this.host = ip;
    this.port = port;
    this.requestUriBase = "socket.io";
    //this.type = 'xhr-multipart';
    this.type = 'nodeTransport'
    this.headers = {};
    //we write json in the message body
    //this.headers['Content-Type'] = 'application/json';  
    this.headers['connection'] = 'keep-alive';
    //this.headers['Transfer-Encoding']= 'chunked';
    events.EventEmitter.call(this);
    //process.EventEmitter.call(this);
    var self = this;

    this.defaults = {
        secure: false,
        logging: true,
        reconnect: true,
        logLevel: 'ALL',
        timeout: 25000,
        // was heartbeatInterval be a bit generous, cause this must be larger than the serverside heartbeat interval (which now is 10 seconds)
        resource: self.requestUriBase,
        closeTimeout: 0,
        maxReconnectionAttempts: 10,
        reconnectionDelay: 500
    }
    nodeBase.apply(this, [opts]);
    this.connected = false;
    this.connecting = false;
    this.reconnecting = false
    this._heartbeats = 0;
    this._posting = false;
    this._heartbeatTimeout = {};
    this.timeBetweenTries = this.options.reconnectionDelay;
    this.shouldConnect = true; //initially true to connect on startup
    this.initial = true;
    this.maxReconnectionAttempts = this.options.maxReconnectionAttempts;
    this.retries = 0;
    //file handling
    this.isPartFile = false;
    this.currentPart;

    // we try connecting every n milli seconds. On errors n is always doubled.
    this.connectWaitTimer = function interval()
    {
        setTimeout(function ()
        {
            self.connect();
            //self.startInterval();
        }, self.timeBetweenTries); // we cannot use setInterval because we need to change the time all the time.
    }

    //this function enables entrance to the connect function after a timeout
    this.manualConnect = function ()
    {
        //must not be connected
        if (this.connected || this.connecting || this.reconnecting) return;
        this.shouldConnect = true;
        this.timeBetweenTries = this.options.maxReconnectionAttempts
        if (this._heartbeatTimeout._onTimeout !== null) clearTimeout(this._heartbeatTimeout);
        this.retries = 0;
        this.heartbeats = 0
        this.connect()
    }

    //this function enables entrance to the connect function after a timeout
    this._connect = function ()
    {
        self.shouldConnect = true;
        self.connectWaitTimer();
    }

    this._onReconnect = function ()
    {
        if (this._checkMaxTimesConnectionError()) return;
        this.timeBetweenTries *= 2;

        if (this.options.reconnect && !this.reconnecting)
        {
            this.reconnecting = true;
            this.log('retrying to connect in ' + this.timeBetweenTries / 1000 + ' seconds')
            //reconnecting(reconnectionDelay,reconnectionAttempts)
            this.emit('reconnecting', this.timeBetweenTries, this.retries)
            self._connect() //starts a timer before effectively connecting        
        }

    }
}

Socket.prototype._prepareUrl = function ()
{
    return (this.options.secure ? 'https' : 'http') + '://' + this.host + ':' + this.port + '/' + this.options.resource + '/' + this.type + (this.sessionId ? ('/' + this.sessionId) : '/');
};

//here we setup GET and POST requests and do some error handling
Socket.prototype._request = function (url, method, multipart)
{
    if (method == 'POST')
    {
        this.headers['Content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    }
    //var req = this.client.request(method || 'GET', this._prepareUrl(), this.headers);
    var options = {
        host: this.host,
        port: this.port,
        path: this._prepareUrl(),
        method: method || 'GET',
        headers: this.headers
    };
    var req = http.request(options);
    var self = this;
    //INSTALL ERROR AND AVENT HANDLESRS ON SHARED SOCKET AND CONNECTION
    //avoid leaks of event listeners on connection object during POST (cause this gets called every time we send a message)
    var connectionCb = function (e)
        {
            self.warn('req.connection.addListener end called');
            if (this.connected) self._onDisconnect('connection end');
        }
    var socketErrCb = function (e)
        {
            self.error('req.socket.error', e);
            if (this.connected) self._onDisconnect('connection end')
        };
    if (req.socket && req.socket.listeners('error').indexOf(socketErrCb) !== -1) req.socket.on('error', socketErrCb);
    if (req.connection && req.connection.listeners('error').indexOf(socketErrCb) !== -1) req.connection.on('error', socketErrCb);
    if (req.connection && req.connection.listeners('end').indexOf(connectionCb) !== -1) req.connection.on('end', connectionCb);

    //the request ERROR handler is not shared
    req.on('error', function (e)
    {
        self.log("Got " + method + " Request error: " + e.message + ' url: ' + req.path);
        //self.emit('error', {type: (req.method=='GET'?'connect':'send'), 'error':e, 'message': e.message})
    })
    //if (multipart) req.multipart = true;
    //req.open(method || 'GET', this._prepareUrl() + (url ? '/' + url : ''));
    return req;
};

/*
*
* SERVER->CLIENT (GET CHANNEL)
* 
*/
Socket.prototype.connect = function (reconnecting)
{
    if (!this.shouldConnect) return false;
    this.log('connecting...')
    if (this.shouldConnect) this.shouldConnect = false;

    var self = this;
    if (!reconnecting) this.connecting = true;
    // SETUP PARSER FOR MULTIPART GET RESPONSES
    this.parser = multipart.parser();
    this.parser.boundary = "socketio";
    // in all event handlers, "this" is the parser, and "this.part" is the
    // part that's currently being dealt with.
    var buffer = "";
    sendBuffer = "";

    //subscribe to own error events to send them to server
    //this.on('error', function(e){
    //this.send({status:'error', 'message':e.message, 'data':e})//will queue in sendbuffer if no connection available yet, be JSend compliant
    //}); 
/*
  *
  * MULTIPART PARSING (using isaacs multipart parser)
  * 
  */
    //fileHandler = new FileHandler(this)
    //keep track of part status file specific hanlding of parts 
    this.parser.onpartbegin = function (part)
    {
        //self.log('content type '+(part.headers['content-type'])); 
        if (part.headers['filename']) self.emit('OnFileBegin', part)
        else self.emit('OnPartBegin', part)

    };
    this.parser.ondata = function (chunk)
    {
        //self.log('chunk '+ chunk); 
        if (this.isPartFile) self.emit('data', chunk)
        else //its a normal text message
        buffer += chunk.toString();


    };
    this.parser.onpartend = function (part)
    {
        if (part.headers['filename']) self.emit('OnFileEnd', part)
        else self.emit('OnPartEnd')
        self._onData(buffer);
        buffer = "";
    };

    if (!('_sendBuffer' in this)) this._sendBuffer = [];
    //nothing will get sent until request end will be called
    //this.request = client.request('GET', this._prepareUrl, this.headers);
    this.request = this._request('', 'GET', true);
    var buffer;
    this.request.socket.on('error', function (e)
    {
        self.error(e)
    })
    this.request.on('error', function (e)
    {
        //self.emit('error', {'type':'connect', 'message': 'Multipart GET request error: ' + e.message})  
        //self.error('Multipart GET request = Message Server->Client error: ' + e.message)  
        self.ermit(e)
        self._handleConnectError();
    });
    this.request.on('response', function (response)
    {
        self.response = response;
        // bail hard on non-200, something must be wrong
        if (response.statusCode != 200)
        {
            self.emit('error', {
                'type': 'connect',
                message: 'response statuscode was ' + response.statuscode,
                'status': http.STATUS_CODES[response.statusCode]
            })
            self._handleConnectError();
            return;
        }

/*
      *
      * INCOMING SERVER DATA AND MESSAGES
      * 
      */
        response.setEncoding('utf8');
        response.on('error', function (e)
        {
            self.emit('error', {
                'type': 'connect',
                'message': 'Multipart GET request response error ' + e.message
            })
            self._handleConnectError();
        });
        response.on('end', function ()
        {
            //self._onData(buffer);
            self.emit('error', {
                'type': 'disconnect',
                'message': 'Multipart GET request should not receive end.'
            })
            self._handleConnectError();
        });
        response.on('data', function (chunk)
        {
            try
            {
                self._onMultipartData(chunk);

            }
            catch (Err)
            {
                console.log((Err.stack));
                self.emit('error', {
                    'type': 'onMessage',
                    'message': Err.message,
                    'stack': Err.stack
                })
                return; // continue
            }
        });
        //this._onConnect(this.request, this.response);
    })
    this.request.end(); // we send a normal GET request without a body //ends the GET request (however as we get back a session  id, next time we can reuse the same transport by passing in the session id in POSt)  
}

Socket.prototype.disconnect = function ()
{
    // close the parser
    if (this.parser)
    {
        this.parser.close();
        this.parser = null
    }
    try
    {
        //the GET request
        if ('request' in this && this.request)
        {
            this.request.end();
            this.request.connection.destroy();
            if (typeof this.request.abort == 'function') this.request.abort(); //new since node v3.8
        }
        this.log("[GET channel] Closing connection ");
    }
    catch (e)
    {
        this.warn("[GET channel] Error ending connection " + e)
    }
    if (this.connected)
    { //POST request and connection tomeout exist if we were connected
        //the POST request exist only after we connected, cause its onbly then that we start sending heartbeats (after connet)
        try
        {
            //the post request
            if ('_sendRequest' in this)
            {
                this._sendRequest.connection.destroy();
                if (typeof this._sendRequest.abort == 'function') this._sendRequest.abort(); //new since node v3.8
            }
            this.log("[POST channel] Closing connection ");
        }
        catch (e)
        {
            this.warn("[POST channel] Error ending connection " + e)
        }
        this._posting = false;
        //we will not receive any heartbeat anymore, so clear the heartbeat timeout
        if (this._heartbeatTimeout._onTimeout !== null) clearTimeout(this._heartbeatTimeout);
    }
    this.connecting = false;
    this.reconnecting = false;
    delete this.sessionId //important
    this.connected = false;
    this._heartbeats = 0
    this.emit('disconnect', {
        message: 'disconnect'
    });
}

Socket.prototype.send = function (data)
{
    //send the message body
    //this.request.write(JSON.stringify(message), this.headers);
    if (Array.isArray(data))
    {
        this._sendBuffer.push.apply(this._sendBuffer, data);
    }
    else
    {
        if (typeof data !== 'string') data = JSON.stringify(data);
        this._sendBuffer.push(data);
    }
    this._checkSend();
    return this;
    //this.request.write('data=' + encodeURIComponent(data), this.headers);
    //this.request.end(); //sends delimiters for chunked encoding but keeps connection
}

Socket.prototype._checkSend = function ()
{
    if (!this._posting && this._sendBuffer.length)
    { //if we aren't posting and there is something in the buffer: send it
        var encoded = this._encode(this._sendBuffer);
        this._sendBuffer = [];
        this._send(encoded);
    }
};

/*
*
* CLIENT->SERVER (POST CHANNEL)
* 
*/

Socket.prototype._send = function (data)
{
    var self = this;
    this._posting = true;
    this._sendRequest = this._request('send', 'POST');
    this._sendRequest.write('data=' + /*encodeURIComponent*/ qs.escape(data));
    this._sendRequest.on('error', function (e)
    {
        self.ermit(e)
    })
    this._sendRequest.on('response', function (response)
    {
        self._sendResponse = response;
        response.on('error', function (e)
        {
            self.ermit(e)
        })
        if (response.statusCode != 200)
        {
            self.emit('error', {
                'type': 'send',
                'message': 'error sending message, got statuscode ' + http.STATUS_CODES[response.statusCode]
            })
        }
        //throw "response: " + response.statusCode;
        response.setEncoding('utf8');
        response.on('end', function ()
        {
            //nothing to be done here all Ok if we receive end from Post request   
        });
        response.on('data', function (chunk)
        {
            try
            {
                //should be multipart message saying ok
                if (chunk !== 'ok')
                {
                    self.log('Bad response for message received from server, Message was not delivered ' + chunk);
                    self.emit('error', {
                        'type': 'send',
                        'message': 'error sending message ' + chunk
                    })
                    return;
                }
                //buffer+=chunk.toString();
                //json = JSON.parse(chunk); // let's not get crazy here
                //this.emit('message', json);
            }
            catch (Err)
            {
                console.log(Err.stack);
                return; // continue
            }
        });
        self._posting = false;
        self._checkSend(); //poll again to see if something new entered the buffer meanwhile
    })
    this._sendRequest.end(); //sends delimiters for chunked encoding but keeps connection
}

Socket.prototype._onMultipartData = function (multipart)
{
    // feed the multipart stream throught the multipart stream parser
    this.parser.write(multipart);
}

//send a heartbeat message
Socket.prototype._heartbeat = function (h)
{
    var self = this;
    this.info('echoing heartbeat ' + h)
    self.send('~h~' + h); //pong
};

//called when we have an error durring connection (No connection yet) 
// HANDLING CONNECTION ERRORS
Socket.prototype._handleConnectError = function ()
{
    this.log('handling Error during connection')
    this.disconnect()
    //  now lets reconnect
    this._onReconnect()
}

Socket.prototype.setupHeartbeatTimeoutInterval = function (h)
{
    var self = this;
    if (this._heartbeatTimeout._onTimeout !== null) clearTimeout(this._heartbeatTimeout);
    //this.log('heartbeat Timeout cleared ' + 		self._heartbeatTimeout._idleStart   )					 
    self._heartbeatTimeout = setTimeout(function ()
    {
        self.log('heartBeat Timeout from server, should have received heartbeat ' + ++h + ' by now, time passed: ' + self.options.timeout)
        self._onDisconnect('heartbeat timeout');
    }, self.options.timeout);
    //self.log('settup heartbeat Timeout ' + self._heartbeatTimeout._idleStart)			
}
//HANDLING ANSWERS
//request on response
Socket.prototype._onConnect = function ()
{
    //when we connect the server will send a heartbeat within its interval (on the client we start counting a bit longer so that we take into account the transmission time)
    this.setupHeartbeatTimeoutInterval();
    if (this.reconnecting) this.emit('reconnect')
    else this.emit('connect'); //if we were reconnecting differentiate the message
    this.connected = true;
    this.connecting = false;
    this.reconnecting = false;
    this.retries = 0 //reset the retry counter to zero, in case we had errors before
    this.timeBetweenTries = this.options.reconnectionDelay //reset timeout time to inital time too, so next time we will start retrying expnantially from beginning
    //this._doQueue();
    //if (this.options.rememberTransport) this.options.document.cookie = 'socket.io=' + encodeURIComponent(this.transport.type);
};

//response on data
Socket.prototype._onData = function (data)
{
    //first me must mime decode the data
    var msgs = this._decode(data);
    if (msgs === false) return this.error('Bad message received from server ' + data);
    if (msgs)
    {
        for (var i = 0, l = msgs.length; i < l; i++)
        {
            this._onMessage(msgs[i]);
        }
    }
};

//response on data
Socket.prototype._onMessage = function (message)
{
    if (!('sessionId' in this))
    {
        this.sessionId = message;
        this.info(' session ' + this.sessionId + ' established - connected')
        this._onConnect();
    }
    else if (message.substr(0, 3) == '~h~')
    {
        this._onHeartbeat(message.substr(3)); //pong
    }
    else if (message.substr(0, 3) == '~j~')
    {
        try
        {
            var objMessage = JSON.parse(message.substr(3));
            //if (message.indexOf('fifty')>=0) console.log (JSON.parse(message.substr(3)).status)	    
        }
        catch (e)
        {
            return this.emit('error', 'JSON parse error ' + e + ' ' + message.substr(3))
        }
        this.emit('message', objMessage); //JSON message	
    }
    else
    {
        this.emit('message', message);
    }
};

//response on data = hearbeat message
Socket.prototype._onHeartbeat = function (h)
{
    var self = this;
    //if (h == this._heartbeats){
    //this.log('heartbeat received ' + h)	
    //this.log('heartbeat Timeout before clear ' + self._heartbeatTimeout._idleStart)
    //when we receive a heartbeat weclear the timeout and start counting again			
    this.setupHeartbeatTimeoutInterval(h);
    this._heartbeat(h); // echo
    //}
};

Socket.prototype._checkMaxTimesConnectionError = function ()
{
    //start the timer on first usage
    //this._checkStartInterval();
    //reopen connection
    if (this.retries++ >= this.maxReconnectionAttempts)
    {
        //this.emit('error', {type: type, message: 'max retry times reached, retried ' + this.maxReconnectionAttempts + ' times. bailing out'})
        this.error('max retry times reached, retried ' + this.maxReconnectionAttempts + ' times. bailing out')
        this.emit('reconnect_failed') //be coherent with socket.io
        //we shouldnt be in a timer, when we come here, cause the timer gets rearmed only after a disconnect took place and a _connect is called 
        //if (this.connectWaitTimer._onTimeout !== null ) clearTimeout(this._connectWaitTimer);  //that's it, definitely clear the reconnect timeout
        return true;
    }
    return false;
}
Socket.prototype._onDisconnect = function (spec)
{
    //called when we lost connection (actually the connection might still be active so disconnect it!)
    //check if limit reached
    //reopen connection
    //if (spec == 'heartbeat timeout'){
    //this.emit('error', {type: 'disconnect', message: spec + ' retrying in ' + this.timeBetweenTries/1000 + ' seconds'})    
    //reconnect(transport_type,reconnectionAttempts), timeBetweenretries
    //this.emit('disconnect', 'nodeTransport', this.retries, this.timeBetweenTries)
    this.disconnect();

    //now lets reconnect
    this._onReconnect();
}



//HELPERS
Socket.prototype._encode = function (messages)
{
    var ret = '',
        message, messages = Array.isArray(messages) ? messages : [messages];
    for (var i = 0, l = messages.length; i < l; i++)
    {
        message = messages[i] === null || messages[i] === undefined ? '' : String(messages[i]);
        ret += frame + message.length + frame + message;
    }
    return ret;
};

Socket.prototype._decode = function (data)
{
    var messages = [],
        number, n;
    do
    {
        if (data.substr(0, 3) !== frame) return messages;
        data = data.substr(3);
        number = '', n = '';
        for (var i = 0, l = data.length; i < l; i++)
        {
            n = Number(data.substr(i, 1));
            if (data.substr(i, 1) == n)
            {
                number += n;
            }
            else
            {
                data = data.substr(number.length + frame.length)
                number = Number(number);
                break;
            }
        }
        messages.push(data.substr(0, number)); // here
        data = data.substr(number);
    } while (data !== '');
    return messages;
};


//factory method for closure
exports.makeSocket = function (ip, port, opts)
{
    return new Socket(ip, port, opts);
};
exports.nodeClient = Socket;